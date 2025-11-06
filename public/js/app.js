// Email providers data
let providers = [];
let selectedProvider = null;
let currentStep = 1;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    await loadProviders();
    renderProviders();
    await loadVersionInfo();

    // Set initial form handler (managed via onsubmit property to support add/edit mode switching)
    document.getElementById('accountForm').onsubmit = handleAccountSubmit;

    // Clear test results when form fields change
    const formFields = ['email', 'password', 'imapHost', 'imapPort'];
    formFields.forEach(fieldId => {
        document.getElementById(fieldId).addEventListener('input', () => {
            document.getElementById('inlineTestResult').classList.add('hidden');
            document.getElementById('inlineTestSuccess').classList.add('hidden');
            document.getElementById('inlineTestError').classList.add('hidden');
        });
    });
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

// Load version info from API
async function loadVersionInfo() {
    try {
        const response = await fetch('/api/health');
        const health = await response.json();

        // Update MCP version
        const mcpVersionElement = document.getElementById('mcpVersion');
        if (mcpVersionElement && health.mcpVersion) {
            mcpVersionElement.textContent = `v${health.mcpVersion}`;
        }

        // Update UI version
        const uiVersionElement = document.getElementById('uiVersion');
        if (uiVersionElement && health.uiVersion) {
            uiVersionElement.textContent = `v${health.uiVersion}`;
        }
    } catch (error) {
        console.error('Failed to load version info:', error);

        // Set fallback text on error
        const mcpVersionElement = document.getElementById('mcpVersion');
        if (mcpVersionElement) {
            mcpVersionElement.textContent = 'Unknown';
        }

        const uiVersionElement = document.getElementById('uiVersion');
        if (uiVersionElement) {
            uiVersionElement.textContent = 'Unknown';
        }
    }
}

