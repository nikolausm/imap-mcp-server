#!/bin/bash
# IMAP MCP Pro - Service Management Script
# Author: Colin Bitterfield <colin@bitterfield.com>
# Date: 2025-11-06
# Version: 2.0.0

ACTION="${1}"
PLATFORM="${2}"
INSTALL_TYPE="${3}"
ARG="${4}"  # SERVICE_FILE or LOG_DIR depending on action

# Service label and plist location
SERVICE_LABEL="com.templeofepiphany.imap-mcp-pro"

if [ "$INSTALL_TYPE" = "system" ]; then
    PLIST_DIR="/Library/LaunchDaemons"
else
    PLIST_DIR="$HOME/Library/LaunchAgents"
fi

PLIST_FILE="$PLIST_DIR/$SERVICE_LABEL.plist"

# macOS LaunchAgent/LaunchDaemon management
macos_start() {
    if [ -f "$PLIST_FILE" ]; then
        echo "Starting IMAP MCP Pro Web UI service..."
        launchctl load "$PLIST_FILE" 2>/dev/null || true
        launchctl start "$SERVICE_LABEL"
        sleep 2
        macos_status
    else
        echo "Error: Service file not found at $PLIST_FILE"
        echo "Run 'make install' first to install the service"
        exit 1
    fi
}

macos_stop() {
    echo "Stopping IMAP MCP Pro Web UI service..."
    launchctl stop "$SERVICE_LABEL" 2>/dev/null || true
    launchctl unload "$PLIST_FILE" 2>/dev/null || true
    echo "✓ Service stopped"
}

macos_restart() {
    echo "Restarting IMAP MCP Pro Web UI service..."
    macos_stop
    sleep 2
    macos_start
}

macos_status() {
    echo "==================================="
    echo "IMAP MCP Pro Web UI Service Status"
    echo "==================================="

    # Check if plist file exists
    if [ ! -f "$PLIST_FILE" ]; then
        echo "Status: NOT INSTALLED"
        echo "Run 'make install' to install the service"
        return 1
    fi

    # Check if service is loaded
    if launchctl list | grep -q "$SERVICE_LABEL"; then
        echo "Status: RUNNING"

        # Get PID
        PID=$(launchctl list | grep "$SERVICE_LABEL" | awk '{print $1}')
        if [ "$PID" != "-" ]; then
            echo "PID: $PID"
        fi

        # Check if Web UI port is listening
        if lsof -iTCP:3000 -sTCP:LISTEN -n -P 2>/dev/null | grep -q LISTEN; then
            echo "Web UI: http://localhost:3000"
        else
            echo "Warning: Port 3000 not listening"
        fi
    else
        echo "Status: STOPPED"
    fi

    echo ""
    echo "Service file: $PLIST_FILE"
    echo "==================================="
}

# Linux systemd management
linux_start() {
    if [ "$INSTALL_TYPE" = "system" ]; then
        sudo systemctl start imap-mcp-pro
        sudo systemctl status imap-mcp-pro --no-pager
    else
        systemctl --user start imap-mcp-pro
        systemctl --user status imap-mcp-pro --no-pager
    fi
}

linux_stop() {
    if [ "$INSTALL_TYPE" = "system" ]; then
        sudo systemctl stop imap-mcp-pro
    else
        systemctl --user stop imap-mcp-pro
    fi
    echo "✓ Service stopped"
}

linux_restart() {
    if [ "$INSTALL_TYPE" = "system" ]; then
        sudo systemctl restart imap-mcp-pro
        sudo systemctl status imap-mcp-pro --no-pager
    else
        systemctl --user restart imap-mcp-pro
        systemctl --user status imap-mcp-pro --no-pager
    fi
}

linux_status() {
    if [ "$INSTALL_TYPE" = "system" ]; then
        systemctl status imap-mcp-pro --no-pager
    else
        systemctl --user status imap-mcp-pro --no-pager
    fi
}

# Main command dispatch
case "$ACTION" in
    start)
        if [ "$PLATFORM" = "darwin" ]; then
            macos_start
        elif [ "$PLATFORM" = "linux" ]; then
            linux_start
        else
            echo "Error: Unsupported platform: $PLATFORM"
            exit 1
        fi
        ;;

    stop)
        if [ "$PLATFORM" = "darwin" ]; then
            macos_stop
        elif [ "$PLATFORM" = "linux" ]; then
            linux_stop
        else
            echo "Error: Unsupported platform: $PLATFORM"
            exit 1
        fi
        ;;

    restart)
        if [ "$PLATFORM" = "darwin" ]; then
            macos_restart
        elif [ "$PLATFORM" = "linux" ]; then
            linux_restart
        else
            echo "Error: Unsupported platform: $PLATFORM"
            exit 1
        fi
        ;;

    status)
        if [ "$PLATFORM" = "darwin" ]; then
            macos_status
        elif [ "$PLATFORM" = "linux" ]; then
            linux_status
        else
            echo "Error: Unsupported platform: $PLATFORM"
            exit 1
        fi
        ;;

    logs)
        LOG_DIR="$ARG"
        echo "Viewing logs from: $LOG_DIR"

        # Try web-ui.log first (from LaunchAgent)
        if [ -f "$LOG_DIR/web-ui.log" ]; then
            echo "Press Ctrl+C to exit"
            tail -f "$LOG_DIR/web-ui.log"
        # Then try stdout.log (fallback)
        elif [ -f "$LOG_DIR/stdout.log" ]; then
            echo "Press Ctrl+C to exit"
            tail -f "$LOG_DIR/stdout.log"
        else
            echo "No logs found at:"
            echo "  - $LOG_DIR/web-ui.log"
            echo "  - $LOG_DIR/stdout.log"
            echo ""
            echo "Service may not be running or logs not configured."
            echo "Run 'make status' to check service status"
        fi
        ;;

    *)
        echo "Usage: $0 {start|stop|restart|status|logs} platform install_type arg"
        exit 1
        ;;
esac
