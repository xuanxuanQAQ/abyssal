/**
 * DLA (Document Layout Analysis) — shared types.
 *
 * Defines content block types, bounding boxes, and the RPC protocol
 * between the main process and the DLA inference subprocess.
 */

// ─── Content Block Types ───

/** DocLayout-YOLO DocStructBench 10-class taxonomy */
export type ContentBlockType =
  | 'title'
  | 'text'
  | 'abandoned'
  | 'figure'
  | 'figure_caption'
  | 'table'
  | 'table_caption'
  | 'table_footnote'
  | 'formula'
  | 'formula_caption';

/** Normalized bounding box — coordinates relative to page dimensions [0, 1] */
export interface NormalizedBBox {
  x: number;  // left / pageWidth
  y: number;  // top / pageHeight
  w: number;  // width / pageWidth
  h: number;  // height / pageHeight
}

/** A detected content block on a single page */
export interface ContentBlock {
  type: ContentBlockType;
  bbox: NormalizedBBox;
  confidence: number;
  pageIndex: number;  // 0-based
}

/** Per-page analysis result */
export interface PageLayoutResult {
  pageIndex: number;
  blocks: ContentBlock[];
  /** Time spent on this page in ms */
  inferenceMs: number;
}

// ─── DLA Subprocess RPC Protocol ───

export interface DlaDetectRequest {
  id: string;
  type: 'detect';
  pdfPath: string;
  pageIndices: number[];
  /** Long edge target size in pixels (default 1024) */
  targetSize?: number;
}

export interface DlaDetectResult {
  id: string;
  type: 'detect:result';
  pageIndex: number;
  blocks: ContentBlock[];
  inferenceMs: number;
}

export interface DlaDetectProgress {
  id: string;
  type: 'detect:progress';
  completed: number;
  total: number;
}

export interface DlaDetectError {
  id: string;
  type: 'detect:error';
  message: string;
  pageIndex?: number;
}

export interface DlaLifecycleMessage {
  type: 'lifecycle';
  action: 'init' | 'shutdown';
  payload?: DlaInitPayload;
}

export interface DlaInitPayload {
  modelPath: string;
  /** 'cpu' | 'dml' (DirectML on Windows) */
  executionProvider?: string;
}

export interface DlaLifecycleResponse {
  type: 'lifecycle';
  action: string;
  success: boolean;
  error?: string;
}

// ─── Fusion Layer Types ───

/** Character with position data extracted from stext.walk() */
export interface CharWithPosition {
  char: string;
  x: number;       // normalized x (0-1)
  y: number;       // normalized y (0-1)
  fontSize: number;
  isBold: boolean;
  pageIndex: number;
}

/**
 * A DLA ContentBlock fused with extracted text and reading order.
 * This is the core shared data structure consumed by all three pipelines.
 */
export interface TypedBlock {
  blockType: ContentBlockType;
  bbox: NormalizedBBox;
  confidence: number;
  pageIndex: number;
  /** Text content assigned from character positions (null for non-text blocks) */
  text: string | null;
  /** Global reading order across entire document (column-aware) */
  readingOrder: number;
  /** Detected column: 0=left, 1=right, -1=spanning/single-column */
  columnIndex: number;
  /** Character offset in fullText where this block's text starts */
  charStart: number | null;
  /** Character offset in fullText where this block's text ends */
  charEnd: number | null;
}

/** Section node in the document structure tree */
export interface DocumentSection {
  titleBlock: TypedBlock;
  label: import('../types/chunk').SectionLabel;
  depth: number;
  bodyBlocks: TypedBlock[];
  figures: TypedBlock[];
  tables: TypedBlock[];
  formulas: TypedBlock[];
  children: DocumentSection[];
}

/** Full document structure built from DLA TypedBlocks */
export interface DocumentStructure {
  /** Top-level sections (including nested children) */
  sections: DocumentSection[];
  /** Reference section (if detected) */
  referenceSection: {
    titleBlock: TypedBlock;
    entries: TypedBlock[];
  } | null;
  /** All blocks in reading order */
  readingOrder: TypedBlock[];
  /** Detected column layout for the document */
  columnLayout: 'single' | 'double' | 'mixed';
}

/** Per-page character data for block-text fusion */
export interface PageCharData {
  pageIndex: number;
  chars: CharWithPosition[];
  /** Page dimensions in PDF points (for normalization) */
  pageWidth: number;
  pageHeight: number;
}

// ─── OCR Line Types (for OCR text alignment in reader) ───

/** A single OCR-recognized word with normalized bounding box */
export interface OcrWord {
  /** Word text content */
  text: string;
  /** Normalized bounding box [0,1] relative to page dimensions */
  bbox: NormalizedBBox;
  /** Tesseract OCR confidence for this word (0-100) */
  confidence: number;
}

/** A single OCR-recognized text line with normalized bounding box */
export interface OcrLine {
  /** Line text content */
  text: string;
  /** Normalized bounding box [0,1] relative to page dimensions */
  bbox: NormalizedBBox;
  /** Tesseract OCR confidence for this line (0-100) */
  confidence: number;
  /** 0-based page index */
  pageIndex: number;
  /** 0-based line index within the page (reading order) */
  lineIndex: number;
  /** Word-level bboxes for precise text alignment */
  words?: OcrWord[];
}

/** Per-page OCR line data */
export interface PageOcrLines {
  pageIndex: number;
  lines: OcrLine[];
}

export type DlaProcessMessage = DlaDetectRequest | DlaLifecycleMessage;
export type DlaProcessResponse = DlaDetectResult | DlaDetectProgress | DlaDetectError | DlaLifecycleResponse;

// ─── Type Guards ──���

export function isDlaLifecycleMessage(msg: unknown): msg is DlaLifecycleMessage {
  return (msg as DlaLifecycleMessage)?.type === 'lifecycle';
}

export function isDlaDetectRequest(msg: unknown): msg is DlaDetectRequest {
  return (msg as DlaDetectRequest)?.type === 'detect';
}

export function isDlaLifecycleResponse(msg: unknown): msg is DlaLifecycleResponse {
  return (msg as DlaLifecycleResponse)?.type === 'lifecycle';
}
