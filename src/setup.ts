import { WebUIServer } from './web/server.js';
import chalk from 'chalk';
import ora from 'ora';
import { program } from 'commander';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

// Resolve the built server next to this module rather than relative to the
// caller's working directory. `imap-setup` is installed on PATH by
// `npm install -g`, so it is usually run from an unrelated directory; using
// process.cwd() wrote a path to whatever folder the user happened to be in.
const serverEntryPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.js');

program
  .name('imap-setup')
  .description('IMAP MCP Server Setup Wizard')
  .option('-p, --port <port>', 'Port for web UI', '3000')
  .option('--no-open', 'Do not open browser automatically')
  .option('--claude-setup', 'Setup Claude Desktop integration')
  .option('--skip-claude', 'Skip Claude Desktop integration')
  .parse();

const options = program.opts();

async function getClaudeConfigPath(): Promise<string> {
  const platform = os.platform();
  switch (platform) {
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    case 'win32':
      return path.join(os.homedir(), 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json');
    case 'linux':
      return path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json');
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

async function setupClaudeIntegration(): Promise<void> {
  const spinner = ora('Setting up Claude Desktop integration...').start();
  
  try {
    const configPath = await getClaudeConfigPath();
    const configDir = path.dirname(configPath);
    
    // Create config directory if it doesn't exist
    await fs.mkdir(configDir, { recursive: true });
    
    const serverPath = serverEntryPath;
    
    let config: any = {};
    
    // Read existing config if it exists
    try {
      const existingConfig = await fs.readFile(configPath, 'utf-8');
      config = JSON.parse(existingConfig);
    } catch (error) {
      // File doesn't exist, start with empty config
      config = {};
    }
    
    // Ensure mcpServers object exists
    if (!config.mcpServers) {
      config.mcpServers = {};
    }
    
    // Add or update IMAP MCP server
    // Use the absolute path of the current Node binary: GUI apps on macOS do
    // not inherit the user's shell PATH, so a bare 'node' is often not found.
    config.mcpServers.imap = {
      command: process.execPath,
      args: [serverPath]
    };
    
    // Write updated config
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
    
    spinner.succeed('Claude Desktop integration configured!');
    
    console.log('\n' + chalk.green('✓') + ' Claude Desktop configuration updated');
    console.log('  Config file: ' + chalk.cyan(configPath));
    console.log('  Server path: ' + chalk.cyan(serverPath));
    console.log('\n' + chalk.yellow('⚠') + '  ' + chalk.bold('Important:') + ' Restart Claude Desktop to apply changes');
    
  } catch (error) {
    spinner.fail('Failed to setup Claude Desktop integration');
    console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
    console.log('\n' + chalk.yellow('💡') + ' You can manually add this configuration to your Claude Desktop config:');
    console.log(chalk.gray('  {'));
    console.log(chalk.gray('    "mcpServers": {'));
    console.log(chalk.gray('      "imap": {'));
    console.log(chalk.gray(`        "command": "${process.execPath}",`));
    console.log(chalk.gray(`        "args": ["${serverEntryPath}"]`));
    console.log(chalk.gray('      }'));
    console.log(chalk.gray('    }'));
    console.log(chalk.gray('  }'));
  }
}

async function askForClaudeSetup(): Promise<boolean> {
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise((resolve) => {
    rl.question(chalk.cyan('? ') + 'Do you want to setup Claude Desktop integration? (y/N): ', (answer) => {
      rl.close();
      resolve(answer.toLowerCase().startsWith('y'));
    });
  });
}

async function main() {
  console.log(chalk.blue.bold('\n🚀 IMAP MCP Server Setup Wizard\n'));
  
  // First, check if we should setup Claude Desktop integration
  if (options.claudeSetup || (!options.skipClaude && await askForClaudeSetup())) {
    await setupClaudeIntegration();
    console.log('');
  }
  
  const spinner = ora('Starting web interface...').start();
  
  try {
    const server = new WebUIServer(parseInt(options.port));
    await server.start(options.open);
    
    spinner.succeed('Web interface is running!');
    
    console.log('\n' + chalk.green('✓') + ' Setup wizard available at: ' + chalk.cyan(`http://localhost:${options.port}`));
    console.log('\n' + chalk.yellow('ℹ') + ' Press Ctrl+C to stop the server\n');
    
    if (!options.open) {
      console.log(chalk.gray('  Open your browser and navigate to the URL above'));
    }
    
    console.log('\n' + chalk.blue('📧') + ' After configuring your email accounts:');
    console.log('  1. Restart Claude Desktop');
    console.log('  2. Try: "Show me my latest emails"');
    console.log('  3. Try: "Add a new email account"');
    console.log('  4. Try: "List all my email accounts"');
    
  } catch (error) {
    spinner.fail('Failed to start web interface');
    console.error(chalk.red('Error:'), error);
    process.exit(1);
  }
}

main().catch(console.error);