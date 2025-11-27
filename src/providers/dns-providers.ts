export interface DNSProvider {
  id: string;
  name: string;
  displayName: string;
  description: string;
  primaryDNS: string;
  secondaryDNS: string;
  ipv6Primary?: string;
  ipv6Secondary?: string;
  features: {
    malwareBlocking: boolean;
    adBlocking: boolean;
    adultContentFiltering: boolean;
    dnssec: boolean;
    noLogging: boolean;
    encrypted: boolean; // DoH/DoT support
  };
  website: string;
  testUrl?: string;
  setupInstructions?: string;
  color: string;
}

export const dnsProviders: DNSProvider[] = [
  {
    id: 'quad9',
    name: 'Quad9',
    displayName: 'Quad9 (Recommended)',
    description: 'Free DNS with malware and phishing protection. No logging.',
    primaryDNS: '9.9.9.9',
    secondaryDNS: '149.112.112.112',
    ipv6Primary: '2620:fe::fe',
    ipv6Secondary: '2620:fe::9',
    features: {
      malwareBlocking: true,
      adBlocking: false,
      adultContentFiltering: false,
      dnssec: true,
      noLogging: true,
      encrypted: true,
    },
    website: 'https://www.quad9.net/',
    testUrl: 'https://on.quad9.net/',
    setupInstructions: 'Set DNS to 9.9.9.9 and 149.112.112.112 in your network settings',
    color: '#00A4E4',
  },
  {
    id: 'quad9-secured',
    name: 'Quad9 Secured',
    displayName: 'Quad9 Secured (9.9.9.11)',
    description: 'Quad9 with ECS (EDNS Client Subnet) disabled for extra privacy',
    primaryDNS: '9.9.9.11',
    secondaryDNS: '149.112.112.11',
    ipv6Primary: '2620:fe::11',
    ipv6Secondary: '2620:fe::fe:11',
    features: {
      malwareBlocking: true,
      adBlocking: false,
      adultContentFiltering: false,
      dnssec: true,
      noLogging: true,
      encrypted: true,
    },
    website: 'https://www.quad9.net/',
    testUrl: 'https://on.quad9.net/',
    setupInstructions: 'Set DNS to 9.9.9.11 and 149.112.112.11 for enhanced privacy',
    color: '#00A4E4',
  },
  {
    id: 'quad9-unsecured',
    name: 'Quad9 Unsecured',
    displayName: 'Quad9 Unsecured (9.9.9.10)',
    description: 'Quad9 without malware blocking (for testing/troubleshooting)',
    primaryDNS: '9.9.9.10',
    secondaryDNS: '149.112.112.10',
    ipv6Primary: '2620:fe::10',
    ipv6Secondary: '2620:fe::fe:10',
    features: {
      malwareBlocking: false,
      adBlocking: false,
      adultContentFiltering: false,
      dnssec: true,
      noLogging: true,
      encrypted: true,
    },
    website: 'https://www.quad9.net/',
    setupInstructions: 'Set DNS to 9.9.9.10 and 149.112.112.10 (no filtering)',
    color: '#00A4E4',
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    displayName: 'Cloudflare DNS (1.1.1.1)',
    description: 'Fast, privacy-focused DNS. No malware blocking by default.',
    primaryDNS: '1.1.1.1',
    secondaryDNS: '1.0.0.1',
    ipv6Primary: '2606:4700:4700::1111',
    ipv6Secondary: '2606:4700:4700::1001',
    features: {
      malwareBlocking: false,
      adBlocking: false,
      adultContentFiltering: false,
      dnssec: true,
      noLogging: true,
      encrypted: true,
    },
    website: 'https://1.1.1.1/',
    setupInstructions: 'Set DNS to 1.1.1.1 and 1.0.0.1',
    color: '#F38020',
  },
  {
    id: 'cloudflare-malware',
    name: 'Cloudflare Malware',
    displayName: 'Cloudflare for Families (Malware)',
    description: 'Cloudflare DNS with malware blocking',
    primaryDNS: '1.1.1.2',
    secondaryDNS: '1.0.0.2',
    ipv6Primary: '2606:4700:4700::1112',
    ipv6Secondary: '2606:4700:4700::1002',
    features: {
      malwareBlocking: true,
      adBlocking: false,
      adultContentFiltering: false,
      dnssec: true,
      noLogging: true,
      encrypted: true,
    },
    website: 'https://1.1.1.1/family/',
    setupInstructions: 'Set DNS to 1.1.1.2 and 1.0.0.2 for malware blocking',
    color: '#F38020',
  },
  {
    id: 'cloudflare-family',
    name: 'Cloudflare Family',
    displayName: 'Cloudflare for Families (Adult Content)',
    description: 'Cloudflare DNS with malware and adult content blocking',
    primaryDNS: '1.1.1.3',
    secondaryDNS: '1.0.0.3',
    ipv6Primary: '2606:4700:4700::1113',
    ipv6Secondary: '2606:4700:4700::1003',
    features: {
      malwareBlocking: true,
      adBlocking: false,
      adultContentFiltering: true,
      dnssec: true,
      noLogging: true,
      encrypted: true,
    },
    website: 'https://1.1.1.1/family/',
    setupInstructions: 'Set DNS to 1.1.1.3 and 1.0.0.3 for family protection',
    color: '#F38020',
  },
  {
    id: 'google',
    name: 'Google',
    displayName: 'Google Public DNS (8.8.8.8)',
    description: 'Fast, reliable DNS from Google. No filtering.',
    primaryDNS: '8.8.8.8',
    secondaryDNS: '8.8.4.4',
    ipv6Primary: '2001:4860:4860::8888',
    ipv6Secondary: '2001:4860:4860::8844',
    features: {
      malwareBlocking: false,
      adBlocking: false,
      adultContentFiltering: false,
      dnssec: true,
      noLogging: false, // Google logs queries
      encrypted: true,
    },
    website: 'https://developers.google.com/speed/public-dns',
    setupInstructions: 'Set DNS to 8.8.8.8 and 8.8.4.4',
    color: '#4285F4',
  },
  {
    id: 'opendns',
    name: 'OpenDNS',
    displayName: 'OpenDNS Home',
    description: 'DNS with optional content filtering and phishing protection',
    primaryDNS: '208.67.222.222',
    secondaryDNS: '208.67.220.220',
    ipv6Primary: '2620:119:35::35',
    ipv6Secondary: '2620:119:53::53',
    features: {
      malwareBlocking: true,
      adBlocking: false,
      adultContentFiltering: false, // Requires account
      dnssec: true,
      noLogging: false,
      encrypted: true,
    },
    website: 'https://www.opendns.com/home-internet-security/',
    setupInstructions: 'Set DNS to 208.67.222.222 and 208.67.220.220',
    color: '#FF7F00',
  },
  {
    id: 'opendns-family',
    name: 'OpenDNS FamilyShield',
    displayName: 'OpenDNS FamilyShield',
    description: 'OpenDNS with adult content blocking pre-configured',
    primaryDNS: '208.67.222.123',
    secondaryDNS: '208.67.220.123',
    features: {
      malwareBlocking: true,
      adBlocking: false,
      adultContentFiltering: true,
      dnssec: true,
      noLogging: false,
      encrypted: true,
    },
    website: 'https://www.opendns.com/setupguide/#familyshield',
    setupInstructions: 'Set DNS to 208.67.222.123 and 208.67.220.123',
    color: '#FF7F00',
  },
  {
    id: 'adguard',
    name: 'AdGuard',
    displayName: 'AdGuard DNS',
    description: 'DNS with ad and tracker blocking',
    primaryDNS: '94.140.14.14',
    secondaryDNS: '94.140.15.15',
    ipv6Primary: '2a10:50c0::ad1:ff',
    ipv6Secondary: '2a10:50c0::ad2:ff',
    features: {
      malwareBlocking: true,
      adBlocking: true,
      adultContentFiltering: false,
      dnssec: true,
      noLogging: true,
      encrypted: true,
    },
    website: 'https://adguard-dns.io/',
    setupInstructions: 'Set DNS to 94.140.14.14 and 94.140.15.15',
    color: '#67BCAC',
  },
  {
    id: 'adguard-family',
    name: 'AdGuard Family',
    displayName: 'AdGuard DNS Family Protection',
    description: 'AdGuard DNS with adult content blocking',
    primaryDNS: '94.140.14.15',
    secondaryDNS: '94.140.15.16',
    ipv6Primary: '2a10:50c0::bad1:ff',
    ipv6Secondary: '2a10:50c0::bad2:ff',
    features: {
      malwareBlocking: true,
      adBlocking: true,
      adultContentFiltering: true,
      dnssec: true,
      noLogging: true,
      encrypted: true,
    },
    website: 'https://adguard-dns.io/en/public-dns.html',
    setupInstructions: 'Set DNS to 94.140.14.15 and 94.140.15.16',
    color: '#67BCAC',
  },
  {
    id: 'custom',
    name: 'Custom',
    displayName: 'Custom DNS Server',
    description: 'Enter custom DNS server addresses',
    primaryDNS: '',
    secondaryDNS: '',
    features: {
      malwareBlocking: false,
      adBlocking: false,
      adultContentFiltering: false,
      dnssec: false,
      noLogging: false,
      encrypted: false,
    },
    website: '',
    setupInstructions: 'Enter your custom DNS server addresses',
    color: '#6B7280',
  },
];

export function getDNSProviderById(id: string): DNSProvider | undefined {
  return dnsProviders.find(p => p.id === id);
}

export function getRecommendedDNSProvider(): DNSProvider {
  return dnsProviders[0]; // Quad9
}
