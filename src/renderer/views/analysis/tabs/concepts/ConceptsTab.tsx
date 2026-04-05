/**
 * ConceptsTab — 概念框架管理器（§2）
 *
 * 左侧: ConceptTree (280px) + SuggestedConceptQueue
 * 右侧: ConceptDetail 面板
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Panel, Group, Separator } from 'react-resizable-panels';
import { useAppStore } from '../../../../core/store';
import { ConceptTree } from './ConceptTree';
import { ConceptDetail } from './ConceptDetail';
import { SuggestedConceptQueue } from './SuggestedConceptQueue';
import { CreateConceptDialog } from './CreateConceptDialog';

export function ConceptsTab() {
  const { t } = useTranslation();
  const selectedConceptId = useAppStore((s) => s.selectedConceptId);
  const selectConcept = useAppStore((s) => s.selectConcept);
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <Group className="workspace-panel-group analysis-concepts-stage" orientation="horizontal" style={{ height: '100%' }}>
      {/* Left: Tree + Suggestions */}
      <Panel id="concept-tree" defaultSize="35%" minSize="20%">
        <div className="workspace-lens-panel analysis-concepts-side" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', borderRight: '1px solid var(--border-subtle)' }}>
          <div style={{ flex: 1, overflow: 'auto' }}>
            <ConceptTree onCreateConcept={() => setCreateOpen(true)} />
          </div>
          <SuggestedConceptQueue />
        </div>
      </Panel>

      <Separator className="panel-resize-handle" />

      {/* Right: Detail */}
      <Panel id="concept-detail" defaultSize="65%" minSize="30%">
        {selectedConceptId ? (
          <div className="workspace-main-stage analysis-concept-detail-stage">
            <ConceptDetail conceptId={selectedConceptId} />
          </div>
        ) : (
          <div className="workspace-empty-state" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, height: '100%', color: 'var(--text-muted)', fontSize: 13, padding: 24, textAlign: 'center' }}>
            <div style={{ color: 'var(--text-primary)', fontSize: 14, fontWeight: 600 }}>
              {t('analysis.concepts.emptySelection.title')}
            </div>
            <div style={{ maxWidth: 320, lineHeight: 1.5 }}>
              {t('analysis.concepts.emptySelection.description')}
            </div>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              style={emptyActionBtnStyle}
            >
              {t('analysis.concepts.create.action')}
            </button>
          </div>
        )}
      </Panel>

      </Group>

      <CreateConceptDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(conceptId) => {
          selectConcept(conceptId);
        }}
      />
    </>
  );
}

const emptyActionBtnStyle: React.CSSProperties = {
  padding: '7px 14px',
  border: '1px solid var(--border-subtle)',
  borderRadius: 6,
  backgroundColor: 'transparent',
  color: 'var(--text-primary)',
  fontSize: 13,
  cursor: 'pointer',
};
