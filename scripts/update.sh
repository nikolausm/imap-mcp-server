#!/bin/bash
# IMAP MCP Pro - Update Script
# Author: Colin Bitterfield <colin@bitterfield.com>
# Date: 2025-11-06
# Version: 1.0.0

set -e

INSTALL_DIR="${1}"
DATA_DIR="${2}"
LOG_DIR="${3}"

echo "===========================================
IMAP MCP Pro - Update
==========================================="

# Check current version
CURRENT_VERSION=$(node -p "require('$INSTALL_DIR/package.json').version" 2>/dev/null || echo "unknown")
echo "Current version: $CURRENT_VERSION"

# Fetch latest release from GitHub
echo "Fetching latest release information..."
LATEST_RELEASE=$(curl -s https://api.github.com/repos/Temple-of-Epiphany/imap-mcp-pro/releases/latest)
LATEST_VERSION=$(echo "$LATEST_RELEASE" | grep '"tag_name":' | sed -E 's/.*"v?([^"]+)".*/\1/')
DOWNLOAD_URL=$(echo "$LATEST_RELEASE" | grep '"tarball_url":' | sed -E 's/.*"([^"]+)".*/\1/')

if [ -z "$LATEST_VERSION" ]; then
    echo "Error: Could not fetch latest release information"
    exit 1
fi

echo "Latest version: $LATEST_VERSION"

# Compare versions
if [ "$CURRENT_VERSION" = "$LATEST_VERSION" ]; then
    echo "Already up to date!"
    exit 0
fi

echo ""
echo "Update available: $CURRENT_VERSION → $LATEST_VERSION"
read -p "Continue with update? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Update cancelled"
    exit 0
fi

# Create backup
echo ""
echo "Creating backup..."
BACKUP_DIR="$INSTALL_DIR.backup-$(date +%Y%m%d-%H%M%S)"
cp -r "$INSTALL_DIR" "$BACKUP_DIR"
echo "✓ Backup created: $BACKUP_DIR"

# Stop service if running
echo ""
echo "Stopping service..."
make stop 2>/dev/null || echo "Service not running"

# Download latest release
echo ""
echo "Downloading latest release..."
TMP_DIR=$(mktemp -d)
cd "$TMP_DIR"
curl -L "$DOWNLOAD_URL" -o release.tar.gz

# Extract
echo "Extracting..."
tar -xzf release.tar.gz
EXTRACTED_DIR=$(ls -d */ | head -n 1)

# Install dependencies and build
echo "Installing dependencies..."
cd "$EXTRACTED_DIR"
npm install --production

echo "Building..."
npm run build

# Replace installation (preserve data and config)
echo ""
echo "Updating installation..."
rm -rf "$INSTALL_DIR/dist"
rm -rf "$INSTALL_DIR/node_modules"
cp -r dist "$INSTALL_DIR/"
cp -r node_modules "$INSTALL_DIR/"
cp package.json "$INSTALL_DIR/"

# Clean up
cd /
rm -rf "$TMP_DIR"

# Start service
echo ""
echo "Starting service..."
make start

# Verify
echo ""
echo "Verifying installation..."
sleep 3
make status

NEW_VERSION=$(node -p "require('$INSTALL_DIR/package.json').version" 2>/dev/null || echo "unknown")

echo ""
echo "===========================================
Update Complete!
==========================================="
echo "Old version: $CURRENT_VERSION"
echo "New version: $NEW_VERSION"
echo "Backup: $BACKUP_DIR"
echo ""
echo "Update log: $LOG_DIR/update.log"
echo "==========================================="
