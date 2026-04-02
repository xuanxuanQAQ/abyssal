/**
 * ConceptsTab — 概念框架管理器（§2）
 *
 * 左侧: ConceptTree (280px) + SuggestedConceptQueue
 * 右侧: ConceptDetail 面板
 */

import React from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useAppStore } from '../../../../core/store';
import { ConceptTree } from './ConceptTree';
import { ConceptDetail } from './ConceptDetail';
import { SuggestedConceptQueue } from './SuggestedConceptQueue';

export function ConceptsTab() {
  const selectedConceptId = useAppStore((s) => s.selectedConceptId);

  return (
    <PanelGroup className="workspace-panel-group analysis-concepts-stage" direction="horizontal" style={{ height: '100%' }}>
      {/* Left: Tree + Suggestions */}
      <Panel id="concept-tree" defaultSize={35} minSize={20} order={1}>
        <div className="workspace-lens-panel analysis-concepts-side" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', borderRight: '1px solid var(--border-subtle)' }}>
          <div style={{ flex: 1, overflow: 'auto' }}>
            <ConceptTree />
          </div>
          <SuggestedConceptQueue />
        </div>
      </Panel>

      <PanelResizeHandle className="panel-resize-handle" />

      {/* Right: Detail */}
      <Panel id="concept-detail" defaultSize={65} minSize={30} order={2}>
        {selectedConceptId ? (
          <div className="workspace-main-stage analysis-concept-detail-stage">
            <ConceptDetail conceptId={selectedConceptId} />
          </div>
        ) : (
          <div className="workspace-empty-state" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: 13 }}>
            选择左侧概念查看详情
          </div>
        )}
      </Panel>
    </PanelGroup>
  );
}
