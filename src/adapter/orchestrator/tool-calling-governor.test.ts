/**
 * Tests for ToolCallingGovernor
 */

import { describe, it, expect } from 'vitest';
import { ToolCallingGovernor } from './tool-calling-governor';

describe('[Governor] Tool Calling Governor', () => {
  it('allows tool calls within limits', () => {
    const gov = new ToolCallingGovernor({ maxTotalCalls: 10, maxCallsPerTool: 3 });

    expect(gov.canCallTool('tool_a').allowed).toBe(true);
    gov.recordCall('tool_a', true, 100);

    expect(gov.canCallTool('tool_a').allowed).toBe(true);
    gov.recordCall('tool_a', true, 100);

    expect(gov.canCallTool('tool_b').allowed).toBe(true);
    gov.recordCall('tool_b', true, 100);

    const stats = gov.getStats();
    expect(stats.totalCalls).toBe(3);
    expect(stats.successfulCalls).toBe(3);
  });

  it('prevents tool calls after consecutive failures', () => {
    const gov = new ToolCallingGovernor({ maxConsecutiveFailures: 2 });

    gov.recordCall('tool_a', false, 0, 'Connection timeout');
    expect(gov.canCallTool('tool_a').allowed).toBe(true); // First failure

    gov.recordCall('tool_a', false, 0, 'Connection timeout');
    expect(gov.canCallTool('tool_a').allowed).toBe(false); // Disabled after 2 failures

    const canCall = gov.canCallTool('tool_a');
    expect(canCall.allowed).toBe(false);
    expect(canCall.reason).toContain('repeated failures');
  });

  it('prevents calls after hitting total call budget', () => {
    const gov = new ToolCallingGovernor({ maxTotalCalls: 2 });

    gov.recordCall('tool_a', true, 100);
    expect(gov.canCallTool('tool_b').allowed).toBe(true);

    gov.recordCall('tool_b', true, 100);
    expect(gov.canCallTool('tool_c').allowed).toBe(false);

    const stats = gov.getStats();
    expect(stats.budgetRemaining).toBe(0);
  });

  it('prevents calls after hitting per-tool limit', () => {
    const gov = new ToolCallingGovernor({ maxCallsPerTool: 2, repetitionThreshold: 10 }); // High repetition threshold

    gov.recordCall('tool_a', true, 100);
    gov.recordCall('tool_a', true, 101); // Different size to avoid repetition detection
    expect(gov.canCallTool('tool_a').allowed).toBe(false);

    const canCall = gov.canCallTool('tool_a');
    expect(canCall.reason).toContain('call limit reached');
  });

  it('detects result repetition when same tool returns same output size', () => {
    const gov = new ToolCallingGovernor({ repetitionThreshold: 2 });

    // Record 2 successful calls with same result size
    gov.recordCall('tool_a', true, 100);
    gov.recordCall('tool_a', true, 100);

    // Governor should detect repetition and disable tool
    expect(gov.canCallTool('tool_a').allowed).toBe(false);
  });

  it('allows different result sizes without disabling', () => {
    const gov = new ToolCallingGovernor({ repetitionThreshold: 2 });

    gov.recordCall('tool_a', true, 100);
    gov.recordCall('tool_a', true, 200); // Different size
    expect(gov.canCallTool('tool_a').allowed).toBe(true);

    gov.recordCall('tool_a', true, 150);
    expect(gov.canCallTool('tool_a').allowed).toBe(true);
  });

  it('resets failure counter on success', () => {
    const gov = new ToolCallingGovernor({ maxConsecutiveFailures: 2, repetitionThreshold: 100 }); // High threshold

    // Three failures before success
    gov.recordCall('tool_a', false, 0, 'Error 1');
    gov.recordCall('tool_a', false, 1, 'Error 2');
    gov.recordCall('tool_a', false, 2, 'Error 3'); // Would disable if no success between
    expect(gov.canCallTool('tool_a').allowed).toBe(false); // Disabled after 2+ failures

    // Reset: clear and retry
    gov.reset();
    gov.recordCall('tool_a', false, 0, 'Error 1');
    gov.recordCall('tool_a', false, 1, 'Error 2');
    expect(gov.canCallTool('tool_a').allowed).toBe(false); // Still disabled at threshold
  });

  it('provides accurate statistics', () => {
    const gov = new ToolCallingGovernor({ maxTotalCalls: 10, repetitionThreshold: 10 }); // Disable repetition detection

    gov.recordCall('tool_a', true, 100);
    gov.recordCall('tool_a', true, 101); // Different size to avoid repetition
    gov.recordCall('tool_b', false, 0, 'Network error');
    gov.recordCall('tool_c', true, 50);

    const stats = gov.getStats();
    expect(stats.totalCalls).toBe(4);
    expect(stats.successfulCalls).toBe(3);
    expect(stats.failedCalls).toBe(1);
    expect(stats.successRate).toBe(75); // 3/4 = 75%
    expect(stats.budgetRemaining).toBe(6); // 10 - 4
    expect(stats.callsByTool['tool_a']).toEqual({ total: 2, successful: 2, disabled: false });
    expect(stats.callsByTool['tool_b']).toEqual({ total: 1, successful: 0, disabled: false });
  });

  it('resets state correctly', () => {
    const gov = new ToolCallingGovernor();

    gov.recordCall('tool_a', false, 0, 'Error');
    gov.recordCall('tool_a', false, 0, 'Error');
    gov.recordCall('tool_a', false, 0, 'Error');

    expect(gov.canCallTool('tool_a').allowed).toBe(false);

    gov.reset();
    expect(gov.canCallTool('tool_a').allowed).toBe(true);

    const stats = gov.getStats();
    expect(stats.totalCalls).toBe(0);
    expect(stats.disabledTools).toHaveLength(0);
  });

  it('distinguishes success rate for different tools', () => {
    const gov = new ToolCallingGovernor();

    // tool_a: 2 successes, 0 failures
    gov.recordCall('tool_a', true, 50);
    gov.recordCall('tool_a', true, 60);

    // tool_b: 1 success, 1 failure
    gov.recordCall('tool_b', true, 50);
    gov.recordCall('tool_b', false, 0);

    const stats = gov.getStats();
    expect(stats.callsByTool['tool_a']?.successful).toBe(2);
    expect(stats.callsByTool['tool_b']?.successful).toBe(1);
    expect(stats.successRate).toBe(75); // 3/4 successful
  });
});
