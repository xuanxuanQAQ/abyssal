import React from 'react';
import { StatusIndicator } from './StatusIndicator';

interface ProcessStatusCellProps {
  hasFulltext: boolean;
  hasText: boolean;
}

export function ProcessStatusCell({ hasFulltext, hasText }: ProcessStatusCellProps) {
  if (hasText) {
    return <StatusIndicator tooltip="已处理（已提取文本）" tone="success" />;
  }

  if (hasFulltext) {
    return <StatusIndicator tooltip="未处理（可开始提取与索引）" tone="warning" />;
  }

  return <StatusIndicator tooltip="未处理（需先获取全文）" tone="neutral" />;
}