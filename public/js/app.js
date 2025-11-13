// IMAP MCP Pro - Tile-based Dashboard UI
// Author: Colin Bitterfield
// Email: colin@bitterfield.com
// Version: 2.11.0

// View Management
function hideAllViews() {
  document.getElementById('dashboardView').classList.add('hidden');
  document.getElementById('profileView').classList.add('hidden');
  document.getElementById('accountsView').classList.add('hidden');
  document.getElementById('dnsFirewallView').classList.add('hidden');
  document.getElementById('spamCheckView').classList.add('hidden');
  document.getElementById('categoriesView').classList.add('hidden');
  document.getElementById('rulesView').classList.add('hidden');
}

function showDashboard() {
  hideAllViews();
  document.getElementById('dashboardView').classList.remove('hidden');
}

function showProfile() {
  hideAllViews();
  document.getElementById('profileView').classList.remove('hidden');
  loadProfile();
}

function showAccounts() {
  hideAllViews();
  document.getElementById('accountsView').classList.remove('hidden');
  loadAccountsUI();
}

function showDnsFirewall() {
  hideAllViews();
  document.getElementById('dnsFirewallView').classList.remove('hidden');
  loadDnsProviders();
}

function showSpamCheck() {
  hideAllViews();
  document.getElementById('spamCheckView').classList.remove('hidden');
  loadUserCheckKeys();
}

function showCategories() {
  hideAllViews();
  document.getElementById('categoriesView').classList.remove('hidden');
  loadCategoryAccounts();
}

function showRules() {
  hideAllViews();
  document.getElementById('rulesView').classList.remove('hidden');
}