// Render provider grid
function renderProviders() {
    const grid = document.getElementById('providerGrid');
    grid.innerHTML = providers.map(provider => `
        <div class="provider-card bg-white rounded-lg shadow p-4 cursor-pointer hover:shadow-lg border-l-4" onclick="selectProvider('${provider.id}')" style="border-left-color: ${provider.color}">
            <div class="text-center">
                <div class="h-12 w-12 mx-auto mb-2 rounded-lg flex items-center justify-center p-2" style="background-color: ${provider.color}15;">
                    <img src="${provider.iconUrl}" alt="${provider.name}" class="w-full h-full object-contain" style="filter: brightness(0) saturate(100%) invert(0)" 
                         onload="this.style.filter = 'none'" 
                         onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                    <div class="w-full h-full items-center justify-center text-sm font-bold text-white rounded" style="display:none; background-color: ${provider.color};">
                        ${provider.name.charAt(0)}
                    </div>
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
        
        // Reset SMTP settings
        document.getElementById('enableSmtp').checked = false;
        document.getElementById('smtpSettings').classList.add('hidden');
        document.getElementById('smtpSameAuth').checked = true;
        document.getElementById('smtpAuthFields').classList.add('hidden');
        
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

// Handle account update
async function handleAccountUpdate(e) {
    e.preventDefault();

    const accountData = {
        name: document.getElementById('accountName').value,
        email: document.getElementById('email').value,
        password: document.getElementById('password').value,
        host: document.getElementById('imapHost').value,
        port: parseInt(document.getElementById('imapPort').value),
        tls: selectedProvider?.imapSecurity !== 'STARTTLS'
    };

    // Only include password if it was changed
    if (!accountData.password) {
        delete accountData.password;
    }

    // Add SMTP configuration if enabled, or explicitly set to null if disabled
    if (document.getElementById('enableSmtp').checked) {
        accountData.smtp = {
            host: document.getElementById('smtpHost').value,
            port: parseInt(document.getElementById('smtpPort').value) || 587,
            tls: document.getElementById('smtpSecure').checked
        };

        // Add SMTP auth if not using same credentials
        if (!document.getElementById('smtpSameAuth').checked) {
            accountData.smtp.user = document.getElementById('smtpUser').value;
            const smtpPassword = document.getElementById('smtpPassword').value;
            if (smtpPassword) {
                accountData.smtp.password = smtpPassword;
            }
        }
    } else {
        // Explicitly set to null to clear SMTP configuration
        accountData.smtp = null;
    }

    goToStep(3);
    await updateAndTestAccount(window.editingAccountId, accountData);
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
    
    // Add SMTP configuration if enabled
    if (document.getElementById('enableSmtp').checked) {
        accountData.smtp = {
            host: document.getElementById('smtpHost').value,
            port: parseInt(document.getElementById('smtpPort').value) || 587,
            secure: document.getElementById('smtpSecure').checked
        };
        
        // Add SMTP auth if not using same credentials
        if (!document.getElementById('smtpSameAuth').checked) {
            accountData.smtp.user = document.getElementById('smtpUser').value;
            accountData.smtp.password = document.getElementById('smtpPassword').value;
        }
    }
    
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

// Update and test account
async function updateAndTestAccount(accountId, accountData) {
    // Show loading
    document.getElementById('testProgress').classList.remove('hidden');
    document.getElementById('testSuccess').classList.add('hidden');
    document.getElementById('testError').classList.add('hidden');
    
    try {
        // Test connection with new data
        const testResponse = await fetch('/api/test-connection', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...accountData,
                // If no password provided, we need to test with existing one
                password: accountData.password || 'use-existing'
            })
        });
        
        const testResult = await testResponse.json();
        
        if (!testResult.success && accountData.password) {
            throw new Error(testResult.error || 'Connection test failed');
        }
        
        // Update account
        const updateResponse = await fetch(`/api/accounts/${accountId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(accountData)
        });
        
        const updateResult = await updateResponse.json();
        
        if (!updateResult.success) {
            throw new Error(updateResult.error || 'Failed to update account');
        }
        
        // Show success
        document.getElementById('testProgress').classList.add('hidden');
        document.getElementById('testSuccess').classList.remove('hidden');
        
        // Update success message
        const successMsg = document.querySelector('#testSuccess h3');
        successMsg.textContent = 'Account updated successfully!';
        
        // Reset edit mode
        window.editingAccountId = null;
        document.getElementById('accountForm').onsubmit = handleAccountSubmit;
        
    } catch (error) {
        // Show error
        document.getElementById('testProgress').classList.add('hidden');
        document.getElementById('testError').classList.remove('hidden');
        document.getElementById('errorMessage').textContent = error.message;
    }
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
                            <th class="text-left pb-2">IMAP Server</th>
                            <th class="text-left pb-2">SMTP Server</th>
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
                                <td class="py-3">${account.smtp ? account.smtp.host : '<span class="text-gray-400">N/A</span>'}</td>
                                <td class="py-3">
                                    <span class="px-2 py-1 text-xs rounded-full bg-green-100 text-green-800">Active</span>
                                </td>
                                <td class="py-3 text-right">
                                    <button onclick="testAccount('${account.id}')" class="text-green-600 hover:text-green-800 mr-2" title="Test Connection">
                                        🩺
                                    </button>
                                    <button onclick="editAccount('${account.id}')" class="text-blue-600 hover:text-blue-800 mr-2" title="Edit Account">
                                        ✏️
                                    </button>
                                    <button onclick="removeAccount('${account.id}')" class="text-red-600 hover:text-red-800" title="Remove Account">
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

