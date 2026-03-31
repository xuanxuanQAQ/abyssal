/**
 * Shared adjudication status visual configuration.
 * Used by both canvas cellRenderer and DOM TableModeView.
 */
import type { AdjudicationStatus } from '../../../../shared-types/enums';

export interface AdjudicationIndicator {
  symbol: string;
  label: string;
}

export const ADJUDICATION_INDICATORS: Record<AdjudicationStatus, AdjudicationIndicator> = {
  pending: { symbol: '', label: 'Pending' },
  accepted: { symbol: '\u2713', label: 'Accepted' },
  rejected: { symbol: '\u2717', label: 'Rejected' },
  revised: { symbol: '\u270F', label: 'Revised' },
};
