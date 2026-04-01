// ═══ Cookie utility functions ═══
// Shared parsing/merging helpers used by CookieJar and acquire sources.

/**
 * Extract cookie name=value pairs from Set-Cookie response headers.
 * Does NOT handle domain/path — only extracts the name=value part.
 */
export function parseSetCookieHeaders(
  headers: Record<string, string | string[] | undefined>,
): string[] {
  const raw = headers['set-cookie'];
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  const pairs: string[] = [];
  for (const line of arr) {
    // "name=value; Path=/; HttpOnly" → "name=value"
    const semi = line.indexOf(';');
    const pair = semi > 0 ? line.slice(0, semi).trim() : line.trim();
    if (pair.includes('=')) pairs.push(pair);
  }
  return pairs;
}

/**
 * Merge a base cookie header string with additional session cookie pairs.
 * Later entries override earlier ones with the same cookie name.
 * Returns a combined "name=value; name2=value2" string.
 */
export function mergeCookieStrings(
  baseCookie: string | null,
  sessionCookies: string[],
): string {
  const map = new Map<string, string>();
  if (baseCookie) {
    for (const pair of baseCookie.split(';')) {
      const trimmed = pair.trim();
      const eq = trimmed.indexOf('=');
      if (eq > 0) map.set(trimmed.slice(0, eq), trimmed);
    }
  }
  // Session cookies override base cookies with same name
  for (const pair of sessionCookies) {
    const eq = pair.indexOf('=');
    if (eq > 0) map.set(pair.slice(0, eq), pair);
  }
  return [...map.values()].join('; ');
}
