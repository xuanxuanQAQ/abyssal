// ═══ Layer 0: Fast Path — 零网络请求的确定性 OA 拦截 ═══
// 某些 DOI 前缀属于纯开源平台，PDF URL 100% 确定性构造。
// 命中时直接跳过所有 Recon/Strategy，进入下载。

// ─── Types ───

export interface FastPathResult {
  matched: boolean;
  /** 可直接下载的 PDF URL（matched=true 时非 null） */
  pdfUrl: string | null;
  /** 数据源标识（用于 AcquireAttempt 归因） */
  source: string | null;
}

const NO_MATCH: FastPathResult = { matched: false, pdfUrl: null, source: null };

// ─── Pattern Registry ───

interface FastPathPattern {
  /** DOI 前缀匹配（如 "10.48550"） */
  doiPrefix: string;
  /** 从 DOI 构造 PDF URL */
  buildUrl: (doi: string) => string | null;
  /** 数据源标识 */
  source: string;
}

const FAST_PATH_PATTERNS: FastPathPattern[] = [
  // ── arXiv (via DOI) ──
  // DOI: 10.48550/arXiv.2301.12345 → arxiv ID: 2301.12345
  {
    doiPrefix: '10.48550',
    source: 'arxiv-doi',
    buildUrl: (doi) => {
      const match = doi.match(/^10\.48550\/arXiv\.(.+)$/i);
      if (!match?.[1]) return null;
      return `https://arxiv.org/pdf/${match[1]}.pdf`;
    },
  },

  // ── bioRxiv ──
  // DOI: 10.1101/2024.01.15.575123 (non-medrxiv pattern)
  // bioRxiv DOIs have a date-based suffix: YYYY.MM.DD.NNNNNN
  {
    doiPrefix: '10.1101',
    source: 'biorxiv',
    buildUrl: (doi) => {
      const suffix = doi.replace(/^10\.1101\//, '');
      // medRxiv DOIs typically contain "medrxiv" or specific date ranges
      // bioRxiv: all 10.1101 DOIs go to bioRxiv first, which also hosts medRxiv
      // The URL pattern works for both — bioRxiv redirects medRxiv DOIs correctly
      return `https://www.biorxiv.org/content/${doi}v1.full.pdf`;
    },
  },

  // ── Zenodo ──
  // DOI: 10.5281/zenodo.1234567
  // Zenodo records have a predictable PDF path, but the filename varies.
  // Use the records API redirect which serves the first PDF file.
  {
    doiPrefix: '10.5281',
    source: 'zenodo',
    buildUrl: (doi) => {
      const match = doi.match(/^10\.5281\/zenodo\.(\d+)$/i);
      if (!match?.[1]) return null;
      // Zenodo /api/records/{id} → files[] → first PDF
      // Simpler: use the DOI redirect which lands on the record page.
      // For fast-path we need a direct URL, so use the content API.
      return `https://zenodo.org/api/records/${match[1]}/files`;
    },
  },

  // ── PLOS ONE ──
  // DOI: 10.1371/journal.pone.0123456 — always OA (CC-BY)
  {
    doiPrefix: '10.1371',
    source: 'plos',
    buildUrl: (doi) => {
      // PLOS PDF URL: https://journals.plos.org/plosone/article/file?id=10.1371/...&type=printable
      return `https://journals.plos.org/plosone/article/file?id=${encodeURIComponent(doi)}&type=printable`;
    },
  },

  // ── Frontiers ──
  // DOI: 10.3389/fneur.2024.1234567 — always OA (CC-BY)
  {
    doiPrefix: '10.3389',
    source: 'frontiers',
    buildUrl: (doi) => {
      // Frontiers PDF: https://www.frontiersin.org/articles/10.3389/.../pdf
      return `https://www.frontiersin.org/articles/${doi}/pdf`;
    },
  },

  // ── MDPI ──
  // DOI: 10.3390/s24010123 — always OA (CC-BY)
  {
    doiPrefix: '10.3390',
    source: 'mdpi',
    buildUrl: (doi) => {
      const suffix = doi.replace(/^10\.3390\//, '');
      return `https://www.mdpi.com/${suffix}/pdf`;
    },
  },

  // ── Hindawi ──
  // DOI: 10.1155/2024/1234567 — always OA
  {
    doiPrefix: '10.1155',
    source: 'hindawi',
    buildUrl: (doi) => {
      return `https://downloads.hindawi.com/journals/${doi.replace(/^10\.1155\//, '')}.pdf`;
    },
  },

  // ── PeerJ ──
  // DOI: 10.7717/peerj.12345 — always OA
  {
    doiPrefix: '10.7717',
    source: 'peerj',
    buildUrl: (doi) => {
      const match = doi.match(/^10\.7717\/peerj\.(\d+)$/i);
      if (!match?.[1]) return null;
      return `https://peerj.com/articles/${match[1]}.pdf`;
    },
  },
];

// ─── Public API ───

/**
 * Layer 0: 尝试从 DOI / arxivId / pmcid 直接构造 PDF URL（零网络请求）。
 *
 * 仅匹配纯 OA 平台（arXiv, bioRxiv, Zenodo, PLOS, Frontiers, MDPI 等）。
 * 匹配成功时返回可直接下载的 URL，跳过所有 Recon/Strategy。
 *
 * 也接受已知的 arXiv ID 或 PMCID 直接构造。
 */
export function tryFastPath(
  doi: string | null,
  arxivId: string | null,
  pmcid?: string | null,
): FastPathResult {
  // arXiv ID 直接构造（优先于 DOI 匹配）
  if (arxivId) {
    return {
      matched: true,
      pdfUrl: `https://arxiv.org/pdf/${arxivId}.pdf`,
      source: 'arxiv',
    };
  }

  // PMCID → EuropePMC 直出 PDF
  if (pmcid) {
    // EuropePMC 提供稳定的 OA PDF 端点
    return {
      matched: true,
      pdfUrl: `https://europepmc.org/backend/ptpmcrender.fcgi?accid=${pmcid}&blobtype=pdf`,
      source: 'europepmc',
    };
  }

  if (!doi) return NO_MATCH;

  // 提取 DOI 前缀
  const prefixMatch = doi.match(/^(10\.\d{4,5})\//);
  if (!prefixMatch) return NO_MATCH;
  const prefix = prefixMatch[1]!;

  for (const pattern of FAST_PATH_PATTERNS) {
    if (prefix === pattern.doiPrefix) {
      const url = pattern.buildUrl(doi);
      if (url) {
        return { matched: true, pdfUrl: url, source: pattern.source };
      }
    }
  }

  return NO_MATCH;
}

/**
 * Zenodo 特殊处理：需要先查 API 拿到文件列表，再找 PDF 文件。
 * 返回实际 PDF 下载 URL，或 null。
 */
export async function resolveZenodoPdfUrl(
  apiUrl: string,
  http: { requestJson<T>(url: string, opts?: { timeoutMs?: number }): Promise<T> },
  timeoutMs: number,
): Promise<string | null> {
  try {
    const data = await http.requestJson<{
      entries?: Array<{ key: string; links?: { content?: string } }>;
    }>(apiUrl, { timeoutMs });

    const pdfEntry = data.entries?.find((e) =>
      e.key.toLowerCase().endsWith('.pdf'),
    );
    return pdfEntry?.links?.content ?? null;
  } catch {
    return null;
  }
}
