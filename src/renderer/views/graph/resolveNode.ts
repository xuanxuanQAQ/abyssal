export type GraphNodeType = 'paper' | 'concept' | 'memo' | 'note';

export function resolveNodeType(attributes: Record<string, unknown>): GraphNodeType {
  const rawType = typeof attributes.nodeType === 'string'
    ? attributes.nodeType
    : typeof attributes.type === 'string'
      ? attributes.type
      : 'paper';
  if (rawType === 'concept' || rawType === 'memo' || rawType === 'note') {
    return rawType;
  }
  return 'paper';
}

export function resolveNodeLabel(attributes: Record<string, unknown>, fallbackIndex: number): string {
  const label = typeof attributes.label === 'string' ? attributes.label.trim() : '';
  if (label) {
    return label;
  }

  const nodeType = resolveNodeType(attributes);
  switch (nodeType) {
    case 'concept': return `Concept ${fallbackIndex}`;
    case 'memo': return `Memo ${fallbackIndex}`;
    case 'note': return `Note ${fallbackIndex}`;
    default: return `Paper ${fallbackIndex}`;
  }
}
