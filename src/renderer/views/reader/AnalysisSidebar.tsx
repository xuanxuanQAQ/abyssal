/**
 * AnalysisSidebar — Reader right-side analysis panel.
 *
 * Five tabs: Summary, Mappings (bilingual evidence), Annotations, Memos, Related.
 * MappingsTab shows bilingual evidence cards with accept/revise/reject controls.
 * Page number links scroll the PDF to the cited page.
 *
 * See spec: section 1.7
 */

import React, { useState, useCallback } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import {
  FileText, Lightbulb, Highlighter, StickyNote, Link2,
  Check, Edit3, X,
} from 'lucide-react';
import { useMappingsForPaper, useAdjudicateMapping } from '../../core/ipc/hooks/useMappings';
import { useMemoList } from '../../core/ipc/hooks/useMemos';
import { useAppDialog } from '../../shared/useAppDialog';
import { MemoCard } from '../notes/memo/MemoCard';
import { useEntityDisplayNameCache } from '../notes/shared/entityDisplayNameCache';

// ─── Props ───

interface AnalysisSidebarProps {
  paperId: string;
  onScrollToPage?: (page: number) => void;
}

// ─── Component ───

export function AnalysisSidebar({ paperId, onScrollToPage }: AnalysisSidebarProps) {
  const [activeTab, setActiveTab] = useState('mappings');
  const { data: mappings } = useMappingsForPaper(paperId);
  const { data: memosData } = useMemoList({ paperIds: [paperId] });
  const memos = memosData?.pages.flat() ?? [];
  const entityNameCache = useEntityDisplayNameCache();
  const adjudicate = useAdjudicateMapping();
  const { prompt, dialog } = useAppDialog();

  return (
    <>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', fontSize: 12 }}>
        <Tabs.Root value={activeTab} onValueChange={setActiveTab}>
        <Tabs.List style={{
          display: 'flex', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0, overflow: 'auto',
        }}>
          <TabTrigger value="summary" active={activeTab === 'summary'} icon={<FileText size={12} />} label="Summary" />
          <TabTrigger value="mappings" active={activeTab === 'mappings'} icon={<Lightbulb size={12} />} label="Mappings" />
          <TabTrigger value="annotations" active={activeTab === 'annotations'} icon={<Highlighter size={12} />} label="Annotations" />
          <TabTrigger value="memos" active={activeTab === 'memos'} icon={<StickyNote size={12} />} label={`Memos (${memos.length})`} />
          <TabTrigger value="related" active={activeTab === 'related'} icon={<Link2 size={12} />} label="Related" />
        </Tabs.List>

        {/* Summary Tab */}
        <Tabs.Content value="summary" style={tabContentStyle}>
          <div style={{ padding: 16, color: 'var(--text-muted)', textAlign: 'center' }}>
            Run analysis to generate summary
          </div>
        </Tabs.Content>

        {/* Mappings Tab — bilingual evidence cards */}
        <Tabs.Content value="mappings" style={tabContentStyle}>
          <div style={{ padding: 8 }}>
            {(mappings ?? []).length === 0 && (
              <div style={{ padding: 16, color: 'var(--text-muted)', textAlign: 'center' }}>
                No concept mappings yet
              </div>
            )}
            {(mappings ?? []).map((mapping, idx: number) => {
              const m = mapping as unknown as Record<string, unknown>;
              return (
              <MappingCard
                key={idx}
                mapping={m}
                paperId={paperId}
                adjudicate={adjudicate}
                prompt={prompt}
                {...(onScrollToPage != null ? { onScrollToPage } : {})}
              />
              );
            })}
          </div>
        </Tabs.Content>

        {/* Annotations Tab */}
        <Tabs.Content value="annotations" style={tabContentStyle}>
          <div style={{ padding: 16, color: 'var(--text-muted)', textAlign: 'center' }}>
            {/* Reuses existing AnnotationList from reader — shown in the main panel */}
            Annotations are shown in the right annotation panel
          </div>
        </Tabs.Content>

        {/* Memos Tab */}
        <Tabs.Content value="memos" style={tabContentStyle}>
          <div style={{ padding: 8 }}>
            {memos.map((m) => <MemoCard key={m.id} memo={m} entityNameCache={entityNameCache} />)}
            {memos.length === 0 && (
              <div style={{ padding: 16, color: 'var(--text-muted)', textAlign: 'center' }}>
                No memos linked to this paper
              </div>
            )}
          </div>
        </Tabs.Content>

        {/* Related Tab */}
        <Tabs.Content value="related" style={tabContentStyle}>
          <div style={{ padding: 16, color: 'var(--text-muted)', textAlign: 'center' }}>
            Related papers will appear after analysis
          </div>
        </Tabs.Content>
        </Tabs.Root>
      </div>
      {dialog}
    </>
  );
}

