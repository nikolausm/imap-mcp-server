#!/bin/bash
# IMAP MCP Pro - Credential Generation Script
# Author: Colin Bitterfield <colin@bitterfield.com>
# Date: 2025-11-06
# Version: 1.0.0

set -e

INSTALL_TYPE="${1:-user}"
CONFIG_DIR="${2}"
DATA_DIR="${3}"

# Get customer/user identifier
if [ -z "$MCP_USER_ID" ]; then
    # Default to current username for single-user installations
    MCP_USER_ID=$(whoami)
fi

echo "Generating credentials for user: $MCP_USER_ID"

# Generate secure password (32 characters)
if command -v openssl &> /dev/null; then
    ADMIN_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-32)
    API_KEY=$(openssl rand -hex 32)
else
    # Fallback if openssl not available
    ADMIN_PASSWORD=$(cat /dev/urandom | tr -dc 'a-zA-Z0-9' | fold -w 32 | head -n 1)
    API_KEY=$(cat /dev/urandom | tr -dc 'a-f0-9' | fold -w 64 | head -n 1)
fi

# Save credentials to secure file
CREDS_FILE="$CONFIG_DIR/credentials.env"
cat > "$CREDS_FILE" <<EOF
# IMAP MCP Pro Credentials
# Generated: $(date)
# User: $MCP_USER_ID

MCP_USER_ID=$MCP_USER_ID
ADMIN_PASSWORD=$ADMIN_PASSWORD
API_KEY=$API_KEY
WEB_PORT=3000
EOF

# Set restrictive permissions
chmod 600 "$CREDS_FILE"

# Initialize database with user
DB_FILE="$DATA_DIR/database.db"

if [ ! -f "$DB_FILE" ]; then
    echo "Initializing database..."

    # Create user in database (using Node.js to access DatabaseService)
    node -e "
const { DatabaseService } = require('./dist/services/database-service.js');
const crypto = require('crypto');

const db = new DatabaseService();
const userId = crypto.randomUUID();

// Create default user
const user = db.createUser({
  user_id: userId,
  username: '$MCP_USER_ID',
  email: undefined,
  organization: 'Personal',
  is_active: true
});

console.log('User created:', user.username);
"
fi

echo "✓ Credentials generated and saved to: $CREDS_FILE"
echo "✓ Database initialized at: $DB_FILE"
