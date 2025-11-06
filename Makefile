# Makefile for IMAP MCP Pro
# Cross-platform installation and service management
#
# Author: Colin Bitterfield
# Email: colin@bitterfield.com
# Date: 2025-11-06
# Version: 1.0.0

.PHONY: help install uninstall start stop restart status logs update test build clean

# Detect OS
UNAME_S := $(shell uname -s 2>/dev/null || echo "Windows")
UNAME_M := $(shell uname -m 2>/dev/null || echo "unknown")

# Detect if running as root/admin
IS_ROOT := $(shell [ "$$(id -u 2>/dev/null || echo 1)" = "0" ] && echo "yes" || echo "no")

# Installation type (user or system)
ifeq ($(IS_ROOT),yes)
    INSTALL_TYPE ?= system
else
    INSTALL_TYPE ?= user
endif

# Platform-specific paths
ifeq ($(UNAME_S),Darwin)
    # macOS
    PLATFORM := darwin
    ifeq ($(INSTALL_TYPE),system)
        INSTALL_DIR := /opt/imap-mcp-pro
        CONFIG_DIR := /etc/imap-mcp
        DATA_DIR := /var/lib/imap-mcp
        LOG_DIR := /var/log/imap-mcp-pro
        SERVICE_DIR := /Library/LaunchDaemons
        SERVICE_FILE := $(SERVICE_DIR)/com.templeofepiphany.imap-mcp-pro.plist
    else
        INSTALL_DIR := $(HOME)/.local/share/imap-mcp-pro
        CONFIG_DIR := $(HOME)/.config/imap-mcp
        DATA_DIR := $(HOME)/.local/share/imap-mcp
        LOG_DIR := $(HOME)/.local/share/imap-mcp-pro/logs
        SERVICE_DIR := $(HOME)/Library/LaunchAgents
        SERVICE_FILE := $(SERVICE_DIR)/com.templeofepiphany.imap-mcp-pro.plist
    endif
    SERVICE_CMD := launchctl
else ifeq ($(UNAME_S),Linux)
    # Linux
    PLATFORM := linux
    ifeq ($(INSTALL_TYPE),system)
        INSTALL_DIR := /opt/imap-mcp-pro
        CONFIG_DIR := /etc/imap-mcp
        DATA_DIR := /var/lib/imap-mcp
        LOG_DIR := /var/log/imap-mcp-pro
        SERVICE_DIR := /etc/systemd/system
        SERVICE_FILE := $(SERVICE_DIR)/imap-mcp-pro.service
    else
        INSTALL_DIR := $(HOME)/.local/share/imap-mcp-pro
        CONFIG_DIR := $(HOME)/.config/imap-mcp
        DATA_DIR := $(HOME)/.local/share/imap-mcp
        LOG_DIR := $(HOME)/.local/share/imap-mcp-pro/logs
        SERVICE_DIR := $(HOME)/.config/systemd/user
        SERVICE_FILE := $(SERVICE_DIR)/imap-mcp-pro.service
    endif
    SERVICE_CMD := systemctl
else
    # Windows (via WSL or native)
    PLATFORM := windows
    INSTALL_DIR := $(LOCALAPPDATA)/imap-mcp-pro
    CONFIG_DIR := $(APPDATA)/imap-mcp
    DATA_DIR := $(LOCALAPPDATA)/imap-mcp
    LOG_DIR := $(LOCALAPPDATA)/imap-mcp-pro/logs
    SERVICE_CMD := sc
endif

help:
	@echo "IMAP MCP Pro - Installation & Service Management"
	@echo ""
	@echo "Detected Platform: $(PLATFORM) ($(UNAME_M))"
	@echo "Installation Type: $(INSTALL_TYPE)"
	@echo "Install Directory: $(INSTALL_DIR)"
	@echo ""
	@echo "Available commands:"
	@echo "  make install    - Install and configure IMAP MCP Pro"
	@echo "  make uninstall  - Remove installation and services"
	@echo "  make start      - Start the service"
	@echo "  make stop       - Stop the service"
	@echo "  make restart    - Restart the service"
	@echo "  make status     - Check service status"
	@echo "  make logs       - View service logs"
	@echo "  make update     - Update to latest release"
	@echo "  make build      - Build the project"
	@echo "  make test       - Run tests"
	@echo "  make clean      - Clean build artifacts"
	@echo ""
	@echo "Installation as system service (requires sudo/admin):"
	@echo "  sudo make install INSTALL_TYPE=system"
	@echo ""
	@echo "Installation as user service (no sudo required):"
	@echo "  make install"

build:
	@echo "Building IMAP MCP Pro..."
	npm install
	npm run build
	@echo "Build complete!"

install: build
	@echo "Installing IMAP MCP Pro..."
	@echo "Platform: $(PLATFORM)"
	@echo "Install Type: $(INSTALL_TYPE)"
	@echo "Install Dir: $(INSTALL_DIR)"
	@bash scripts/install.sh $(PLATFORM) $(INSTALL_TYPE) "$(INSTALL_DIR)" "$(CONFIG_DIR)" "$(DATA_DIR)" "$(LOG_DIR)" "$(SERVICE_FILE)"

uninstall:
	@echo "Uninstalling IMAP MCP Pro..."
	@bash scripts/uninstall.sh $(PLATFORM) $(INSTALL_TYPE) "$(INSTALL_DIR)" "$(SERVICE_FILE)"

start:
	@bash scripts/service.sh start $(PLATFORM) $(INSTALL_TYPE) "$(SERVICE_FILE)"

stop:
	@bash scripts/service.sh stop $(PLATFORM) $(INSTALL_TYPE) "$(SERVICE_FILE)"

restart:
	@bash scripts/service.sh restart $(PLATFORM) $(INSTALL_TYPE) "$(SERVICE_FILE)"

status:
	@bash scripts/service.sh status $(PLATFORM) $(INSTALL_TYPE) "$(SERVICE_FILE)"

logs:
	@bash scripts/service.sh logs $(PLATFORM) $(INSTALL_TYPE) "$(LOG_DIR)"

update:
	@bash scripts/update.sh "$(INSTALL_DIR)" "$(DATA_DIR)" "$(LOG_DIR)"

test:
	@echo "Running tests..."
	npm test

clean:
	@echo "Cleaning build artifacts..."
	rm -rf dist/
	rm -rf node_modules/
	@echo "Clean complete!"

# Development helpers
dev:
	npm run dev

web:
	npm run web

# Version info
version:
	@node -p "require('./package.json').version"