// ─── Mapping Card with bilingual evidence (§1.7) ───

function MappingCard({
  mapping,
  paperId,
  adjudicate,
  prompt,
  onScrollToPage,
}: {
  mapping: Record<string, unknown>;
  paperId: string;
  adjudicate: ReturnType<typeof useAdjudicateMapping>;
  prompt: ReturnType<typeof useAppDialog>['prompt'];
  onScrollToPage?: (page: number) => void;
}) {
  const conceptId = (mapping['conceptId'] ?? mapping['concept_id']) as string ?? '';
  const relation = (mapping['relation'] as string) ?? '';
  const confidence = (mapping['confidence'] as number) ?? 0;
  const evidence = (mapping['evidence'] as string) ?? '';
  const evidenceOriginal = (mapping['evidenceOriginal'] ?? mapping['evidence_original']) as string | undefined;
  const page = (mapping['page'] as number) ?? null;

  const relationColor = RELATION_COLORS[relation] ?? 'var(--text-secondary)';

  return (
    <div style={{
      marginBottom: 8, padding: 10,
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-md, 6px)',
      background: 'var(--bg-surface-low, var(--bg-surface))',
    }}>
      {/* Header: concept + relation + confidence */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{conceptId}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: relationColor, fontSize: 11 }}>{relation}</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{confidence.toFixed(2)}</span>
        </div>
      </div>

      {/* Bilingual evidence comparison */}
      {(evidence || evidenceOriginal) && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          {evidence && (
            <div style={{ flex: 1, padding: 6, background: 'var(--bg-surface)', borderRadius: 4, fontSize: 11, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>English (AI)</div>
              {evidence}
            </div>
          )}
          {evidenceOriginal && (
            <div style={{ flex: 1, padding: 6, background: 'var(--bg-surface)', borderRadius: 4, fontSize: 11, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>Original</div>
              {evidenceOriginal}
              {page && (
                <button
                  onClick={() => onScrollToPage?.(page)}
                  style={{
                    display: 'inline', background: 'none', border: 'none',
                    color: 'var(--accent-color)', cursor: 'pointer', fontSize: 10, marginLeft: 4,
                  }}
                >
                  🔗p.{page}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 4 }}>
        <ActionButton icon={<Check size={12} />} label="Accept" color="var(--success, #22c55e)" onClick={() => {
          const mappingId = (mapping['id'] as string) ?? '';
          if (!mappingId) return;
          adjudicate.mutate({ mappingId, decision: 'accept', paperId });
        }} />
        <ActionButton icon={<Edit3 size={12} />} label="Revise" color="var(--accent-color)" onClick={async () => {
          const mappingId = (mapping['id'] as string) ?? '';
          if (!mappingId) return;
          const revised = await prompt({
            title: 'Revise relation',
            description: 'Revised relation (supports/challenges/extends/operationalizes):',
            defaultValue: relation,
            placeholder: 'supports / challenges / extends / operationalizes',
            confirmLabel: 'Save relation',
          });
          if (revised === null) return;
          adjudicate.mutate({ mappingId, decision: 'revise', paperId, revisedMapping: { relation: revised } as any });
        }} />
        <ActionButton icon={<X size={12} />} label="Reject" color="var(--danger, #ef4444)" onClick={() => {
          const mappingId = (mapping['id'] as string) ?? '';
          if (!mappingId) return;
          adjudicate.mutate({ mappingId, decision: 'reject', paperId });
        }} />
      </div>
    </div>
  );
}

// ─── Sub-components ───

function TabTrigger({ value, active, icon, label }: { value: string; active: boolean; icon: React.ReactNode; label: string }) {
  return (
    <Tabs.Trigger value={value} style={{
      display: 'flex', alignItems: 'center', gap: 3,
      padding: '6px 8px', background: 'none', border: 'none',
      borderBottom: active ? '2px solid var(--accent-color)' : '2px solid transparent',
      color: active ? 'var(--accent-color)' : 'var(--text-muted)',
      cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap',
    }}>
      {icon} {label}
    </Tabs.Trigger>
  );
}

function ActionButton({ icon, label, color, onClick }: { icon: React.ReactNode; label: string; color: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 3,
        padding: '3px 8px', fontSize: 11, border: 'none',
        borderRadius: 'var(--radius-sm, 4px)',
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        color, cursor: 'pointer',
      }}
    >
      {icon} {label}
    </button>
  );
}

const tabContentStyle: React.CSSProperties = { flex: 1, overflow: 'auto' };

const RELATION_COLORS: Record<string, string> = {
  supports: 'var(--success, #22c55e)',
  challenges: 'var(--danger, #ef4444)',
  extends: '#8b5cf6',
  operationalizes: '#06b6d4',
  irrelevant: 'var(--text-muted)',
};
