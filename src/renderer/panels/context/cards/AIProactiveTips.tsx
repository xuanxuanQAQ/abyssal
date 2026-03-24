/**
 * AIProactiveTips — Reader 专属 AI 主动提示卡片列表（§3.5）
 *
 * 数据源：useAppStore.proactiveTips
 * 事件源：pipeline:readerPageChanged（TODO: Sub-Doc 5 Reader 视图翻页事件）
 */

import React from 'react';
import { Lightbulb, X, BookmarkPlus } from 'lucide-react';
import { useAppStore } from '../../../core/store';

export function AIProactiveTips() {
  const tips = useAppStore((s) => s.proactiveTips);
  const removeProactiveTip = useAppStore((s) => s.removeProactiveTip);
  const navigateTo = useAppStore((s) => s.navigateTo);

  if (tips.length === 0) return null;

  return (
    <div style={{ padding: '8px 0' }}>
      <div style={{ padding: '4px 12px', fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontWeight: 600 }}>
        AI 建议
      </div>
      {tips.map((tip) => (
        <div
          key={tip.id}
          style={{
            margin: '4px 12px',
            padding: '8px 10px',
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--text-xs)',
          }}
        >
          {/* 标题行 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
            <Lightbulb size={12} style={{ color: 'var(--warning)' }} />
            <span style={{ fontWeight: 500, flex: 1 }}>AI 建议</span>
            <button
              onClick={() => removeProactiveTip(tip.id)}
              title="忽略"
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                padding: 1,
              }}
            >
              <X size={10} />
            </button>
          </div>

          {/* 描述 */}
          <div style={{ color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 6 }}>
            第 {tip.page} 页 {tip.sectionRef} 中的论述可能与概念
            {' '}{tip.conceptId} "{tip.conceptName}" 相关
          </div>

          {/* 置信度 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8 }}>
            <span style={{ color: 'var(--text-muted)' }}>置信度:</span>
            <div
              style={{
                flex: 1,
                height: 4,
                backgroundColor: 'var(--bg-surface-low)',
                borderRadius: 2,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${tip.confidence * 100}%`,
                  backgroundColor: 'var(--accent-color)',
                }}
              />
            </div>
            <span>{tip.confidence.toFixed(2)}</span>
          </div>

          {/* 操作按钮 */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => {
                // TODO: 跳转到标注工作流（Sub-Doc 5 Reader 标注系统）
                removeProactiveTip(tip.id);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '3px 8px',
                border: '1px solid var(--accent-color)',
                borderRadius: 'var(--radius-sm)',
                background: 'none',
                color: 'var(--accent-color)',
                fontSize: 'var(--text-xs)',
                cursor: 'pointer',
              }}
            >
              <BookmarkPlus size={10} /> 标注此段
            </button>
            <button
              onClick={() => {
                navigateTo({ type: 'concept', id: tip.conceptId });
              }}
              style={{
                padding: '3px 8px',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                background: 'none',
                color: 'var(--text-secondary)',
                fontSize: 'var(--text-xs)',
                cursor: 'pointer',
              }}
            >
              查看概念详情
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
