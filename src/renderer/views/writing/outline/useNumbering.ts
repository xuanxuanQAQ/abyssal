/**
 * useNumbering -- DFS section numbering (max 4 numeric levels)
 *
 * Depths 0-3 produce dotted numbers (e.g. "2.1.3").
 * Depth >= 4 switches to letter suffix   (e.g. "2.1.3.1.a").
 */

import type { SectionNode } from '../../../../shared-types/models';

export interface NumberingMap {
  [sectionId: string]: string;
}

export function computeNumbering(sections: SectionNode[]): NumberingMap {
  const result: NumberingMap = {};

  function dfs(nodes: SectionNode[], prefix: string, depth: number): void {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;
      let numbering: string;
      if (depth < 4) {
        numbering = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
      } else {
        // depth >= 4: use letter suffix (a-z, wraps after 26)
        const letter = String.fromCharCode(97 + (i % 26));
        numbering = `${prefix}.${letter}`;
      }
      result[node.id] = numbering;
      if (node.children.length > 0) {
        dfs(node.children, numbering, depth + 1);
      }
    }
  }

  dfs(sections, '', 0);
  return result;
}
