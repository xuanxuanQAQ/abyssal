/**
 * QuickActions — 论文快速操作按钮组（§3.2 LibraryPaperPane 子卡）
 *
 * 四个操作：获取全文 / 处理 / 分析 / 打开 PDF
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Microscope, Download, FileText, Loader2, Cog } from 'lucide-react';
import { useAppStore } from '../../../core/store';
import { useAcquireFulltext } from '../../../core/ipc/hooks/useAcquire';
import { useStartPipeline } from '../../../core/ipc/hooks/usePipeline';
import { usePaper } from '../../../core/ipc/hooks/usePapers';

interface QuickActionsProps {
  paperId: string;
}

// ── Static styles ──

const containerStyle: React.CSSProperties = {
  padding: '8px 12px',
  display: 'flex',
  gap: 8,
};

export const QuickActions = React.memo(function QuickActions({ paperId }: QuickActionsProps) {
  const { t } = useTranslation();
  const navigateTo = useAppStore((s) => s.navigateTo);
  const acquireFulltext = useAcquireFulltext();
  const startPipeline = useStartPipeline();
  const { data: paper } = usePaper(paperId);

  const startProcess = useStartPipeline();

  const isAcquiring = acquireFulltext.isPending;
  const isProcessing = startProcess.isPending;
  const isAnalyzing = startPipeline.isPending;
  const status = paper?.fulltextStatus;
  const hasFulltext = status === 'available' || !!paper?.fulltextPath;
  const hasText = !!paper?.textPath;

  const actions = [
    {
      icon: isAcquiring ? <Loader2 size={14} className="spin" /> : <Download size={14} />,
      label: t('context.quickActions.acquireFulltext'),
      disabled: isAcquiring || hasFulltext || status === 'pending',
      onClick: () => {
        acquireFulltext.mutate(paperId);
      },
    },
    {
      icon: isProcessing ? <Loader2 size={14} className="spin" /> : <Cog size={14} />,
      label: t('context.quickActions.process'),
      disabled: !hasFulltext || isProcessing || hasText,
      onClick: () => {
        startProcess.mutate({ workflow: 'process', config: { paperIds: [paperId] } });
      },
    },
    {
      icon: isAnalyzing ? <Loader2 size={14} className="spin" /> : <Microscope size={14} />,
      label: t('context.quickActions.analyze'),
      disabled: !paper || isAnalyzing || paper.analysisStatus === 'in_progress' || paper.analysisStatus === 'completed' || !hasFulltext,
      onClick: () => {
        startPipeline.mutate({ workflow: 'analyze', config: { paperIds: [paperId] } });
      },
    },
    {
      icon: <FileText size={14} />,
      label: paper?.paperType === 'webpage'
        ? t('context.quickActions.openWebArticle')
        : t('context.quickActions.openPDF'),
      disabled: !hasFulltext,
      onClick: () => {
        navigateTo({ type: 'paper', id: paperId, view: 'reader' });
      },
    },
  ];

  return (
    <div style={containerStyle}>
      {actions.map((action) => (
        <button
          key={action.label}
          onClick={action.onClick}
          disabled={action.disabled}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            padding: '6px 0',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)',
            background: 'none',
            color: action.disabled ? 'var(--text-disabled)' : 'var(--text-primary)',
            fontSize: 'var(--text-xs)',
            cursor: action.disabled ? 'not-allowed' : 'pointer',
            opacity: action.disabled ? 0.5 : 1,
          }}
        >
          {action.icon}
          {action.label}
        </button>
      ))}
    </div>
  );
});
