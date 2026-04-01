/**
 * ResearchSession — persistent research session state.
 *
 * Tracks what the user is focused on, accumulates working memory
 * across all interactions, and maintains a research trajectory.
 *
 * Updated automatically by the EventBus: user navigation, paper opens,
 * text selections, pipeline completions all feed into this state.
 *
 * The SessionOrchestrator reads this to generate context-aware prompts
 * and proactive suggestions.
 */

import type { ViewType } from '../../shared-types/enums';
import type { EventBus, AppEvent } from '../event-bus';
import { WorkingMemory, type WorkingMemoryEntry } from './working-memory';

// ─── Types ───

export interface SessionFocus {
  /** Currently active UI view */
  currentView: ViewType;
  /** Papers the user has recently interacted with (most recent first, max 10) */
  activePapers: string[];
  /** Concepts the user has recently interacted with (most recent first, max 10) */
  activeConcepts: string[];
  /** If in reader view, the current reader state */
  readerState: {
    paperId: string;
    page: number;
    totalPages?: number;
    selection?: { text: string; page: number };
  } | null;
  /** Currently selected entity IDs by type */
  selected: {
    paperId: string | null;
    conceptId: string | null;
    noteId: string | null;
    articleId: string | null;
  };
}

export interface TrajectoryStep {
  action: string;
  timestamp: number;
  entityIds?: string[];
  result?: string;
}

export interface ResearchGoal {
  id: string;
  description: string;
  status: 'active' | 'completed' | 'abandoned';
  relatedEntities: string[];
  createdAt: number;
  completedAt?: number;
}

export interface SessionSnapshot {
  focus: SessionFocus;
  goals: ResearchGoal[];
  trajectory: TrajectoryStep[];
  memory: WorkingMemoryEntry[];
  startedAt: number;
}

// ─── Research Session ───

export class ResearchSession {
  readonly focus: SessionFocus;
  readonly memory: WorkingMemory;
  readonly goals: ResearchGoal[] = [];
  readonly trajectory: TrajectoryStep[] = [];
  readonly startedAt: number;

  private static readonly MAX_ACTIVE_PAPERS = 10;
  private static readonly MAX_ACTIVE_CONCEPTS = 10;
  private static readonly MAX_TRAJECTORY = 200;
  private eventBusHandle: { unsubscribe: () => void } | null = null;
  private readonly log: (msg: string, data?: unknown) => void;

  constructor(logger?: (msg: string, data?: unknown) => void) {
    this.log = logger ?? (() => {});
    this.startedAt = Date.now();
    this.focus = {
      currentView: 'library',
      activePapers: [],
      activeConcepts: [],
      readerState: null,
      selected: { paperId: null, conceptId: null, noteId: null, articleId: null },
    };
    this.memory = new WorkingMemory(100);
  }

  /**
   * Bind to EventBus — auto-updates session state from events.
   * Call this once during bootstrap.
   */
  bind(eventBus: EventBus): void {
    this.log('[Session] Binding to EventBus');
    this.eventBusHandle = eventBus.onAny((event) => this.handleEvent(event));
  }

  /**
   * Unbind from EventBus.
   */
  unbind(): void {
    this.eventBusHandle?.unsubscribe();
    this.eventBusHandle = null;
  }

  // ─── Event handling ───

