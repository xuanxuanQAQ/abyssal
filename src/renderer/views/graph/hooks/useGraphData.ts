import { useGraphData as useGraphDataQuery } from '../../../core/ipc/hooks/useRelations';
import type { GraphFilter } from '../../../../shared-types/ipc';
import type { GraphData } from '../../../../shared-types/models';

export function useGraphData(filter?: GraphFilter): {
  data: GraphData | undefined;
  isLoading: boolean;
  error: Error | null;
} {
  const result = useGraphDataQuery(filter);

  return {
    data: result.data,
    isLoading: result.isLoading,
    error: result.error ?? null,
  };
}
