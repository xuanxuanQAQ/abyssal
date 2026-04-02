import { describe, it, expect } from 'vitest';
import { CostTracker } from './cost-tracker';

describe('CostTracker', () => {
  it('records a call and computes cost correctly', () => {
    const tracker = new CostTracker();
    const record = tracker.record({
      model: 'claude-sonnet-4',
      provider: 'anthropic',
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      durationMs: 5000,
      workflowId: 'analyze',
    });

    // claude-sonnet-4: input $3/1M, output $15/1M
    expect(record.inputCost).toBeCloseTo(3.0, 2);
    expect(record.outputCost).toBeCloseTo(1.5, 2);
    expect(record.totalCost).toBeCloseTo(4.5, 2);
  });

  it('aggregates by model and workflow', () => {
    const tracker = new CostTracker();
    tracker.record({ model: 'deepseek-chat', provider: 'deepseek', inputTokens: 500_000, outputTokens: 50_000, durationMs: 2000, workflowId: 'discover' });
    tracker.record({ model: 'deepseek-chat', provider: 'deepseek', inputTokens: 300_000, outputTokens: 30_000, durationMs: 1500, workflowId: 'discover' });
    tracker.record({ model: 'claude-opus-4', provider: 'anthropic', inputTokens: 100_000, outputTokens: 10_000, durationMs: 8000, workflowId: 'analyze' });

    const stats = tracker.getCostStats();
    expect(stats.session.callCount).toBe(3);
    expect(stats.byModel['deepseek-chat']!.callCount).toBe(2);
    expect(stats.byModel['claude-opus-4']!.callCount).toBe(1);
    expect(stats.byWorkflow['discover']!.callCount).toBe(2);
    expect(stats.byWorkflow['analyze']!.callCount).toBe(1);
  });

  it('treats local models as free', () => {
    const tracker = new CostTracker();
    const record = tracker.record({
      model: 'vllm/qwen2.5:14b',
      provider: 'vllm',
      inputTokens: 10_000_000,
      outputTokens: 1_000_000,
      durationMs: 60000,
    });

    expect(record.inputCost).toBe(0);
    expect(record.outputCost).toBe(0);
    expect(record.totalCost).toBe(0);
  });

  it('recentCalls returns last 20 entries', () => {
    const tracker = new CostTracker();
    for (let i = 0; i < 25; i++) {
      tracker.record({ model: 'deepseek-chat', provider: 'deepseek', inputTokens: 100, outputTokens: 10, durationMs: 100 });
    }

    const stats = tracker.getCostStats();
    expect(stats.recentCalls.length).toBe(20);
  });
});
