// ═══ Publisher Resolver ═══
// DOI prefix → publisher PDF URL pattern mapping
// + Domain-based reverse lookup (for Recon-driven publisher identification)
// Used by china-institutional source and Strategy layer

// ─── Types ───

export interface PublisherPattern {
  name: string;
  /** DOI registrant prefixes (e.g., "10.1109" for IEEE) */
  doiPrefixes: string[];
  /** Construct a candidate PDF URL from a DOI */
  resolvePdfUrl: (doi: string) => string;
  /** Cookie domains needed for authenticated access */
  cookieDomains: string[];
  /** Hostnames that identify this publisher (for DOI HEAD redirect matching) */
  hostPatterns: string[];
}

// ─── IEEE arnumber extraction ───

/**
 * Extract IEEE arnumber from a DOI.
 * IEEE DOIs: 10.1109/XXXXX.YYYY.NNNNNNN — the trailing numeric segment is the arnumber.
 * Falls back to the full suffix after "10.1109/" if no trailing number found.
 */
function extractIeeeArnumber(doi: string): string | null {
  // Try: trailing all-digit segment
  const match = doi.match(/\.(\d{5,})$/);
  if (match) return match[1]!;
  // Fallback: everything after the prefix "10.1109/"
  const idx = doi.indexOf('10.1109/');
  if (idx >= 0) return doi.slice(idx + 8);
  return null;
}

// ─── Publisher Pattern Registry ───

