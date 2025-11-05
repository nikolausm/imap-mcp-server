# Running IMAP MCP Server with launchctl (macOS)

This guide explains how to set up the IMAP MCP server to run automatically as a launchd service on macOS using launchctl.

## Overview

Using launchctl offers several advantages:
- **Auto-start**: Service starts automatically when you log in
- **Auto-restart**: Service automatically restarts if it crashes
- **Background operation**: Runs in the background without terminal windows
- **Log management**: Centralized logging to dedicated log files
- **Resource management**: Better integration with macOS system services

## Prerequisites

- macOS system
- IMAP MCP Server installed and built (`npm install && npm run build`)
- Node.js and npm installed

## Setup Instructions

### 1. Create the LaunchAgent Directory

```bash
mkdir -p ~/Library/LaunchAgents
```

### 2. Create the Property List (plist) File

Create a file at `~/Library/LaunchAgents/com.imap-mcp-server.plist` using the sample provided in this repository:

```bash
cp examples/com.imap-mcp-server.plist ~/Library/LaunchAgents/
```

Or create it manually using the sample template below.

### 3. Edit the plist File

Update the following paths in the plist file to match your setup:

- **WorkingDirectory**: Path to your IMAP MCP server installation
- **PATH**: Ensure it includes the directory where your `node` and `npm` binaries are located
- **StandardOutPath**: Log file location (optional)
- **StandardErrorPath**: Error log file location (optional)

Common Node.js binary locations:
- Homebrew: `/opt/homebrew/bin` (Apple Silicon) or `/usr/local/bin` (Intel)
- MacPorts: `/opt/local/bin`
- nvm: `/Users/YOUR_USERNAME/.nvm/versions/node/VERSION/bin`

### 4. Create Log Directory

```bash
mkdir -p ~/Library/Logs
```

### 5. Load the Service

```bash
launchctl load ~/Library/LaunchAgents/com.imap-mcp-server.plist
```

The service will start automatically and continue running in the background.

## Managing the Service

### Check Service Status

```bash
launchctl list | grep imap-mcp-server
```

Output format: `PID Status Label`
- If PID is shown, the service is running
- Status code (usually 0 for success)

### Start the Service

```bash
launchctl start com.imap-mcp-server
```

### Stop the Service

```bash
launchctl stop com.imap-mcp-server
```

### Restart the Service

After making code changes, rebuild and restart:

```bash
npm run build
launchctl kickstart -k gui/$(id -u)/com.imap-mcp-server
```

The `-k` flag kills the existing process before restarting.

### Unload the Service

To completely disable the service:

```bash
launchctl unload ~/Library/LaunchAgents/com.imap-mcp-server.plist
```

### Reload After Configuration Changes

If you modify the plist file:

```bash
launchctl unload ~/Library/LaunchAgents/com.imap-mcp-server.plist
launchctl load ~/Library/LaunchAgents/com.imap-mcp-server.plist
```

## Viewing Logs

### Standard Output Log

```bash
tail -f ~/Library/Logs/imap-mcp-server.log
```

### Error Log

```bash
tail -f ~/Library/Logs/imap-mcp-server.error.log
```

### View Recent Logs

```bash
# Last 50 lines
tail -n 50 ~/Library/Logs/imap-mcp-server.log

# Last 50 error lines
tail -n 50 ~/Library/Logs/imap-mcp-server.error.log
```

## Troubleshooting

### Service Won't Start

1. Check the logs for errors:
   ```bash
   cat ~/Library/Logs/imap-mcp-server.error.log
   ```

2. Verify the plist file syntax:
   ```bash
   plutil -lint ~/Library/LaunchAgents/com.imap-mcp-server.plist
   ```

3. Check PATH and WorkingDirectory in the plist file

4. Ensure the project is built:
   ```bash
   cd /path/to/imap-mcp-server
   npm run build
   ```

### Service Keeps Crashing

1. Check error logs for Node.js errors
2. Try running manually first to diagnose:
   ```bash
   cd /path/to/imap-mcp-server
   npm run web
   ```
3. Verify all dependencies are installed: `npm install`

### Permission Issues

Ensure the plist file has correct permissions:
```bash
chmod 644 ~/Library/LaunchAgents/com.imap-mcp-server.plist
```

### Changes Not Taking Effect

After code changes, always rebuild and restart:
```bash
npm run build
launchctl kickstart -k gui/$(id -u)/com.imap-mcp-server
```

## Alternative: Running Stdio Mode

The sample plist runs the web server mode (`npm run web`). To run stdio mode instead (for direct MCP integration), modify the ProgramArguments:

```xml
<key>ProgramArguments</key>
<array>
    <string>/opt/local/bin/npm</string>
    <string>start</string>
</array>
```

Note: Stdio mode is typically used when Claude Desktop or another MCP client manages the server lifecycle directly.

## Uninstalling

To completely remove the launchd service:

```bash
launchctl unload ~/Library/LaunchAgents/com.imap-mcp-server.plist
rm ~/Library/LaunchAgents/com.imap-mcp-server.plist
rm ~/Library/Logs/imap-mcp-server.log
rm ~/Library/Logs/imap-mcp-server.error.log
```

## Security Considerations

- The service runs with your user permissions
- Account credentials are stored encrypted in `~/.imap-mcp/accounts.json`
- Logs may contain email metadata; ensure proper file permissions
- Consider log rotation for long-running services

## Additional Resources

- [launchd.info](https://www.launchd.info/) - Comprehensive launchd documentation
- [Apple Developer - launchd](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html)
- [MCP Documentation](https://modelcontextprotocol.io/)
