// ═══ Paper & Bibliography ═══

export interface PaperMetadata {
  id: string;
  title: string;
  authors: string[];
  year: number;
  doi?: string;
  arxivId?: string;
  venue?: string;
  abstract?: string;
  citationCount?: number;
  paperType: PaperType;
  source: PaperSource;
}

export type PaperType =
  | 'journal'
  | 'conference'
  | 'book'
  | 'chapter'
  | 'preprint'
  | 'review'
  | 'unknown';

export type PaperSource =
  | 'semantic_scholar'
  | 'openalex'
  | 'arxiv'
  | 'bibtex'
  | 'ris'
  | 'manual';

export type FulltextStatus = 'pending' | 'acquired' | 'abstract_only' | 'failed';
export type AnalysisStatus = 'pending' | 'analyzed' | 'reviewed' | 'integrated' | 'parse_failed';
export type Relevance = 'high' | 'medium' | 'low' | 'excluded';

// ═══ Text Processing ═══

export interface TextChunk {
  chunkId: string;
  paperId: string;
  section: string;
  pageStart: number;
  pageEnd: number;
  text: string;
  tokenCount: number;
}

export interface RankedChunk extends TextChunk {
  paperTitle: string;
  score: number;
  source: 'paper' | 'annotation' | 'private';
}

// ═══ PDF Annotations ═══

export interface Annotation {
  id?: number;
  paperId: string;
  page: number;
  rect: [number, number, number, number];
  text: string;
  type: 'highlight' | 'note' | 'concept_tag';
  color?: string;
  comment?: string;
  conceptId?: string;
}

// ═══ Concept Framework ═══

export interface ConceptMapping {
  conceptId: string;
  relation: 'supports' | 'challenges' | 'extends' | 'operationalizes';
  confidence: number;
  evidence: string;
  annotationId?: number;
}

export interface ConceptDefinition {
  id: string;
  nameZh: string;
  nameEn: string;
  layer: string;
  definition: string;
  keywords: string[];
}

// ═══ Figure Extraction ═══

export interface FigureBlock {
  page: number;
  type: 'figure' | 'table' | 'equation';
  description: string;
  imagePath: string;
  caption: string;
}

// ═══ LLM Client ═══

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface CompleteOptions {
  tools?: ToolDef[];
  maxTokens?: number;
  temperature?: number;
}

export interface CompleteResult {
  text?: string;
  toolCalls?: ToolCall[];
}

// ═══ Acquire ═══

export interface AcquireResult {
  status: 'success' | 'failed';
  path?: string;
  source?: string;
  reason?: string;
}

// ═══ Search ═══

export type CitationDirection = 'citations' | 'references';

// ═══ Reference Extraction ═══

export interface RefMetadata {
  title: string;
  authors?: string[];
  year?: number;
  doi?: string;
}

// ═══ Configuration ═══

export interface AbyssalConfig {
  project: {
    name: string;
    description: string;
    mode: 'anchored' | 'unanchored';
  };
  acquire: {
    unpaywall: boolean;
    arxiv: boolean;
    pmc: boolean;
    institutionalProxy: string;
    scihub: boolean;
    maxRetries: number;
    downloadTimeout: number;
  };
  discovery: {
    citationDepth: number;
    maxPapersPerSeed: number;
    relevanceThreshold: number;
  };
  analysis: {
    maxTokensPerChunk: number;
    includeKeyReferences: boolean;
    autoMapConcepts: boolean;
  };
  rag: {
    embeddingBackend: 'api' | 'local-onnx';
    embeddingModel: string;
    embeddingDim: number;
    chunkOverlap: number;
    defaultTopK: number;
    crossPaperContextK: number;
  };
  language: {
    internal: string;
    outputDefault: string;
  };
  llm: {
    defaultProvider: string;
    defaultModel: string;
    discovery?: { provider: string; model: string };
    analysis?: { provider: string; model: string };
    article?: { provider: string; model: string };
  };
  apiKeys: {
    semanticScholar: string;
    unpaywallEmail: string;
  };
  workspace: {
    baseDir: string;
  };
}
