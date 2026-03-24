/**
 * RelevanceCell — 星标 + 内联编辑 Popover（§7.2）
 *
 * 点击弹出 5 色按钮 Popover，选择即提交 + 精确缓存更新。
 */

import React, { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Star, X } from 'lucide-react';
import { useUpdatePaper } from '../../../../core/ipc/hooks/usePapers';
import type { Paper } from '../../../../../shared-types/models';
import type { Relevance } from '../../../../../shared-types/enums';
import { RELEVANCE_CONFIG, getRelevanceColor } from '../../shared/relevanceConfig';

interface RelevanceCellProps {
  paper: Paper;
}

export function RelevanceCell({ paper }: RelevanceCellProps) {
  const [open, setOpen] = useState(false);
  const updatePaper = useUpdatePaper();

  const handleSelect = (rel: Relevance) => {
    setOpen(false);
    if (rel !== paper.relevance) {
      updatePaper.mutate({ id: paper.id, patch: { relevance: rel } });
    }
  };

  return (
    <div
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}
      onClick={(e) => e.stopPropagation()}
    >
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 2,
              display: 'flex',
            }}
          >
            {paper.relevance === 'excluded' ? (
              <X size={14} style={{ color: getRelevanceColor(paper.relevance) }} />
            ) : (
              <Star
                size={14}
                fill={getRelevanceColor(paper.relevance)}
                style={{ color: getRelevanceColor(paper.relevance) }}
              />
            )}
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            sideOffset={4}
            style={{
              display: 'flex',
              gap: 4,
              padding: '6px 8px',
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              zIndex: 30,
            }}
          >
            {RELEVANCE_CONFIG.map((cfg) => (
              <button
                key={cfg.value}
                onClick={() => handleSelect(cfg.value)}
                title={cfg.label}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  border: paper.relevance === cfg.value
                    ? `2px solid ${cfg.color}`
                    : '2px solid transparent',
                  backgroundColor: `${cfg.color}30`,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {cfg.value === 'excluded' ? (
                  <X size={12} style={{ color: cfg.color }} />
                ) : (
                  <Star size={12} fill={cfg.color} style={{ color: cfg.color }} />
                )}
              </button>
            ))}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