// Profile Management
async function loadProfile() {
  try {
    const response = await fetch('/api/profile');
    const result = await response.json();

    if (result.success && result.profile) {
      document.getElementById('profileUserId').textContent = result.profile.userId;
      document.getElementById('profileDbPath').textContent = result.profile.databasePath;
      document.getElementById('profileDbSize').textContent = formatBytes(result.profile.databaseSize);
      document.getElementById('profileVersion').textContent = result.profile.version;
    }
  } catch (error) {
    console.error('Failed to load profile:', error);
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// DNS Firewall Management
async function loadDnsProviders() {
  try {
    const response = await fetch('/api/dns-firewall/providers');
    const result = await response.json();

    if (result.success && result.providers) {
      const container = document.getElementById('dnsProvidersList');

      if (result.providers.length === 0) {
        container.innerHTML = '<p class="text-sm text-gray-500">No DNS firewall providers configured</p>';
      } else {
        container.innerHTML = result.providers.map(provider => {
          const statusBadge = provider.isEnabled
            ? '<span class="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">Enabled</span>'
            : '<span class="text-xs bg-gray-100 text-gray-800 px-2 py-1 rounded">Disabled</span>';

          const defaultBadge = provider.isDefault
            ? '<span class="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded ml-2">Default</span>'
            : '';

          return `
            <div class="border border-gray-200 rounded-lg p-4 mb-4 bg-white">
              <div class="mb-4">
                <div class="flex items-center justify-between mb-2">
                  <div class="flex items-center">
                    <h5 class="font-semibold text-lg">${provider.providerName}</h5>
                    ${statusBadge}
                    ${defaultBadge}
                  </div>
                  <div class="flex gap-2">
                    <button onclick="testDnsProvider('${provider.providerId}')" class="text-gray-600 hover:text-gray-800 text-sm">
                      Test
                    </button>
                    <button onclick="editDnsProvider('${provider.providerId}')" class="text-blue-600 hover:text-blue-800 text-sm">
                      Edit
                    </button>
                  </div>
                </div>
                <p class="text-xs text-gray-500">Type: ${provider.providerType}</p>
                <p class="text-xs text-gray-500">Endpoint: ${provider.apiEndpoint}</p>
                ${provider.apiKey ? '<p class="text-xs text-gray-500">API Key: ••••••••</p>' : ''}
              </div>

              <div class="grid grid-cols-3 gap-4 pt-4 border-t border-gray-200">
                <div>
                  <label class="flex items-center cursor-pointer">
                    <input type="checkbox"
                      ${provider.isEnabled ? 'checked' : ''}
                      onchange="toggleDnsProvider('${provider.providerId}', this.checked)"
                      class="mr-2 cursor-pointer">
                    <span class="text-sm font-medium">Enabled</span>
                  </label>
                  <p class="text-xs text-gray-500 mt-1">Use this provider</p>
                </div>

                <div>
                  <label class="flex items-center cursor-pointer">
                    <input type="checkbox"
                      ${provider.isDefault ? 'checked' : ''}
                      onchange="setDefaultDnsProvider('${provider.providerId}', this.checked)"
                      class="mr-2 cursor-pointer">
                    <span class="text-sm font-medium">Default</span>
                  </label>
                  <p class="text-xs text-gray-500 mt-1">Primary provider</p>
                </div>

                <div>
                  <div class="flex items-center">
                    <label class="text-sm font-medium mr-2">Timeout:</label>
                    <input type="number"
                      value="${provider.timeoutMs}"
                      onchange="updateDnsProviderTimeout('${provider.providerId}', this.value)"
                      class="w-20 px-2 py-1 border border-gray-300 rounded text-sm">
                    <span class="text-xs text-gray-500 ml-1">ms</span>
                  </div>
                  <p class="text-xs text-gray-500 mt-1">Query timeout</p>
                </div>
              </div>

              <div id="dns-test-result-${provider.providerId}" class="hidden mt-4 pt-4 border-t border-gray-200"></div>
            </div>
          `;
        }).join('');
      }
    }
  } catch (error) {
    console.error('Failed to load DNS providers:', error);
  }
}

async function toggleDnsProvider(providerId, isEnabled) {
  try {
    const response = await fetch(`/api/dns-firewall/providers/${providerId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isEnabled })
    });

    const result = await response.json();
    if (result.success) {
      loadDnsProviders();
    }
  } catch (error) {
    console.error('Failed to update DNS provider:', error);
  }
}

async function setDefaultDnsProvider(providerId, isDefault) {
  try {
    const response = await fetch(`/api/dns-firewall/providers/${providerId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isDefault })
    });

    const result = await response.json();
    if (result.success) {
      loadDnsProviders();
    }
  } catch (error) {
    console.error('Failed to update DNS provider:', error);
  }
}

async function updateDnsProviderTimeout(providerId, timeoutMs) {
  try {
    const timeout = parseInt(timeoutMs);
    if (isNaN(timeout) || timeout < 1000 || timeout > 30000) {
      alert('Timeout must be between 1000 and 30000 milliseconds');
      loadDnsProviders();
      return;
    }

    const response = await fetch(`/api/dns-firewall/providers/${providerId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeoutMs: timeout })
    });

    const result = await response.json();
    if (result.success) {
      loadDnsProviders();
    }
  } catch (error) {
    console.error('Failed to update DNS provider timeout:', error);
  }
}

function editDnsProvider(providerId) {
  const providerName = prompt('Edit DNS Provider\n\nProvider name:');
  if (!providerName) return;

  const apiEndpoint = prompt('API Endpoint:');
  if (!apiEndpoint) return;

  const apiKey = prompt('API Key (leave empty if not required):');

  updateDnsProviderDetails(providerId, providerName, apiEndpoint, apiKey);
}

async function updateDnsProviderDetails(providerId, providerName, apiEndpoint, apiKey) {
  try {
    const updates = { providerName, apiEndpoint };
    if (apiKey) {
      updates.apiKey = apiKey;
    }

    const response = await fetch(`/api/dns-firewall/providers/${providerId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });

    const result = await response.json();
    if (result.success) {
      loadDnsProviders();
    } else {
      alert('Failed to update provider: ' + result.error);
    }
  } catch (error) {
    console.error('Failed to update DNS provider:', error);
    alert('Failed to update provider');
  }
}

