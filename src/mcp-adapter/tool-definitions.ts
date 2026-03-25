// ═══ MCP Tool Definitions ═══
// §5: 全部 Tool 的 JSON Schema 定义
//
// 每个 Tool 含 name / description / inputSchema。
// 初版手工注册，后续由 tool-generator.ts 自动同步。

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  /** 是否为写操作（只读模式下禁止） */
  isWriteOperation: boolean;
  /** 核心模块名 */
  module: string;
  /** 原始函数名（camelCase） */
  functionName: string;
  /** 需要代理层自动注入的参数名列表 */
  injectedParams: string[];
  /** 函数签名的完整参数名有序列表（Fix #1: 防止可选参数省略导致位置错位） */
  paramOrder: string[];
}

// ─── 简写辅助 ───

const str = { type: 'string' as const };
const num = { type: 'number' as const };
const bool = { type: 'boolean' as const };
const strArr = { type: 'array' as const, items: { type: 'string' as const } };
const numArr = { type: 'array' as const, items: { type: 'number' as const } };

// ─── 原始定义类型（paramOrder 可省略，由 ensureParamOrder 补全） ───
type RawToolDef = Omit<ToolDefinition, 'paramOrder'> & { paramOrder?: string[] | undefined };

// ═══ Search Tools (7) ═══

const searchTools: RawToolDef[] = [
  {
    name: 'search_semantic_scholar',
    description: 'Search Semantic Scholar for academic papers matching the query.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { ...str, description: 'Keywords to search for' },
        limit: { ...num, description: 'Maximum results', default: 100 },
        yearRange: { type: 'object', properties: { min: num, max: num }, description: 'Year range filter' },
        fieldsOfStudy: { ...strArr, description: 'Fields of study filter' },
        openAccessOnly: { ...bool, description: 'Only open access papers' },
      },
      required: ['query'],
    },
    isWriteOperation: false, module: 'search', functionName: 'searchSemanticScholar', injectedParams: [],
  },
  {
    name: 'search_openalex',
    description: 'Search OpenAlex for papers by concept.',
    inputSchema: {
      type: 'object',
      properties: {
        concepts: { ...strArr, description: 'Concept names or OpenAlex IDs' },
        limit: { ...num, default: 100 },
        yearRange: { type: 'object', properties: { min: num, max: num } },
        minCitations: { ...num, description: 'Minimum citation count' },
      },
      required: ['concepts'],
    },
    isWriteOperation: false, module: 'search', functionName: 'searchOpenAlex', injectedParams: [],
  },
  {
    name: 'search_arxiv',
    description: 'Search arXiv for preprints.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { ...str, description: 'Search query' },
        limit: { ...num, default: 100 },
        categories: { ...strArr, description: 'arXiv categories (e.g. cs.AI)' },
        sortBy: { ...str, enum: ['relevance', 'lastUpdatedDate', 'submittedDate'] },
      },
      required: ['query'],
    },
    isWriteOperation: false, module: 'search', functionName: 'searchArxiv', injectedParams: [],
  },
  {
    name: 'get_paper_details',
    description: 'Get detailed metadata for a paper by DOI, arXiv ID, or S2 ID.',
    inputSchema: { type: 'object', properties: { identifier: str }, required: ['identifier'] },
    isWriteOperation: false, module: 'search', functionName: 'getPaperDetails', injectedParams: [],
  },
  {
    name: 'get_citations',
    description: 'Get citation list (references or citing papers).',
    inputSchema: {
      type: 'object',
      properties: {
        identifier: str,
        direction: { ...str, enum: ['citations', 'references'] },
        limit: { ...num, default: 500 },
      },
      required: ['identifier', 'direction'],
    },
    isWriteOperation: false, module: 'search', functionName: 'getCitations', injectedParams: [],
  },
  {
    name: 'get_related_papers',
    description: 'Get recommended related papers.',
    inputSchema: { type: 'object', properties: { identifier: str }, required: ['identifier'] },
    isWriteOperation: false, module: 'search', functionName: 'getRelatedPapers', injectedParams: [],
  },
  {
    name: 'search_by_author',
    description: 'Search papers by author name.',
    inputSchema: {
      type: 'object',
      properties: {
        authorName: str,
        affiliationHint: str,
        limit: { ...num, default: 500 },
      },
      required: ['authorName'],
    },
    isWriteOperation: false, module: 'search', functionName: 'searchByAuthor', injectedParams: [],
  },
];

