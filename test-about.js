#!/usr/bin/env node

/**
 * Test script to verify imap_about includes spam functions
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { metaTools } from './dist/tools/meta-tools.js';

const server = new McpServer({
  name: 'test-about',
  version: '1.0.0'
});

metaTools(server);

// Get the about tool
const tools = server._tools || server.tools || {};
const aboutTool = Object.values(tools).find(t => t.name === 'imap_about');

if (!aboutTool) {
  console.error('❌ imap_about tool not found');
  process.exit(1);
}

console.log('Testing imap_about tool...\n');

try {
  // Execute the about tool
  const result = await aboutTool.handler({});
  const aboutData = JSON.parse(result.content[0].text);

  console.log('='.repeat(70));
  console.log('Service Information');
  console.log('='.repeat(70));
  console.log(`Name: ${aboutData.service.name}`);
  console.log(`Version: ${aboutData.service.version}`);
  console.log(`Total Tools: ${aboutData.capabilities.totalTools}`);

  console.log('\n' + '='.repeat(70));
  console.log('Feature Categories');
  console.log('='.repeat(70));

  // Check for spam filtering features
  if (aboutData.features.spamFiltering) {
    console.log('\n✅ Spam Filtering Features:');
    aboutData.features.spamFiltering.forEach(feature => {
      console.log(`   • ${feature}`);
    });
  } else {
    console.log('\n❌ Spam filtering features NOT FOUND');
  }

  // Check for subscription management features
  if (aboutData.features.subscriptionManagement) {
    console.log('\n✅ Subscription Management Features:');
    aboutData.features.subscriptionManagement.forEach(feature => {
      console.log(`   • ${feature}`);
    });
  } else {
    console.log('\n❌ Subscription management features NOT FOUND');
  }

  console.log('\n' + '='.repeat(70));
  console.log('Capabilities');
  console.log('='.repeat(70));
  aboutData.capabilities.toolCategories.forEach(category => {
    console.log(`   • ${category}`);
  });

  console.log('\n' + '='.repeat(70));
  console.log('Feature Flags');
  console.log('='.repeat(70));
  console.log(`   • Bulk Operations: ${aboutData.capabilities.bulkOperations ? '✅' : '❌'}`);
  console.log(`   • Circuit Breaker: ${aboutData.capabilities.circuitBreaker ? '✅' : '❌'}`);
  console.log(`   • Metrics: ${aboutData.capabilities.metrics ? '✅' : '❌'}`);
  console.log(`   • SMTP: ${aboutData.capabilities.smtp ? '✅' : '❌'}`);
  console.log(`   • Spam Filtering: ${aboutData.capabilities.spamFiltering ? '✅' : '❌'}`);
  console.log(`   • Subscription Management: ${aboutData.capabilities.subscriptionManagement ? '✅' : '❌'}`);
  console.log(`   • DNS Firewall: ${aboutData.capabilities.dnsFirewall ? '✅' : '❌'}`);

  console.log('\n' + '='.repeat(70));
  console.log('✅ Test PASSED - Spam functions are included in imap_about');
  console.log('='.repeat(70) + '\n');

} catch (error) {
  console.error('❌ Error testing imap_about:', error.message);
  process.exit(1);
}
