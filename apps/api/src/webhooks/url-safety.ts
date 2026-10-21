import { lookup } from 'dns/promises';
import { isIP } from 'net';

/** DEF-002: webhook targets must not reach internal networks (SSRF). */

function ipv4ToInt(ip: string) {
  return ip.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

const V4_BLOCKED: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    const n = ipv4ToInt(ip);
    return V4_BLOCKED.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (ipv4ToInt(base) & mask);
    });
  }
  if (family === 6) {
    const v = ip.toLowerCase();
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return (
      v === '::' ||
      v === '::1' ||
      v.startsWith('fc') ||
      v.startsWith('fd') ||
      v.startsWith('fe8') ||
      v.startsWith('fe9') ||
      v.startsWith('fea') ||
      v.startsWith('feb') ||
      v.startsWith('ff')
    );
  }
  return true; // not an IP at all: treat as unsafe
}

/** Hosts explicitly trusted by the operator, e.g. the local mock receiver in dev and CI. */
export function allowedHosts(): string[] {
  return (process.env.WEBHOOK_ALLOWED_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

export async function checkWebhookUrl(raw: string, resolve = lookup): Promise<UrlCheck> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'url is not a valid absolute URL' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, reason: 'url must use http or https' };
  }
  if (url.username || url.password) return { ok: false, reason: 'url must not contain credentials' };

  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (allowedHosts().includes(host)) return { ok: true, url };

  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = (await resolve(host, { all: true })).map((a: { address: string }) => a.address);
    } catch {
      return { ok: false, reason: 'url host does not resolve' };
    }
  }
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    return { ok: false, reason: 'url must not point to a private, loopback or link-local address' };
  }
  return { ok: true, url };
}
