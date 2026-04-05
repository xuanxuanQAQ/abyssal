import { NavigationExecutor } from '../../executors/navigation-executor';
import type { NavigationExecutorDeps } from '../../executors/navigation-executor';
import { OperationEventEmitter } from '../../event-emitter';
import { makeOperation, resetSeq } from '../helpers';
import type { ExecutionStep } from '../../types';
import type { ViewType } from '../../../shared-types/enums';

function makeStep(view: ViewType = 'library', entityId?: string): ExecutionStep & { kind: 'navigate' } {
  return {
    kind: 'navigate',
    view,
    ...(entityId != null ? { entityId } : {}),
  };
}

describe('NavigationExecutor', () => {
  let emitter: OperationEventEmitter;

  beforeEach(() => {
    emitter = new OperationEventEmitter();
    resetSeq();
  });

  describe('execute — success', () => {
    it('navigates to view and returns success', async () => {
      const deps: NavigationExecutorDeps = {
        navigate: vi.fn().mockResolvedValue(undefined),
      };
      const executor = new NavigationExecutor(deps);
      const result = await executor.execute(makeOperation(), makeStep('reader'), emitter);

      expect(result.success).toBe(true);
      expect(result.view).toBe('reader');
      expect(deps.navigate).toHaveBeenCalledWith('reader', undefined);
    });

    it('passes entityId to navigate', async () => {
      const deps: NavigationExecutorDeps = {
        navigate: vi.fn().mockResolvedValue(undefined),
      };
      const executor = new NavigationExecutor(deps);
      const result = await executor.execute(makeOperation(), makeStep('reader', 'paper-123'), emitter);

      expect(result.entityId).toBe('paper-123');
      expect(deps.navigate).toHaveBeenCalledWith('reader', 'paper-123');
    });
  });

  describe('execute — failure', () => {
    it('returns success=false when navigate throws', async () => {
      const deps: NavigationExecutorDeps = {
        navigate: vi.fn().mockRejectedValue(new Error('view not found')),
      };
      const executor = new NavigationExecutor(deps);
      const result = await executor.execute(makeOperation(), makeStep('writing'), emitter);

      expect(result.success).toBe(false);
      expect(result.view).toBe('writing');
    });
  });
});