// ═══ Acquire Tools (1) ═══

const acquireTools: RawToolDef[] = [
  {
    name: 'acquire_fulltext',
    description: 'Download fulltext PDF through 5-level cascade (Unpaywall→arXiv→PMC→Institutional→Sci-Hub).',
    inputSchema: {
      type: 'object',
      properties: {
        doi: { type: 'string', description: 'DOI identifier' },
        arxivId: { type: 'string', description: 'arXiv identifier' },
        pmcid: { type: 'string', description: 'PubMed Central ID' },
        savePath: { ...str, description: 'Absolute path to save PDF' },
      },
      required: ['savePath'],
    },
    isWriteOperation: true, module: 'acquire', functionName: 'acquireFulltext', injectedParams: [],
  },
];

// ═══ Process Tools (9) ═══

const processTools: RawToolDef[] = [
  {
    name: 'extract_text',
    description: 'Extract text from PDF using mupdf with OCR fallback.',
    inputSchema: {
      type: 'object',
      properties: {
        pdfPath: str,
        ocrEnabled: bool,
        ocrLanguages: strArr,
      },
      required: ['pdfPath'],
    },
    isWriteOperation: false, module: 'process', functionName: 'extractText', injectedParams: [],
  },
  {
    name: 'extract_sections',
    description: 'Identify sections in extracted text using heuristic rules + font metadata.',
    inputSchema: { type: 'object', properties: { fullText: str }, required: ['fullText'] },
    isWriteOperation: false, module: 'process', functionName: 'extractSections', injectedParams: [],
  },
  {
    name: 'extract_references',
    description: 'Extract reference entries from paper full text.',
    inputSchema: { type: 'object', properties: { fullText: str }, required: ['fullText'] },
    isWriteOperation: false, module: 'process', functionName: 'extractReferences', injectedParams: [],
  },
  {
    name: 'chunk_text',
    description: 'Split text into structure-aware chunks for RAG indexing.',
    inputSchema: {
      type: 'object',
      properties: {
        sectionMap: { type: 'object', description: 'SectionLabel→text mapping' },
        boundaries: { type: 'array', items: { type: 'object' } },
        pageTexts: strArr,
        paperId: str,
        maxTokensPerChunk: { ...num, default: 1024 },
        overlapTokens: { ...num, default: 128 },
      },
      required: ['sectionMap', 'boundaries', 'pageTexts'],
    },
    isWriteOperation: false, module: 'process', functionName: 'chunkText', injectedParams: [],
  },
  {
    name: 'detect_figure_pages',
    description: 'Detect pages containing figures/tables using density analysis.',
    inputSchema: { type: 'object', properties: { pdfPath: str }, required: ['pdfPath'] },
    isWriteOperation: false, module: 'process', functionName: 'detectFigurePages', injectedParams: [],
  },
  {
    name: 'parse_figures_with_vlm',
    description: 'Parse detected figures using Vision Language Model. [Requires VLM configuration]',
    inputSchema: {
      type: 'object',
      properties: { pdfPath: str, candidates: { type: 'array', items: { type: 'object' } } },
      required: ['pdfPath', 'candidates'],
    },
    isWriteOperation: false, module: 'process', functionName: 'parseFiguresWithVlm', injectedParams: ['vlm'],
  },
  {
    name: 'read_annotations',
    description: 'Read highlight and note annotations from PDF.',
    inputSchema: { type: 'object', properties: { pdfPath: str }, required: ['pdfPath'] },
    isWriteOperation: false, module: 'process', functionName: 'readAnnotations', injectedParams: [],
  },
  {
    name: 'write_annotation',
    description: 'Write a highlight or note annotation to PDF.',
    inputSchema: {
      type: 'object',
      properties: {
        pdfPath: str,
        annotationData: { type: 'object', description: 'Annotation data (page, type, rect, text)' },
      },
      required: ['pdfPath', 'annotationData'],
    },
    isWriteOperation: true, module: 'process', functionName: 'writeAnnotation', injectedParams: [],
  },
  {
    name: 'compress_for_context',
    description: 'Compress paper text to fit within a token budget.',
    inputSchema: {
      type: 'object',
      properties: { sectionMap: { type: 'object' }, targetTokens: num },
      required: ['sectionMap', 'targetTokens'],
    },
    isWriteOperation: false, module: 'process', functionName: 'compressForContext', injectedParams: [],
  },
];

