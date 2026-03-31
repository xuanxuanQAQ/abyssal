/**
 * Recon Cache DAO — 持久化 acquire recon 侦察结果。
 *
 * 表：recon_cache (DOI 主键)
 * JSON 数组列：pdf_urls, repository_urls, landing_page_urls, crossref_pdf_links
 */

import type Database from 'better-sqlite3';
import type { CachedRecon } from '../../acquire/recon-cache';

/** 从数据库行解析 CachedRecon */
function rowToCachedRecon(row: Record<string, unknown>): CachedRecon {
  return {
    doi: row['doi'] as string,
    publisherDomain: (row['publisher_domain'] as string) ?? null,
    resolvedUrl: (row['resolved_url'] as string) ?? null,
    oaStatus: (row['oa_status'] as string) ?? null,
    pdfUrls: JSON.parse((row['pdf_urls'] as string) || '[]') as string[],
    repositoryUrls: JSON.parse((row['repository_urls'] as string) || '[]') as string[],
    landingPageUrls: JSON.parse((row['landing_page_urls'] as string) || '[]') as string[],
    crossrefPdfLinks: JSON.parse((row['crossref_pdf_links'] as string) || '[]') as string[],
    licenseUrl: (row['license_url'] as string) ?? null,
    reconAt: row['recon_at'] as string,
  };
}

export function getRecon(db: Database.Database, doi: string): CachedRecon | null {
  const row = db.prepare('SELECT * FROM recon_cache WHERE doi = ?').get(doi) as Record<string, unknown> | undefined;
  if (!row) return null;
  return rowToCachedRecon(row);
}

export function upsertRecon(db: Database.Database, recon: CachedRecon): void {
  db.prepare(`
    INSERT INTO recon_cache (doi, publisher_domain, resolved_url, oa_status, pdf_urls, repository_urls, landing_page_urls, crossref_pdf_links, license_url, recon_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(doi) DO UPDATE SET
      publisher_domain = excluded.publisher_domain,
      resolved_url = excluded.resolved_url,
      oa_status = excluded.oa_status,
      pdf_urls = excluded.pdf_urls,
      repository_urls = excluded.repository_urls,
      landing_page_urls = excluded.landing_page_urls,
      crossref_pdf_links = excluded.crossref_pdf_links,
      license_url = excluded.license_url,
      recon_at = excluded.recon_at
  `).run(
    recon.doi,
    recon.publisherDomain,
    recon.resolvedUrl,
    recon.oaStatus,
    JSON.stringify(recon.pdfUrls),
    JSON.stringify(recon.repositoryUrls),
    JSON.stringify(recon.landingPageUrls),
    JSON.stringify(recon.crossrefPdfLinks),
    recon.licenseUrl,
    recon.reconAt,
  );
}
