/**
 * IPC handler: advisory namespace
 *
 * Delegates to AdvisoryAgent for diagnostic suggestions.
 * Maps FormattedSuggestion to IPC contract types (Recommendation, AdvisoryNotification).
 */

import type { AppContext } from '../app-context';
import { typedHandler } from './register';
import type { FormattedSuggestion, SuggestionAction } from '../../adapter/advisory-agent/suggestion-types';
import type { RecommendationType, AdvisoryNotificationType } from '../../shared-types/enums';
import type { WorkflowType } from '../../adapter/orchestrator/workflow-runner';

/**
 * diagnosticSource → RecommendationType 映射
 *
 * 12 种诊断源映射到 6 种前端 Recommendation 类型。
 */
function mapRecommendationType(source: string | undefined): RecommendationType {
  switch (source) {
    case 'concept_coverage_low':  return 'add_paper';
    case 'mapping_unreviewed':    return 'review_mapping';
    case 'mapping_quality_low':   return 'review_mapping';
    case 'acquire_failures':      return 'fill_evidence_gap';
    case 'analyze_failures':      return 'fill_evidence_gap';
    case 'synthesis_missing':     return 'fill_evidence_gap';
    case 'writing_dependency':    return 'fill_evidence_gap';
    case 'concept_suggestion':    return 'add_paper';
    case 'definition_unstable':   return 'split_concept';
    case 'maturity_upgrade':      return 'general';
    case 'unindexed_memos':       return 'general';
    case 'concept_conflict':      return 'merge_concepts';
    default:                      return 'general';
  }
}

/**
 * diagnosticSource → AdvisoryNotificationType 映射
 */
function mapNotificationType(source: string | undefined): AdvisoryNotificationType {
  switch (source) {
    case 'concept_coverage_low':  return 'coverage_gap';
    case 'concept_suggestion':    return 'concept_suggestion';
    case 'maturity_upgrade':      return 'maturity_upgrade';
    case 'mapping_quality_low':   return 'high_rejection';
    case 'synthesis_missing':     return 'stale_synthesis';
    default:                      return 'coverage_gap';
  }
}

function buildActionLabel(action: SuggestionAction): string {
  if (action.type === 'workflow') return `Run ${action.workflowType}`;
  if (action.type === 'navigate') return 'View';
  return 'Execute';
}

/** 缓存已生成的 Recommendation ID → FormattedSuggestion 映射，供 execute 使用 */
const suggestionCache = new Map<string, FormattedSuggestion>();

export function registerAdvisoryHandlers(ctx: AppContext): void {
  const { logger } = ctx;

  typedHandler('advisory:getRecommendations', logger, async () => {
    if (!ctx.advisoryAgent) return [];

    try {
      const suggestions = ctx.advisoryAgent.getLatestSuggestions();
      const formatted = suggestions.length > 0
        ? suggestions
        : await ctx.advisoryAgent.generateSuggestions();

      // Clear stale cache before populating with fresh results
      suggestionCache.clear();
      return formatted.map((s, i) => {
        const id = `adv-${Date.now()}-${i}`;
        suggestionCache.set(id, s);
        return {
          id,
          type: mapRecommendationType(s.diagnosticSource),
          title: s.title,
          description: s.description,
          evidence: [] as string[],
          actionLabel: buildActionLabel(s.action),
        };
      });
    } catch (err) {
      logger.warn('Advisory getRecommendations failed', { error: (err as Error).message });
      return [];
    }
  });

  typedHandler('advisory:execute', logger, async (_e, id) => {
    const suggestion = suggestionCache.get(id);
    if (!suggestion) {
      logger.warn('Advisory execute: suggestion not found in cache', { id });
      return id;
    }

    const { action } = suggestion;
    logger.info('Advisory execute', { id, actionType: action.type });

    if (action.type === 'workflow' && action.workflowType) {
      // 触发工作流（通过 orchestrator）
      try {
        if (ctx.orchestrator) {
          ctx.orchestrator.start(action.workflowType as WorkflowType, action.workflowOptions ?? {});
        }
      } catch (err) {
        logger.warn('Advisory workflow execution failed', { error: (err as Error).message });
      }
    } else if (action.type === 'navigate' && action.route) {
      // 导航动作：通过 push 通知前端路由
      ctx.pushManager?.pushAdvisoryNavigate({ route: action.route });
    }

    suggestionCache.delete(id);
    return id;
  });

  typedHandler('advisory:getNotifications', logger, async () => {
    if (!ctx.advisoryAgent) return [];

    const suggestions = ctx.advisoryAgent.getLatestSuggestions();
    return suggestions
      .filter((s) => s.priority === 'high')
      .map((s, i) => ({
        id: `notif-${Date.now()}-${i}`,
        type: mapNotificationType(s.diagnosticSource),
        title: s.title,
        description: s.description,
        actionLabel: buildActionLabel(s.action),
      }));
  });
}