// ═══ Database Tools (representative subset — full 40+ defined) ═══

const databaseTools: RawToolDef[] = [
  {
    name: 'add_paper', description: 'Add or upsert a paper.',
    inputSchema: { type: 'object', properties: { metadata: { type: 'object', description: 'PaperMetadata' } }, required: ['metadata'] },
    isWriteOperation: true, module: 'database', functionName: 'addPaper', injectedParams: ['dbService'],
  },
  {
    name: 'update_paper', description: 'Update paper fields.',
    inputSchema: { type: 'object', properties: { paperId: str, fields: { type: 'object' } }, required: ['paperId', 'fields'] },
    isWriteOperation: true, module: 'database', functionName: 'updatePaper', injectedParams: ['dbService'],
  },
  {
    name: 'get_paper', description: 'Get paper by ID.',
    inputSchema: { type: 'object', properties: { paperId: str }, required: ['paperId'] },
    isWriteOperation: false, module: 'database', functionName: 'getPaper', injectedParams: ['dbService'],
  },
  {
    name: 'query_papers', description: 'Query papers with filters, sorting, and pagination.',
    inputSchema: {
      type: 'object',
      properties: {
        fulltextStatus: strArr, analysisStatus: strArr, relevance: strArr,
        paperType: strArr, source: strArr, searchText: str,
        yearRange: { type: 'object', properties: { min: num, max: num } },
        limit: { ...num, default: 50 }, offset: { ...num, default: 0 },
      },
    },
    isWriteOperation: false, module: 'database', functionName: 'queryPapers', injectedParams: ['dbService'],
  },
  {
    name: 'delete_paper', description: 'Delete paper with cascade.',
    inputSchema: { type: 'object', properties: { paperId: str, cascade: { ...bool, default: true } }, required: ['paperId'] },
    isWriteOperation: true, module: 'database', functionName: 'deletePaper', injectedParams: ['dbService'],
  },
  {
    name: 'add_concept', description: 'Add a new concept to the framework.',
    inputSchema: { type: 'object', properties: { concept: { type: 'object', description: 'ConceptDefinition' } }, required: ['concept'] },
    isWriteOperation: true, module: 'database', functionName: 'addConcept', injectedParams: ['dbService'],
  },
  {
    name: 'get_concept', description: 'Get concept by ID.',
    inputSchema: { type: 'object', properties: { conceptId: str }, required: ['conceptId'] },
    isWriteOperation: false, module: 'database', functionName: 'getConcept', injectedParams: ['dbService'],
  },
  {
    name: 'get_all_concepts', description: 'List all concepts.',
    inputSchema: { type: 'object', properties: { includeDeprecated: bool } },
    isWriteOperation: false, module: 'database', functionName: 'getAllConcepts', injectedParams: ['dbService'],
  },
  {
    name: 'deprecate_concept', description: 'Deprecate a concept.',
    inputSchema: { type: 'object', properties: { conceptId: str, reason: str }, required: ['conceptId', 'reason'] },
    isWriteOperation: true, module: 'database', functionName: 'deprecateConcept', injectedParams: ['dbService'],
  },
  {
    name: 'merge_concepts', description: 'Merge two concepts.',
    inputSchema: { type: 'object', properties: { keepConceptId: str, mergeConceptId: str, conflictResolution: { ...str, enum: ['keep', 'merge', 'max_confidence'] } }, required: ['keepConceptId', 'mergeConceptId'] },
    isWriteOperation: true, module: 'database', functionName: 'mergeConcepts', injectedParams: ['dbService'],
  },
  {
    name: 'split_concept', description: 'Split a concept into two.',
    inputSchema: { type: 'object', properties: { originalConceptId: str, newConceptA: { type: 'object' }, newConceptB: { type: 'object' } }, required: ['originalConceptId', 'newConceptA', 'newConceptB'] },
    isWriteOperation: true, module: 'database', functionName: 'splitConcept', injectedParams: ['dbService'],
  },
  {
    name: 'map_paper_concept', description: 'Create or update a paper-concept mapping.',
    inputSchema: { type: 'object', properties: { mapping: { type: 'object', description: 'ConceptMapping' } }, required: ['mapping'] },
    isWriteOperation: true, module: 'database', functionName: 'mapPaperConcept', injectedParams: ['dbService'],
  },
  {
    name: 'get_mappings_by_paper', description: 'Get all concept mappings for a paper.',
    inputSchema: { type: 'object', properties: { paperId: str }, required: ['paperId'] },
    isWriteOperation: false, module: 'database', functionName: 'getMappingsByPaper', injectedParams: ['dbService'],
  },
  {
    name: 'get_concept_matrix', description: 'Get the concept-paper heatmap matrix.',
    inputSchema: { type: 'object', properties: {} },
    isWriteOperation: false, module: 'database', functionName: 'getConceptMatrix', injectedParams: ['dbService'],
  },
  {
    name: 'add_memo', description: 'Create a research memo.',
    inputSchema: { type: 'object', properties: { memo: { type: 'object', description: 'Memo data' }, embedding: { type: 'array', items: num } }, required: ['memo'] },
    isWriteOperation: true, module: 'database', functionName: 'addMemo', injectedParams: ['dbService'],
  },
  {
    name: 'get_memos_by_entity', description: 'Get memos related to a paper, concept, or note.',
    inputSchema: { type: 'object', properties: { entityType: { ...str, enum: ['paper', 'concept', 'annotation', 'outline', 'note'] }, entityId: str }, required: ['entityType', 'entityId'] },
    isWriteOperation: false, module: 'database', functionName: 'getMemosByEntity', injectedParams: ['dbService'],
  },
  {
    name: 'get_relation_graph', description: 'Get paper relation graph for visualization.',
    inputSchema: {
      type: 'object',
      properties: { centerId: str, depth: { ...num, default: 2 }, edgeTypes: strArr, minWeight: num, includeNotes: bool },
    },
    isWriteOperation: false, module: 'database', functionName: 'getRelationGraph', injectedParams: ['dbService'],
  },
  {
    name: 'get_stats', description: 'Get database statistics.',
    inputSchema: { type: 'object', properties: {} },
    isWriteOperation: false, module: 'database', functionName: 'getStats', injectedParams: ['dbService'],
  },
  {
    name: 'check_integrity', description: 'Run database integrity checks.',
    inputSchema: { type: 'object', properties: {} },
    isWriteOperation: false, module: 'database', functionName: 'checkIntegrity', injectedParams: ['dbService'],
  },
];

