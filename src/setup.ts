#!/usr/bin/env node

import { WebUIServer } from './web/server.js';
import chalk from 'chalk';
import ora from 'ora';
import { program } from 'commander';

program
  .name('imap-setup')
  .description('IMAP MCP Server Setup Wizard')
  .option('-p, --port <port>', 'Port for web UI', '3000')
  .option('--no-open', 'Do not open browser automatically')
  .parse();

const options = program.opts();

async function main() {
  console.log(chalk.blue.bold('\n🚀 IMAP MCP Server Setup Wizard\n'));
  
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
    
  } catch (error) {
    spinner.fail('Failed to start web interface');
    console.error(chalk.red('Error:'), error);
    process.exit(1);
  }
}

main().catch(console.error);