/**
 * EmptyPane — 空状态引导 + 最近活动流（§10）
 *
 * 当 ContextSource 为 EmptyContext 时显示。
 * 最近活动来源：navigationStack + activeTasks
 */

import React, { useMemo } from 'react';
import { Search, FileText, Lightbulb, PenTool, CheckCircle, BookOpen, BarChart3, Network } from 'lucide-react';
import { useAppStore } from '../../../core/store';

interface ActivityItem {
  id: string;
  icon: React.ReactNode;
  text: string;
  time: string;
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

const guideItems = [
  { icon: <BookOpen size={14} />, label: '在 Library 中选中一篇论文', color: '#60a5fa' },
  { icon: <FileText size={14} />, label: '在 Reader 中打开 PDF', color: '#34d399' },
  { icon: <BarChart3 size={14} />, label: '在 Analysis 中选中映射', color: '#f472b6' },
  { icon: <Network size={14} />, label: '在 Graph 中点击节点', color: '#a78bfa' },
];

export function EmptyPane() {
  const navigationStack = useAppStore((s) => s.navigationStack);
  const activeTasks = useAppStore((s) => s.activeTasks);

  const recentActivity = useMemo<ActivityItem[]>(() => {
    const items: ActivityItem[] = [];

    for (const task of Object.values(activeTasks)) {
      if (task.status === 'completed') {
        items.push({
          id: `task:${task.taskId}`,
          icon: <CheckCircle size={13} style={{ color: 'var(--success)' }} />,
          text: `"${task.workflow}" 完成`,
          time: formatRelativeTime(Date.now()),
        });
      }
    }

    const seen = new Set<string>();
    for (let i = navigationStack.length - 1; i >= 0 && items.length < 5; i--) {
      const target = navigationStack[i];
      if (!target) continue;

      const key = JSON.stringify(target);
      if (seen.has(key)) continue;
      seen.add(key);

      if (target.type === 'paper') {
        items.push({
          id: `nav:paper:${target.id}`,
          icon: <FileText size={13} style={{ color: 'var(--text-muted)' }} />,
          text: `查看论文 ${target.id.slice(0, 8)}…`,
          time: '',
        });
      } else if (target.type === 'concept') {
        items.push({
          id: `nav:concept:${target.id}`,
          icon: <Lightbulb size={13} style={{ color: 'var(--text-muted)' }} />,
          text: `查看概念 ${target.id}`,
          time: '',
        });
      } else if (target.type === 'section') {
        items.push({
          id: `nav:section:${target.sectionId}`,
          icon: <PenTool size={13} style={{ color: 'var(--text-muted)' }} />,
          text: `编辑 §${target.sectionId}`,
          time: '',
        });
      }
    }

    return items.slice(0, 5);
  }, [navigationStack, activeTasks]);

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 24px',
        gap: 0,
      }}
    >
      {/* 图标 */}
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 16,
          background: 'linear-gradient(135deg, var(--bg-surface) 0%, var(--bg-surface-low) 100%)',
          border: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 20,
        }}
      >
        <Search size={22} style={{ color: 'var(--text-muted)', opacity: 0.7 }} />
      </div>

      {/* 标题 */}
      <div style={{
        fontSize: 14,
        fontWeight: 600,
        color: 'var(--text-primary)',
        marginBottom: 6,
        textAlign: 'center',
      }}>
        选择一个实体以查看上下文
      </div>

      {/* 副标题 */}
      <div style={{
        fontSize: 12,
        color: 'var(--text-muted)',
        marginBottom: 24,
        textAlign: 'center',
      }}>
        面板将显示相关信息并启用 AI 对话
      </div>

      {/* 引导列表 */}
      <div style={{ width: '100%', maxWidth: 220, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {guideItems.map((item, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 12px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              fontSize: 12,
              color: 'var(--text-secondary)',
              transition: 'border-color 150ms ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = item.color; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}
          >
            <span style={{ color: item.color, flexShrink: 0, display: 'flex' }}>{item.icon}</span>
            {item.label}
          </div>
        ))}
      </div>

      {/* 最近活动 */}
      {recentActivity.length > 0 && (
        <div style={{ width: '100%', maxWidth: 220, marginTop: 24 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: 8,
            }}
          >
            最近活动
          </div>
          {recentActivity.map((item) => (
            <div
              key={item.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '5px 0',
                fontSize: 12,
                color: 'var(--text-secondary)',
              }}
            >
              {item.icon}
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.text}
              </span>
              {item.time && (
                <span style={{ color: 'var(--text-muted)', fontSize: 11, flexShrink: 0 }}>
                  {item.time}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
