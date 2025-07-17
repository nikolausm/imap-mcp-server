# Example Usage

This document shows how to use the IMAP MCP server with Claude Desktop.

## Configuration

Add to your Claude Desktop configuration (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "imap": {
      "command": "node",
      "args": ["/Users/michaelnikolaus/RiderProjects/ImapClient/dist/index.js"]
    }
  }
}
```

## Example Prompts

### 1. Add an Email Account

```
Add my Gmail account:
- Name: Personal Gmail
- Host: imap.gmail.com
- Port: 993
- Username: myemail@gmail.com
- Password: [app-specific password]
```

### 2. List All Accounts

```
Show me all my configured email accounts
```

### 3. Connect to an Account

```
Connect to my Personal Gmail account
```

### 4. List Folders

```
List all folders in my email account
```

### 5. Check Unread Emails

```
How many unread emails do I have in each folder?
```

### 6. Get Latest Emails

```
Show me the 5 most recent emails in my inbox
```

### 7. Search Emails

```
Search for emails from john@example.com in the last week
```

### 8. Read an Email

```
Show me the content of email with UID 12345
```

### 9. Mark Emails

```
Mark email 12345 as read
```

### 10. Delete an Email

```
Delete email with UID 12345 from my inbox
```

## Common Email Provider Settings

### Gmail
- Host: imap.gmail.com
- Port: 993
- TLS: true
- Note: Requires app-specific password with 2FA enabled

### Outlook/Hotmail
- Host: outlook.office365.com
- Port: 993
- TLS: true

### Yahoo Mail
- Host: imap.mail.yahoo.com
- Port: 993
- TLS: true
- Note: Requires app-specific password

### iCloud Mail
- Host: imap.mail.me.com
- Port: 993
- TLS: true
- Note: Requires app-specific password

## Troubleshooting

1. **Authentication Failed**: 
   - Ensure you're using app-specific passwords for Gmail/Yahoo
   - Check that IMAP is enabled in your email settings

2. **Connection Timeout**:
   - Verify the host and port settings
   - Check your network connection
   - Some corporate networks block IMAP ports

3. **Folder Not Found**:
   - Use the list folders tool to see available folders
   - Folder names are case-sensitive
   - Gmail uses labels which appear as folders