// ═══ RAG Tools (7) ═══

const ragTools: RawToolDef[] = [
  {
    name: 'retrieve', description: 'Execute 3-stage hybrid retrieval (vector + BM25 + structured + memo).',
    inputSchema: {
      type: 'object',
      properties: {
        queryText: str, taskType: { ...str, enum: ['analyze', 'synthesize', 'article', 'ad_hoc'] },
        conceptIds: strArr, paperIds: strArr, budgetMode: { ...str, enum: ['focused', 'broad', 'full'] },
        maxTokens: num, enableCorrectiveRag: bool,
      },
      required: ['queryText', 'taskType', 'budgetMode', 'maxTokens'],
    },
    isWriteOperation: false, module: 'rag', functionName: 'retrieve', injectedParams: [],
  },
  {
    name: 'index_chunks', description: 'Index text chunks with embeddings into vector store.',
    inputSchema: { type: 'object', properties: { chunks: { type: 'array', items: { type: 'object' } }, embeddings: { type: 'array', items: numArr } }, required: ['chunks', 'embeddings'] },
    isWriteOperation: true, module: 'rag', functionName: 'indexChunks', injectedParams: [],
  },
  {
    name: 'search_semantic', description: 'Pure vector similarity search.',
    inputSchema: { type: 'object', properties: { queryText: str, topK: { ...num, default: 10 } }, required: ['queryText'] },
    isWriteOperation: false, module: 'rag', functionName: 'searchSemantic', injectedParams: [],
  },
  {
    name: 'search_by_concept', description: 'Search chunks by concept (hybrid: structured + vector + memo).',
    inputSchema: { type: 'object', properties: { conceptId: str, topK: { ...num, default: 10 } }, required: ['conceptId'] },
    isWriteOperation: false, module: 'rag', functionName: 'searchByConcept', injectedParams: [],
  },
  {
    name: 'search_similar', description: 'Find similar papers by embedding.',
    inputSchema: { type: 'object', properties: { paperId: str, topK: { ...num, default: 10 } }, required: ['paperId'] },
    isWriteOperation: false, module: 'rag', functionName: 'searchSimilar', injectedParams: [],
  },
  {
    name: 'get_index_stats', description: 'Get chunk index statistics.',
    inputSchema: { type: 'object', properties: {} },
    isWriteOperation: false, module: 'rag', functionName: 'getIndexStats', injectedParams: [],
  },
];

