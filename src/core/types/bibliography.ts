import type { PaperId } from './common';
import type { PaperMetadata } from './paper';

// ═══ FormattedCitation ═══

export interface FormattedCitation {
  paperId: PaperId;
  inlineCitation: string; // e.g. "(Goffman, 1959, p.112)"
  fullEntry: string; // 参考文献列表条目完整文本
  cslStyleId: string;
  missingFieldWarnings: string[]; // e.g. ["volume is missing"]
}

// ═══ BiblioCompletenessReport ═══

export interface BiblioCompletenessReport {
  paperId: PaperId;
  missingFields: string[];
  completeness: number; // [0.0, 1.0]
  cslStyleId: string;
}

// ═══ ImportedEntry ═══

export interface ImportedEntry {
  originalKey: string; // BibTeX key 或 RIS ID 标签值
  metadata: Partial<PaperMetadata>;
  unmappedFields: Record<string, string>;
  sourceFormat: 'bibtex' | 'ris';
}

// ═══ AnystyleParsedEntry ═══

export interface AnystyleParsedEntry {
  rawText: string;
  authors: string[] | null;
  title: string | null;
  year: number | null;
  journal: string | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  publisher: string | null;
  doi: string | null;
  type: 'journal' | 'book' | 'chapter' | 'conference' | 'unknown';
  confidence: number; // [0.0, 1.0]
}

// ═══ EnrichResult ═══

export interface EnrichResult {
  enriched: boolean;
  enrichedFields: string[];
  metadata: PaperMetadata;
}

// ═══ ScanAndReplaceResult ═══

export interface ScanAndReplaceResult {
  text: string;
  bibliography: string;
  citedPaperIds: PaperId[];
}
