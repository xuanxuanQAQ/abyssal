/**
 * NavigationExecutor — executes view switches, entity focus, and paper opening.
 */

import type { ViewType } from '../../shared-types/enums';
import type {
  CopilotOperation,
  ExecutionStep,
} from '../types';
import type { OperationEventEmitter } from '../event-emitter';

export interface NavigationExecutorDeps {
  navigate: (view: ViewType, entityId?: string) => Promise<void>;
}

export interface NavigationExecutorResult {
  success: boolean;
  view: ViewType;
  entityId?: string;
}

export class NavigationExecutor {
  private deps: NavigationExecutorDeps;

  constructor(deps: NavigationExecutorDeps) {
    this.deps = deps;
  }

  async execute(
    operation: CopilotOperation,
    step: ExecutionStep & { kind: 'navigate' },
    emitter: OperationEventEmitter,
  ): Promise<NavigationExecutorResult> {
    try {
      await this.deps.navigate(step.view, step.entityId);
      return { success: true, view: step.view, ...(step.entityId != null ? { entityId: step.entityId } : {}) };
    } catch {
      return { success: false, view: step.view, ...(step.entityId != null ? { entityId: step.entityId } : {}) };
    }
  }
}