  private handleEvent(event: AppEvent): void {
    this.log('[Session] Event', { type: event.type });

    switch (event.type) {
      case 'user:navigate':
        this.focus.currentView = event.view;
        if (event.target?.paperId) this.touchPaper(event.target.paperId);
        if (event.target?.conceptId) this.touchConcept(event.target.conceptId);
        this.recordTrajectory(`Navigate to ${event.view}`, event.target ? [
          event.target.paperId, event.target.conceptId, event.target.articleId, event.target.noteId,
        ].filter(Boolean) as string[] : undefined);
        break;

      case 'user:selectPaper':
        this.focus.selected.paperId = event.paperId;
        this.touchPaper(event.paperId);
        break;

      case 'user:selectConcept':
        this.focus.selected.conceptId = event.conceptId;
        this.touchConcept(event.conceptId);
        break;

      case 'user:openPaper':
        this.touchPaper(event.paperId);
        this.focus.readerState = { paperId: event.paperId, page: 1 };
        this.recordTrajectory('Open paper', [event.paperId]);
        break;

      case 'user:pageChange':
        if (this.focus.readerState?.paperId === event.paperId) {
          this.focus.readerState.page = event.page;
          this.focus.readerState.totalPages = event.totalPages;
        }
        break;

      case 'user:selectText':
        if (this.focus.readerState?.paperId === event.paperId) {
          this.focus.readerState.selection = { text: event.text, page: event.page };
        }
        this.memory.add({
          type: 'observation',
          content: `User selected text on page ${event.page}: "${truncate(event.text, 100)}"`,
          source: 'reader',
          linkedEntities: [event.paperId],
          importance: 0.3,
        });
        break;

      case 'user:highlight':
        this.memory.add({
          type: 'artifact',
          content: `Highlighted in paper: "${truncate(event.text, 100)}"`,
          source: 'reader',
          linkedEntities: [event.paperId, event.annotationId],
          importance: 0.5,
        });
        this.recordTrajectory('Highlight text', [event.paperId]);
        break;

      case 'user:search':
        this.recordTrajectory(`Search: ${truncate(event.query, 50)}`, undefined);
        break;

      case 'user:chat':
        this.recordTrajectory(`Chat: ${truncate(event.message, 50)}`, undefined);
        break;

      case 'user:import':
        this.recordTrajectory(`Import ${event.count} ${event.format} items`);
        break;

      // Pipeline events
      case 'pipeline:started':
        this.recordTrajectory(`Pipeline ${event.workflow} started`, event.paperIds);
        break;

      case 'pipeline:complete':
        this.memory.add({
          type: 'finding',
          content: `Pipeline ${event.workflow} ${event.result}${event.summary ? ': ' + event.summary : ''}`,
          source: `pipeline:${event.workflow}`,
          linkedEntities: [],
          importance: event.result === 'completed' ? 0.6 : 0.4,
        });
        this.recordTrajectory(`Pipeline ${event.workflow} ${event.result}`, undefined, event.summary);
        break;

      case 'pipeline:stepComplete':
        // Only record significant steps in memory
        if (['analyze', 'synthesize'].includes(event.workflow)) {
          this.memory.add({
            type: 'finding',
            content: `${event.workflow}/${event.step} completed`,
            source: `pipeline:${event.workflow}`,
            linkedEntities: [],
            importance: 0.3,
          });
        }
        break;

      // Data events
      case 'data:paperAdded':
        this.touchPaper(event.paperId);
        this.memory.add({
          type: 'artifact',
          content: `Paper added: "${truncate(event.title, 80)}"`,
          source: event.source,
          linkedEntities: [event.paperId],
          importance: 0.5,
        });
        break;

      case 'data:conceptUpdated':
        this.touchConcept(event.conceptId);
        this.memory.add({
          type: 'decision',
          content: `Concept ${event.changeType}: ${event.conceptId}`,
          source: 'data',
          linkedEntities: [event.conceptId],
          importance: event.changeType === 'created' ? 0.6 : 0.4,
        });
        break;

      case 'data:annotationCreated':
        this.memory.add({
          type: 'artifact',
          content: `Annotation on page ${event.page}: "${truncate(event.text, 80)}"`,
          source: 'reader',
          linkedEntities: [event.paperId, event.annotationId],
          importance: 0.4,
        });
        break;

      case 'data:noteCreated':
        this.memory.add({
          type: 'artifact',
          content: `Note created: "${event.title}"`,
          source: 'notes',
          linkedEntities: [event.noteId, ...event.linkedPaperIds, ...event.linkedConceptIds],
          importance: 0.6,
        });
        break;

      default:
        // Other events don't update session focus
        break;
    }
  }

  // ─── Focus management ───

  private touchPaper(paperId: string): void {
    const list = this.focus.activePapers;
    const idx = list.indexOf(paperId);
    if (idx !== -1) list.splice(idx, 1);
    list.unshift(paperId);
    if (list.length > ResearchSession.MAX_ACTIVE_PAPERS) list.pop();
  }

  private touchConcept(conceptId: string): void {
    const list = this.focus.activeConcepts;
    const idx = list.indexOf(conceptId);
    if (idx !== -1) list.splice(idx, 1);
    list.unshift(conceptId);
    if (list.length > ResearchSession.MAX_ACTIVE_CONCEPTS) list.pop();
  }

  // ─── Trajectory ───

