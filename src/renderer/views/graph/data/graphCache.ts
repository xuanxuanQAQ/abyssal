/**
 * graphCache — v1.2 已加载节点缓存
 *
 * 简单的内存缓存，跟踪已请求过的节点 ID 避免重复 IPC 调用。
 */

export class GraphCache {
  private loadedNodes = new Set<string>();
  private loadedEdgeKeys = new Set<string>();

  hasNode(nodeId: string): boolean {
    return this.loadedNodes.has(nodeId);
  }

  markNodeLoaded(nodeId: string): void {
    this.loadedNodes.add(nodeId);
  }

  hasEdge(edgeKey: string): boolean {
    return this.loadedEdgeKeys.has(edgeKey);
  }

  markEdgeLoaded(edgeKey: string): void {
    this.loadedEdgeKeys.add(edgeKey);
  }

  clear(): void {
    this.loadedNodes.clear();
    this.loadedEdgeKeys.clear();
  }

  get nodeCount(): number {
    return this.loadedNodes.size;
  }

  get edgeCount(): number {
    return this.loadedEdgeKeys.size;
  }
}
