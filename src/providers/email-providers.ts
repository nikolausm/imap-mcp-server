export interface EmailProvider {
  id: string;
  name: string;
  displayName: string;
  iconSvg: string;
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
    iconSvg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" fill="#EA4335"/><path d="M16.563 15.543l.532-3.47h-3.328v-2.25c0-.949.465-1.874 1.956-1.874h1.513V4.996s-1.374-.235-2.686-.235c-2.741 0-4.533 1.662-4.533 4.669v2.642H7.078v3.47h3.047v8.385a12.067 12.067 0 003.75 0v-8.385h2.796z" fill="#4285F4"/></svg>`,
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
    iconSvg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7.462 12.444c0 1.285.789 2.074 1.958 2.074 1.169 0 1.958-.789 1.958-2.074s-.789-2.074-1.958-2.074c-1.169 0-1.958.789-1.958 2.074zm9.461-5.407H24v13.926H16.923V7.037zm-6.5 7.37c0-2.334-1.607-4.077-3.961-4.077S2.5 11.93 2.5 14.407c0 2.334 1.607 4.077 3.961 4.077s3.961-1.743 3.961-4.077zm6.5-5.407V2.963c0-.703-.568-1.27-1.27-1.27H9.115c-.703 0-1.27.568-1.27 1.27v.37c-.703-.37-1.61-.555-2.48-.555C2.5 3.148 0 5.815 0 9.407v9.148c0 .926.741 1.667 1.667 1.667H22.5c.926 0 1.667-.741 1.667-1.667V9.407c0-.926-.741-1.667-1.667-1.667z" fill="#0078D4"/></svg>`,
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
    iconSvg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.568 7.34l-3.656 7.34v4.32h-1.824V14.68L7.432 7.34h2.136l2.432 4.896L14.432 7.34h2.136z" fill="#6001D2"/></svg>`,
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
    iconSvg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.84 5.33c.76-.91 1.27-2.18 1.13-3.44-.11 0-1.07.54-1.76 1.19-.85.78-1.54 1.99-1.39 3.22.02.02 1.23.03 2.02-.97z" fill="#007AFF"/></svg>`,
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
    iconSvg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.5 16.5h-2.8L12 12.8 9.3 16.5H6.5l4.2-5.2L6.5 7.5h2.8L12 11.2l2.7-3.7H17.5l-4.2 3.8 4.2 5.2z" fill="#FF6900"/></svg>`,
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
    iconSvg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm6 16.5h-2.4L14 14.1 12.4 16.5H10L8.4 14.1 6.8 16.5H4.4l2.8-4.5L4.4 7.5h2.4L8.4 9.9 10 7.5h2.4L14 9.9l1.6-2.4H18l-2.8 4.5L18 16.5z" fill="#FFCC00"/></svg>`,
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
    iconSvg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm2.5 18h-5v-2h5v2zm0-4h-5v-2h5v2zm0-4h-5V8h5v2zm0-4h-5V4h5v2z" fill="#003D8F"/></svg>`,
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
    iconSvg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm6 8.5v7c0 .828-.672 1.5-1.5 1.5h-9C6.672 17 6 16.328 6 15.5v-7c0-.828.672-1.5 1.5-1.5h9c.828 0 1.5.672 1.5 1.5zM16.5 9h-9l4.5 3.5L16.5 9z" fill="#5CB85C"/></svg>`,
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
    iconSvg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm4.5 16.5h-9c-.828 0-1.5-.672-1.5-1.5V9c0-.828.672-1.5 1.5-1.5h9c.828 0 1.5.672 1.5 1.5v6c0 .828-.672 1.5-1.5 1.5zM15 10.5l-3 2.5-3-2.5v-1l3 2.5 3-2.5v1z" fill="#8CC63F"/></svg>`,
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
    iconSvg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm4.32 16.5h-1.8l-.48-1.5h-2.88l-.48 1.5H8.88L12 7.5l3.32 9zM12 10.5l-.96 3h1.92l-.96-3z" fill="#FF0B00"/></svg>`,
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
    iconSvg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm6 16.5h-2.25v-9H18v9zm-3.75-10.5h-2.25v10.5h2.25V6zm-3.75 3h-2.25v7.5h2.25V9zm-3.75 3h-2.25v4.5h2.25V12z" fill="#0078D4"/></svg>`,
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
    iconSvg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.5 16.5h-2.25L12 12.75 8.75 16.5H6.5l4.25-4.5L6.5 7.5h2.25L12 11.25 15.25 7.5H17.5l-4.25 4.5 4.25 4.5z" fill="#C83C2B"/></svg>`,
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
    iconSvg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm6 15c0 1.657-1.343 3-3 3H9c-1.657 0-3-1.343-3-3V9c0-1.657 1.343-3 3-3h6c1.657 0 3 1.343 3 3v6zm-2-6H8v2h8V9z" fill="#6D4AFF"/></svg>`,
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
    iconSvg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm6 15.5c0 .828-.672 1.5-1.5 1.5h-9c-.828 0-1.5-.672-1.5-1.5v-7c0-.828.672-1.5 1.5-1.5h9c.828 0 1.5.672 1.5 1.5v7zm-1.5-6h-9l4.5 3.5L16.5 9.5z" fill="#2E5CFF"/></svg>`,
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
    id: 'custom',
    name: 'Custom',
    displayName: 'Custom/Other Provider',
    iconSvg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm6 16.5h-2.25v-9H18v9zm-3.75-10.5h-2.25v10.5h2.25V6zm-3.75 3h-2.25v7.5h2.25V9zm-3.75 3h-2.25v4.5h2.25V12z" fill="#6B7280"/></svg>`,
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