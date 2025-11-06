#!/bin/bash
# IMAP MCP Pro - Uninstall Script
# Author: Colin Bitterfield <colin@bitterfield.com>
# Date: 2025-11-06
# Version: 1.0.0

set -e

PLATFORM="${1}"
INSTALL_TYPE="${2}"
INSTALL_DIR="${3}"
SERVICE_FILE="${4}"

echo "===========================================
IMAP MCP Pro - Uninstall
==========================================="
echo "Install Directory: $INSTALL_DIR"
echo ""

read -p "This will remove IMAP MCP Pro. Continue? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Uninstall cancelled"
    exit 0
fi

# Stop service if running
echo "Stopping service..."
make stop 2>/dev/null || echo "Service not running"

# Remove installation directory
echo "Removing installation..."
rm -rf "$INSTALL_DIR"

echo ""
echo "===========================================
Uninstall Complete!
==========================================="
echo ""
echo "Note: Config and data directories were preserved"
echo "To completely remove all data, also delete:"
echo "  - Config: ~/.config/imap-mcp"
echo "  - Data: ~/.local/share/imap-mcp"
echo "==========================================="
