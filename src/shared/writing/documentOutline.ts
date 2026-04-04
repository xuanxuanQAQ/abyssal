import type { JSONContent } from '@tiptap/core';
import type { SectionOrder } from '../../shared-types/models';

export interface ProjectedSection {
  id: string;
  title: string;
  level: number;
  depth: number;
  parentId: string | null;
  sortIndex: number;
  wordCount: number;
  startIndex: number;
  bodyStartIndex: number;
  bodyEndIndex: number;
  subtreeEndIndex: number;
  bodyDocument: JSONContent;
  plainText: string;
  children: ProjectedSection[];
}

export interface DocumentProjection {
  document: JSONContent;
  flatSections: ProjectedSection[];
  rootSections: ProjectedSection[];
}

export interface SectionContinuityContext {
  section: ProjectedSection | null;
  precedingSummary: string;
  followingSectionTitles: string[];
}

type JsonNode = JSONContent;

function cloneNode<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createEmptyArticleDocument(): JSONContent {
  return {
    type: 'doc',
    content: [{ type: 'paragraph' }],
  };
}

export function parseArticleDocument(documentJson: string | null | undefined): JSONContent {
  if (!documentJson) return createEmptyArticleDocument();
  try {
    const parsed = JSON.parse(documentJson) as JSONContent;
    if (parsed?.type !== 'doc' || !Array.isArray(parsed.content)) {
      return createEmptyArticleDocument();
    }
    return parsed;
  } catch {
    return createEmptyArticleDocument();
  }
}

export function serializeArticleDocument(document: JSONContent): string {
  return JSON.stringify(document);
}

export function contentHash(json: JSONContent): string {
  const str = JSON.stringify(json);
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

function isOutlineHeading(node: JSONContent | undefined): boolean {
  if (!node || node.type !== 'heading') return false;
  const level = Number(node.attrs?.level ?? 0);
  return level >= 1 && level <= 3;
}

function clampHeadingLevel(level: number): number {
  return Math.max(1, Math.min(6, level));
}

function createHeadingNode(level: number, sectionId: string, title: string): JSONContent {
  return {
    type: 'heading',
    attrs: {
      level: clampHeadingLevel(level),
      sectionId,
    },
    content: title.trim().length > 0
      ? [{ type: 'text', text: title }]
      : [{ type: 'text', text: '未命名节' }],
  };
}

export function createBodyDocumentFromText(text: string): JSONContent {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return { type: 'doc', content: [{ type: 'paragraph' }] };
  }

  return {
    type: 'doc',
    content: lines.map((line) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: line }],
    })),
  };
}

export function extractTextContent(node: JsonNode | undefined): string {
  if (!node) return '';
  if (typeof node.text === 'string') return node.text;
  if (!Array.isArray(node.content)) return '';
  return node.content.map((child) => extractTextContent(child)).join('');
}

export function extractPlainText(nodes: JsonNode[]): string {
  const parts: string[] = [];
  for (const node of nodes) {
    const text = extractTextContent(node).trim();
    if (text.length > 0) parts.push(text);
  }
  return parts.join('\n\n');
}

function countWords(text: string): number {
  const normalized = text.trim();
  if (normalized.length === 0) return 0;
  return normalized.split(/\s+/).length;
}