async function testDnsProvider(providerId) {
  const resultDiv = document.getElementById(`dns-test-result-${providerId}`);
  resultDiv.classList.remove('hidden');
  resultDiv.innerHTML = '<div class="text-gray-600 text-sm">Testing DNS provider...</div>';

  try {
    const response = await fetch(`/api/dns-firewall/providers/${providerId}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: 'google.com' })
    });

    const result = await response.json();

    if (result.success) {
      resultDiv.innerHTML = `
        <div class="bg-green-50 border border-green-200 rounded p-3 text-sm">
          <div class="flex items-center mb-2">
            <span class="text-green-600 font-semibold">✓ DNS Query Successful</span>
          </div>
          <p class="text-gray-700">Test domain: <span class="font-mono">google.com</span></p>
          ${result.blocked !== undefined ? `<p class="text-gray-700">Blocked: <span class="font-semibold ${result.blocked ? 'text-red-600' : 'text-green-600'}">${result.blocked ? 'Yes' : 'No'}</span></p>` : ''}
          ${result.responseTime ? `<p class="text-gray-600">Response time: ${result.responseTime}ms</p>` : ''}
          ${result.addresses ? `<p class="text-gray-600 mt-1">Resolved: ${result.addresses.join(', ')}</p>` : ''}
        </div>
      `;
    } else {
      resultDiv.innerHTML = `
        <div class="bg-red-50 border border-red-200 rounded p-3 text-sm">
          <span class="text-red-600 font-semibold">✗ DNS Query Failed</span>
          <p class="text-red-700 mt-1">${result.error || 'Unknown error'}</p>
        </div>
      `;
    }
  } catch (error) {
    resultDiv.innerHTML = `
      <div class="bg-red-50 border border-red-200 rounded p-3 text-sm">
        <span class="text-red-600 font-semibold">✗ Test Failed</span>
        <p class="text-red-700 mt-1">${error.message}</p>
      </div>
    `;
  }
}

// UserCheck / SPAM Check Management
async function loadUserCheckKeys() {
  try {
    const response = await fetch('/api/usercheck/keys');
    const result = await response.json();

    if (result.success && result.keys) {
      const container = document.getElementById('userCheckKeysList');

      if (result.keys.length === 0) {
        container.innerHTML = `
          <p class="text-sm text-gray-500 mb-4">No UserCheck API keys configured</p>
          <button onclick="addUserCheckKey()" class="bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700">
            Add API Key
          </button>
        `;
      } else {
        container.innerHTML = result.keys.map(key => {
          const statusBadge = key.isActive
            ? '<span class="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">Active</span>'
            : '<span class="text-xs bg-gray-100 text-gray-800 px-2 py-1 rounded">Inactive</span>';

          return `
            <div class="border border-gray-200 rounded-lg p-4 mb-4">
              <div class="flex justify-between items-start">
                <div>
                  <div class="flex items-center mb-2">
                    <h5 class="font-semibold">${key.email}</h5>
                    ${statusBadge}
                  </div>
                  <p class="text-xs text-gray-500">Key: ${key.apiKey.substring(0, 10)}...${key.apiKey.substring(key.apiKey.length - 4)}</p>
                </div>
                <button onclick="deleteUserCheckKey('${key.email}')" class="text-red-600 hover:text-red-800 text-sm">
                  Delete
                </button>
              </div>
            </div>
          `;
        }).join('');

        container.innerHTML += `
          <button onclick="addUserCheckKey()" class="bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700 mt-4">
            Add Another API Key
          </button>
        `;
      }
    }
  } catch (error) {
    console.error('Failed to load UserCheck keys:', error);
  }
}

function addUserCheckKey() {
  const email = prompt('Enter email address for this API key:');
  if (!email) return;

  const apiKey = prompt('Enter UserCheck API key:');
  if (!apiKey) return;

  saveUserCheckKey(email, apiKey);
}

async function saveUserCheckKey(email, apiKey) {
  try {
    const response = await fetch('/api/usercheck/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, apiKey, isActive: true })
    });

    const result = await response.json();
    if (result.success) {
      loadUserCheckKeys();
    } else {
      alert('Failed to save API key: ' + result.error);
    }
  } catch (error) {
    console.error('Failed to save UserCheck key:', error);
    alert('Failed to save API key');
  }
}

async function deleteUserCheckKey(email) {
  if (!confirm(`Delete UserCheck API key for ${email}?`)) return;

  try {
    const response = await fetch(`/api/usercheck/keys/${encodeURIComponent(email)}`, {
      method: 'DELETE'
    });

    const result = await response.json();
    if (result.success) {
      loadUserCheckKeys();
    } else {
      alert('Failed to delete API key: ' + result.error);
    }
  } catch (error) {
    console.error('Failed to delete UserCheck key:', error);
    alert('Failed to delete API key');
  }
}

// Categories Management
async function loadCategoryAccounts() {
  try {
    const response = await fetch('/api/accounts');
    const result = await response.json();

    if (result.success && result.accounts) {
      const select = document.getElementById('categoryAccountSelect');
      select.innerHTML = '<option value="">Select an account...</option>' +
        result.accounts.map(acc =>
          `<option value="${acc.id}">${acc.email}</option>`
        ).join('');
    }
  } catch (error) {
    console.error('Failed to load accounts:', error);
  }
}

async function loadCategories() {
  const accountId = document.getElementById('categoryAccountSelect').value;
  if (!accountId) {
    document.getElementById('categoriesList').innerHTML = '<p class="text-sm text-gray-500">Select an account to view categories</p>';
    return;
  }

  try {
    const response = await fetch(`/api/categories/${accountId}`);
    const result = await response.json();

    if (result.success && result.categories) {
      const container = document.getElementById('categoriesList');

      if (result.categories.length === 0) {
        container.innerHTML = '<p class="text-sm text-gray-500">No categories configured for this account</p>';
      } else {
        container.innerHTML = '<div class="space-y-2">' + result.categories.map(cat => `
          <div class="border border-gray-200 rounded-lg p-4 flex justify-between items-center">
            <div>
              <h5 class="font-semibold">${cat.categoryName}</h5>
              <p class="text-sm text-gray-500">Folder: ${cat.folderName}</p>
            </div>
            <button onclick="deleteCategory(${cat.categoryId})" class="text-red-600 hover:text-red-800 text-sm">
              Delete
            </button>
          </div>
        `).join('') + '</div>';
      }
    }
  } catch (error) {
    console.error('Failed to load categories:', error);
  }
}

async function addCategory() {
  const accountId = document.getElementById('categoryAccountSelect').value;
  const categoryName = document.getElementById('newCategoryName').value.trim();
  const folderName = document.getElementById('newFolderName').value.trim();

  if (!accountId) {
    alert('Please select an account first');
    return;
  }

  if (!categoryName || !folderName) {
    alert('Please enter both category name and folder name');
    return;
  }

  try {
    const response = await fetch('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId, categoryName, folderName })
    });

    const result = await response.json();
    if (result.success) {
      document.getElementById('newCategoryName').value = '';
      document.getElementById('newFolderName').value = '';
      loadCategories();
    } else {
      alert('Failed to add category: ' + result.error);
    }
  } catch (error) {
    console.error('Failed to add category:', error);
    alert('Failed to add category');
  }
}

async function deleteCategory(categoryId) {
  if (!confirm('Delete this category?')) return;

  try {
    const response = await fetch(`/api/categories/${categoryId}`, {
      method: 'DELETE'
    });

    const result = await response.json();
    if (result.success) {
      loadCategories();
    } else {
      alert('Failed to delete category: ' + result.error);
    }
  } catch (error) {
    console.error('Failed to delete category:', error);
    alert('Failed to delete category');
  }
}

// Accounts Management
async function loadAccountsUI() {
  document.getElementById('accountsList').classList.remove('hidden');
  document.getElementById('accountFormView').classList.add('hidden');
  await loadAccountsList();
}

async function loadAccountsList() {
  try {
    const response = await fetch('/api/accounts');
    const accounts = await response.json();

    const container = document.getElementById('accountsListContent');

    if (Array.isArray(accounts) && accounts.length > 0) {
      container.innerHTML = '<div class="space-y-2">' + accounts.map(acc => `
        <div class="border border-gray-200 rounded-lg p-4" id="account-${acc.id}">
          <div class="flex justify-between items-start">
            <div>
              <h5 class="font-semibold">${acc.user}</h5>
              <p class="text-sm text-gray-500">Name: ${acc.name}</p>
              <p class="text-sm text-gray-500">Host: ${acc.host}:${acc.port}</p>
              <span class="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">Configured</span>
            </div>
            <div class="flex gap-2">
              <button onclick="testSingleAccount('${acc.id}')" class="text-gray-600 hover:text-gray-800 text-sm">
                Test
              </button>
              <button onclick="connectAccount('${acc.id}')" class="text-blue-600 hover:text-blue-800 text-sm">
                Connect
              </button>
              <button onclick="deleteAccount('${acc.id}')" class="text-red-600 hover:text-red-800 text-sm">
                Delete
              </button>
            </div>
          </div>
          <div id="test-result-${acc.id}" class="hidden mt-3 text-sm"></div>
        </div>
      `).join('') + '</div>';
    } else {
      container.innerHTML = '<p class="text-gray-500">No accounts configured. Click "Add Account" to get started.</p>';
    }
  } catch (error) {
    console.error('Failed to load accounts:', error);
    document.getElementById('accountsListContent').innerHTML = '<p class="text-red-500">Failed to load accounts</p>';
  }
}

function startAddAccount() {
  document.getElementById('accountsList').classList.add('hidden');
  document.getElementById('accountFormView').classList.remove('hidden');
  document.getElementById('formTitle').textContent = 'Add New Account';

  // Clear form
  document.getElementById('accountEmail').value = '';
  document.getElementById('accountPassword').value = '';
  document.getElementById('accountImapHost').value = '';
  document.getElementById('accountImapPort').value = '993';
  document.getElementById('accountFormMessage').classList.add('hidden');
}

function cancelAccountForm() {
  document.getElementById('accountsList').classList.remove('hidden');
  document.getElementById('accountFormView').classList.add('hidden');
}

async function testAccountConnection() {
  const email = document.getElementById('accountEmail').value;
  const password = document.getElementById('accountPassword').value;
  const imapHost = document.getElementById('accountImapHost').value;
  const imapPort = document.getElementById('accountImapPort').value;

  if (!email || !password || !imapHost || !imapPort) {
    showAccountFormMessage('Please fill in all fields', 'error');
    return;
  }

  showAccountFormMessage('Testing connection...', 'info');

  try {
    const response = await fetch('/api/accounts/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, imapHost, imapPort: parseInt(imapPort) })
    });

    const result = await response.json();

    if (result.success) {
      showAccountFormMessage('✅ Connection successful!', 'success');
    } else {
      showAccountFormMessage('❌ Connection failed: ' + result.error, 'error');
    }
  } catch (error) {
    showAccountFormMessage('❌ Test failed: ' + error.message, 'error');
  }
}

async function saveAccount() {
  const email = document.getElementById('accountEmail').value;
  const password = document.getElementById('accountPassword').value;
  const imapHost = document.getElementById('accountImapHost').value;
  const imapPort = document.getElementById('accountImapPort').value;

  if (!email || !password || !imapHost || !imapPort) {
    showAccountFormMessage('Please fill in all fields', 'error');
    return;
  }

  showAccountFormMessage('Saving account...', 'info');

  try {
    const response = await fetch('/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        imapHost,
        imapPort: parseInt(imapPort),
        imapSecure: true
      })
    });

    const result = await response.json();

    if (result.success) {
      showAccountFormMessage('✅ Account saved successfully!', 'success');
      setTimeout(() => {
        cancelAccountForm();
        loadAccountsList();
      }, 1500);
    } else {
      showAccountFormMessage('❌ Failed to save: ' + result.error, 'error');
    }
  } catch (error) {
    showAccountFormMessage('❌ Save failed: ' + error.message, 'error');
  }
}

function showAccountFormMessage(message, type) {
  const messageEl = document.getElementById('accountFormMessage');
  messageEl.classList.remove('hidden');

  const bgColors = {
    success: 'bg-green-50 border-green-200 text-green-800',
    error: 'bg-red-50 border-red-200 text-red-800',
    info: 'bg-blue-50 border-blue-200 text-blue-800'
  };

  messageEl.className = `mt-4 p-4 rounded-md border ${bgColors[type] || bgColors.info}`;
  messageEl.textContent = message;
}

async function connectAccount(accountId) {
  try {
    const response = await fetch(`/api/accounts/${accountId}/connect`, {
      method: 'POST'
    });

    const result = await response.json();

    if (result.success) {
      loadAccountsList();
    } else {
      alert('Failed to connect: ' + result.error);
    }
  } catch (error) {
    alert('Failed to connect: ' + error.message);
  }
}

async function deleteAccount(accountId) {
  if (!confirm('Are you sure you want to delete this account?')) return;

  try {
    const response = await fetch(`/api/accounts/${accountId}`, {
      method: 'DELETE'
    });

    const result = await response.json();

    if (result.success) {
      loadAccountsList();
    } else {
      alert('Failed to delete: ' + result.error);
    }
  } catch (error) {
    alert('Failed to delete: ' + error.message);
  }
}

async function testSingleAccount(accountId) {
  const resultDiv = document.getElementById(`test-result-${accountId}`);
  resultDiv.classList.remove('hidden');
  resultDiv.innerHTML = '<div class="text-gray-600">Testing connection...</div>';

  try {
    const response = await fetch(`/api/accounts/${accountId}/test`, {
      method: 'POST'
    });

    const result = await response.json();

    if (result.success && result.results) {
      const testResults = result.results;
      const imapStatus = testResults.imap?.success
        ? `<span class="text-green-600">✓ IMAP Connected</span>`
        : `<span class="text-red-600">✗ IMAP Failed</span>`;

      const smtpStatus = testResults.smtp?.tested
        ? (testResults.smtp.success ? `<span class="text-green-600">✓ SMTP OK</span>` : `<span class="text-red-600">✗ SMTP Failed</span>`)
        : `<span class="text-gray-500">○ SMTP Not Tested</span>`;

      resultDiv.innerHTML = `
        <div class="bg-gray-50 rounded p-3">
          <div class="flex gap-4">
            <div>${imapStatus}</div>
            <div>${smtpStatus}</div>
          </div>
          ${testResults.imap?.unreadCount !== undefined ? `<div class="text-xs text-gray-600 mt-1">📬 ${testResults.imap.unreadCount} unread emails</div>` : ''}
          ${testResults.error ? `<div class="text-xs text-red-600 mt-1">${testResults.error}</div>` : ''}
          <div class="text-xs text-gray-500 mt-1">Test completed in ${testResults.totalTime}ms</div>
        </div>
      `;
    } else {
      resultDiv.innerHTML = `<div class="bg-red-50 text-red-600 rounded p-3">❌ ${result.error || 'Test failed'}</div>`;
    }
  } catch (error) {
    resultDiv.innerHTML = `<div class="bg-red-50 text-red-600 rounded p-3">❌ ${error.message}</div>`;
  }
}

async function testAllAccounts() {
  try {
    const response = await fetch('/api/accounts');
    const accounts = await response.json();

    if (!Array.isArray(accounts) || accounts.length === 0) {
      alert('No accounts to test');
      return;
    }

    // Test each account
    for (const account of accounts) {
      await testSingleAccount(account.id);
    }
  } catch (error) {
    alert('Failed to test accounts: ' + error.message);
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  showDashboard();
});
