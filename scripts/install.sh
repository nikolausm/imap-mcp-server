#!/bin/bash
# IMAP MCP Pro - Installation Script
# Author: Colin Bitterfield <colin@bitterfield.com>
# Date: 2025-11-06
# Version: 1.0.0

set -e

# Parse arguments from Makefile
PLATFORM="${1:-$(uname -s | tr '[:upper:]' '[:lower:]')}"
INSTALL_TYPE="${2:-user}"
INSTALL_DIR="${3}"
CONFIG_DIR="${4}"
DATA_DIR="${5}"
LOG_DIR="${6}"
SERVICE_FILE="${7}"

echo "===========================================
IMAP MCP Pro - Installation
==========================================="
echo "Platform: $PLATFORM"
echo "Install Type: $INSTALL_TYPE"
echo "Install Directory: $INSTALL_DIR"
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is not installed"
    echo "Please install Node.js 18+ from https://nodejs.org"
    exit 1
fi

NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "Error: Node.js 18+ is required (found: $(node --version))"
    exit 1
fi

echo "✓ Node.js $(node --version) detected"

# Create directories
echo ""
echo "Creating directories..."
mkdir -p "$INSTALL_DIR"
mkdir -p "$CONFIG_DIR"
mkdir -p "$DATA_DIR"
mkdir -p "$LOG_DIR"

# Copy files
echo "Copying files..."
cp -r dist/* "$INSTALL_DIR/"
cp -r node_modules "$INSTALL_DIR/"
cp package.json "$INSTALL_DIR/"

# Generate credentials
echo ""
echo "Generating credentials..."
bash scripts/generate-creds.sh "$INSTALL_TYPE" "$CONFIG_DIR" "$DATA_DIR"

# Create .env file
echo ""
echo "Creating configuration..."
cat > "$INSTALL_DIR/.env" <<EOF
NODE_ENV=production
LOG_LEVEL=info
DATA_DIR=$DATA_DIR
CONFIG_DIR=$CONFIG_DIR
EOF

# Get version from package.json
VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "unknown")

# Update Claude Desktop config if it exists
CLAUDE_CONFIG=""
if [ "$PLATFORM" = "darwin" ]; then
    CLAUDE_CONFIG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
elif [ "$PLATFORM" = "linux" ]; then
    CLAUDE_CONFIG="$HOME/.config/Claude/claude_desktop_config.json"
fi

if [ -n "$CLAUDE_CONFIG" ] && [ -f "$CLAUDE_CONFIG" ]; then
    echo ""
    echo "Updating Claude Desktop configuration..."

    # Create backup
    cp "$CLAUDE_CONFIG" "$CLAUDE_CONFIG.backup-$(date +%Y%m%d-%H%M%S)"

    # Update config with new path and version
    cat > "$CLAUDE_CONFIG" <<EOF
{
  "mcpServers": {
    "imap": {
      "command": "node",
      "args": [
        "$INSTALL_DIR/index.js"
      ],
      "env": {
        "MCP_USER_ID": "$(whoami)",
        "IMAP_MCP_VERSION": "$VERSION"
      }
    }
  }
}
EOF

    echo "✓ Claude Desktop config updated"
    echo "  Backup saved to: $CLAUDE_CONFIG.backup-$(date +%Y%m%d-%H%M%S)"
    echo "  Please restart Claude Desktop to apply changes"
fi

echo ""
echo "===========================================
Installation Complete!
==========================================="
echo ""
echo "Install Directory: $INSTALL_DIR"
echo "Config Directory: $CONFIG_DIR"
echo "Data Directory: $DATA_DIR"
echo "Log Directory: $LOG_DIR"
echo "Version: $VERSION"
echo ""
echo "Credentials saved to: $CONFIG_DIR/credentials.env"
echo ""
echo "Next steps:"
echo "1. Review credentials: cat $CONFIG_DIR/credentials.env"
echo "2. Restart Claude Desktop (if config was updated)"
echo "3. Start service: make start"
echo "4. Check status: make status"
echo ""
echo "Claude Desktop configuration:"
echo '{'
echo '  "mcpServers": {'
echo '    "imap": {'
echo '      "command": "node",'
echo "      \"args\": [\"$INSTALL_DIR/index.js\"],"
echo '      "env": {'
echo "        \"MCP_USER_ID\": \"$(whoami)\","
echo "        \"IMAP_MCP_VERSION\": \"$VERSION\""
echo '      }'
echo '    }'
echo '  }'
echo '}'
echo ""
echo "==========================================="
