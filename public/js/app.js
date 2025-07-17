// Email providers data
let providers = [];
let selectedProvider = null;
let currentStep = 1;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    await loadProviders();
    renderProviders();
    
    // Setup form handler
    document.getElementById('accountForm').addEventListener('submit', handleAccountSubmit);
});

// Load providers from API
async function loadProviders() {
    try {
        const response = await fetch('/api/providers');
        providers = await response.json();
    } catch (error) {
        console.error('Failed to load providers:', error);
    }
}

// Render provider grid
function renderProviders() {
    const grid = document.getElementById('providerGrid');
    grid.innerHTML = providers.map(provider => `
        <div class="provider-card bg-white rounded-lg shadow p-4 cursor-pointer hover:shadow-lg border-l-4" onclick="selectProvider('${provider.id}')" style="border-left-color: ${provider.color}">
            <div class="text-center">
                <div class="h-12 w-12 mx-auto mb-2 rounded-lg flex items-center justify-center" style="background-color: ${provider.color}15;">
                    ${provider.iconSvg}
                </div>
                <h3 class="font-medium text-gray-900">${provider.displayName}</h3>
                ${provider.domains.length > 0 ? `<p class="text-sm text-gray-500 mt-1">${provider.domains[0]}</p>` : ''}
            </div>
        </div>
    `).join('');
}

// Select provider
function selectProvider(providerId) {
    selectedProvider = providers.find(p => p.id === providerId);
    goToStep(2);
    
    // Pre-fill advanced settings
    if (selectedProvider) {
        document.getElementById('imapHost').value = selectedProvider.imapHost;
        document.getElementById('imapPort').value = selectedProvider.imapPort;
        
        // Update password help text
        const passwordHelp = document.getElementById('passwordHelp');
        if (selectedProvider.requiresAppPassword) {
            passwordHelp.innerHTML = `<span class="mr-1">ℹ️</span>${selectedProvider.notes || 'This provider requires an app-specific password.'}`;
            if (selectedProvider.helpUrl) {
                passwordHelp.innerHTML += ` <a href="${selectedProvider.helpUrl}" target="_blank" class="text-blue-600 hover:underline">Learn more</a>`;
            }
        } else {
            passwordHelp.textContent = '';
        }
    }
}

// Navigation
function goToStep(step) {
    currentStep = step;
    
    // Hide all steps
    document.getElementById('providerSelection').classList.add('hidden');
    document.getElementById('credentialsForm').classList.add('hidden');
    document.getElementById('testConnection').classList.add('hidden');
    document.getElementById('accountsList').classList.add('hidden');
    
    // Update step indicators
    for (let i = 1; i <= 3; i++) {
        const stepEl = document.getElementById(`step${i}`);
        const circle = stepEl.querySelector('.step-circle');
        
        if (i < step) {
            stepEl.classList.remove('step-inactive');
            circle.classList.add('bg-green-600', 'text-white');
            circle.classList.remove('bg-gray-300', 'text-gray-600', 'bg-blue-600');
            circle.innerHTML = '✓';
        } else if (i === step) {
            stepEl.classList.remove('step-inactive');
            circle.classList.add('bg-blue-600', 'text-white');
            circle.classList.remove('bg-gray-300', 'text-gray-600', 'bg-green-600');
            circle.textContent = i;
        } else {
            stepEl.classList.add('step-inactive');
            circle.classList.add('bg-gray-300', 'text-gray-600');
            circle.classList.remove('bg-blue-600', 'text-white', 'bg-green-600');
            circle.textContent = i;
        }
    }
    
    // Show current step
    switch(step) {
        case 1:
            document.getElementById('providerSelection').classList.remove('hidden');
            break;
        case 2:
            document.getElementById('credentialsForm').classList.remove('hidden');
            break;
        case 3:
            document.getElementById('testConnection').classList.remove('hidden');
            break;
    }
}

