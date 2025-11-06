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
    echo "=============================================="
    echo "Error: Node.js is not installed"
    echo "=============================================="
    echo ""
    echo "IMAP MCP Pro requires Node.js 18 or later."
    echo ""
    echo "Installation options:"
    echo ""
    echo "1. MacPorts (recommended for macOS):"
    echo "   sudo port install nodejs22"
    echo ""
    echo "2. Homebrew:"
    echo "   brew install node"
    echo ""
    echo "3. Direct download:"
    echo "   https://nodejs.org/en/download/"
    echo ""
    echo "4. Node Version Manager (nvm):"
    echo "   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash"
    echo "   nvm install --lts"
    echo ""
    echo "After installing Node.js, run 'make install' again."
    echo "=============================================="
    exit 1
fi

NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "=============================================="
    echo "Error: Node.js 18+ is required"
    echo "=============================================="
    echo ""
    echo "Current version: $(node --version)"
    echo "Required version: v18.0.0 or later"
    echo ""
    echo "Please upgrade Node.js using one of these methods:"
    echo ""
    echo "1. MacPorts:"
    echo "   sudo port selfupdate"
    echo "   sudo port upgrade nodejs22"
    echo ""
    echo "2. Homebrew:"
    echo "   brew update"
    echo "   brew upgrade node"
    echo ""
    echo "3. Download from https://nodejs.org/"
    echo ""
    echo "4. Using nvm:"
    echo "   nvm install --lts"
    echo "   nvm use --lts"
    echo ""
    echo "=============================================="
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
cp -r public "$INSTALL_DIR/"
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

# Install Web UI service (macOS LaunchAgent or Linux systemd)
echo ""
echo "Installing Web UI service..."

if [ "$PLATFORM" = "darwin" ]; then
    # macOS LaunchAgent
    SERVICE_LABEL="com.templeofepiphany.imap-mcp-pro"

    if [ "$INSTALL_TYPE" = "system" ]; then
        SERVICE_DIR="/Library/LaunchDaemons"
    else
        SERVICE_DIR="$HOME/Library/LaunchAgents"
    fi

    SERVICE_FILE="$SERVICE_DIR/$SERVICE_LABEL.plist"

    # Create service directory if needed
    mkdir -p "$SERVICE_DIR"

    # Stop and unload existing service if running
    if [ -f "$SERVICE_FILE" ]; then
        launchctl stop "$SERVICE_LABEL" 2>/dev/null || true
        launchctl unload "$SERVICE_FILE" 2>/dev/null || true
    fi

    # Detect node path
    NODE_PATH=$(which node)
    if [ -z "$NODE_PATH" ]; then
        echo "Error: node command not found in PATH"
        exit 1
    fi

    # Copy and customize plist template
    sed -e "s|NODE_PATH|$NODE_PATH|g" \
        -e "s|INSTALL_DIR|$INSTALL_DIR|g" \
        -e "s|__DATA_DIR__|$DATA_DIR|g" \
        -e "s|__CONFIG_DIR__|$CONFIG_DIR|g" \
        -e "s|LOG_DIR|$LOG_DIR|g" \
        -e "s|__MCP_USER_ID__|$(whoami)|g" \
        -e "s|__IMAP_MCP_VERSION__|$VERSION|g" \
        templates/com.templeofepiphany.imap-mcp-pro.plist > "$SERVICE_FILE"

    # Set correct permissions
    chmod 644 "$SERVICE_FILE"

    echo "✓ LaunchAgent installed at $SERVICE_FILE"
    echo "  Use 'make start' to start the Web UI service"

elif [ "$PLATFORM" = "linux" ]; then
    # Linux systemd
    if [ "$INSTALL_TYPE" = "system" ]; then
        SERVICE_DIR="/etc/systemd/system"
    else
        SERVICE_DIR="$HOME/.config/systemd/user"
        mkdir -p "$SERVICE_DIR"
    fi

    SERVICE_FILE="$SERVICE_DIR/imap-mcp-pro.service"

    # Create systemd service file
    cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=IMAP MCP Pro Web UI Service
After=network.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/node $INSTALL_DIR/web/server.js
Restart=always
RestartSec=10
StandardOutput=append:$LOG_DIR/web-ui.log
StandardError=append:$LOG_DIR/web-ui-error.log

Environment="NODE_ENV=production"
Environment="LOG_LEVEL=info"
Environment="DATA_DIR=$DATA_DIR"
Environment="CONFIG_DIR=$CONFIG_DIR"
Environment="MCP_USER_ID=$(whoami)"
Environment="IMAP_MCP_VERSION=$VERSION"

[Install]
WantedBy=default.target
EOF

    chmod 644 "$SERVICE_FILE"

    # Reload systemd
    if [ "$INSTALL_TYPE" = "system" ]; then
        sudo systemctl daemon-reload
    else
        systemctl --user daemon-reload
    fi

    echo "✓ Systemd service installed at $SERVICE_FILE"
    echo "  Use 'make start' to start the Web UI service"
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
