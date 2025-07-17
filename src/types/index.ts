export interface ImapAccount {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  password: string;
  tls: boolean;
  authTimeout?: number;
  connTimeout?: number;
  keepalive?: boolean;
}

export interface EmailMessage {
  uid: number;
  date: Date;
  from: string;
  to: string[];
  subject: string;
  messageId: string;
  inReplyTo?: string;
  flags: string[];
}

export interface EmailContent extends EmailMessage {
  textContent?: string;
  htmlContent?: string;
  attachments: Attachment[];
}

export interface Attachment {
  filename: string;
  contentType: string;
  size: number;
  contentId?: string;
}

export interface Folder {
  name: string;
  delimiter: string;
  attributes: string[];
  children?: Folder[];
}

export interface SearchCriteria {
  from?: string;
  to?: string;
  subject?: string;
  body?: string;
  since?: Date;
  before?: Date;
  seen?: boolean;
  flagged?: boolean;
  answered?: boolean;
  draft?: boolean;
}

export interface ConnectionPool {
  [accountId: string]: any; // IMAP connection instance
}