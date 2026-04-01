// ═══ CookieJar — Encrypted cookie persistence for institutional access ═══
// Stores session cookies from BrowserWindow-based institutional login.
// Cookies are AES-256-GCM encrypted at rest, keyed to the local machine.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { parseSetCookieHeaders } from './cookie-utils';

// ─── Types ───

export interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expirationDate?: number | undefined;
  httpOnly: boolean;
  secure: boolean;
}

export interface CookieStore {
  cookies: StoredCookie[];
  updatedAt: string;
  /** Institution identifier (e.g., "zju") */
  institutionId: string | null;
}

export interface InstitutionalSessionStatus {
  loggedIn: boolean;
  institutionId: string | null;
  institutionName: string | null;
  lastLogin: string | null;
  /** Domains that have active (non-expired) cookies */
  activeDomains: string[];
}

export type CookieJarLogger = (level: 'info' | 'warn' | 'error', msg: string, meta?: Record<string, unknown>) => void;

/** Session cookies without an explicit expiry are given a 24-hour TTL. */
const DEFAULT_SESSION_TTL_S = 86_400;

// ─── CookieJar ───

export class CookieJar {
  private store: CookieStore;
  private readonly filePath: string;
  private readonly encryptionKey: Buffer;
  private readonly log: CookieJarLogger | null;

  constructor(appDataDir: string, logger?: CookieJarLogger | null) {
    this.filePath = path.join(appDataDir, 'institutional-cookies.enc');
    this.log = logger ?? null;
    // Derive key from machine-specific info (prevents cookie file portability)
    this.encryptionKey = crypto.scryptSync(
      `${os.hostname()}:${os.userInfo().username}:abyssal`,
      'abyssal-cookie-jar-salt-v1',
      32,
    );
    this.store = this.load();
  }

  /**
   * Import cookies from an Electron session.
   * Filters to only keep cookies for the specified domains.
   */
  async importFromElectronSession(
    sessionCookies: Array<{
      name: string;
      value: string;
      domain?: string;
      path?: string;
      expirationDate?: number;
      httpOnly?: boolean;
      secure?: boolean;
    }>,
    filterDomains: string[],
    institutionId: string,
  ): Promise<number> {
    const relevant = sessionCookies.filter((c) =>
      filterDomains.some((d) => (c.domain ?? '').includes(d)),
    );

    // Merge with existing cookies (replace by domain+name+path, keep others)
    const existingMap = new Map<string, StoredCookie>();
    for (const c of this.store.cookies) {
      existingMap.set(`${c.domain}|${c.name}|${c.path}`, c);
    }

    const now = Date.now() / 1000;
    for (const c of relevant) {
      const stored: StoredCookie = {
        name: c.name,
        value: c.value,
        domain: c.domain ?? '',
        path: c.path ?? '/',
        // Session cookies (no expiry) get a default TTL to prevent immortal stale cookies
        expirationDate: c.expirationDate ?? (now + DEFAULT_SESSION_TTL_S),
        httpOnly: c.httpOnly ?? false,
        secure: c.secure ?? false,
      };
      existingMap.set(`${stored.domain}|${stored.name}|${stored.path}`, stored);
    }

    const nextStore: CookieStore = {
      cookies: [...existingMap.values()],
      institutionId,
      updatedAt: new Date().toISOString(),
    };

    // Save first — only update in-memory store on success
    if (!this.save(nextStore)) {
      this.log?.('warn', 'Cookie import succeeded in-memory but failed to persist to disk');
    }
    this.store = nextStore;
    this.log?.('info', `Imported ${relevant.length} cookies for ${institutionId}`);

    return relevant.length;
  }

  /**
   * Merge Set-Cookie response headers into the jar.
   * Call this after HTTP requests that return fresh session cookies (e.g., FSSO bridge, warmup).
   */
  mergeFromHeaders(
    url: string,
    headers: Record<string, string | string[] | undefined>,
  ): void {
    const pairs = parseSetCookieHeaders(headers);
    if (pairs.length === 0) return;

    let hostname: string;
    try {
      hostname = new URL(url).hostname;
    } catch {
      return;
    }

    const now = Date.now() / 1000;
    const map = new Map<string, StoredCookie>();
    for (const c of this.store.cookies) {
      map.set(`${c.domain}|${c.name}|${c.path}`, c);
    }

    for (const pair of pairs) {
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      const stored: StoredCookie = {
        name,
        value,
        domain: hostname,
        path: '/',
        expirationDate: now + DEFAULT_SESSION_TTL_S,
        httpOnly: false,
        secure: false,
      };
      map.set(`${stored.domain}|${stored.name}|${stored.path}`, stored);
    }

    this.store.cookies = [...map.values()];
    this.store.updatedAt = new Date().toISOString();
    this.save(this.store);
  }

  /**
   * Build a Cookie header string for the given URL.
   * Returns null if no matching cookies found.
   */
  getCookieHeader(url: string): string | null {
    let hostname: string;
    try {
      hostname = new URL(url).hostname;
    } catch {
      return null;
    }

    const now = Date.now() / 1000;
    const matching = this.store.cookies.filter((c) => {
      if (c.expirationDate && c.expirationDate < now) return false;
      return domainMatches(hostname, c.domain);
    });

    if (matching.length === 0) return null;
    return matching.map((c) => `${c.name}=${c.value}`).join('; ');
  }