// Edit account
async function editAccount(accountId) {
    try {
        // Get account details
        const response = await fetch(`/api/accounts/${accountId}`);
        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.error || 'Failed to load account');
        }
        
        const account = result.account;
        
        // Store editing account ID
        window.editingAccountId = accountId;
        
        // Pre-fill form with account data
        document.getElementById('accountName').value = account.name || '';
        document.getElementById('email').value = account.user || '';
        document.getElementById('password').value = ''; // Don't pre-fill password
        document.getElementById('password').placeholder = 'Leave blank to keep current password';
        document.getElementById('imapHost').value = account.host || '';
        document.getElementById('imapPort').value = account.port || 993;
        
        // Pre-fill SMTP settings if available
        if (account.smtp) {
            document.getElementById('enableSmtp').checked = true;
            document.getElementById('smtpSettings').classList.remove('hidden');
            document.getElementById('smtpHost').value = account.smtp.host || '';
            document.getElementById('smtpPort').value = account.smtp.port || 587;
            document.getElementById('smtpSecure').checked = account.smtp.secure || false;
            
            // Check if using different auth
            if (account.smtp.user && account.smtp.user !== account.user) {
                document.getElementById('smtpSameAuth').checked = false;
                document.getElementById('smtpAuthFields').classList.remove('hidden');
                document.getElementById('smtpUser').value = account.smtp.user;
                document.getElementById('smtpPassword').value = '';
                document.getElementById('smtpPassword').placeholder = 'Leave blank to keep current password';
            } else {
                document.getElementById('smtpSameAuth').checked = true;
                document.getElementById('smtpAuthFields').classList.add('hidden');
            }
        } else {
            document.getElementById('enableSmtp').checked = false;
            document.getElementById('smtpSettings').classList.add('hidden');
        }
        
        // Try to detect provider
        const domain = account.user.split('@')[1];
        const detectedProvider = providers.find(p => 
            p.domains.some(d => domain.endsWith(d))
        );
        selectedProvider = detectedProvider || providers.find(p => p.id === 'custom');
        
        // Show credentials form
        goToStep(2);
        
        // Update form submit handler for edit mode
        document.getElementById('accountForm').onsubmit = handleAccountUpdate;
        
        // Add a visual indicator that we're editing
        const formTitle = document.querySelector('#credentialsForm h2');
        formTitle.textContent = 'Edit account details';

        // Update submit button text
        const submitButton = document.querySelector('#accountForm button[type="submit"]');
        submitButton.innerHTML = 'Save Changes<span class="ml-2">→</span>';
        
        // Add cancel edit button
        const backButton = document.querySelector('#credentialsForm button[onclick="goToStep(1)"]');
        backButton.innerHTML = '<span class="mr-2">✕</span>Cancel';
        backButton.onclick = () => {
            window.editingAccountId = null;
            document.getElementById('accountForm').onsubmit = handleAccountSubmit;
            viewAccounts();
        };
        
    } catch (error) {
        alert('Failed to load account: ' + error.message);
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

// Test current settings
async function testCurrentSettings() {
    // Hide previous results
    document.getElementById('inlineTestResult').classList.remove('hidden');
    document.getElementById('inlineTestSuccess').classList.add('hidden');
    document.getElementById('inlineTestError').classList.add('hidden');

    // Get current form values
    const accountData = {
        name: document.getElementById('accountName').value,
        email: document.getElementById('email').value,
        password: document.getElementById('password').value,
        host: document.getElementById('imapHost').value,
        port: parseInt(document.getElementById('imapPort').value),
        tls: selectedProvider?.imapSecurity !== 'STARTTLS'
    };

    // If editing and no password provided, we can't test
    if (window.editingAccountId && !accountData.password) {
        document.getElementById('inlineTestResult').classList.remove('hidden');
        document.getElementById('inlineTestError').classList.remove('hidden');
        document.getElementById('inlineErrorMessage').textContent = 'Please enter a password to test the connection';
        document.getElementById('errorHelp').innerHTML = '';
        return;
    }

    // Disable test button during test
    const testButton = document.getElementById('testButton');
    const originalText = testButton.innerHTML;
    testButton.disabled = true;
    testButton.innerHTML = '<span class="mr-2">⏳</span>Testing...';

    try {
        const response = await fetch('/api/test-connection', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(accountData)
        });

        const result = await response.json();

        if (result.success) {
            // Show success with details
            document.getElementById('inlineTestSuccess').classList.remove('hidden');

            // Display connection details
            const details = result.details || {};
            const detailsHtml = `
                <div>📊 <strong>Folders found:</strong> ${details.folderCount || 0}</div>
                <div>⏱️ <strong>Connection time:</strong> ${details.connectionTime || 0}ms</div>
                <div>🖥️ <strong>Server:</strong> ${details.serverHost}:${details.serverPort}</div>
                <div>🔒 <strong>TLS:</strong> ${details.tlsEnabled ? 'Enabled' : 'Disabled'}</div>
            `;
            document.getElementById('connectionDetails').innerHTML = detailsHtml;
        } else {
            // Show error with helpful message
            document.getElementById('inlineTestError').classList.remove('hidden');
            document.getElementById('inlineErrorMessage').textContent = result.error || 'Connection failed';

            // Show helpful troubleshooting tip
            if (result.help) {
                document.getElementById('errorHelp').innerHTML = result.help;
                document.getElementById('errorHelp').classList.remove('hidden');
            } else {
                document.getElementById('errorHelp').innerHTML = '';
            }
        }
    } catch (error) {
        document.getElementById('inlineTestError').classList.remove('hidden');
        document.getElementById('inlineErrorMessage').textContent = error.message;
        document.getElementById('errorHelp').innerHTML = '💡 Network error. Check your internet connection and try again.';
    } finally {
        // Re-enable test button
        testButton.disabled = false;
        testButton.innerHTML = originalText;
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

function toggleSmtpSettings() {
    const enabled = document.getElementById('enableSmtp').checked;
    const smtpSettings = document.getElementById('smtpSettings');
    
    if (enabled) {
        smtpSettings.classList.remove('hidden');
        // Auto-fill SMTP settings based on IMAP if provider is selected
        if (selectedProvider) {
            const smtpHost = document.getElementById('smtpHost');
            const smtpPort = document.getElementById('smtpPort');
            const smtpSecure = document.getElementById('smtpSecure');

            if (!smtpHost.value) {
                // Use provider's SMTP host if available, otherwise convert IMAP host
                smtpHost.value = selectedProvider.smtpHost || selectedProvider.imapHost.replace('imap.', 'smtp.').replace('imap-', 'smtp-');
            }
            if (!smtpPort.value) {
                // Use provider's SMTP port if available, otherwise default to 587
                smtpPort.value = selectedProvider.smtpPort || '587';
            }
            // Set TLS checkbox based on provider's SMTP security setting
            if (selectedProvider.smtpSecurity === 'SSL' || selectedProvider.smtpSecurity === 'TLS') {
                smtpSecure.checked = true;
            }
        }
    } else {
        smtpSettings.classList.add('hidden');
    }
}

function toggleSmtpAuth() {
    const sameAuth = document.getElementById('smtpSameAuth').checked;
    const authFields = document.getElementById('smtpAuthFields');
    
    if (sameAuth) {
        authFields.classList.add('hidden');
    } else {
        authFields.classList.remove('hidden');
    }
}

function showProviderSelection() {
    // Reset form and edit mode
    document.getElementById('accountForm').reset();
    document.getElementById('password').placeholder = '';
    window.editingAccountId = null;
    document.getElementById('accountForm').onsubmit = handleAccountSubmit;
    selectedProvider = null;
    
    // Reset form title
    const formTitle = document.querySelector('#credentialsForm h2');
    formTitle.textContent = 'Enter your account details';
    
    // Reset back button
    const backButton = document.querySelector('#credentialsForm button[onclick*="goToStep"]');
    if (backButton) {
        backButton.innerHTML = '<span class="mr-2">←</span>Back';
        backButton.onclick = () => goToStep(1);
    }
    
    // Reset submit button text
    const submitButton = document.querySelector('#accountForm button[type="submit"]');
    if (submitButton) {
        submitButton.innerHTML = 'Continue<span class="ml-2">→</span>';
    }
    
    // Hide test results (but keep test button visible)
    document.getElementById('inlineTestResult').classList.add('hidden');
    document.getElementById('inlineTestSuccess').classList.add('hidden');
    document.getElementById('inlineTestError').classList.add('hidden');
    
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

// Test a single account
async function testAccount(accountId) {
    const resultsArea = document.getElementById('testResults');
    const resultsContent = document.getElementById('testResultsContent');

    // Show results area and loading message
    resultsArea.classList.remove('hidden');
    resultsContent.innerHTML = '<div class="text-center py-4"><div class="loading-spinner mx-auto"></div><p class="mt-2 text-gray-600">Testing account...</p></div>';

    try {
        const response = await fetch(`/api/accounts/${accountId}/test`, {
            method: 'POST'
        });
        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || 'Test failed');
        }

        // Display results
        displayTestResult(result.results);
    } catch (error) {
        resultsContent.innerHTML = `
            <div class="bg-red-50 border border-red-200 rounded-lg p-4">
                <p class="text-red-800 font-semibold">❌ Test Failed</p>
                <p class="text-red-600 text-sm mt-1">${error.message}</p>
            </div>
        `;
    }
}

// Test all accounts
async function testAllAccounts() {
    const resultsArea = document.getElementById('testResults');
    const resultsContent = document.getElementById('testResultsContent');

    try {
        // Get all accounts
        const response = await fetch('/api/accounts');
        const accounts = await response.json();

        if (accounts.length === 0) {
            alert('No accounts to test');
            return;
        }

        // Show results area and loading message
        resultsArea.classList.remove('hidden');
        resultsContent.innerHTML = '<div class="text-center py-4"><div class="loading-spinner mx-auto"></div><p class="mt-2 text-gray-600">Testing all accounts...</p></div>';

        // Test each account
        const results = [];
        for (const account of accounts) {
            try {
                const testResponse = await fetch(`/api/accounts/${account.id}/test`, {
                    method: 'POST'
                });
                const testResult = await testResponse.json();
                results.push(testResult.success ? testResult.results : {
                    accountName: account.name,
                    error: testResult.error || 'Test failed'
                });
            } catch (error) {
                results.push({
                    accountName: account.name,
                    error: error.message
                });
            }
        }

        // Display all results
        displayAllTestResults(results);
    } catch (error) {
        resultsContent.innerHTML = `
            <div class="bg-red-50 border border-red-200 rounded-lg p-4">
                <p class="text-red-800 font-semibold">❌ Test Failed</p>
                <p class="text-red-600 text-sm mt-1">${error.message}</p>
            </div>
        `;
    }
}

// Display test result for a single account
function displayTestResult(result) {
    const resultsContent = document.getElementById('testResultsContent');

    const imapStatus = result.imap.success
        ? `<span class="text-green-600">✓ Connected</span>`
        : `<span class="text-red-600">✗ Failed</span>`;

    const smtpStatus = !result.smtp.tested
        ? '<span class="text-gray-500">Not Configured</span>'
        : result.smtp.success
            ? '<span class="text-green-600">✓ Connected</span>'
            : '<span class="text-red-600">✗ Failed</span>';

    resultsContent.innerHTML = `
        <div class="space-y-4">
            <div class="border-b pb-3">
                <h4 class="font-semibold text-lg">${result.accountName}</h4>
                <p class="text-sm text-gray-500">Test completed in ${result.totalTime}ms</p>
            </div>

            <div class="grid grid-cols-2 gap-4">
                <div class="bg-gray-50 p-4 rounded">
                    <p class="font-semibold text-gray-700">IMAP Connection</p>
                    <p class="mt-2">${imapStatus}</p>
                    ${result.imap.success ? `<p class="text-sm mt-1 text-gray-600">📬 ${result.imap.unreadCount} unread emails</p>` : ''}
                    ${result.imap.error ? `<p class="text-sm mt-1 text-red-600">${result.imap.error}</p>` : ''}
                </div>

                <div class="bg-gray-50 p-4 rounded">
                    <p class="font-semibold text-gray-700">SMTP Connection</p>
                    <p class="mt-2">${smtpStatus}</p>
                    ${result.smtp.error ? `<p class="text-sm mt-1 text-red-600">${result.smtp.error}</p>` : ''}
                </div>
            </div>
        </div>
    `;
}

// Display test results for all accounts
function displayAllTestResults(results) {
    const resultsContent = document.getElementById('testResultsContent');

    const resultsHtml = results.map(result => {
        if (result.error) {
            return `
                <div class="border-b pb-4 mb-4">
                    <h4 class="font-semibold">${result.accountName}</h4>
                    <p class="text-sm text-red-600 mt-1">❌ ${result.error}</p>
                </div>
            `;
        }

        const imapIcon = result.imap.success ? '✓' : '✗';
        const imapColor = result.imap.success ? 'text-green-600' : 'text-red-600';
        const smtpIcon = !result.smtp.tested ? '○' : result.smtp.success ? '✓' : '✗';
        const smtpColor = !result.smtp.tested ? 'text-gray-500' : result.smtp.success ? 'text-green-600' : 'text-red-600';

        return `
            <div class="border-b pb-4 mb-4 last:border-0">
                <h4 class="font-semibold">${result.accountName}</h4>
                <div class="flex gap-4 mt-2 text-sm">
                    <div>
                        <span class="${imapColor}">${imapIcon} IMAP</span>
                        ${result.imap.success ? `<span class="text-gray-600 ml-1">(${result.imap.unreadCount} unread)</span>` : ''}
                    </div>
                    <div>
                        <span class="${smtpColor}">${smtpIcon} SMTP</span>
                        ${!result.smtp.tested ? '<span class="text-gray-500 ml-1">(not configured)</span>' : ''}
                    </div>
                </div>
                ${result.imap.error ? `<p class="text-xs text-red-600 mt-1">IMAP: ${result.imap.error}</p>` : ''}
                ${result.smtp.error ? `<p class="text-xs text-red-600 mt-1">SMTP: ${result.smtp.error}</p>` : ''}
            </div>
        `;
    }).join('');

    resultsContent.innerHTML = `
        <div class="space-y-2">
            <p class="text-sm text-gray-600 mb-4">Tested ${results.length} account(s)</p>
            ${resultsHtml}
        </div>
    `;
}