const PUBLISHER_PATTERNS: PublisherPattern[] = [
  {
    name: 'IEEE',
    doiPrefixes: ['10.1109'],
    resolvePdfUrl: (doi) => {
      const arnumber = extractIeeeArnumber(doi);
      if (arnumber && /^\d+$/.test(arnumber)) {
        return `https://ieeexplore.ieee.org/stampPdf/getPdf.jsp?tp=&arnumber=${arnumber}`;
      }
      return `https://doi.org/${doi}`;
    },
    cookieDomains: ['ieeexplore.ieee.org', 'ieee.org'],
    hostPatterns: ['ieeexplore.ieee.org'],
  },
  {
    name: 'Elsevier / ScienceDirect',
    doiPrefixes: ['10.1016'],
    resolvePdfUrl: (doi) =>
      `https://www.sciencedirect.com/science/article/pdf/${encodeURIComponent(doi)}`,
    cookieDomains: ['sciencedirect.com', 'elsevier.com'],
    hostPatterns: ['sciencedirect.com', 'linkinghub.elsevier.com', 'cell.com', 'thelancet.com'],
  },
  {
    name: 'Springer',
    doiPrefixes: ['10.1007'],
    resolvePdfUrl: (doi) =>
      `https://link.springer.com/content/pdf/${encodeURIComponent(doi)}.pdf`,
    cookieDomains: ['link.springer.com', 'springer.com', 'springernature.com'],
    hostPatterns: ['link.springer.com', 'rd.springer.com'],
  },
  {
    name: 'Nature',
    doiPrefixes: ['10.1038'],
    resolvePdfUrl: (doi) =>
      `https://www.nature.com/articles/${doi.replace('10.1038/', '')}.pdf`,
    cookieDomains: ['nature.com', 'springer.com'],
    hostPatterns: ['nature.com'],
  },
  {
    name: 'Wiley',
    doiPrefixes: ['10.1002', '10.1111'],
    resolvePdfUrl: (doi) =>
      `https://onlinelibrary.wiley.com/doi/pdfdirect/${encodeURIComponent(doi)}`,
    cookieDomains: ['onlinelibrary.wiley.com', 'wiley.com'],
    hostPatterns: ['onlinelibrary.wiley.com'],
  },
  {
    name: 'Taylor & Francis',
    doiPrefixes: ['10.1080', '10.1081'],
    resolvePdfUrl: (doi) =>
      `https://www.tandfonline.com/doi/pdf/${encodeURIComponent(doi)}`,
    cookieDomains: ['tandfonline.com'],
    hostPatterns: ['tandfonline.com'],
  },
  {
    name: 'ACS',
    doiPrefixes: ['10.1021'],
    resolvePdfUrl: (doi) =>
      `https://pubs.acs.org/doi/pdf/${encodeURIComponent(doi)}`,
    cookieDomains: ['pubs.acs.org'],
    hostPatterns: ['pubs.acs.org'],
  },
  {
    name: 'RSC',
    doiPrefixes: ['10.1039'],
    resolvePdfUrl: (doi) => {
      return `https://pubs.rsc.org/en/content/articlepdf/${encodeURIComponent(doi.replace('10.1039/', ''))}`;
    },
    cookieDomains: ['pubs.rsc.org'],
    hostPatterns: ['pubs.rsc.org'],
  },
  {
    name: 'SAGE',
    doiPrefixes: ['10.1177'],
    resolvePdfUrl: (doi) =>
      `https://journals.sagepub.com/doi/pdf/${encodeURIComponent(doi)}`,
    cookieDomains: ['journals.sagepub.com'],
    hostPatterns: ['journals.sagepub.com'],
  },
  {
    name: 'Cambridge University Press',
    doiPrefixes: ['10.1017'],
    resolvePdfUrl: (doi) =>
      `https://www.cambridge.org/core/services/aop-cambridge-core/content/view/${encodeURIComponent(doi)}/pdf`,
    cookieDomains: ['cambridge.org'],
    hostPatterns: ['cambridge.org'],
  },
  {
    name: 'Oxford University Press',
    doiPrefixes: ['10.1093'],
    resolvePdfUrl: (doi) =>
      `https://academic.oup.com/doi/pdf/${encodeURIComponent(doi)}`,
    cookieDomains: ['academic.oup.com', 'oup.com'],
    hostPatterns: ['academic.oup.com'],
  },
  {
    name: 'MDPI',
    doiPrefixes: ['10.3390'],
    resolvePdfUrl: (doi) =>
      `https://www.mdpi.com/${doi.replace('10.3390/', '')}/pdf`,
    cookieDomains: ['mdpi.com'],
    hostPatterns: ['mdpi.com'],
  },
  // ── 新增出版商（通过 DOI HEAD 域名匹配发现） ──
  {
    name: 'ACM',
    doiPrefixes: ['10.1145'],
    resolvePdfUrl: (doi) =>
      `https://dl.acm.org/doi/pdf/${encodeURIComponent(doi)}`,
    cookieDomains: ['dl.acm.org'],
    hostPatterns: ['dl.acm.org'],
  },
  {
    name: 'APS (Physical Review)',
    doiPrefixes: ['10.1103'],
    resolvePdfUrl: (doi) =>
      `https://journals.aps.org/prl/pdf/${encodeURIComponent(doi)}`,
    cookieDomains: ['journals.aps.org'],
    hostPatterns: ['journals.aps.org'],
  },
  {
    name: 'AIP',
    doiPrefixes: ['10.1063'],
    resolvePdfUrl: (doi) =>
      `https://pubs.aip.org/aip/jcp/article-pdf/doi/${encodeURIComponent(doi)}`,
    cookieDomains: ['pubs.aip.org'],
    hostPatterns: ['pubs.aip.org'],
  },
  {
    name: 'IOP',
    doiPrefixes: ['10.1088'],
    resolvePdfUrl: (doi) =>
      `https://iopscience.iop.org/article/${encodeURIComponent(doi)}/pdf`,
    cookieDomains: ['iopscience.iop.org'],
    hostPatterns: ['iopscience.iop.org'],
  },
  {
    name: 'De Gruyter',
    doiPrefixes: ['10.1515'],
    resolvePdfUrl: (doi) =>
      `https://www.degruyter.com/document/doi/${encodeURIComponent(doi)}/pdf`,
    cookieDomains: ['degruyter.com'],
    hostPatterns: ['degruyter.com'],
  },
  {
    name: 'PNAS',
    doiPrefixes: ['10.1073'],
    resolvePdfUrl: (doi) =>
      `https://www.pnas.org/doi/pdf/${encodeURIComponent(doi)}`,
    cookieDomains: ['pnas.org'],
    hostPatterns: ['pnas.org'],
  },
  {
    name: 'Science (AAAS)',
    doiPrefixes: ['10.1126'],
    resolvePdfUrl: (doi) =>
      `https://www.science.org/doi/pdf/${encodeURIComponent(doi)}`,
    cookieDomains: ['science.org'],
    hostPatterns: ['science.org'],
  },

  // ── 新增出版商 ──

  {
    name: 'University of Chicago Press',
    doiPrefixes: ['10.1086'],
    resolvePdfUrl: (doi) =>
      `https://www.journals.uchicago.edu/doi/pdf/${encodeURIComponent(doi)}`,
    cookieDomains: ['journals.uchicago.edu', 'uchicago.edu'],
    hostPatterns: ['journals.uchicago.edu'],
  },
  {
    name: 'Wolters Kluwer / LWW',
    doiPrefixes: ['10.1097'],
    resolvePdfUrl: (doi) =>
      `https://journals.lww.com/doi/pdf/${encodeURIComponent(doi)}`,
    cookieDomains: ['journals.lww.com', 'lww.com', 'wolterskluwer.com', 'ovid.com'],
    hostPatterns: ['journals.lww.com', 'ovid.com'],
  },
  {
    name: 'Annual Reviews',
    doiPrefixes: ['10.1146'],
    resolvePdfUrl: (doi) =>
      `https://www.annualreviews.org/doi/pdf/${encodeURIComponent(doi)}`,
    cookieDomains: ['annualreviews.org'],
    hostPatterns: ['annualreviews.org'],
  },
  {
    name: 'Thieme',
    doiPrefixes: ['10.1055'],
    resolvePdfUrl: (doi) =>
      `https://www.thieme-connect.com/products/ejournals/pdf/${encodeURIComponent(doi)}.pdf`,
    cookieDomains: ['thieme-connect.com', 'thieme.com'],
    hostPatterns: ['thieme-connect.com'],
  },
  {
    name: 'Karger',
    doiPrefixes: ['10.1159'],
    resolvePdfUrl: (doi) =>
      `https://karger.com/Article/Pdf/${encodeURIComponent(doi)}`,
    cookieDomains: ['karger.com'],
    hostPatterns: ['karger.com'],
  },
  {
    name: 'BMJ',
    doiPrefixes: ['10.1136'],
    resolvePdfUrl: (doi) =>
      `https://www.bmj.com/content/doi/${encodeURIComponent(doi)}.full.pdf`,
    cookieDomains: ['bmj.com'],
    hostPatterns: ['bmj.com'],
  },
  {
    name: 'Mary Ann Liebert',
    doiPrefixes: ['10.1089'],
    resolvePdfUrl: (doi) =>
      `https://www.liebertpub.com/doi/pdf/${encodeURIComponent(doi)}`,
    cookieDomains: ['liebertpub.com'],
    hostPatterns: ['liebertpub.com'],
  },
  {
    name: 'Emerald',
    doiPrefixes: ['10.1108'],
    resolvePdfUrl: (doi) =>
      `https://www.emerald.com/insight/content/doi/${encodeURIComponent(doi)}/full/pdf`,
    cookieDomains: ['emerald.com'],
    hostPatterns: ['emerald.com'],
  },
  {
    name: 'JSTOR',
    doiPrefixes: ['10.2307'],
    resolvePdfUrl: (doi) => {
      const id = doi.replace(/^10\.2307\//, '');
      return `https://www.jstor.org/stable/pdf/${id}.pdf`;
    },
    cookieDomains: ['jstor.org'],
    hostPatterns: ['jstor.org'],
  },
  {
    name: 'Informa / Routledge',
    doiPrefixes: ['10.4324'],
    resolvePdfUrl: (doi) =>
      `https://www.taylorfrancis.com/doi/pdf/${encodeURIComponent(doi)}`,
    cookieDomains: ['taylorfrancis.com', 'tandfonline.com'],
    hostPatterns: ['taylorfrancis.com'],
  },
  {
    name: 'World Scientific',
    doiPrefixes: ['10.1142'],
    resolvePdfUrl: (doi) =>
      `https://www.worldscientific.com/doi/pdf/${encodeURIComponent(doi)}`,
    cookieDomains: ['worldscientific.com'],
    hostPatterns: ['worldscientific.com'],
  },
  {
    name: 'ASCE',
    doiPrefixes: ['10.1061'],
    resolvePdfUrl: (doi) =>
      `https://ascelibrary.org/doi/pdf/${encodeURIComponent(doi)}`,
    cookieDomains: ['ascelibrary.org'],
    hostPatterns: ['ascelibrary.org'],
  },
  {
    name: 'ASME',
    doiPrefixes: ['10.1115'],
    resolvePdfUrl: (doi) =>
      `https://asmedigitalcollection.asme.org/doi/pdf/${encodeURIComponent(doi)}`,
    cookieDomains: ['asmedigitalcollection.asme.org', 'asme.org'],
    hostPatterns: ['asmedigitalcollection.asme.org'],
  },
  {
    name: 'Walter de Gruyter (Sciendo)',
    doiPrefixes: ['10.2478'],
    resolvePdfUrl: (doi) =>
      `https://sciendo.com/pdf/${encodeURIComponent(doi)}`,
    cookieDomains: ['sciendo.com', 'degruyter.com'],
    hostPatterns: ['sciendo.com'],
  },
  {
    name: 'SPIE',
    doiPrefixes: ['10.1117'],
    resolvePdfUrl: (doi) =>
      `https://www.spiedigitallibrary.org/doi/pdf/${encodeURIComponent(doi)}`,
    cookieDomains: ['spiedigitallibrary.org'],
    hostPatterns: ['spiedigitallibrary.org'],
  },

  // ── Chinese academic databases ──

  {
    name: 'CNKI (知网)',
    doiPrefixes: [],
    resolvePdfUrl: (_doi) => '',
    cookieDomains: ['cnki.net', 'cnki.com.cn', 'kns.cnki.net'],
    hostPatterns: ['cnki.net', 'kns.cnki.net'],
  },
  {
    name: 'Wanfang (万方)',
    doiPrefixes: [],
    resolvePdfUrl: (_doi) => '',
    cookieDomains: ['wanfangdata.com.cn', 'd.wanfangdata.com.cn'],
    hostPatterns: ['wanfangdata.com.cn', 'd.wanfangdata.com.cn', 's.wanfangdata.com.cn'],
  },
];

// Generic fallback: resolve via DOI redirect
const FALLBACK_PATTERN: PublisherPattern = {
  name: 'Generic (DOI redirect)',
  doiPrefixes: [],
  resolvePdfUrl: (doi) => `https://doi.org/${encodeURIComponent(doi)}`,
  cookieDomains: [],
  hostPatterns: [],
};

// ─── Public API ───

/**
 * Resolve a DOI to its publisher pattern (by DOI prefix).
 * Returns the matching publisher or a generic DOI-redirect fallback.
 */
export function resolvePublisher(doi: string): PublisherPattern {
  const prefix = doi.match(/^(10\.\d{4,5})\//)?.[1];
  if (!prefix) return FALLBACK_PATTERN;

  const matched = PUBLISHER_PATTERNS.find((p) =>
    p.doiPrefixes.includes(prefix),
  );
  return matched ?? FALLBACK_PATTERN;
}

/**
 * Resolve a publisher from the hostname of a DOI redirect landing page.
 *
 * This is the Recon-driven alternative to DOI-prefix matching:
 * `HEAD https://doi.org/{doi}` → redirects to publisher → extract hostname →
 * match against `hostPatterns`.
 *
 * Returns null if no known publisher matches (still usable for cookie checking
 * since the domain itself can be matched against CookieJar).
 */
export function resolvePublisherByDomain(hostname: string): PublisherPattern | null {
  // Strip 'www.' prefix for matching
  const bare = hostname.replace(/^www\./, '');

  for (const pattern of PUBLISHER_PATTERNS) {
    for (const host of pattern.hostPatterns) {
      // Exact match or subdomain match: "journals.aps.org" matches host "journals.aps.org"
      // "foo.sciencedirect.com" matches host "sciencedirect.com"
      if (bare === host || bare.endsWith(`.${host}`)) {
        return pattern;
      }
    }
  }
  return null;
}

/**
 * Get all known cookie domains across all publishers.
 * Used during BrowserWindow login to decide which cookies to capture.
 */
export function getAllPublisherCookieDomains(): string[] {
  const domains = new Set<string>();
  for (const p of PUBLISHER_PATTERNS) {
    for (const d of p.cookieDomains) domains.add(d);
  }
  return [...domains];
}

/**
 * Get cookie domains for a specific hostname (from DOI redirect).
 * Uses domain-based publisher resolution, falls back to the hostname itself.
 */
export function getCookieDomainsForHost(hostname: string): string[] {
  const pattern = resolvePublisherByDomain(hostname);
  if (pattern) return pattern.cookieDomains;
  // Fallback: use the hostname and its parent domain
  const bare = hostname.replace(/^www\./, '');
  const parts = bare.split('.');
  if (parts.length > 2) {
    return [bare, parts.slice(-2).join('.')];
  }
  return [bare];
}
