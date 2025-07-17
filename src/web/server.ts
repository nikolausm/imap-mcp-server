import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import open from 'open';
import { AccountManager } from '../services/account-manager.js';
import { ImapService } from '../services/imap-service.js';
import { emailProviders, getProviderByEmail } from '../providers/email-providers.js';
import { ImapAccount } from '../types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class WebUIServer {
  private app: express.Application;
  private accountManager: AccountManager;
  private imapService: ImapService;
  private port: number;

  constructor(port: number = 3000) {
    this.app = express();
    this.port = port;
    this.accountManager = new AccountManager();
    this.imapService = new ImapService();
    
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use(cors());
    this.app.use(bodyParser.json());
    this.app.use(express.static(path.join(__dirname, '../../public')));
  }

  private setupRoutes(): void {
    // Get all providers
    this.app.get('/api/providers', (req, res) => {
      res.json(emailProviders);
    });

    // Get all accounts
    this.app.get('/api/accounts', (req, res) => {
      try {
        const accounts = this.accountManager.getAllAccounts();
        res.json(accounts);
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch accounts' });
      }
    });

    // Add new account
    this.app.post('/api/accounts', async (req, res) => {
      try {
        const { name, email, password, host, port, tls } = req.body;
        
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
        
        const account = await this.accountManager.addAccount({
          name: name || email,
          host: imapHost,
          port: imapPort || 993,
          user: email,
          password,
          tls: useTls !== false,
        });
        
        res.json({ success: true, account });
      } catch (error) {
        res.status(400).json({ 
          success: false, 
          error: error instanceof Error ? error.message : 'Failed to add account' 
        });
      }
    });

    // Test connection
    this.app.post('/api/test-connection', async (req, res) => {
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
        
        // Disconnect
        await this.imapService.disconnect(testAccount.id);
        
        res.json({ 
          success: true, 
          folders: folders.map(f => f.name) 
        });
      } catch (error) {
        res.status(400).json({ 
          success: false, 
          error: error instanceof Error ? error.message : 'Connection test failed' 
        });
      }
    });

    // Remove account
    this.app.delete('/api/accounts/:id', async (req, res) => {
      try {
        await this.accountManager.removeAccount(req.params.id);
        res.json({ success: true });
      } catch (error) {
        res.status(400).json({ 
          success: false, 
          error: error instanceof Error ? error.message : 'Failed to remove account' 
        });
      }
    });

    // Health check
    this.app.get('/api/health', (req, res) => {
      res.json({ status: 'ok', version: '1.0.0' });
    });
  }

  async start(autoOpen: boolean = true): Promise<void> {
    return new Promise((resolve) => {
      const server = this.app.listen(this.port, () => {
        console.log(`🌐 Web UI server running at http://localhost:${this.port}`);
        
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