function truncateSectionSummary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}...`;
}

export function ensureOutlineHeadingIds(
  inputDocument: JSONContent,
  idFactory: () => string,
): { document: JSONContent; changed: boolean } {
  const document = cloneNode(inputDocument?.type === 'doc' ? inputDocument : createEmptyArticleDocument());
  const content = Array.isArray(document.content) ? document.content : [];

  let changed = false;
  for (const node of content) {
    if (!isOutlineHeading(node)) continue;
    const sectionId = typeof node.attrs?.sectionId === 'string' ? node.attrs.sectionId : '';
    if (sectionId.length > 0) continue;
    node.attrs = {
      ...(node.attrs ?? {}),
      sectionId: idFactory(),
    };
    changed = true;
  }

  if (!Array.isArray(document.content) || document.content.length === 0) {
    document.content = [{ type: 'paragraph' }];
    changed = true;
  }

  return { document, changed };
}

export function buildDocumentProjection(inputDocument: JSONContent): DocumentProjection {
  const document = inputDocument?.type === 'doc' ? inputDocument : createEmptyArticleDocument();
  const content = Array.isArray(document.content) ? document.content : [];
  const flatSections: ProjectedSection[] = [];
  const siblingCounter = new Map<string | null, number>();
  const stack: ProjectedSection[] = [];

  const headingIndices: number[] = [];
  for (let index = 0; index < content.length; index += 1) {
    if (isOutlineHeading(content[index])) headingIndices.push(index);
  }

  for (let index = 0; index < headingIndices.length; index += 1) {
    const startIndex = headingIndices[index]!;
    const headingNode = content[startIndex]!;
    const nextHeadingIndex = headingIndices[index + 1] ?? content.length;
    const level = clampHeadingLevel(Number(headingNode.attrs?.level ?? 1));
    const sectionId = String(headingNode.attrs?.sectionId ?? '');
    const title = extractTextContent(headingNode).trim() || '未命名节';

    while (stack.length > 0 && stack[stack.length - 1]!.level >= level) {
      stack.pop();
    }

    const parent = stack[stack.length - 1] ?? null;
    const parentId = parent?.id ?? null;
    const sortIndex = siblingCounter.get(parentId) ?? 0;
    siblingCounter.set(parentId, sortIndex + 1);

    const bodyNodes = content.slice(startIndex + 1, nextHeadingIndex).map((node) => cloneNode(node));
    const bodyDocument: JSONContent = {
      type: 'doc',
      content: bodyNodes.length > 0 ? bodyNodes : [{ type: 'paragraph' }],
    };
    const plainText = extractPlainText(bodyNodes);

    const projected: ProjectedSection = {
      id: sectionId,
      title,
      level,
      depth: level - 1,
      parentId,
      sortIndex,
      wordCount: countWords(plainText),
      startIndex,
      bodyStartIndex: startIndex + 1,
      bodyEndIndex: nextHeadingIndex - 1,
      subtreeEndIndex: content.length - 1,
      bodyDocument,
      plainText,
      children: [],
    };

    if (parent) parent.children.push(projected);
    flatSections.push(projected);
    stack.push(projected);
  }

  for (let index = 0; index < flatSections.length; index += 1) {
    const current = flatSections[index]!;
    for (let nextIndex = index + 1; nextIndex < flatSections.length; nextIndex += 1) {
      const candidate = flatSections[nextIndex]!;
      if (candidate.level <= current.level) {
        current.subtreeEndIndex = candidate.startIndex - 1;
        break;
      }
    }
  }

  return {
    document,
    flatSections,
    rootSections: flatSections.filter((section) => section.parentId === null),
  };
}

export function buildSectionContinuityContext(
  inputDocument: JSONContent,
  sectionId: string,
  options?: {
    followingLimit?: number;
    summaryMaxChars?: number;
  },
): SectionContinuityContext {
  const projection = buildDocumentProjection(inputDocument);
  const sectionIndex = projection.flatSections.findIndex((candidate) => candidate.id === sectionId);

  if (sectionIndex < 0) {
    return {
      section: null,
      precedingSummary: '',
      followingSectionTitles: [],
    };
  }

  const followingLimit = options?.followingLimit ?? 5;
  const summaryMaxChars = options?.summaryMaxChars ?? 240;
  const section = projection.flatSections[sectionIndex] ?? null;
  const previous = sectionIndex > 0 ? projection.flatSections[sectionIndex - 1] ?? null : null;
  const precedingSummary = previous && previous.plainText.trim().length > 0
    ? `${previous.title}: ${truncateSectionSummary(previous.plainText.replace(/\s+/g, ' ').trim(), summaryMaxChars)}`
    : '';
  const followingSectionTitles = projection.flatSections
    .slice(sectionIndex + 1, sectionIndex + 1 + followingLimit)
    .map((candidate) => candidate.title);

  return {
    section,
    precedingSummary,
    followingSectionTitles,
  };
}

function replaceRange(
  content: JSONContent[],
  fromIndex: number,
  toIndex: number,
  replacement: JSONContent[],
): JSONContent[] {
  const next = content.map((node) => cloneNode(node));
  next.splice(fromIndex, Math.max(0, toIndex - fromIndex + 1), ...replacement.map((node) => cloneNode(node)));
  return next.length > 0 ? next : [{ type: 'paragraph' }];
}

export function renameSectionInDocument(
  inputDocument: JSONContent,
  sectionId: string,
  title: string,
): JSONContent {
  const document = cloneNode(inputDocument);
  const projection = buildDocumentProjection(document);
  const section = projection.flatSections.find((candidate) => candidate.id === sectionId);
  if (!section || !Array.isArray(document.content)) return document;
  document.content[section.startIndex] = createHeadingNode(section.level, section.id, title);
  return document;
}

export function replaceSectionBodyInDocument(
  inputDocument: JSONContent,
  sectionId: string,
  bodyDocument: JSONContent,
): JSONContent {
  const document = cloneNode(inputDocument);
  const projection = buildDocumentProjection(document);
  const section = projection.flatSections.find((candidate) => candidate.id === sectionId);
  if (!section || !Array.isArray(document.content)) return document;

  const replacement = Array.isArray(bodyDocument.content) && bodyDocument.content.length > 0
    ? bodyDocument.content
    : [{ type: 'paragraph' }];

  document.content = replaceRange(
    document.content,
    section.bodyStartIndex,
    Math.max(section.bodyStartIndex - 1, section.bodyEndIndex),
    replacement,
  );
  return document;
}

export function insertSectionInDocument(
  inputDocument: JSONContent,
  args: {
    parentId: string | null;
    sortIndex: number;
    title: string;
    idFactory: () => string;
  },
): JSONContent {
  const document = cloneNode(inputDocument);
  const projection = buildDocumentProjection(document);
  const content = Array.isArray(document.content) ? document.content.map((node) => cloneNode(node)) : [];

  const parent = args.parentId
    ? projection.flatSections.find((section) => section.id === args.parentId) ?? null
    : null;
  const level = parent ? Math.min(parent.level + 1, 3) : 1;
  const siblings = projection.flatSections
    .filter((section) => section.parentId === args.parentId)
    .sort((left, right) => left.sortIndex - right.sortIndex);

  let insertIndex = content.length;
  if (siblings.length > 0) {
    if (args.sortIndex <= 0) {
      insertIndex = siblings[0]!.startIndex;
    } else if (args.sortIndex >= siblings.length) {
      insertIndex = siblings[siblings.length - 1]!.subtreeEndIndex + 1;
    } else {
      insertIndex = siblings[args.sortIndex]!.startIndex;
    }
  } else if (parent) {
    insertIndex = parent.bodyEndIndex + 1;
  }

  const sectionId = args.idFactory();
  content.splice(
    insertIndex,
    0,
    createHeadingNode(level, sectionId, args.title || '新节'),
    { type: 'paragraph' },
  );

  document.content = content;
  return document;
}

export function deleteSectionFromDocument(
  inputDocument: JSONContent,
  sectionId: string,
): JSONContent {
  const document = cloneNode(inputDocument);
  const projection = buildDocumentProjection(document);
  const section = projection.flatSections.find((candidate) => candidate.id === sectionId);
  if (!section || !Array.isArray(document.content)) return document;

  document.content = replaceRange(document.content, section.startIndex, section.subtreeEndIndex, []);
  return document;
}

function adjustHeadingLevels(nodes: JSONContent[], delta: number): JSONContent[] {
  const walk = (node: JSONContent): JSONContent => {
    const next = cloneNode(node);
    if (next.type === 'heading') {
      next.attrs = {
        ...(next.attrs ?? {}),
        level: clampHeadingLevel(Number(next.attrs?.level ?? 1) + delta),
      };
    }
    if (Array.isArray(next.content)) {
      next.content = next.content.map((child) => walk(child));
    }
    return next;
  };

  return nodes.map((node) => walk(node));
}

export function reorderSectionsInDocument(
  inputDocument: JSONContent,
  order: SectionOrder[],
): JSONContent {
  const document = cloneNode(inputDocument);
  const projection = buildDocumentProjection(document);
  const content = Array.isArray(document.content) ? document.content : [];
  if (projection.flatSections.length === 0 || order.length === 0) return document;

  const firstOutlineIndex = projection.flatSections[0]!.startIndex;
  const prefixNodes = content.slice(0, firstOutlineIndex).map((node) => cloneNode(node));
  const sectionsById = new Map(projection.flatSections.map((section) => [section.id, section]));
  const ownBlocks = new Map<string, JSONContent[]>();

  for (const section of projection.flatSections) {
    ownBlocks.set(
      section.id,
      content.slice(section.startIndex, section.bodyEndIndex + 1).map((node) => cloneNode(node)),
    );
  }

  const completeOrder = [...order];
  for (const section of projection.flatSections) {
    if (!completeOrder.some((entry) => entry.sectionId === section.id)) {
      completeOrder.push({
        sectionId: section.id,
        parentId: section.parentId,
        sortIndex: section.sortIndex,
      });
    }
  }

  const childrenByParent = new Map<string | null, SectionOrder[]>();
  for (const entry of completeOrder) {
    const list = childrenByParent.get(entry.parentId) ?? [];
    list.push(entry);
    childrenByParent.set(entry.parentId, list);
  }
  for (const list of childrenByParent.values()) {
    list.sort((left, right) => left.sortIndex - right.sortIndex);
  }

  const renderSection = (sectionId: string, level: number): JSONContent[] => {
    const original = sectionsById.get(sectionId);
    const ownBlock = ownBlocks.get(sectionId) ?? [];
    if (!original || ownBlock.length === 0) return [];

    const delta = level - original.level;
    const adjustedOwn = adjustHeadingLevels(ownBlock, delta);
    const rendered = [...adjustedOwn];

    const children = childrenByParent.get(sectionId) ?? [];
    for (const child of children) {
      rendered.push(...renderSection(child.sectionId, Math.min(level + 1, 3)));
    }

    return rendered;
  };

  const nextContent = [...prefixNodes];
  const roots = childrenByParent.get(null) ?? [];
  for (const root of roots) {
    nextContent.push(...renderSection(root.sectionId, 1));
  }

  document.content = nextContent.length > 0 ? nextContent : [{ type: 'paragraph' }];
  return document;
}