  private recordTrajectory(action: string, entityIds?: string[], result?: string): void {
    this.trajectory.push({
      action,
      timestamp: Date.now(),
      ...(entityIds !== undefined && { entityIds }),
      ...(result !== undefined && { result }),
    });
    if (this.trajectory.length > ResearchSession.MAX_TRAJECTORY) {
      this.trajectory.shift();
    }
  }

  // ─── Goals ───

  addGoal(description: string, relatedEntities: string[] = []): ResearchGoal {
    const goal: ResearchGoal = {
      id: Math.random().toString(36).slice(2, 10),
      description,
      status: 'active',
      relatedEntities,
      createdAt: Date.now(),
    };
    this.goals.push(goal);
    return goal;
  }

  completeGoal(goalId: string): void {
    const goal = this.goals.find((g) => g.id === goalId);
    if (goal) {
      goal.status = 'completed';
      goal.completedAt = Date.now();
    }
  }

  getActiveGoals(): ResearchGoal[] {
    return this.goals.filter((g) => g.status === 'active');
  }

  // ─── Context generation (for system prompt) ───

  /**
   * Generate a compact context string for injection into the AI system prompt.
   * Includes focus, recent trajectory, active goals, and working memory.
   */
  buildContextForPrompt(): string {
    this.log('[Session] buildContextForPrompt', {
      view: this.focus.currentView,
      activePapers: this.focus.activePapers.length,
      activeConcepts: this.focus.activeConcepts.length,
      readerOpen: !!this.focus.readerState,
      activeGoals: this.getActiveGoals().length,
      trajectorySteps: this.trajectory.length,
      memoryEntries: this.memory.getAll().length,
    });

    const parts: string[] = [];

    // Focus
    parts.push('<session_focus>');
    parts.push(`View: ${this.focus.currentView}`);
    if (this.focus.activePapers.length > 0) {
      parts.push(`Active papers: ${this.focus.activePapers.slice(0, 5).join(', ')}`);
    }
    if (this.focus.activeConcepts.length > 0) {
      parts.push(`Active concepts: ${this.focus.activeConcepts.slice(0, 5).join(', ')}`);
    }
    if (this.focus.readerState) {
      const r = this.focus.readerState;
      parts.push(`Reader: paper=${r.paperId} page=${r.page}${r.totalPages ? '/' + r.totalPages : ''}`);
      if (r.selection) {
        parts.push(`Selected text: "${truncate(r.selection.text, 150)}"`);
      }
    }
    const sel = this.focus.selected;
    const selParts = [
      sel.paperId && `paper=${sel.paperId}`,
      sel.conceptId && `concept=${sel.conceptId}`,
      sel.noteId && `note=${sel.noteId}`,
      sel.articleId && `article=${sel.articleId}`,
    ].filter(Boolean);
    if (selParts.length > 0) {
      parts.push(`Selected: ${selParts.join(', ')}`);
    }
    parts.push('</session_focus>');

    // Active goals
    const activeGoals = this.getActiveGoals();
    if (activeGoals.length > 0) {
      parts.push('<research_goals>');
      for (const g of activeGoals) {
        parts.push(`- ${g.description}`);
      }
      parts.push('</research_goals>');
    }

    // Recent trajectory (last 10 steps)
    if (this.trajectory.length > 0) {
      parts.push('<recent_activity>');
      const recent = this.trajectory.slice(-10);
      for (const step of recent) {
        const age = formatAge(Date.now() - step.timestamp);
        parts.push(`- ${step.action}${step.result ? ' → ' + step.result : ''} (${age} ago)`);
      }
      parts.push('</recent_activity>');
    }

    // Working memory
    const memoryStr = this.memory.formatForPrompt(8);
    if (memoryStr) {
      parts.push(memoryStr);
    }

    return parts.join('\n');
  }

  // ─── Serialization ───

  toSnapshot(): SessionSnapshot {
    return {
      focus: { ...this.focus },
      goals: [...this.goals],
      trajectory: [...this.trajectory],
      memory: this.memory.getAll(),
      startedAt: this.startedAt,
    };
  }

  /** Session duration in ms */
  get durationMs(): number {
    return Date.now() - this.startedAt;
  }
}

// ─── Helpers ───

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
}

function formatAge(ms: number): string {
  if (ms < 60_000) return '<1min';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}min`;
  return `${Math.floor(ms / 3_600_000)}h`;
}
