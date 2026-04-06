/**
 * Tool Calling Governor — Controls and limits tool invocations to prevent excessive calling.
 *
 * Prevents AI from repeatedly calling tools when:
 * - Same tool fails multiple times consecutively
 * - Total tool calls exceed budget
 * - Tool returns diminishing results (same output for multiple calls)
 */

export interface ToolCallRecord {
  toolName: string;
  success: boolean;
  resultLength?: number;
  timestamp: number;
  error?: string;
}

export interface GovernorConfig {
  /** Max consecutive failures before disabling a tool (default: 3) */
  maxConsecutiveFailures: number;
  /** Max total tool calls per conversation (default: 20) */
  maxTotalCalls: number;
  /** Max calls for the same tool (default: 5) */
  maxCallsPerTool: number;
  /** Detect result repetition if output is same for N consecutive calls (default: 2) */
  repetitionThreshold: number;
  /**
   * Per-tool override limits. Tools not listed here use maxCallsPerTool.
   * Useful for restricting expensive tools (e.g., web search) to a lower budget.
   * Example: { 'search_semantic_scholar': 2, 'search_web': 3 }
   */
  perToolLimits?: Record<string, number>;
}

export class ToolCallingGovernor {
  private callHistory: ToolCallRecord[] = [];
  private disabledTools = new Set<string>();
  private readonly config: GovernorConfig;

  constructor(config?: Partial<GovernorConfig>) {
    this.config = {
      maxConsecutiveFailures: config?.maxConsecutiveFailures ?? 3,
      maxTotalCalls: config?.maxTotalCalls ?? 20,
      maxCallsPerTool: config?.maxCallsPerTool ?? 5,
      repetitionThreshold: config?.repetitionThreshold ?? 2,
    };
  }

  /**
   * Record a tool call result. Returns true if the call should be allowed, false if should be blocked.
   */
  recordCall(toolName: string, success: boolean, resultLength?: number, error?: string): void {
    this.callHistory.push({
      toolName,
      success,
      ...(resultLength !== undefined && { resultLength }),
      timestamp: Date.now(),
      ...(error !== undefined && { error }),
    });

    // Check if we should disable this tool
    this.updateDisabledTools();
  }

  /**
   * Check if a tool is allowed to be called.
   * Returns detailed reason if tool is blocked.
   */
  canCallTool(toolName: string): { allowed: boolean; reason?: string } {
    // Check if tool is explicitly disabled
    if (this.disabledTools.has(toolName)) {
      const lastFailure = this.getLastFailureForTool(toolName);
      return {
        allowed: false,
        reason: `Tool "${toolName}" disabled due to repeated failures: ${lastFailure?.error || 'unknown error'}`,
      };
    }

    // Check total call budget
    if (this.callHistory.length >= this.config.maxTotalCalls) {
      return {
        allowed: false,
        reason: `Tool call budget exhausted (${this.callHistory.length}/${this.config.maxTotalCalls})`,
      };
    }

    // Check per-tool call limit (individual override or default)
    const toolLimit = this.config.perToolLimits?.[toolName] ?? this.config.maxCallsPerTool;
    const callCountForTool = this.callHistory.filter((c) => c.toolName === toolName).length;
    if (callCountForTool >= toolLimit) {
      return {
        allowed: false,
        reason: `Tool "${toolName}" call limit reached (${callCountForTool}/${toolLimit})`,
      };
    }

    return { allowed: true };
  }

  /**
   * Get consecutive failure count for a tool (from most recent failures backward).
   */
  private getConsecutiveFailureCount(toolName: string): number {
    let count = 0;
    for (let i = this.callHistory.length - 1; i >= 0; i--) {
      const call = this.callHistory[i];
      if (!call) break; // Safety check
      if (call.toolName !== toolName) {
        break; // Stop at first different tool
      }
      if (!call.success) {
        count++;
      } else {
        break; // Stop at first success
      }
    }
    return count;
  }

  /**
   * Check for result repetition — same tool returning same size output multiple times.
   */
  private isResultRepeating(toolName: string): boolean {
    const recentCalls = this.callHistory
      .filter((c) => c.toolName === toolName && c.success)
      .slice(-this.config.repetitionThreshold);

    if (recentCalls.length < this.config.repetitionThreshold) {
      return false;
    }

    // Check if all recent calls have same result length (proxy for same output)
    const lengths = recentCalls.map((c) => c.resultLength ?? 0);
    const firstLength = lengths[0];
    return lengths.every((len) => len === firstLength && firstLength > 0);
  }

  /**
   * Update disabled tools based on failure count and repetition.
   */
  private updateDisabledTools(): void {
    const uniqueTools = new Set(this.callHistory.map((c) => c.toolName));

    for (const tool of uniqueTools) {
      if (this.disabledTools.has(tool)) continue; // Already disabled

      const consecutiveFailures = this.getConsecutiveFailureCount(tool);
      const isRepeating = this.isResultRepeating(tool);

      // Disable if: too many failures OR repeating results
      if (consecutiveFailures >= this.config.maxConsecutiveFailures || isRepeating) {
        this.disabledTools.add(tool);
      }
    }
  }

  /**
   * Get the last failure record for a tool.
   */
  private getLastFailureForTool(toolName: string): ToolCallRecord | null {
    for (let i = this.callHistory.length - 1; i >= 0; i--) {
      const call = this.callHistory[i];
      if (call && call.toolName === toolName && !call.success) {
        return call;
      }
    }
    return null;
  }

  /**
   * Get statistics about tool calling.
   */
  getStats() {
    const totalCalls = this.callHistory.length;
    const successfulCalls = this.callHistory.filter((c) => c && c.success).length;
    const failedCalls = totalCalls - successfulCalls;

    const callsByTool: Record<string, { total: number; successful: number; disabled: boolean }> = {};
    for (const call of this.callHistory) {
      if (!call) continue; // Skip undefined entries
      if (!callsByTool[call.toolName]) {
        callsByTool[call.toolName] = { total: 0, successful: 0, disabled: this.disabledTools.has(call.toolName) };
      }
      callsByTool[call.toolName]!.total++;
      if (call.success) {
        callsByTool[call.toolName]!.successful++;
      }
    }

    return {
      totalCalls,
      successfulCalls,
      failedCalls,
      successRate: totalCalls > 0 ? (successfulCalls / totalCalls) * 100 : 0,
      disabledTools: Array.from(this.disabledTools),
      callsByTool,
      budgetRemaining: Math.max(0, this.config.maxTotalCalls - totalCalls),
    };
  }

  /**
   * Reset governor state (e.g., for new conversation).
   */
  reset(): void {
    this.callHistory = [];
    this.disabledTools.clear();
  }

  /**
   * Get call history for debugging/logging.
   */
  getCallHistory(): ToolCallRecord[] {
    return [...this.callHistory];
  }
}
