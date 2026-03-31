// ═══ CookieJar — Encrypted cookie persistence for institutional access ═══
// Stores session cookies from BrowserWindow-based institutional login.
// Cookies are AES-256-GCM encrypted at rest, keyed to the local machine.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

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

// ─── CookieJar ───

export class CookieJar {
  private store: CookieStore;
  private readonly filePath: string;
  private readonly encryptionKey: Buffer;

  constructor(appDataDir: string) {
    this.filePath = path.join(appDataDir, 'institutional-cookies.enc');
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

    for (const c of relevant) {
      const stored: StoredCookie = {
        name: c.name,
        value: c.value,
        domain: c.domain ?? '',
        path: c.path ?? '/',
        expirationDate: c.expirationDate,
        httpOnly: c.httpOnly ?? false,
        secure: c.secure ?? false,
      };
      existingMap.set(`${stored.domain}|${stored.name}|${stored.path}`, stored);
    }

    this.store.cookies = [...existingMap.values()];
    this.store.institutionId = institutionId;
    this.store.updatedAt = new Date().toISOString();
    this.save();

    return relevant.length;
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
      // Skip expired cookies
      if (c.expirationDate && c.expirationDate < now) return false;
      // Domain matching: cookie domain ".foo.com" matches "bar.foo.com"
      const cookieDomain = c.domain.startsWith('.') ? c.domain.slice(1) : c.domain;
      return hostname === cookieDomain || hostname.endsWith(`.${cookieDomain}`);
    });

    if (matching.length === 0) return null;
    return matching.map((c) => `${c.name}=${c.value}`).join('; ');
  }

  /**
   * Check if there are valid (non-expired) cookies for any of the specified domains.
   */
  hasCookiesFor(domains: string[]): boolean {
    if (domains.length === 0) return false;
    const now = Date.now() / 1000;
    return domains.some((d) =>
      this.store.cookies.some((c) => {
        if (c.expirationDate && c.expirationDate < now) return false;
        // Proper domain matching: strip leading dot then check exact or subdomain
        const cookieDomain = c.domain.startsWith('.') ? c.domain.slice(1) : c.domain;
        return cookieDomain === d || cookieDomain.endsWith(`.${d}`);
      }),
    );
  }

  /** Get domains that currently have valid cookies. */
  getActiveDomains(): string[] {
    const now = Date.now() / 1000;
    const domains = new Set<string>();
    for (const c of this.store.cookies) {
      if (!c.expirationDate || c.expirationDate > now) {
        // Normalize: strip leading dot
        const d = c.domain.startsWith('.') ? c.domain.slice(1) : c.domain;
        domains.add(d);
      }
    }
    return [...domains];
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
    } catch {
      // Best-effort delete
    }
  }

  // ─── Encrypted persistence ───

  private save(): void {
    try {
      const json = JSON.stringify(this.store);
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
      fs.writeFileSync(this.filePath, Buffer.concat([iv, tag, encrypted]));
    } catch {
      // Non-fatal: cookies won't persist but app still works
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
      return JSON.parse(json) as CookieStore;
    } catch {
      return empty;
    }
  }
}