  /**
   * Check if there are valid (non-expired) cookies for any of the specified domains.
   * Accepts both exact domains ("cnki.net") and sub-domains ("kns.cnki.net").
   */
  hasCookiesFor(domains: string[]): boolean {
    if (domains.length === 0) return false;
    const now = Date.now() / 1000;
    return domains.some((d) =>
      this.store.cookies.some((c) => {
        if (c.expirationDate && c.expirationDate < now) return false;
        // The query domain `d` should match cookie domain the same way as
        // getCookieHeader: d is the "hostname", c.domain is the cookie domain.
        return domainMatches(d, c.domain);
      }),
    );
  }

  /** Get domains that currently have valid cookies. */
  getActiveDomains(): string[] {
    const now = Date.now() / 1000;
    const domains = new Set<string>();
    for (const c of this.store.cookies) {
      if (!c.expirationDate || c.expirationDate > now) {
        const d = c.domain.startsWith('.') ? c.domain.slice(1) : c.domain;
        domains.add(d);
      }
    }
    return [...domains];
  }

  /** Collect and merge cookies from multiple URLs (cross-domain CARSI scenarios). */
  collectCookies(urls: string[]): string | null {
    return collectCookiesFromJar(this, urls);
  }

  /** Get current session status (for UI display). */
  getSessionStatus(institutionNameResolver?: (id: string) => string | null): InstitutionalSessionStatus {
    const activeDomains = this.getActiveDomains();
    return {
      loggedIn: activeDomains.length > 0,
      institutionId: this.store.institutionId,
      institutionName: this.store.institutionId
        ? (institutionNameResolver?.(this.store.institutionId) ?? this.store.institutionId)
        : null,
      lastLogin: this.store.updatedAt || null,
      activeDomains,
    };
  }

  getInstitutionId(): string | null {
    return this.store.institutionId;
  }

  /** Clear all stored cookies. */
  clear(): void {
    this.store = { cookies: [], updatedAt: '', institutionId: null };
    try {
      if (fs.existsSync(this.filePath)) fs.unlinkSync(this.filePath);
    } catch (err) {
      this.log?.('warn', 'Failed to delete cookie file', { error: (err as Error).message });
    }
    this.log?.('info', 'Cookie jar cleared');
  }

  // ─── Encrypted persistence ───

  /** Returns true on success, false on failure. */
  private save(store: CookieStore): boolean {
    try {
      const json = JSON.stringify(store);
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
      const encrypted = Buffer.concat([
        cipher.update(json, 'utf8'),
        cipher.final(),
      ]);
      const tag = cipher.getAuthTag();
      // Format: iv(16) + authTag(16) + ciphertext
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      // Atomic write: write to temp file first, then rename
      const tmpPath = this.filePath + '.tmp';
      fs.writeFileSync(tmpPath, Buffer.concat([iv, tag, encrypted]));
      fs.renameSync(tmpPath, this.filePath);
      return true;
    } catch (err) {
      this.log?.('error', 'Failed to persist cookies', { error: (err as Error).message });
      // Clean up temp file if it was written
      try { fs.unlinkSync(this.filePath + '.tmp'); } catch { /* ignore */ }
      return false;
    }
  }

  private load(): CookieStore {
    const empty: CookieStore = { cookies: [], updatedAt: '', institutionId: null };
    try {
      if (!fs.existsSync(this.filePath)) return empty;
      const buf = fs.readFileSync(this.filePath);
      if (buf.length < 33) return empty; // Too short to be valid
      const iv = buf.subarray(0, 16);
      const tag = buf.subarray(16, 32);
      const data = buf.subarray(32);
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
      decipher.setAuthTag(tag);
      const json = Buffer.concat([
        decipher.update(data),
        decipher.final(),
      ]).toString('utf8');
      const loaded = JSON.parse(json) as CookieStore;
      this.log?.('info', `Loaded ${loaded.cookies.length} cookies from disk`);
      return loaded;
    } catch (err) {
      this.log?.('warn', 'Failed to load cookie file, starting fresh', { error: (err as Error).message });
      return empty;
    }
  }
}

// ─── Domain matching (RFC 6265) ───

/**
 * Check if `hostname` matches `cookieDomain`.
 * Cookie domain ".foo.com" (or "foo.com") matches "bar.foo.com" and "foo.com".
 */
function domainMatches(hostname: string, cookieDomain: string): boolean {
  const normalized = cookieDomain.startsWith('.') ? cookieDomain.slice(1) : cookieDomain;
  return hostname === normalized || hostname.endsWith(`.${normalized}`);
}

// ─── Cookie collection helper ───

/**
 * Collect cookies from the CookieJar across multiple domains and merge them.
 * Needed because CARSI login stores cookies under SSO domains (e.g. fsso.cnki.net)
 * which don't match the search host (kns.cnki.net).
 */
export function collectCookiesFromJar(cookieJar: CookieJar, urls: string[]): string | null {
  const parts = new Map<string, string>();
  for (const url of urls) {
    const header = cookieJar.getCookieHeader(url);
    if (header) {
      for (const pair of header.split(';')) {
        const trimmed = pair.trim();
        const eq = trimmed.indexOf('=');
        if (eq > 0) parts.set(trimmed.slice(0, eq), trimmed);
      }
    }
  }
  return parts.size > 0 ? [...parts.values()].join('; ') : null;
}