// ═══ Bibliography Tools (9) ═══

const bibliographyTools: RawToolDef[] = [
  {
    name: 'enrich_bibliography', description: 'Enrich paper metadata via CrossRef API.',
    inputSchema: { type: 'object', properties: { metadata: { type: 'object', description: 'PaperMetadata with doi' } }, required: ['metadata'] },
    isWriteOperation: false, module: 'bibliography', functionName: 'enrichBibliography', injectedParams: [],
  },
  {
    name: 'import_bibtex', description: 'Parse BibTeX string into imported entries.',
    inputSchema: { type: 'object', properties: { bibtexString: str }, required: ['bibtexString'] },
    isWriteOperation: false, module: 'bibliography', functionName: 'importBibtex', injectedParams: [],
  },
  {
    name: 'import_ris', description: 'Parse RIS string into imported entries.',
    inputSchema: { type: 'object', properties: { risString: str }, required: ['risString'] },
    isWriteOperation: false, module: 'bibliography', functionName: 'importRis', injectedParams: [],
  },
  {
    name: 'export_bibtex', description: 'Export papers as BibTeX string.',
    inputSchema: { type: 'object', properties: { papers: { type: 'array', items: { type: 'object' } } }, required: ['papers'] },
    isWriteOperation: false, module: 'bibliography', functionName: 'exportBibtex', injectedParams: [],
  },
  {
    name: 'export_ris', description: 'Export papers as RIS string.',
    inputSchema: { type: 'object', properties: { papers: { type: 'array', items: { type: 'object' } } }, required: ['papers'] },
    isWriteOperation: false, module: 'bibliography', functionName: 'exportRis', injectedParams: [],
  },
  {
    name: 'format_citation', description: 'Format citations using CSL engine.',
    inputSchema: { type: 'object', properties: { papers: { type: 'array', items: { type: 'object' } } }, required: ['papers'] },
    isWriteOperation: false, module: 'bibliography', functionName: 'formatCitation', injectedParams: [],
  },
  {
    name: 'format_bibliography', description: 'Format full bibliography list.',
    inputSchema: { type: 'object', properties: { papers: { type: 'array', items: { type: 'object' } }, format: { ...str, enum: ['html', 'text'], default: 'text' } }, required: ['papers'] },
    isWriteOperation: false, module: 'bibliography', functionName: 'formatBibliography', injectedParams: [],
  },
  {
    name: 'check_biblio_completeness', description: 'Check bibliography completeness for a paper.',
    inputSchema: { type: 'object', properties: { metadata: { type: 'object' }, cslStyleId: str }, required: ['metadata', 'cslStyleId'] },
    isWriteOperation: false, module: 'bibliography', functionName: 'checkBiblioCompleteness', injectedParams: [],
  },
  {
    name: 'parse_references', description: 'Parse raw reference text strings into structured entries.',
    inputSchema: { type: 'object', properties: { rawTexts: strArr }, required: ['rawTexts'] },
    isWriteOperation: false, module: 'bibliography', functionName: 'parseReferences', injectedParams: [],
  },
];

// ═══ System Tools (1) ═══

const systemTools: RawToolDef[] = [
  {
    name: 'abyssal_health_check', description: 'Returns the current status of all Abyssal subsystems.',
    inputSchema: { type: 'object', properties: {} },
    isWriteOperation: false, module: 'system', functionName: 'healthCheck', injectedParams: [],
  },
];

// ═══ 导出全部 Tool 定义 ═══

/** 自动从 inputSchema.properties 派生 paramOrder（如未显式设置） */
function ensureParamOrder(tool: RawToolDef): ToolDefinition {
  return {
    ...tool,
    paramOrder: tool.paramOrder ?? Object.keys(tool.inputSchema.properties),
  };
}

export function getToolDefinitions(): ToolDefinition[] {
  const raw: RawToolDef[] = [
    ...searchTools,
    ...acquireTools,
    ...processTools,
    ...databaseTools,
    ...ragTools,
    ...bibliographyTools,
    ...systemTools,
  ];
  return raw.map(ensureParamOrder);
}

/** 获取 Tool 定义 Map（name → definition） */
export function getToolMap(): Map<string, ToolDefinition> {
  const map = new Map<string, ToolDefinition>();
  for (const tool of getToolDefinitions()) {
    map.set(tool.name, tool);
  }
  return map;
}
