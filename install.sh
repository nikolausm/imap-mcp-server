#!/bin/bash

# IMAP MCP Server Installer for Claude Desktop
# This script clones, builds, and configures the IMAP MCP server

set -e

echo "🚀 IMAP MCP Server Installer for Claude Desktop"
echo "==============================================="

# Default installation directory
DEFAULT_INSTALL_DIR="$HOME/.claude/mcp-servers/imap"
INSTALL_DIR="${1:-$DEFAULT_INSTALL_DIR}"

echo "📁 Installing to: $INSTALL_DIR"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 16 or higher."
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'.' -f1 | sed 's/v//')
if [ "$NODE_VERSION" -lt 16 ]; then
    echo "❌ Node.js version 16 or higher is required. Current version: $(node -v)"
    exit 1
fi

# Create installation directory
echo "📂 Creating installation directory..."
mkdir -p "$INSTALL_DIR"

# Clone the repository
echo "📥 Cloning repository..."
if [ -d "$INSTALL_DIR/.git" ]; then
    echo "📝 Repository already exists, pulling latest changes..."
    cd "$INSTALL_DIR"
    git pull
else
    git clone https://github.com/nikolausm/imap-mcp-server.git "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Build the project
echo "🔨 Building project..."
npm run build

# Detect OS
OS="$(uname -s)"
case "$OS" in
    Darwin*)
        CONFIG_DIR="$HOME/Library/Application Support/Claude"
        ;;
    Linux*)
        CONFIG_DIR="$HOME/.config/Claude"
        ;;
    MINGW*|CYGWIN*|MSYS*)
        echo "❌ Windows detected. Please use install.ps1 for Windows installation."
        exit 1
        ;;
    *)
        echo "❌ Unknown operating system: $OS"
        exit 1
        ;;
esac

# Create config directory if it doesn't exist
mkdir -p "$CONFIG_DIR"

# Check if claude_desktop_config.json exists
CONFIG_FILE="$CONFIG_DIR/claude_desktop_config.json"

if [ -f "$CONFIG_FILE" ]; then
    echo "📝 Updating Claude Desktop configuration..."
    
    # Backup existing config
    cp "$CONFIG_FILE" "$CONFIG_FILE.backup.$(date +%Y%m%d_%H%M%S)"
    
    # Check if jq is installed for JSON manipulation
    if command -v jq &> /dev/null; then
        # Add or update the IMAP MCP server configuration
        jq '.mcpServers.imap = {
            "command": "node",
            "args": ["'$INSTALL_DIR'/dist/index.js"]
        }' "$CONFIG_FILE" > "$CONFIG_FILE.tmp" && mv "$CONFIG_FILE.tmp" "$CONFIG_FILE"
    else
        echo "⚠️  jq is not installed. Please manually add the following to your $CONFIG_FILE:"
        echo ""
        echo '  "mcpServers": {'
        echo '    "imap": {'
        echo '      "command": "node",'
        echo "      \"args\": [\"$INSTALL_DIR/dist/index.js\"]"
        echo '    }'
        echo '  }'
    fi
else
    echo "📝 Creating Claude Desktop configuration..."
    cat > "$CONFIG_FILE" <<EOF
{
  "mcpServers": {
    "imap": {
      "command": "node",
      "args": ["$INSTALL_DIR/dist/index.js"]
    }
  }
}
EOF
fi

echo ""
echo "✅ Installation complete!"
echo ""
echo "📋 Next steps:"
echo "1. Run the setup wizard: cd $INSTALL_DIR && npm run setup"
echo "2. Configure your email accounts through the web interface"
echo "3. Restart Claude Desktop"
echo "4. The IMAP MCP server tools will be available in Claude"
echo ""
echo "📚 Available tools:"
echo "   - imap_add_account     : Add a new IMAP account"
echo "   - imap_list_accounts   : List configured accounts"
echo "   - imap_connect         : Connect to an account"
echo "   - imap_list_folders    : List email folders"
echo "   - imap_search_emails   : Search for emails"
echo "   - imap_get_email       : Read email content"
echo "   - ... and more!"
echo ""
echo "🔒 Security: Your credentials are encrypted and stored in:"
echo "   $HOME/.imap-mcp/"
echo ""
echo "📖 For more information, visit:"
echo "   https://github.com/nikolausm/imap-mcp-server"