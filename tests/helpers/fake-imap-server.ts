import net from 'node:net';

/**
 * A minimal scripted IMAP server for tests that need the real imapflow
 * command implementations, not mocks. It speaks just enough IMAP4rev1 over
 * plain TCP on 127.0.0.1 for imapflow to log in, list, select, STATUS and rename,
 * and records every command it receives so a test can assert on the exact
 * wire traffic (e.g. "no CLOSE was ever sent").
 */
export interface FakeImapServerOptions {
  /** Capabilities advertised in addition to IMAP4rev1 (e.g. ['UNSELECT']). */
  capabilities?: string[];
  /** Mailbox paths that exist; INBOX is always present. */
  folders?: string[];
  /** Reply `NO` to RENAME with this text instead of performing it. */
  refuseRename?: string;
}

export interface FakeImapServer {
  port: number;
  /** Every command received, as `VERB args` without the tag (e.g. `EXAMINE INBOX`). */
  commands: string[];
  folders: Set<string>;
  close(): Promise<void>;
}

function parseArgs(rest: string): string[] {
  const args: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest)) !== null) {
    args.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2]);
  }
  return args;
}

const quote = (s: string) => `"${s.replace(/["\\]/g, c => `\\${c}`)}"`;

export async function startFakeImapServer(options: FakeImapServerOptions = {}): Promise<FakeImapServer> {
  const caps = ['IMAP4rev1', ...(options.capabilities ?? [])].join(' ');
  const folders = new Set(['INBOX', ...(options.folders ?? [])]);
  const commands: string[] = [];
  const sockets = new Set<net.Socket>();

  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    let buffer = '';
    const send = (line: string) => socket.write(`${line}\r\n`);
    send(`* OK [CAPABILITY ${caps}] fake server ready`);

    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      let idx: number;
      while ((idx = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const [tag, rawVerb = '', ...restParts] = line.split(' ');
        const verb = rawVerb.toUpperCase();
        const rest = restParts.join(' ');
        const args = parseArgs(rest);
        commands.push(rest ? `${verb} ${args.join(' ')}` : verb);

        switch (verb) {
          case 'CAPABILITY':
            send(`* CAPABILITY ${caps}`);
            send(`${tag} OK CAPABILITY completed`);
            break;
          case 'LOGIN':
            send(`${tag} OK [CAPABILITY ${caps}] LOGIN completed`);
            break;
          case 'LIST':
          case 'LSUB': {
            const pattern = args[1] ?? '';
            if (pattern === '') {
              send(`* ${verb} (\\Noselect) "/" ""`);
            } else {
              for (const f of folders) {
                send(`* ${verb} () "/" ${quote(f)}`);
              }
            }
            send(`${tag} OK ${verb} completed`);
            break;
          }
          case 'SELECT':
          case 'EXAMINE': {
            const name = args[0];
            if (!folders.has(name)) {
              send(`${tag} NO Mailbox does not exist`);
              break;
            }
            send('* FLAGS (\\Seen \\Deleted)');
            send('* 0 EXISTS');
            send('* OK [UIDVALIDITY 1] UIDs valid');
            send('* OK [UIDNEXT 1] Predicted next UID');
            send(`${tag} OK [${verb === 'EXAMINE' ? 'READ-ONLY' : 'READ-WRITE'}] ${verb} completed`);
            break;
          }
          case 'STATUS': {
            const name = args[0];
            if (!folders.has(name)) {
              send(`${tag} NO Mailbox does not exist`);
              break;
            }
            send(`* STATUS ${quote(name)} (MESSAGES 0 RECENT 0 UNSEEN 0 UIDNEXT 1 UIDVALIDITY 1)`);
            send(`${tag} OK STATUS completed`);
            break;
          }
          case 'RENAME': {
            const [from, to] = args;
            if (options.refuseRename) {
              send(`${tag} NO ${options.refuseRename}`);
              break;
            }
            if (!folders.has(from) || folders.has(to)) {
              send(`${tag} NO RENAME failed`);
              break;
            }
            for (const f of [...folders]) {
              if (f === from || f.startsWith(`${from}/`)) {
                folders.delete(f);
                folders.add(to + f.slice(from.length));
              }
            }
            send(`${tag} OK RENAME completed`);
            break;
          }
          case 'LOGOUT':
            send('* BYE logging out');
            send(`${tag} OK LOGOUT completed`);
            socket.end();
            break;
          case 'ID':
            send('* ID NIL');
            send(`${tag} OK ID completed`);
            break;
          default:
            // NOOP, CLOSE, UNSELECT, ENABLE, ...: accept and record.
            send(`${tag} OK ${verb} completed`);
        }
      }
    });
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;

  return {
    port,
    commands,
    folders,
    close: () =>
      new Promise<void>(resolve => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}
