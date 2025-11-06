import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import open from 'open';
import nodemailer from 'nodemailer';
import rateLimit from 'express-rate-limit';
import slowDown from 'express-slow-down';
import { DatabaseService } from '../services/database-service.js';
import { ImapService } from '../services/imap-service.js';
import { emailProviders, getProviderByEmail } from '../providers/email-providers.js';
import { ImapAccount } from '../types/index.js';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class WebUIServer {
  private app: express.Application;
  private db: DatabaseService;
  private imapService: ImapService;
  private port: number;
  private defaultUserId: string;
  private authLimiter: any; // Rate limiter for auth endpoints

  constructor(port: number = 3000) {
    this.app = express();
    this.port = port;
    this.db = new DatabaseService();
    this.imapService = new ImapService();

    // Use same user resolution logic as MCP server (from tool-context.ts)
    // Get username from environment (set in MCP config) or fall back to 'default'
    const username = process.env.MCP_USER_ID || 'default';

    // Get or create user
    let user = this.db.getUserByUsername(username);
    if (!user) {
      user = this.db.createUser({
        user_id: crypto.randomUUID(),
        username: username,
        email: undefined,
        organization: 'Personal',
        is_active: true
      });
    }
    this.defaultUserId = user.user_id;

    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    // SECURITY: Restrict CORS to localhost only (Issue #24)
    this.app.use(cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (same-origin) or from localhost
        if (!origin || origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
          callback(null, true);
        } else {
          callback(new Error('CORS policy: Origin not allowed'));
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization']
    }));

    // SECURITY: Global rate limiter (Issue #26)
    const globalLimiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // Limit each IP to 100 requests per window
      message: 'Too many requests from this IP, please try again later',
      standardHeaders: true,
      legacyHeaders: false
    });

    // SECURITY: Speed limiter - delays responses after threshold (Issue #26)
    const speedLimiter = slowDown({
      windowMs: 15 * 60 * 1000, // 15 minutes
      delayAfter: 50, // Allow 50 requests per window at full speed
      delayMs: (hits) => hits * 100 // Add 100ms delay per request above threshold
    });

    // SECURITY: Strict rate limiter for authentication endpoints (Issue #26)
    this.authLimiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 10, // Only 10 auth attempts per 15 minutes
      message: 'Too many authentication attempts, please try again later',
      skipSuccessfulRequests: false, // Count all attempts
      standardHeaders: true,
      legacyHeaders: false
    });

    this.app.use(bodyParser.json());
    this.app.use(globalLimiter);
    this.app.use(speedLimiter);

    // Serve static files from public directory
    // In development: __dirname = src/web, public is at ../../public
    // In production: __dirname = web (inside install dir), public is at ../public
    const publicPath = path.join(__dirname, '../public');
    this.app.use(express.static(publicPath));
  }

  private setupRoutes(): void {
    // Get all providers
    this.app.get('/api/providers', (req, res) => {
      res.json(emailProviders);
    });

    // Get all accounts
    this.app.get('/api/accounts', (req, res) => {
      try {
        const accounts = this.db.listDecryptedAccountsForUser(this.defaultUserId);
        // Convert to web UI format (use username instead of user field)
        const webAccounts = accounts.map(acc => ({
          id: acc.account_id,
          name: acc.name,
          user: acc.username,
          host: acc.host,
          port: acc.port,
          tls: acc.tls,
          smtp: acc.smtp_host ? {
            host: acc.smtp_host,
            port: acc.smtp_port,
            tls: acc.smtp_secure
          } : undefined
        }));
        res.json(webAccounts);
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch accounts' });
      }
    });

    // Add new account
    this.app.post('/api/accounts', async (req, res) => {
      try {
        const { name, email, password, host, port, tls, smtp } = req.body;

        // Auto-detect provider if not specified
        let imapHost = host;
        let imapPort = port;
        let useTls = tls;

        if (!host && email) {
          const provider = getProviderByEmail(email);
          if (provider) {
            imapHost = provider.imapHost;
            imapPort = provider.imapPort;
            useTls = provider.imapSecurity !== 'STARTTLS';
          }
        }

        const account = this.db.createAccount({
          user_id: this.defaultUserId,
          name: name || email,
          host: imapHost,
          port: imapPort || 993,
          username: email,
          password,
          tls: useTls !== false,
          smtp_host: smtp?.host,
          smtp_port: smtp?.port,
          smtp_username: smtp?.user || email,
          smtp_password: smtp?.password,
          smtp_secure: smtp?.secure ?? smtp?.tls, // Accept both 'secure' and 'tls' field names
          is_active: true
        });

        res.json({ success: true, account: {
          id: account.account_id,
          name: account.name,
          user: account.username,
          host: account.host,
          port: account.port,
          tls: account.tls
        }});
      } catch (error) {
        res.status(400).json({
          success: false,
          error: error instanceof Error ? error.message : 'Failed to add account'
        });
      }
    });

    // Test connection (with strict rate limiting)
    this.app.post('/api/test-connection', this.authLimiter, async (req, res) => {
      const startTime = Date.now();

      try {
        const { email, password, host, port, tls } = req.body;

        // Create temporary account for testing
        const testAccount: ImapAccount = {
          id: 'test-' + Date.now(),
          name: 'Test',
          host: host || 'imap.gmail.com',
          port: port || 993,
          user: email,
          password,
          tls: tls !== false,
        };

        // Try to connect
        await this.imapService.connect(testAccount);

        // Get folder list to verify connection works
        const folders = await this.imapService.listFolders(testAccount.id);

        // Calculate connection time
        const connectionTime = Date.now() - startTime;

        // Disconnect
        await this.imapService.disconnect(testAccount.id);

        res.json({
          success: true,
          details: {
            folderCount: folders.length,
            connectionTime: connectionTime,
            serverHost: testAccount.host,
            serverPort: testAccount.port,
            tlsEnabled: testAccount.tls
          }
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Connection test failed';

        // Provide helpful error messages based on common issues
        let helpText = '';

        if (errorMessage.toLowerCase().includes('auth') || errorMessage.toLowerCase().includes('login') || errorMessage.toLowerCase().includes('invalid credentials')) {
          helpText = '💡 **Authentication failed.** Check your password or use an app-specific password (required for Gmail, Yahoo, and some other providers).';
        } else if (errorMessage.toLowerCase().includes('timeout') || errorMessage.toLowerCase().includes('timed out')) {
          helpText = '💡 **Connection timeout.** Check that the host and port are correct. Verify your firewall allows IMAP connections. Try toggling the TLS setting.';
        } else if (errorMessage.toLowerCase().includes('econnrefused') || errorMessage.toLowerCase().includes('connection refused')) {
          helpText = '💡 **Connection refused.** Verify the server address is correct. Check if IMAP is enabled in your account settings. Try a different port (993 for TLS, 143 for non-TLS).';
        } else if (errorMessage.toLowerCase().includes('ssl') || errorMessage.toLowerCase().includes('tls') || errorMessage.toLowerCase().includes('certificate')) {
          helpText = '💡 **SSL/TLS error.** Try toggling the TLS setting. Some servers use port 143 without TLS, others use 993 with TLS.';
        } else if (errorMessage.toLowerCase().includes('enotfound') || errorMessage.toLowerCase().includes('getaddrinfo')) {
          helpText = '💡 **Server not found.** Check that the host name is spelled correctly. Verify you have an internet connection.';
        } else {
          helpText = '💡 **Connection failed.** Double-check all settings and try again. If using Gmail or Yahoo, you may need an app-specific password.';
        }

        res.status(400).json({
          success: false,
          error: errorMessage,
          help: helpText
        });
      }
    });

    // Remove account
    this.app.delete('/api/accounts/:id', async (req, res) => {
      try {
        await this.imapService.disconnect(req.params.id);
        this.db.deleteAccount(req.params.id);
        res.json({ success: true });
      } catch (error) {
        res.status(400).json({
          success: false,
          error: error instanceof Error ? error.message : 'Failed to remove account'
        });
      }
    });

    // Update account
    this.app.put('/api/accounts/:id', async (req, res) => {
      try {
        const { name, email, password, host, port, tls, smtp } = req.body;

        const updates: any = {};
        if (name !== undefined) updates.name = name;
        if (email !== undefined) updates.username = email;
        if (password !== undefined) updates.password = password;
        if (host !== undefined) updates.host = host;
        if (port !== undefined) updates.port = port;
        if (tls !== undefined) updates.tls = tls;

        // Handle SMTP configuration
        if ('smtp' in req.body) {
          if (smtp) {
            // SMTP is enabled - update fields
            if (smtp.host !== undefined) updates.smtp_host = smtp.host;
            if (smtp.port !== undefined) updates.smtp_port = smtp.port;
            if (smtp.user !== undefined) updates.smtp_username = smtp.user;
            if (smtp.password !== undefined) updates.smtp_password = smtp.password;
            // Accept both 'secure' and 'tls' field names for TLS/SSL setting
            if (smtp.secure !== undefined) updates.smtp_secure = smtp.secure;
            else if (smtp.tls !== undefined) updates.smtp_secure = smtp.tls;
          } else {
            // SMTP is disabled - clear all SMTP fields
            updates.smtp_host = null;
            updates.smtp_port = null;
            updates.smtp_username = null;
            updates.smtp_password = null;
            updates.smtp_secure = null;
          }
        }

        this.db.updateAccount(req.params.id, updates);
        const account = this.db.getAccount(req.params.id);

        if (!account) {
          res.status(404).json({ success: false, error: 'Account not found after update' });
          return;
        }

        res.json({ success: true, account: {
          id: account.account_id,
          name: account.name,
          user: account.username,
          host: account.host,
          port: account.port,
          tls: account.tls
        }});
      } catch (error) {
        res.status(400).json({
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update account'
        });
      }
    });

    // Get single account
    this.app.get('/api/accounts/:id', async (req, res) => {
      try {
        const account = this.db.getAccount(req.params.id);
        if (!account) {
          res.status(404).json({ success: false, error: 'Account not found' });
        } else {
          // Don't send encrypted passwords to client
          const safeAccount = {
            id: account.account_id,
            name: account.name,
            user: account.username,
            host: account.host,
            port: account.port,
            tls: account.tls,
            smtp: account.smtp_host ? {
              host: account.smtp_host,
              port: account.smtp_port,
              user: account.smtp_username,
              tls: account.smtp_secure
            } : undefined
          };

          res.json({ success: true, account: safeAccount });
        }
      } catch (error) {
        res.status(400).json({
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get account'
        });
      }
    });

    // Test account connection (with strict rate limiting)
    this.app.post('/api/accounts/:id/test', this.authLimiter, async (req, res) => {
      const startTime = Date.now();

      try {
        const dbAccount = this.db.getDecryptedAccount(req.params.id);
        if (!dbAccount) {
          return res.status(404).json({
            success: false,
            error: 'Account not found'
          });
        }

        const results: any = {
          accountName: dbAccount.name,
          imap: { tested: false },
          smtp: { tested: false },
          totalTime: 0
        };

        // Test IMAP connection
        try {
          const imapAccount: ImapAccount = {
            id: dbAccount.account_id,
            name: dbAccount.name,
            host: dbAccount.host,
            port: dbAccount.port,
            user: dbAccount.username,
            password: dbAccount.password,
            tls: dbAccount.tls
          };

          await this.imapService.connect(imapAccount);

          // Get unread count from INBOX
          try {
            const unreadEmails = await this.imapService.searchEmails(dbAccount.account_id, 'INBOX', { seen: false });
            results.imap = {
              tested: true,
              success: true,
              unreadCount: unreadEmails.length,
              message: 'IMAP connection successful'
            };
          } catch (unreadError) {
            results.imap = {
              tested: true,
              success: true,
              unreadCount: 0,
              message: 'Connected but could not fetch unread count',
              warning: unreadError instanceof Error ? unreadError.message : 'Unknown error'
            };
          }

          // Disconnect after test
          await this.imapService.disconnect(dbAccount.account_id);
        } catch (imapError) {
          results.imap = {
            tested: true,
            success: false,
            error: imapError instanceof Error ? imapError.message : 'IMAP connection failed'
          };
        }

        // Test SMTP connection if configured
        if (dbAccount.smtp_host && dbAccount.smtp_port) {
          try {
            const transporter = nodemailer.createTransport({
              host: dbAccount.smtp_host,
              port: dbAccount.smtp_port,
              secure: dbAccount.smtp_secure || false,
              auth: {
                user: dbAccount.smtp_username || dbAccount.username,
                pass: dbAccount.smtp_password || dbAccount.password
              },
              connectionTimeout: 10000, // 10 second connection timeout
              greetingTimeout: 10000,   // 10 second greeting timeout
              socketTimeout: 10000      // 10 second socket timeout
            });

            // Add timeout wrapper for verify() operation
            const verifyWithTimeout = Promise.race([
              transporter.verify(),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error('SMTP verification timed out after 10 seconds')), 10000)
              )
            ]);

            await verifyWithTimeout;
            results.smtp = {
              tested: true,
              success: true,
              message: 'SMTP connection successful'
            };
          } catch (smtpError) {
            results.smtp = {
              tested: true,
              success: false,
              error: smtpError instanceof Error ? smtpError.message : 'SMTP connection failed'
            };
          }
        } else {
          results.smtp = {
            tested: false,
            message: 'SMTP not configured'
          };
        }

        results.totalTime = Date.now() - startTime;
        res.json({ success: true, results });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'Test failed',
          totalTime: Date.now() - startTime
        });
      }
    });

    // Get CleanTalk API keys for user
    this.app.get('/api/cleantalk/keys', (req, res) => {
      try {
        const stmt = this.db['db'].prepare(`
          SELECT id, api_key, is_active, daily_limit, daily_usage,
                 usage_reset_at, last_used, created_at, notes
          FROM cleantalk_keys
          WHERE user_id = ?
          ORDER BY created_at DESC
        `);

        const keys = stmt.all(this.defaultUserId) as any[];

        res.json({
          success: true,
          keys: keys.map(k => ({
            id: k.id,
            apiKey: k.api_key.substring(0, 8) + '...' + k.api_key.substring(k.api_key.length - 4), // Masked
            isActive: k.is_active === 1,
            dailyLimit: k.daily_limit,
            dailyUsage: k.daily_usage,
            usageResetAt: k.usage_reset_at,
            lastUsed: k.last_used,
            createdAt: k.created_at,
            notes: k.notes
          }))
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'Failed to load CleanTalk keys'
        });
      }
    });

    // Add CleanTalk API key
    this.app.post('/api/cleantalk/keys', (req, res) => {
      try {
        const { apiKey, dailyLimit, notes } = req.body;

        if (!apiKey || apiKey.trim().length === 0) {
          return res.status(400).json({
            success: false,
            error: 'API key is required'
          });
        }

        this.db['db'].prepare(`
          INSERT INTO cleantalk_keys (user_id, api_key, daily_limit, notes, is_active)
          VALUES (?, ?, ?, ?, 1)
        `).run(this.defaultUserId, apiKey.trim(), dailyLimit || 1000, notes || null);

        res.json({
          success: true,
          message: 'CleanTalk API key added successfully'
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'Failed to add CleanTalk key'
        });
      }
    });

    // Delete CleanTalk API key
    this.app.delete('/api/cleantalk/keys/:keyId', (req, res) => {
      try {
        const keyId = parseInt(req.params.keyId);

        if (isNaN(keyId)) {
          return res.status(400).json({
            success: false,
            error: 'Invalid key ID'
          });
        }

        this.db['db'].prepare('DELETE FROM cleantalk_keys WHERE id = ? AND user_id = ?')
          .run(keyId, this.defaultUserId);

        res.json({
          success: true,
          message: 'CleanTalk API key deleted successfully'
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'Failed to delete CleanTalk key'
        });
      }
    });

    // Health check
    this.app.get('/api/health', (req, res) => {
      res.json({
        status: 'ok',
        mcpVersion: '2.8.0',
        uiVersion: '2.8.0',
        database: 'SQLite3 with AES-256-GCM encryption',
        features: ['multi-tenant', 'account-sharing', 'encrypted-storage', 'cleantalk-integration']
      });
    });
  }

  async start(autoOpen: boolean = true): Promise<void> {
    return new Promise((resolve) => {
      // SECURITY: Explicitly bind to localhost (127.0.0.1) to prevent external access
      const server = this.app.listen(this.port, '127.0.0.1', () => {
        console.log(`🌐 Web UI server running at http://localhost:${this.port}`);
        console.log(`🔒 Security: Server bound to localhost only (127.0.0.1)`);

        if (autoOpen) {
          // Open browser after a short delay
          setTimeout(() => {
            open(`http://localhost:${this.port}`);
          }, 1000);
        }

        resolve();
      });

      // Handle graceful shutdown
      process.on('SIGINT', () => {
        console.log('\nShutting down web server...');
        server.close(() => {
          process.exit(0);
        });
      });
    });
  }
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = parseInt(process.env.PORT || '3000');
  const server = new WebUIServer(port);
  server.start();
}