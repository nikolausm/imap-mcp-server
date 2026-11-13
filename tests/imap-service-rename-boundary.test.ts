import { describe, it, expect, afterEach, vi } from 'vitest';
import { ImapService } from '../src/services/imap-service.js';
import { folderTools } from '../src/tools/folder-tools.js';
import type { ImapAccount } from '../src/types/index.js';
import { startFakeImapServer, type FakeImapServer } from './helpers/fake-imap-server.js';

/**
 * imapflow's mailboxRename() deselects the source first when it is the
 * selected mailbox, and without UNSELECT that deselect is a CLOSE, which
 * expunges every message flagged \Deleted. renameFolder must never send it.
 *
 * Unlike tests/imap-service.test.ts this does NOT mock imapflow: the real
 * ImapService drives the real imapflow command implementations against a
 * scripted server, and the test asserts on the commands actually sent.
 */
describe('renameFolder at the real imapflow command boundary', () => {
  let server: FakeImapServer | undefined;
  let service: ImapService | undefined;

  afterEach(async () => {
    if (service) await service.disconnect('acct');
    if (server) await server.close();
    service = undefined;
    server = undefined;
  });

  async function setup(capabilities: string[], refuseRename?: string) {
    server = await startFakeImapServer({
      capabilities,
      folders: ['Projects', 'Projects/Acme'],
      refuseRename,
    });
    service = new ImapService();
    const account: ImapAccount = {
      id: 'acct',
      name: 'Fake',
      host: '127.0.0.1',
      port: server.port,
      user: 'user',
      password: 'pass',
      tls: false,
    };
    await service.connect(account);
    return server;
  }

  /** Commands sent from index `start` onwards, ignoring NOOPs. */
  function commandsAfter(srv: FakeImapServer, start: number): string[] {
    return srv.commands.slice(start).filter(c => c !== 'NOOP');
  }

  it.each([
    ['without UNSELECT', [] as string[]],
    ['with UNSELECT', ['UNSELECT']],
  ])('%s: renames a selected source without CLOSE or EXPUNGE', async (_label, caps) => {
    const srv = await setup(caps);

    // A prior operation leaves the source selected on the pooled connection.
    await service!.selectFolder('acct', 'Projects');
    expect(srv.commands).toContain('SELECT Projects');

    const start = srv.commands.length;
    const result = await service!.renameFolder('acct', 'Projects', 'Clients');

    const sent = commandsAfter(srv, start);
    expect(sent).toContain('EXAMINE INBOX');
    expect(sent).toContain('RENAME Projects Clients');
    expect(sent.indexOf('EXAMINE INBOX')).toBeLessThan(sent.indexOf('RENAME Projects Clients'));
    expect(sent.some(c => c.startsWith('CLOSE'))).toBe(false);
    expect(sent.some(c => c.startsWith('UNSELECT'))).toBe(false);
    expect(sent.some(c => /EXPUNGE/.test(c))).toBe(false);
    expect(srv.commands.some(c => c.startsWith('CLOSE') || /EXPUNGE/.test(c))).toBe(false);

    expect(result).toEqual({
      oldPath: 'Projects',
      newPath: 'Clients',
      renamedChildren: [{ oldPath: 'Projects/Acme', newPath: 'Clients/Acme' }],
    });
    expect([...srv.folders].sort()).toEqual(['Clients', 'Clients/Acme', 'INBOX']);
  });

  /**
   * imapflow's run() awaits `preCheck` (its IDLE handshake) before the RENAME
   * command checks whether the source is selected. Any other caller that
   * gets the event loop during that await could select the source, and the
   * RENAME command would then deselect it with CLOSE. Here the rename is
   * parked at exactly that await while a real imap_folder_status call for the
   * source runs, then released.
   */
  it.each([
    ['without UNSELECT', [] as string[]],
    ['with UNSELECT', ['UNSELECT']],
  ])('%s: a concurrent imap_folder_status cannot select the source during the rename preCheck', async (_label, caps) => {
    const srv = await setup(caps);
    const client = (service as any).connections.get('acct').client;

    // Park the next RENAME inside run()'s preCheck await.
    let releaseGate!: () => void;
    const gate = new Promise<void>(resolve => { releaseGate = resolve; });
    let enteredPreCheck!: () => void;
    const inPreCheck = new Promise<void>(resolve => { enteredPreCheck = resolve; });
    const originalRun = client.run.bind(client);
    client.run = (command: string, ...args: unknown[]) => {
      if (command.toUpperCase() === 'RENAME') {
        client.preCheck = async () => {
          client.preCheck = false;
          enteredPreCheck();
          await gate;
        };
      }
      return originalRun(command, ...args);
    };

    // The real imap_folder_status handler, wired to the real service.
    let folderStatus!: Function;
    folderTools(
      { registerTool: (name: string, _schema: unknown, handler: Function) => {
        if (name === 'imap_folder_status') folderStatus = handler;
      } } as any,
      service!,
      { resolveAccountId: (id: string) => id } as any,
    );

    const start = srv.commands.length;
    const rename = service!.renameFolder('acct', 'Projects', 'Clients');
    await inPreCheck;

    const status = folderStatus({ accountId: 'acct', folder: 'Projects' });
    // Let the status call run as far as it can while RENAME is parked: until
    // imapflow has Projects selected (the bug) or the call is queued for the
    // mailbox lock.
    await vi.waitFor(() => {
      expect(client.mailbox?.path === 'Projects' || client.locks.length > 0).toBe(true);
    });
    expect(srv.commands.slice(start)).not.toContain('SELECT Projects');

    releaseGate();
    const [renameResult, statusResult] = await Promise.allSettled([rename, status]);

    const sent = commandsAfter(srv, start);
    expect(sent.some(c => c.startsWith('CLOSE') || c.startsWith('UNSELECT') || /EXPUNGE/.test(c))).toBe(false);
    expect(sent).toContain('RENAME Projects Clients');
    // Any SELECT of the source happens only after the rename, and fails.
    const select = sent.indexOf('SELECT Projects');
    if (select !== -1) {
      expect(select).toBeGreaterThan(sent.indexOf('RENAME Projects Clients'));
    }

    expect(renameResult).toMatchObject({ status: 'fulfilled', value: { oldPath: 'Projects', newPath: 'Clients' } });
    // The status call ran after the rename, so its folder no longer exists.
    expect(statusResult.status).toBe('rejected');
    expect([...srv.folders].sort()).toEqual(['Clients', 'Clients/Acme', 'INBOX']);
  });

  it('reports a server NO as server_refused, still without CLOSE', async () => {
    const srv = await setup([], 'Permission denied');
    await service!.selectFolder('acct', 'Projects');

    await expect(service!.renameFolder('acct', 'Projects', 'Clients'))
      .rejects.toMatchObject({ reason: 'server_refused', message: expect.stringContaining('Permission denied') });
    expect(srv.commands.some(c => c.startsWith('CLOSE') || /EXPUNGE/.test(c))).toBe(false);
  });
});
