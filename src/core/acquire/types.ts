// ═══ Acquire Module Types ═══

/** 结构化失败分类——供 FailureMemory 精确归因 */
export type FailureCategory =
  | 'timeout'
  | 'dns_error'
  | 'connection_reset'
  | 'ssl_error'
  | 'http_4xx'
  | 'http_5xx'
  | 'rate_limited'
  | 'invalid_pdf'
  | 'parse_error'
  | 'no_pdf_url'
  | 'no_identifier'
  | 'session_expired'
  | 'unknown';

/** 全文获取尝试记录 */
export interface AcquireAttempt {
  source: string;
  status: 'success' | 'failed' | 'skipped' | 'timeout';
  durationMs: number;
  failureReason: string | null;
  failureCategory: FailureCategory | null;
  httpStatus: number | null;
}

/** 全文获取结果 */
export interface AcquireResult {
  status: 'success' | 'abstract_only' | 'failed' | 'suspicious';
  pdfPath: string | null;
  source: string | null;
  sha256: string | null;
  fileSize: number | null;
  attempts: AcquireAttempt[];
}

/** PDF 校验结果 */
export interface PdfValidation {
  valid: boolean;
  reason: string | null;
  pageCount: number | null;
  fileSizeBytes: number;
}