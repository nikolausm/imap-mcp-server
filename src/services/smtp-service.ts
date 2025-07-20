import nodemailer from 'nodemailer';
import { ImapAccount, EmailComposer, SmtpConfig } from '../types/index.js';

export class SmtpService {
  private transporters: Map<string, nodemailer.Transporter> = new Map();

  async createTransporter(account: ImapAccount): Promise<nodemailer.Transporter> {
    if (this.transporters.has(account.id)) {
      return this.transporters.get(account.id)!;
    }

    const smtpConfig = account.smtp || this.getDefaultSmtpConfig(account);
    
    const transporterOptions = {
      host: smtpConfig.host,
      port: smtpConfig.port,
      secure: smtpConfig.secure,
      auth: {
        user: smtpConfig.user || account.user,
        pass: smtpConfig.password || account.password,
      },
      tls: smtpConfig.tls,
    };

    const transporter = nodemailer.createTransport(transporterOptions);
    
    // Verify connection
    await transporter.verify();
    
    this.transporters.set(account.id, transporter);
    return transporter;
  }

  private getDefaultSmtpConfig(account: ImapAccount): SmtpConfig {
    // Common SMTP configurations based on IMAP settings
    const commonProviders: { [key: string]: SmtpConfig } = {
      'imap.gmail.com': {
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
      },
      'outlook.office365.com': {
        host: 'smtp.office365.com',
        port: 587,
        secure: false,
      },
      'imap-mail.outlook.com': {
        host: 'smtp-mail.outlook.com',
        port: 587,
        secure: false,
      },
      'imap.mail.yahoo.com': {
        host: 'smtp.mail.yahoo.com',
        port: 587,
        secure: false,
      },
      'imap.aol.com': {
        host: 'smtp.aol.com',
        port: 587,
        secure: false,
      },
      'imap.fastmail.com': {
        host: 'smtp.fastmail.com',
        port: 587,
        secure: false,
      },
    };

    const providerConfig = commonProviders[account.host];
    if (providerConfig) {
      return providerConfig;
    }

    // Default: assume SMTP server is on same host with standard ports
    return {
      host: account.host.replace('imap.', 'smtp.').replace('imap-', 'smtp-'),
      port: account.tls ? 465 : 587,
      secure: account.port === 993,
    };
  }

  async sendEmail(accountId: string, account: ImapAccount, email: EmailComposer): Promise<string> {
    try {
      const transporter = await this.createTransporter(account);
      
      const mailOptions: nodemailer.SendMailOptions = {
        from: email.from || account.user,
        to: email.to,
        cc: email.cc,
        bcc: email.bcc,
        subject: email.subject,
        text: email.text,
        html: email.html,
        attachments: email.attachments?.map(att => ({
          filename: att.filename,
          content: att.content,
          path: att.path,
          contentType: att.contentType,
          contentDisposition: att.contentDisposition,
          cid: att.cid,
        })),
        replyTo: email.replyTo,
        inReplyTo: email.inReplyTo,
        references: Array.isArray(email.references) ? email.references.join(' ') : email.references,
      };

      const info = await transporter.sendMail(mailOptions);
      return info.messageId;
    } catch (error) {
      throw new Error(`Failed to send email: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async verifySmtpConnection(account: ImapAccount): Promise<boolean> {
    try {
      const transporter = await this.createTransporter(account);
      await transporter.verify();
      return true;
    } catch (error) {
      return false;
    }
  }

  disconnect(accountId: string): void {
    const transporter = this.transporters.get(accountId);
    if (transporter) {
      transporter.close();
      this.transporters.delete(accountId);
    }
  }

  disconnectAll(): void {
    for (const [accountId, transporter] of this.transporters) {
      transporter.close();
    }
    this.transporters.clear();
  }
}