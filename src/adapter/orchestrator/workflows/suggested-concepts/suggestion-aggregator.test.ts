import { describe, it, expect, vi } from 'vitest';
import { aggregateSuggestions, type SuggestionDb, type PushNotifier } from './suggestion-aggregator';

function makeDb(overrides: Partial<SuggestionDb> = {}): SuggestionDb {
  return {
    getSuggestedConceptByTerm: vi.fn().mockResolvedValue(null),
    insertSuggestedConcept: vi.fn().mockResolvedValue(undefined),
    updateSuggestedConcept: vi.fn().mockResolvedValue(undefined),
    addSuggestedConcept: vi.fn().mockResolvedValue('new-id'),
    ...overrides,
  };
}

describe('aggregateSuggestions', () => {
  it('inserts new suggestion when term does not exist', async () => {
    const db = makeDb();
    const result = await aggregateSuggestions(
      [{ term: 'Embodied Cognition', termNormalized: 'embodied cognition', frequencyInPaper: 3, closestExisting: null, reason: 'test', suggestedDefinition: null, suggestedKeywords: null }],
      'paper1',
      db,
      null,
    );

    expect(result.newSuggestions).toBe(1);
    expect(db.addSuggestedConcept).toHaveBeenCalledTimes(1);
  });

  it('updates existing suggestion and aggregates paper count', async () => {
    const db = makeDb({
      getSuggestedConceptByTerm: vi.fn().mockResolvedValue({
        id: 'existing-1',
        source_paper_ids: '["paper0"]',
        frequency: 2,
      }),
    });

    const result = await aggregateSuggestions(
      [{ term: 'Embodied Cognition', termNormalized: 'embodied cognition', frequencyInPaper: 3, closestExisting: null, reason: 'test', suggestedDefinition: null, suggestedKeywords: null }],
      'paper1',
      db,
      null,
    );

    expect(result.updatedSuggestions).toBe(1);
    expect(db.updateSuggestedConcept).toHaveBeenCalledWith('existing-1', expect.objectContaining({
      source_paper_count: 2,
      frequency: 5,
    }));
  });

  it('updates frequency using the persisted suggested_concepts schema field', async () => {
    const db = makeDb({
      getSuggestedConceptByTerm: vi.fn().mockResolvedValue({
        id: 'existing-1',
        source_paper_ids: '["paper0"]',
        frequency: 2,
      }),
    });

    await aggregateSuggestions(
      [{ term: 'Embodied Cognition', termNormalized: 'embodied cognition', frequencyInPaper: 3, closestExisting: null, reason: 'test', suggestedDefinition: null, suggestedKeywords: null }],
      'paper1',
      db,
      null,
    );

    expect(db.updateSuggestedConcept).toHaveBeenCalledWith('existing-1', expect.objectContaining({
      source_paper_count: 2,
      frequency: 5,
    }));
  });

  it('skips if paper already in source_paper_ids', async () => {
    const db = makeDb({
      getSuggestedConceptByTerm: vi.fn().mockResolvedValue({
        id: 'existing-1',
        source_paper_ids: '["paper1"]',
        frequency: 3,
      }),
    });

    const result = await aggregateSuggestions(
      [{ term: 'Embodied Cognition', termNormalized: 'embodied cognition', frequencyInPaper: 3, closestExisting: null, reason: 'test', suggestedDefinition: null, suggestedKeywords: null }],
      'paper1',
      db,
      null,
    );

    expect(result.updatedSuggestions).toBe(0);
    expect(result.newSuggestions).toBe(0);
  });

  it('sends push notification when threshold is reached', async () => {
    const db = makeDb({
      getSuggestedConceptByTerm: vi.fn().mockResolvedValue({
        id: 'existing-1',
        source_paper_ids: '["paper0", "paper1"]',
        frequency: 5,
      }),
    });
    const notifier: PushNotifier = { pushNotification: vi.fn() };

    const result = await aggregateSuggestions(
      [{ term: 'New Concept', termNormalized: 'new concept', frequencyInPaper: 2, closestExisting: null, reason: 'test', suggestedDefinition: null, suggestedKeywords: null }],
      'paper2',
      db,
      notifier,
      3, // threshold
    );

    expect(result.notificationsSent).toBe(1);
    expect(notifier.pushNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'concept_suggestion',
    }));
  });

  it('retries on UNIQUE constraint violation (concurrent write race)', async () => {
    let insertCallCount = 0;
    const db = makeDb({
      getSuggestedConceptByTerm: vi.fn().mockImplementation(async () => {
        // First call: returns null (not found), second call: returns existing (after race)
        insertCallCount++;
        if (insertCallCount <= 1) return null;
        return { id: 'race-winner', source_paper_ids: '["paper0"]', frequency: 1 };
      }),
      addSuggestedConcept: vi.fn().mockRejectedValue(new Error('UNIQUE constraint failed')),
    });

    const result = await aggregateSuggestions(
      [{ term: 'Race Condition', termNormalized: 'race condition', frequencyInPaper: 1, closestExisting: null, reason: 'test', suggestedDefinition: null, suggestedKeywords: null }],
      'paper1',
      db,
      null,
    );

    // Should have retried and found the existing record
    expect(result.updatedSuggestions).toBe(1);
    expect(db.updateSuggestedConcept).toHaveBeenCalledWith('race-winner', expect.objectContaining({
      source_paper_count: 2,
    }));
  });
});