// Handle account form submission
async function handleAccountSubmit(e) {
    e.preventDefault();
    
    const accountData = {
        name: document.getElementById('accountName').value,
        email: document.getElementById('email').value,
        password: document.getElementById('password').value,
        host: document.getElementById('imapHost').value,
        port: parseInt(document.getElementById('imapPort').value),
        tls: selectedProvider?.imapSecurity !== 'STARTTLS'
    };
    
    // Auto-detect provider if not selected
    if (!selectedProvider || selectedProvider.id === 'custom') {
        const domain = accountData.email.split('@')[1];
        const detectedProvider = providers.find(p => 
            p.domains.some(d => domain.endsWith(d))
        );
        if (detectedProvider) {
            accountData.host = detectedProvider.imapHost;
            accountData.port = detectedProvider.imapPort;
            accountData.tls = detectedProvider.imapSecurity !== 'STARTTLS';
        }
    }
    
    goToStep(3);
    await testAndSaveAccount(accountData);
}

// Test and save account
async function testAndSaveAccount(accountData) {
    // Show loading
    document.getElementById('testProgress').classList.remove('hidden');
    document.getElementById('testSuccess').classList.add('hidden');
    document.getElementById('testError').classList.add('hidden');
    
    try {
        // Test connection
        const testResponse = await fetch('/api/test-connection', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(accountData)
        });
        
        const testResult = await testResponse.json();
        
        if (!testResult.success) {
            throw new Error(testResult.error || 'Connection test failed');
        }
        
        // Save account
        const saveResponse = await fetch('/api/accounts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(accountData)
        });
        
        const saveResult = await saveResponse.json();
        
        if (!saveResult.success) {
            throw new Error(saveResult.error || 'Failed to save account');
        }
        
        // Show success
        document.getElementById('testProgress').classList.add('hidden');
        document.getElementById('testSuccess').classList.remove('hidden');
        
    } catch (error) {
        // Show error
        document.getElementById('testProgress').classList.add('hidden');
        document.getElementById('testError').classList.remove('hidden');
        document.getElementById('errorMessage').textContent = error.message;
    }
}

// View accounts
async function viewAccounts() {
    document.getElementById('providerSelection').classList.add('hidden');
    document.getElementById('credentialsForm').classList.add('hidden');
    document.getElementById('testConnection').classList.add('hidden');
    document.getElementById('accountsList').classList.remove('hidden');
    
    try {
        const response = await fetch('/api/accounts');
        const accounts = await response.json();
        
        const table = document.getElementById('accountsTable');
        if (accounts.length === 0) {
            table.innerHTML = '<p class="text-gray-500 text-center py-8">No accounts configured yet.</p>';
        } else {
            table.innerHTML = `
                <table class="w-full">
                    <thead>
                        <tr class="border-b">
                            <th class="text-left pb-2">Name</th>
                            <th class="text-left pb-2">Email</th>
                            <th class="text-left pb-2">Server</th>
                            <th class="text-left pb-2">Status</th>
                            <th class="text-right pb-2">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${accounts.map(account => `
                            <tr class="border-b">
                                <td class="py-3">${account.name}</td>
                                <td class="py-3">${account.user}</td>
                                <td class="py-3">${account.host}</td>
                                <td class="py-3">
                                    <span class="px-2 py-1 text-xs rounded-full bg-green-100 text-green-800">Active</span>
                                </td>
                                <td class="py-3 text-right">
                                    <button onclick="removeAccount('${account.id}')" class="text-red-600 hover:text-red-800">
                                        🗑️
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        }
    } catch (error) {
        console.error('Failed to load accounts:', error);
    }
}

// Remove account
async function removeAccount(accountId) {
    if (!confirm('Are you sure you want to remove this account?')) return;
    
    try {
        await fetch(`/api/accounts/${accountId}`, { method: 'DELETE' });
        viewAccounts(); // Refresh list
    } catch (error) {
        alert('Failed to remove account: ' + error.message);
    }
}

// UI helpers
function togglePassword() {
    const input = document.getElementById('password');
    const icon = document.getElementById('passwordToggle');
    
    if (input.type === 'password') {
        input.type = 'text';
        icon.textContent = '🙈';
    } else {
        input.type = 'password';
        icon.textContent = '👁️';
    }
}

function toggleAdvanced() {
    const advanced = document.getElementById('advancedSettings');
    advanced.classList.toggle('hidden');
}

function showProviderSelection() {
    currentStep = 1;
    goToStep(1);
}

function addAnotherAccount() {
    // Reset form
    document.getElementById('accountForm').reset();
    selectedProvider = null;
    goToStep(1);
}

function closeWindow() {
    if (window.close) {
        window.close();
    } else {
        alert('Account added successfully! You can close this window.');
    }
}