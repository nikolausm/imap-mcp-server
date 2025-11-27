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
            <div class="border border-gray-200 rounded-lg p-4 mb-4">
              <div class="flex justify-between items-start mb-3">
                <div>
                  <div class="flex items-center">
                    <h5 class="font-semibold">${provider.providerName}</h5>
                    ${statusBadge}
                    ${defaultBadge}
                  </div>
                  <p class="text-xs text-gray-500 mt-1">Type: ${provider.providerType}</p>
                  <p class="text-xs text-gray-500">Endpoint: ${provider.apiEndpoint}</p>
                </div>
              </div>
              <div class="flex items-center space-x-4 text-sm">
                <label class="flex items-center">
                  <input type="checkbox"
                    ${provider.isEnabled ? 'checked' : ''}
                    onchange="toggleDnsProvider('${provider.providerId}', this.checked)"
                    class="mr-2">
                  Enabled
                </label>
                <label class="flex items-center">
                  <input type="checkbox"
                    ${provider.isDefault ? 'checked' : ''}
                    onchange="setDefaultDnsProvider('${provider.providerId}', this.checked)"
                    class="mr-2">
                  Default
                </label>
                <div class="flex items-center">
                  <label class="mr-2">Timeout (ms):</label>
                  <input type="number"
                    value="${provider.timeoutMs}"
                    onchange="updateDnsProviderTimeout('${provider.providerId}', this.value)"
                    class="w-20 px-2 py-1 border border-gray-300 rounded text-sm">
                </div>
              </div>
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

// Accounts UI Loading (placeholder for now - will need full implementation)
function loadAccountsUI() {
  const container = document.getElementById('accountsView');
  container.innerHTML = `
    <div class="flex items-center mb-6">
      <button onclick="showDashboard()" class="text-blue-600 hover:text-blue-800 mr-4">
        ← Back to Dashboard
      </button>
    </div>
    <h2 class="text-3xl font-bold text-gray-900 mb-6">Accounts</h2>
    <div class="bg-white rounded-lg shadow-md p-6 text-center py-12">
      <div class="text-6xl mb-4">📬</div>
      <h3 class="text-2xl font-semibold text-gray-700 mb-2">Account Management</h3>
      <p class="text-gray-600 mb-4">Full account management UI will be integrated here.</p>
      <p class="text-sm text-gray-500">For now, use the MCP tools to manage accounts via Claude.</p>
    </div>
  `;
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  showDashboard();
});
