export interface CrossPageInfo {
  isCrossPage: boolean;
  startPage: number;
  endPage: number;
}

function findPageNumber(node: Node): number {
  let el: Element | null =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node.parentElement;

  while (el) {
    const pageAttr = el.getAttribute('data-page');
    if (pageAttr !== null) {
      const num = parseInt(pageAttr, 10);
      if (Number.isFinite(num)) {
        return num;
      }
    }
    el = el.parentElement;
  }
  return -1;
}

export function detectCrossPageSelection(range: Range): CrossPageInfo {
  const startPage = findPageNumber(range.startContainer);
  const endPage = findPageNumber(range.endContainer);

  if (startPage === -1 || endPage === -1) {
    return {
      isCrossPage: false,
      startPage: Math.max(startPage, endPage),
      endPage: Math.max(startPage, endPage),
    };
  }

  return {
    isCrossPage: startPage !== endPage,
    startPage: Math.min(startPage, endPage),
    endPage: Math.max(startPage, endPage),
  };
}

export function generateGroupId(): string {
  return crypto.randomUUID();
}
