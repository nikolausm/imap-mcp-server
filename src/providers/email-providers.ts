export interface EmailProvider {
  id: string;
  name: string;
  displayName: string;
  iconUrl: string;
  color: string;
  imapHost: string;
  imapPort: number;
  imapSecurity: 'TLS' | 'SSL' | 'STARTTLS';
  smtpHost?: string;
  smtpPort?: number;
  smtpSecurity?: 'TLS' | 'SSL' | 'STARTTLS';
  domains: string[];
  helpUrl?: string;
  requiresAppPassword?: boolean;
  oauth2Supported?: boolean;
  notes?: string;
}

export const emailProviders: EmailProvider[] = [
  {
    id: 'gmail',
    name: 'Gmail',
    displayName: 'Google Mail',
    iconUrl: 'https://cdn.jsdelivr.net/npm/simple-icons@v10/icons/gmail.svg',
    color: '#EA4335',
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    imapSecurity: 'SSL',
    smtpHost: 'smtp.gmail.com',
    smtpPort: 465,
    smtpSecurity: 'SSL',
    domains: ['gmail.com', 'googlemail.com'],
    helpUrl: 'https://support.google.com/mail/answer/7126229',
    requiresAppPassword: true,
    oauth2Supported: true,
    notes: 'Requires app-specific password or OAuth2. Enable "Less secure app access" or use App Password with 2FA.'
  },
  {
    id: 'outlook',
    name: 'Outlook',
    displayName: 'Microsoft Outlook',
    iconUrl: 'https://cdn.jsdelivr.net/npm/simple-icons@v10/icons/microsoftoutlook.svg',
    color: '#0078D4',
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    imapSecurity: 'TLS',
    smtpHost: 'smtp-mail.outlook.com',
    smtpPort: 587,
    smtpSecurity: 'STARTTLS',
    domains: ['outlook.com', 'hotmail.com', 'live.com', 'msn.com'],
    helpUrl: 'https://support.microsoft.com/en-us/office/pop-imap-and-smtp-settings-8361e398-8af4-4e97-b147-6c6c4ac95353',
    oauth2Supported: true
  },
  {
    id: 'yahoo',
    name: 'Yahoo',
    displayName: 'Yahoo Mail',
    iconUrl: 'https://cdn.jsdelivr.net/npm/simple-icons@v10/icons/yahoo.svg',
    color: '#6001D2',
    imapHost: 'imap.mail.yahoo.com',
    imapPort: 993,
    imapSecurity: 'SSL',
    smtpHost: 'smtp.mail.yahoo.com',
    smtpPort: 465,
    smtpSecurity: 'SSL',
    domains: ['yahoo.com', 'yahoo.de', 'yahoo.co.uk', 'ymail.com'],
    helpUrl: 'https://help.yahoo.com/kb/SLN4075.html',
    requiresAppPassword: true,
    notes: 'Requires app-specific password. Generate one in Yahoo Account Security settings.'
  },
  {
    id: 'icloud',
    name: 'iCloud',
    displayName: 'Apple iCloud Mail',
    iconUrl: 'https://cdn.jsdelivr.net/npm/simple-icons@v10/icons/icloud.svg',
    color: '#007AFF',
    imapHost: 'imap.mail.me.com',
    imapPort: 993,
    imapSecurity: 'SSL',
    smtpHost: 'smtp.mail.me.com',
    smtpPort: 587,
    smtpSecurity: 'STARTTLS',
    domains: ['icloud.com', 'me.com', 'mac.com'],
    helpUrl: 'https://support.apple.com/en-us/HT202304',
    requiresAppPassword: true,
    notes: 'Requires app-specific password if 2FA is enabled.'
  },
  {
    id: 'gmx',
    name: 'GMX',
    displayName: 'GMX Mail',
    iconUrl: 'https://upload.wikimedia.org/wikipedia/commons/4/4e/GMX_logo.svg',
    color: '#FF6900',
    imapHost: 'imap.gmx.net',
    imapPort: 993,
    imapSecurity: 'SSL',
    smtpHost: 'mail.gmx.net',
    smtpPort: 587,
    smtpSecurity: 'STARTTLS',
    domains: ['gmx.net', 'gmx.de', 'gmx.at', 'gmx.ch', 'gmx.com'],
    helpUrl: 'https://support.gmx.com/pop-imap/imap/index.html'
  },
  {
    id: 'webde',
    name: 'Web.de',
    displayName: 'WEB.DE Mail',
    iconUrl: 'https://upload.wikimedia.org/wikipedia/commons/f/f2/Web.de_logo.svg',
    color: '#FFCC00',
    imapHost: 'imap.web.de',
    imapPort: 993,
    imapSecurity: 'SSL',
    smtpHost: 'smtp.web.de',
    smtpPort: 587,
    smtpSecurity: 'STARTTLS',
    domains: ['web.de'],
    helpUrl: 'https://hilfe.web.de/pop-imap/imap/index.html'
  },
  {
    id: 'ionos',
    name: 'IONOS',
    displayName: 'IONOS Mail (1&1)',
    iconUrl: 'https://cdn.jsdelivr.net/npm/simple-icons@v10/icons/ionos.svg',
    color: '#003D8F',
    imapHost: 'imap.ionos.de',
    imapPort: 993,
    imapSecurity: 'SSL',
    smtpHost: 'smtp.ionos.de',
    smtpPort: 587,
    smtpSecurity: 'STARTTLS',
    domains: ['ionos.de', '1und1.de', '1and1.com'],
    helpUrl: 'https://www.ionos.de/hilfe/e-mail/e-mail-konto-in-e-mail-programm-einrichten/imap-posteingangsserver-und-postausgangsserver/',
    notes: 'Use your full email address as username.'
  },
  {
    id: 'mailbox',
    name: 'Mailbox.org',
    displayName: 'mailbox.org',
    iconUrl: 'https://mailbox.org/favicon.ico',
    color: '#5CB85C',
    imapHost: 'imap.mailbox.org',
    imapPort: 993,
    imapSecurity: 'TLS',
    smtpHost: 'smtp.mailbox.org',
    smtpPort: 587,
    smtpSecurity: 'STARTTLS',
    domains: ['mailbox.org'],
    helpUrl: 'https://kb.mailbox.org/en/private/e-mail-article/manual-configuration-of-e-mail-programs'
  },
  {
    id: 'posteo',
    name: 'Posteo',
    displayName: 'Posteo',
    iconUrl: 'https://posteo.de/favicon.ico',
    color: '#8CC63F',
    imapHost: 'posteo.de',
    imapPort: 993,
    imapSecurity: 'TLS',
    smtpHost: 'posteo.de',
    smtpPort: 587,
    smtpSecurity: 'STARTTLS',
    domains: ['posteo.de', 'posteo.net'],
    helpUrl: 'https://posteo.de/en/help/how-do-i-set-up-posteo-in-an-email-client-pop3-imap-and-smtp'
  },
  {
    id: 'aol',
    name: 'AOL',
    displayName: 'AOL Mail',
    iconUrl: 'https://cdn.jsdelivr.net/npm/simple-icons@v10/icons/aol.svg',
    color: '#FF0B00',
    imapHost: 'imap.aol.com',
    imapPort: 993,
    imapSecurity: 'SSL',
    smtpHost: 'smtp.aol.com',
    smtpPort: 465,
    smtpSecurity: 'SSL',
    domains: ['aol.com', 'aol.de'],
    helpUrl: 'https://help.aol.com/articles/how-do-i-use-other-email-applications-to-send-and-receive-my-aol-mail',
    requiresAppPassword: true
  },
  {
    id: 'office365',
    name: 'Office365',
    displayName: 'Microsoft 365',
    iconUrl: 'https://cdn.jsdelivr.net/npm/simple-icons@v10/icons/microsoft365.svg',
    color: '#0078D4',
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    imapSecurity: 'TLS',
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    smtpSecurity: 'STARTTLS',
    domains: [],
    helpUrl: 'https://support.microsoft.com/en-us/office/pop-imap-and-smtp-settings-8361e398-8af4-4e97-b147-6c6c4ac95353',
    notes: 'For business/organization accounts. Use full email as username.',
    oauth2Supported: true
  },
  {
    id: 'zoho',
    name: 'Zoho',
    displayName: 'Zoho Mail',
    iconUrl: 'https://cdn.jsdelivr.net/npm/simple-icons@v10/icons/zoho.svg',
    color: '#C83C2B',
    imapHost: 'imap.zoho.com',
    imapPort: 993,
    imapSecurity: 'SSL',
    smtpHost: 'smtp.zoho.com',
    smtpPort: 465,
    smtpSecurity: 'SSL',
    domains: ['zoho.com', 'zohomail.com'],
    helpUrl: 'https://www.zoho.com/mail/help/imap-access.html',
    notes: 'Enable IMAP access in Zoho Mail settings first.'
  },
  {
    id: 'protonmail',
    name: 'ProtonMail',
    displayName: 'Proton Mail',
    iconUrl: 'https://cdn.jsdelivr.net/npm/simple-icons@v10/icons/protonmail.svg',
    color: '#6D4AFF',
    imapHost: '127.0.0.1',
    imapPort: 1143,
    imapSecurity: 'STARTTLS',
    smtpHost: '127.0.0.1',
    smtpPort: 1025,
    smtpSecurity: 'STARTTLS',
    domains: ['protonmail.com', 'proton.me', 'pm.me'],
    helpUrl: 'https://proton.me/support/protonmail-bridge-install',
    notes: 'Requires ProtonMail Bridge application running locally. Paid accounts only.'
  },
  {
    id: 'fastmail',
    name: 'Fastmail',
    displayName: 'Fastmail',
    iconUrl: 'https://cdn.jsdelivr.net/npm/simple-icons@v10/icons/fastmail.svg',
    color: '#2E5CFF',
    imapHost: 'imap.fastmail.com',
    imapPort: 993,
    imapSecurity: 'SSL',
    smtpHost: 'smtp.fastmail.com',
    smtpPort: 465,
    smtpSecurity: 'SSL',
    domains: ['fastmail.com', 'fastmail.fm'],
    helpUrl: 'https://www.fastmail.help/hc/en-us/articles/1500000278342',
    requiresAppPassword: true,
    notes: 'Requires app-specific password. Create one in Settings > Privacy & Security.'
  },
  {
    id: 'hostinger',
    name: 'Hostinger',
    displayName: 'Hostinger Email',
    iconUrl: 'https://cdn.jsdelivr.net/npm/simple-icons@v10/icons/hostinger.svg',
    color: '#673AB7',
    imapHost: 'imap.hostinger.com',
    imapPort: 993,
    imapSecurity: 'SSL',
    smtpHost: 'smtp.hostinger.com',
    smtpPort: 465,
    smtpSecurity: 'SSL',
    domains: [],
    helpUrl: 'https://support.hostinger.com/en/articles/1583419-how-to-set-up-an-email-account-on-an-email-client',
    notes: 'For Hostinger-hosted email accounts. Use full email address as username.'
  },
  {
    id: 'custom',
    name: 'Custom',
    displayName: 'Custom/Other Provider',
    iconUrl: 'https://cdn.jsdelivr.net/npm/simple-icons@v10/icons/mail.svg',
    color: '#6B7280',
    imapHost: '',
    imapPort: 993,
    imapSecurity: 'SSL',
    domains: [],
    notes: 'Enter your email provider\'s IMAP settings manually.'
  }
];

export function getProviderByEmail(email: string): EmailProvider | undefined {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return undefined;
  
  return emailProviders.find(provider => 
    provider.domains.some(d => domain.endsWith(d))
  );
}

export function getProviderById(id: string): EmailProvider | undefined {
  return emailProviders.find(provider => provider.id === id);
}