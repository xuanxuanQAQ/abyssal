/**
 * IPC handler: advisory namespace
 *
 * Delegates to AdvisoryAgent for diagnostic suggestions.
 * Maps FormattedSuggestion to IPC contract types (Recommendation, AdvisoryNotification).
 */

import type { AppContext } from '../app-context';
import { typedHandler } from './register';

export function registerAdvisoryHandlers(ctx: AppContext): void {
  const { logger } = ctx;

  typedHandler('advisory:getRecommendations', logger, async () => {
    if (!ctx.advisoryAgent) return [];

    try {
      const suggestions = ctx.advisoryAgent.getLatestSuggestions();
      const formatted = suggestions.length > 0
        ? suggestions
        : await ctx.advisoryAgent.generateSuggestions();

      // Map FormattedSuggestion → Recommendation (IPC contract)
      return formatted.map((s, i) => ({
        id: `adv-${Date.now()}-${i}`,
        type: 'fill_evidence_gap' as const, // Map to closest Recommendation type
        title: s.title,
        description: s.description,
        evidence: [] as string[],
        actionLabel: s.action.type === 'workflow' ? `Run ${s.action.workflowType}`
          : s.action.type === 'navigate' ? 'View'
          : 'Execute',
      }));
    } catch (err) {
      logger.warn('Advisory getRecommendations failed', { error: (err as Error).message });
      return [];
    }
  });

  typedHandler('advisory:execute', logger, async (_e, id) => {
    logger.info('Advisory suggestion executed', { suggestionId: id });
    return id;
  });

  typedHandler('advisory:getNotifications', logger, async () => {
    if (!ctx.advisoryAgent) return [];

    const suggestions = ctx.advisoryAgent.getLatestSuggestions();
    return suggestions
      .filter((s) => s.priority === 'high')
      .map((s, i) => ({
        id: `notif-${Date.now()}-${i}`,
        type: 'coverage_gap' as const,
        title: s.title,
        description: s.description,
        actionLabel: s.action.type === 'workflow' ? `Run ${s.action.workflowType}` : 'View',
      }));
  });
}
