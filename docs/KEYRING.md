# OS keyring setup (Windows, macOS, Ubuntu)

`imap-mcp-server` can store account passwords and the file-store data-encryption
key (DEK) in the operating system credential store via the optional native
dependency [`@napi-rs/keyring`](https://www.npmjs.com/package/@napi-rs/keyring).

When the binding or desktop secret service is unavailable, the server **soft-fails**
and falls back to the encrypted file store (`~/.imap-mcp/accounts.json` with
AES-256-GCM). Prefer the OS keyring (or env / Vault) over a co-located
`~/.imap-mcp/.key` whenever you can.

Service name used in the keyring: **`imap-mcp`**.

Account secrets use names like `account:<accountId>:imap-password` (also
`smtp-password`, `imap-user`, and `smtp-user` when those fields are stored). The
file-store DEK uses the name **`store-dek`**.

## Credential resolution (reminder)

At runtime, each IMAP/SMTP username/password is resolved in this order (first hit wins):

1. **`IMAP_MCP_ACCOUNT_*` environment variables** (captured at process start, scrubbed from `process.env`)
2. **Vault / OpenBao** — only when the account opts in (`credentialSource: "vault"` and/or `vaultPath`) **and** Vault/OpenBao env auth is configured
3. **OS keyring** (this document)
4. **Encrypted file store** (`accounts.json` + DEK in keyring or legacy `.key`)

See [SECURITY.md](../SECURITY.md) and the README “Credential resolution order” section for Vault/env details.

### Useful environment flags

| Variable | Effect |
| --- | --- |
| `IMAP_MCP_ALLOW_FILE_KEY=0` | Refuse creating a new co-located `~/.imap-mcp/.key` (prefer keyring/Vault/env). If no keyring DEK is available, the process uses an **ephemeral** DEK — existing file-store credentials will fail to decrypt and file writes will not persist across restarts. |
| `IMAP_MCP_MIGRATE_CREDENTIALS=1` | Migrate legacy AES-CBC ciphertext to AES-GCM on load |
| `IMAP_MCP_SILENCE_CRYPTO_NOTICE=1` | Hide the startup credential-store notice |
| `VAULT_ADDR` / `BAO_ADDR` + token or AppRole | Enable Vault/OpenBao for **opted-in** accounts |
| `IMAP_MCP_VAULT_PATH` | Default KV path template for opted-in accounts (not an ambient reroute) |

---

## Windows (Credential Manager)

`@napi-rs/keyring` uses **Windows Credential Manager** (generic credentials).

### Requirements

- A normal interactive Windows user session (desktop or RDP with a loaded profile).
- Optional dependency installed with the package (`@napi-rs/keyring` and the
  matching `@napi-rs/keyring-win32-*` binary). `npm install` / `npm install -g`
  for this project pulls it when the platform optional dependency resolves.

### Verify

1. Add or update an account in the setup wizard (or via tools) so a password is stored.
2. Open **Control Panel → Credential Manager → Windows Credentials** (or run
   `control /name Microsoft.CredentialManager`).
3. Look for a generic credential whose target/service relates to **`imap-mcp`**.

### Notes

- Headless CI agents and some service accounts may not have a usable Credential
  Manager context; use env overrides or Vault there.
- Uninstalling the app does not always delete Credential Manager entries; remove
  stale `imap-mcp` entries manually if you retire an install.

---

## macOS (Keychain)

On macOS, `@napi-rs/keyring` uses the system **Keychain**.

### Requirements

- A logged-in user session with access to the login (or other unlocked) keychain.
- The optional `@napi-rs/keyring` / `@napi-rs/keyring-darwin-*` packages installed
  for your architecture (Apple Silicon or Intel).

### First use

macOS may show a Keychain access prompt the first time the server reads or writes
a secret. Approve access for **Node** (or your MCP host process) for service
**`imap-mcp`**. Prefer “Always Allow” for unattended local MCP use on a trusted machine.

### Verify

```bash
security find-generic-password -s "imap-mcp" -a "store-dek" 2>/dev/null || true
# Account passwords use -a values like: account:<id>:imap-password
```

Or open **Keychain Access**, search for `imap-mcp`.

### Notes

- SSH/headless sessions without an unlocked keychain will soft-fail to the file
  store (or fail closed if you set `IMAP_MCP_ALLOW_FILE_KEY=0` and have no DEK).
- On managed Macs, prefer env/Vault if MDM restricts Keychain prompts.

---

## Ubuntu 24.04 LTS and Ubuntu 26.04 (libsecret)

On Linux, `@napi-rs/keyring` prefers the **Freedesktop Secret Service** API
(GNOME Keyring, KWallet, KeePassXC, …). If no Secret Service is available it may
fall back to the in-memory kernel **keyutils** store, which **does not persist
across reboots** — treat that as unsuitable for lasting credentials.

### Packages (apt)

Same package set applies to **24.04 (noble)** and **26.04 (resolute)** desktop/server
images that ship GNOME Keyring / libsecret (names verified against Ubuntu archives):

**GNOME / Ubuntu Desktop (recommended):** install a Secret Service provider and
unlock it at login. `gnome-keyring` supplies the usual daemon; `libsecret-1-0`
is commonly present on desktop images; `libsecret-tools` is optional (for
`secret-tool` verification).

```bash
sudo apt update
sudo apt install -y gnome-keyring libsecret-1-0 libsecret-tools
```

**KDE / Kubuntu:** install a Secret Service provider. KWallet (`kwallet6` on recent
releases) may expose Secret Service; if apps cannot store secrets, install
`gnome-keyring` as well and ensure a Secret Service backend is selected for your
session (some KDE setups need an XDG desktop-portal Secret backend pointing at
gnome-keyring). Keep one clear unlock-at-login path.

Minimal library-only install (you still need a running daemon that implements
Secret Service):

```bash
sudo apt install -y libsecret-1-0 libsecret-tools
```

### Unlock on login

- On a standard Ubuntu GNOME desktop, **logging into the graphical session**
  unlocks the default keyring via PAM/`gnome-keyring-daemon`.
- If you see repeated password prompts for “Default keyring”, set the keyring
  password to match your login password (Seahorse / Passwords and Keys), or
  unlock it once per session.
- Confirm the daemon is present after login:

```bash
echo "$XDG_RUNTIME_DIR"
# Secret Service usually needs a D-Bus session bus:
echo "$DBUS_SESSION_BUS_ADDRESS"
pgrep -a gnome-keyring || true
secret-tool search --all service imap-mcp 2>/dev/null || true
```

### Headless / SSH caveats

Secret Service generally needs:

- A **D-Bus session bus** (`DBUS_SESSION_BUS_ADDRESS`)
- An **unlocked** keyring / wallet for that user

Pure SSH or systemd-user services **without** an unlocked graphical (or
explicitly started) keyring often cannot use persistent Secret Service storage.
In those environments:

1. Prefer **`IMAP_MCP_ACCOUNT_*` env overrides** or **Vault/OpenBao** opt-in, or
2. Allow the encrypted file store / co-located key only if you accept local
   filesystem threat model (`IMAP_MCP_ALLOW_FILE_KEY` defaults allow creating
   `.key` when keyring DEK is unavailable). Setting `IMAP_MCP_ALLOW_FILE_KEY=0`
   without a keyring DEK uses an ephemeral DEK (existing file credentials fail;
   writes do not survive restart).

Do not expect kernel keyutils fallback to survive reboot.

### Verify on Ubuntu

```bash
# After the server has stored a secret:
secret-tool search --all service imap-mcp
```

Or use Seahorse (Passwords and Keys) and search for `imap-mcp`.

---

## Troubleshooting

| Symptom | Likely cause | What to try |
| --- | --- | --- |
| Passwords keep landing only in `accounts.json` / `.key` | Native module missing or Secret Service/Keychain unavailable | Reinstall deps; on Linux install `gnome-keyring` + `libsecret-1-0`; ensure GUI login unlock |
| Works on desktop, fails over SSH | No session D-Bus / locked keyring | Use env or Vault for remote sessions |
| Startup notice about co-located `.key` | DEK still on disk (`.key`), not in OS keyring | Unlock keyring and restart — an existing `.key` DEK is promoted into the keyring automatically when available. Use `IMAP_MCP_MIGRATE_CREDENTIALS=1` only to convert legacy CBC ciphertext to GCM |
| Want to forbid new file keys | Policy choice | Set `IMAP_MCP_ALLOW_FILE_KEY=0` |

## Related docs

- [SECURITY.md](../SECURITY.md) — threat model and disclosure
- README — [Credential resolution order](../README.md#credential-resolution-order) and env-override sections
