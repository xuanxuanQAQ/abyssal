const MAGIC = 0x41425347; // 'ABSG'

export interface DecodedGraphData {
  nodes: Array<{
    id: string;
    type: 'paper' | 'concept';
    label: string;
    relevance: number;
    citationCount: number;
    initialX: number;
    initialY: number;
    analysisStatus: number;
    conceptLevel: number;
  }>;
  edges: Array<{
    sourceIndex: number;
    targetIndex: number;
    layer: number;
    weight: number;
    conceptIdOffset: number;
  }>;
}

export function isValidBinaryFormat(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 16) {
    return false;
  }
  const view = new DataView(buffer);
  return view.getUint32(0, true) === MAGIC;
}

export function decodeBinaryGraphData(buffer: ArrayBuffer): DecodedGraphData {
  const view = new DataView(buffer);

  // Header (16 bytes)
  const magic = view.getUint32(0, true);
  if (magic !== MAGIC) {
    throw new Error(
      `Invalid magic number: expected 0x${MAGIC.toString(16)}, got 0x${magic.toString(16)}`,
    );
  }
  const nodeCount = view.getUint32(4, true);
  const edgeCount = view.getUint32(8, true);
  const stringPoolOffset = view.getUint32(12, true);

  // String Pool batch decode
  const stringPoolBytes = new Uint8Array(buffer, stringPoolOffset);
  const decoder = new TextDecoder();
  const allStrings = decoder.decode(stringPoolBytes);

  // Pre-scan for null bytes to build byte-offset to char-position mapping
  const charOffsets: number[] = [];
  let charPos = 0;
  for (let byteIdx = 0; byteIdx < stringPoolBytes.length; byteIdx++) {
    charOffsets.push(charPos);
    if (stringPoolBytes[byteIdx] === 0) {
      charPos++;
    } else {
      // Count the character contribution of this byte
      // For multi-byte UTF-8, only the first byte of a sequence advances the char position
      const byte = stringPoolBytes[byteIdx]!;
      if ((byte & 0xc0) !== 0x80) {
        // Not a continuation byte, this starts a new character
        charPos++;
      }
    }
  }
  charOffsets.push(charPos); // sentinel for end

  function extractString(byteOffset: number): string {
    const relOffset = byteOffset;
    const charStart = charOffsets[relOffset] ?? 0;
    // Find next null byte from this offset
    let endByteOffset = relOffset;
    while (endByteOffset < stringPoolBytes.length && stringPoolBytes[endByteOffset] !== 0) {
      endByteOffset++;
    }
    const charEnd = charOffsets[endByteOffset] ?? 0;
    return allStrings.substring(charStart, charEnd);
  }

  // Node Table: 24 bytes per node, starts at offset 16
  const nodeTableOffset = 16;
  const nodes: DecodedGraphData['nodes'] = [];

  for (let i = 0; i < nodeCount; i++) {
    const offset = nodeTableOffset + i * 24;

    const idOffset = view.getUint32(offset, true);
    const labelOffset = view.getUint32(offset + 4, true);
    const typeFlag = view.getUint8(offset + 8);
    const relevance = view.getUint8(offset + 9);
    const citationCount = view.getUint16(offset + 10, true);
    const initialX = view.getFloat32(offset + 12, true);
    const initialY = view.getFloat32(offset + 16, true);
    const analysisStatus = view.getUint8(offset + 20);
    const conceptLevel = view.getUint8(offset + 21);
    // bytes 22-23 reserved/padding

    nodes.push({
      id: extractString(idOffset),
      type: typeFlag === 0 ? 'paper' : 'concept',
      label: extractString(labelOffset),
      relevance,
      citationCount,
      initialX,
      initialY,
      analysisStatus,
      conceptLevel,
    });
  }

  // Edge Table: 16 bytes per edge
  const edgeTableOffset = nodeTableOffset + nodeCount * 24;
  const edges: DecodedGraphData['edges'] = [];

  for (let i = 0; i < edgeCount; i++) {
    const offset = edgeTableOffset + i * 16;

    const sourceIndex = view.getUint32(offset, true);
    const targetIndex = view.getUint32(offset + 4, true);
    const layer = view.getUint8(offset + 8);
    // bytes 9-11 reserved/padding
    const weight = view.getFloat32(offset + 12, true);

    edges.push({
      sourceIndex,
      targetIndex,
      layer,
      weight,
      conceptIdOffset: layer >= 2 ? view.getUint32(offset + 8, true) & 0xffffff00 : 0,
    });
  }

  return { nodes, edges };
}
