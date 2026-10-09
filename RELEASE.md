# Releasing from jmagly/imap-mcp-server

This fork tracks [nikolausm/imap-mcp-server](https://github.com/nikolausm/imap-mcp-server)
and carries security hardening that may land upstream asynchronously. Cut
releases from **this fork** when you need the hardened bits before (or without)
an upstream merge.

## Prerequisites

- CI green on the branch you intend to tag (`main` or a release branch such as
  `hardened`)
- `package.json` / `server.json` version fields in sync
- Local verification: `npm ci && npm run lint && npm test && npm run build`

## Version bump

1. Update `package.json` `version` and matching fields in `server.json`.
2. Move `[Unreleased]` notes in `CHANGELOG.md` under `## [X.Y.Z] - YYYY-MM-DD`.
3. Commit: `chore(release): vX.Y.Z`

## Tag and GitHub Release

```bash
git tag -a "vX.Y.Z" -m "vX.Y.Z"
git push origin "vX.Y.Z"
gh release create "vX.Y.Z" --title "vX.Y.Z" --notes-file CHANGELOG.md --latest
```

Attach build artifacts if useful:

```bash
npm run build
tar -czf "imap-mcp-server-vX.Y.Z-dist.tgz" dist public package.json README.md LICENSE
gh release upload "vX.Y.Z" "imap-mcp-server-vX.Y.Z-dist.tgz"
```

Prereleases are fine while validating:

```bash
gh release create "vX.Y.Z-rc.1" --prerelease --title "vX.Y.Z-rc.1" --generate-notes
```

## npm publish

**Do not publish to the public `imap-mcp-server` npm package from this fork**
without explicit maintainer approval and a distinct package name / scope
(e.g. `@jmagly/imap-mcp-server`). Upstream owns Trusted Publishing OIDC for
`nikolausm/imap-mcp-server`.

The upstream `.github/workflows/release.yml` publishes to npm + MCP Registry on
`v*` tags for the upstream repo. On this fork, prefer **GitHub Releases only**
unless you have intentionally configured a scoped package and Trusted Publisher
for `jmagly/imap-mcp-server`.

## Consumers

Point MCP configs at a git tag or GitHub release tarball of this fork until
hardening is available on npm from upstream:

```json
{
  "mcpServers": {
    "imap": {
      "command": "npx",
      "args": ["-y", "github:jmagly/imap-mcp-server#vX.Y.Z"],
      "env": {}
    }
  }
}
```

Or install from a cloned checkout after `npm run build`.

## Syncing with upstream

```bash
git fetch upstream
git checkout main
git merge upstream/main   # or rebase
# resolve conflicts favoring security defaults where they diverge
git push origin main
```

Cherry-pick or re-merge `security/harden-path-jail-readonly-bind` if upstream
has not yet absorbed the hardening.
