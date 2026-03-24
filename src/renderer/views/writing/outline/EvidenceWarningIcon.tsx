import React from 'react';
import { AlertTriangle } from 'lucide-react';
import type { EvidenceStatus } from '../../../../shared-types/enums';

interface EvidenceWarningIconProps {
  status: EvidenceStatus | undefined;
}

export function EvidenceWarningIcon({ status }: EvidenceWarningIconProps) {
  if (!status || status === 'sufficient') return null;

  const color = status === 'missing' ? 'var(--danger)' : 'var(--warning)';
  const title = status === 'missing' ? '缺少证据支撑' : '证据不充分';

  return (
    <span title={title} style={{ display: 'flex', flexShrink: 0 }}>
      <AlertTriangle size={12} style={{ color }} />
    </span>
  );
}
