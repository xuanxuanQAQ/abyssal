/**
 * ChatSessionList — 历史会话下拉列表
 *
 * 从 db:chat:listSessions 获取所有历史会话摘要，
 * 按最后活跃时间降序显示，点击切换会话。
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageSquare, Trash2, FileText, Brain, GitMerge, BookOpen, Globe, StickyNote, Lightbulb } from 'lucide-react';
import { getAPI } from '../../../core/ipc/bridge';
import type { ChatSessionSummary } from '../../../../shared-types/models';

const iconStyle: React.CSSProperties = { flexShrink: 0, opacity: 0.6 };
const dropdownStyle: React.CSSProperties = {
  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
  maxHeight: 320, overflowY: 'auto', backgroundColor: 'var(--bg-surface)',
  border: '1px solid var(--border-default)', borderTop: 'none',
  borderRadius: '0 0 8px 8px', boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
};
const centeredMsgStyle: React.CSSProperties = { padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 };
const sessionInfoStyle: React.CSSProperties = { flex: 1, minWidth: 0 };
const msgCountStyle: React.CSSProperties = { fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 };
const timeStyle: React.CSSProperties = { fontSize: 10, color: 'var(--text-muted)', flexShrink: 0, minWidth: 40, textAlign: 'right' };
const deleteBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
  padding: 2, borderRadius: 4, display: 'flex', alignItems: 'center',
  opacity: 0.4, transition: 'opacity 100ms', flexShrink: 0,
};

interface ChatSessionListProps {
  currentKey: string;
  onSelect: (contextKey: string) => void;
  onClose: () => void;
}

/** Parse contextSourceKey → display label & icon */
function parseSessionKey(key: string, t: ReturnType<typeof import('react-i18next').useTranslation>['t']): { label: string; icon: React.ReactNode } {
  if (key === 'global') {
    return { label: t('context.chat.sessions.global'), icon: <Globe size={12} style={iconStyle} /> };
  }
  const [type, ...rest] = key.split(':');
  const id = rest.join(':');
  const shortId = id.length > 12 ? id.slice(0, 6) + '…' + id.slice(-4) : id;

  switch (type) {
    case 'paper':
      return { label: t('context.chat.sessions.paper', { id: shortId }), icon: <FileText size={12} style={iconStyle} /> };
    case 'concept':
      return { label: t('context.chat.sessions.concept', { id: shortId }), icon: <Brain size={12} style={iconStyle} /> };
    case 'mapping':
      return { label: t('context.chat.sessions.mapping', { id: shortId }), icon: <GitMerge size={12} style={iconStyle} /> };
    case 'section':
      return { label: t('context.chat.sessions.section', { id: shortId }), icon: <BookOpen size={12} style={iconStyle} /> };
    case 'memo':
      return { label: t('context.chat.sessions.memo', { id: shortId }), icon: <Lightbulb size={12} style={iconStyle} /> };
    case 'note':
      return { label: t('context.chat.sessions.note', { id: shortId }), icon: <StickyNote size={12} style={iconStyle} /> };
    default:
      return { label: key, icon: <MessageSquare size={12} style={iconStyle} /> };
  }
}

function formatTime(ts: number, t: ReturnType<typeof import('react-i18next').useTranslation>['t']): string {
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60_000) return t('context.chat.sessions.justNow');
  if (diff < 3600_000) return t('context.chat.sessions.minutesAgo', { count: Math.floor(diff / 60_000) });
  if (diff < 86400_000) return t('context.chat.sessions.hoursAgo', { count: Math.floor(diff / 3600_000) });
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export const ChatSessionList = React.memo(function ChatSessionList({ currentKey, onSelect, onClose }: ChatSessionListProps) {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const panelRef = useRef<HTMLDivElement>(null);

  // Load sessions on mount
  useEffect(() => {
    let cancelled = false;
    getAPI().db.chat.listSessions().then((list) => {
      if (cancelled) return;
      // Sort by lastMessageAt descending
      list.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
      setSessions(list);
      setLoading(false);
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleDelete = useCallback(async (e: React.MouseEvent, key: string) => {
    e.stopPropagation();
    await getAPI().db.chat.deleteSession(key);
    setSessions((prev) => prev.filter((s) => s.contextSourceKey !== key));
  }, []);

  return (
    <div ref={panelRef} style={dropdownStyle} className="chat-scroll-area">
      {loading ? (
        <div style={centeredMsgStyle}>
          {t('common.loading')}
        </div>
      ) : sessions.length === 0 ? (
        <div style={centeredMsgStyle}>
          {t('context.chat.sessions.empty')}
        </div>
      ) : (
        sessions.map((s) => {
          const { label, icon } = parseSessionKey(s.contextSourceKey, t);
          const isActive = s.contextSourceKey === currentKey;
          return (
            <div
              key={s.contextSourceKey}
              onClick={() => { onSelect(s.contextSourceKey); onClose(); }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '7px 12px',
                cursor: 'pointer',
                backgroundColor: isActive ? 'rgba(var(--accent-color-rgb, 59, 130, 246), 0.08)' : 'transparent',
                borderLeft: isActive ? '2px solid var(--accent-color)' : '2px solid transparent',
                transition: 'background-color 100ms ease',
              }}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.backgroundColor = 'var(--bg-surface-hover, rgba(0,0,0,0.03))';
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              {icon}
              <div style={sessionInfoStyle}>
                <div style={{
                  fontSize: 12,
                  color: isActive ? 'var(--accent-color)' : 'var(--text-primary)',
                  fontWeight: isActive ? 600 : 400,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {label}
                </div>
              </div>
              <span style={msgCountStyle}>
                {t('context.chat.sessions.messageCount', { count: s.messageCount })}
              </span>
              <span style={timeStyle}>
                {formatTime(s.lastMessageAt, t)}
              </span>
              {!isActive && (
                <button
                  onClick={(e) => handleDelete(e, s.contextSourceKey)}
                  title={t('context.chat.sessions.delete')}
                  style={deleteBtnStyle}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = 'var(--danger, #ef4444)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.4'; e.currentTarget.style.color = 'var(--text-muted)'; }}
                >
                  <Trash2 size={11} />
                </button>
              )}
            </div>
          );
        })
      )}
    </div>
  );
});
