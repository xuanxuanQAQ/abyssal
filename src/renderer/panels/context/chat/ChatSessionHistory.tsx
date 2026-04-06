/**
 * ChatSessionHistory — 聊天会话历史列表
 *
 * 显示所有之前的聊天会话，支持：
 * - 按时间排序呈现
 * - 点击切换到该会话
 * - 删除会话
 * - 显示会话的消息数量和最后更新时间
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageSquare, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { getAPI } from '../../../core/ipc/bridge';
import { useChatSession } from './hooks/useChatSession';
import { useAppDialog } from '../../../shared/useAppDialog';
import type { ChatSessionSummary } from '../../../../shared-types/models';
import toast from 'react-hot-toast';

interface ChatSessionHistoryProps {
  onSessionSelected?: () => void;
}

export const ChatSessionHistory = React.memo(function ChatSessionHistory({
  onSessionSelected,
}: ChatSessionHistoryProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { switchSession, sessionKey, createNewSession } = useChatSession();
  const { confirm, dialog } = useAppDialog();
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  /** 加载所有会话列表 */
  const loadSessions = useCallback(async () => {
    setIsLoading(true);
    try {
      const list = await getAPI().db.chat.listSessions();
      // 按最后消息时间排序（最新优先）
      const sorted = list
        .filter((s) => s.messageCount > 0)
        .sort((a, b) => b.lastMessageAt - a.lastMessageAt);
      setSessions(sorted);
    } catch (error) {
      console.error('[ChatSessionHistory] Failed to load sessions:', error);
      toast.error('加载会话历史失败', { id: 'chat-history-load-error' });
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 每次挂载（展开）刷新会话列表
  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const handleSelectSession = useCallback((key: string) => {
    switchSession(key);
    onSessionSelected?.();
  }, [switchSession, onSessionSelected]);

  const handleDeleteSession = async (key: string, e: React.MouseEvent) => {
    e.stopPropagation();

    const confirmed = await confirm({
      title: t('context.chat.menu.delete'),
      description: t('context.chat.confirmDeleteSession'),
      confirmLabel: t('common.delete'),
      confirmTone: 'danger',
    });
    if (!confirmed) {
      return;
    }

    try {
      await getAPI().db.chat.deleteSession(key);
      queryClient.removeQueries({ queryKey: ['chat', 'history', key] });

      // If the deleted session is currently active, immediately move to a fresh session.
      // This prevents UI/backend state from pointing at a deleted conversation key.
      if (key === sessionKey) {
        createNewSession();
      }

      await loadSessions();
      onSessionSelected?.();
      toast.success(t('context.chat.sessionDeleted'), { id: 'chat-session-deleted' });
    } catch (error) {
      console.error('[ChatSessionHistory] Failed to delete session:', error);
      toast.error(t('context.chat.failedToDeleteSession'), { id: 'chat-delete-error' });
    }
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return t('common.time.justNow');
    if (diffMins < 60) return t('common.time.minutesAgo', { count: diffMins });
    if (diffHours < 24) return t('common.time.hoursAgo', { count: diffHours });
    if (diffDays < 7) return t('common.time.daysAgo', { count: diffDays });

    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  return (
    <>
      <div
        className="chat-session-history"
        style={{
          position: 'relative',
          maxHeight: '400px',
          overflow: 'hidden',
          backgroundColor: 'var(--lens-surface)',
          borderBottom: '1px solid var(--border-subtle)',
          borderTop: '1px solid var(--border-subtle)',
          zIndex: 2,
          transition: 'max-height 200ms ease',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
        }}
      >
      {isLoading ? (
        <div
          style={{
            padding: '12px 14px',
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: '12px',
          }}
        >
          {t('common.loading')}
        </div>
      ) : sessions.length === 0 ? (
        <div
          style={{
            padding: '12px 14px',
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: '12px',
          }}
        >
          {t('context.chat.noSessionHistory')}
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            maxHeight: '380px',
            overflow: 'auto',
          }}
        >
          {sessions.map((session) => (
            <div
              key={session.contextSourceKey}
              role="button"
              tabIndex={0}
              onClick={() => handleSelectSession(session.contextSourceKey)}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleSelectSession(session.contextSourceKey);
                }
              }}
              className="chat-session-item"
              style={{
                padding: '10px 14px',
                borderBottom: '1px solid var(--border-subtle)',
                background: 'transparent',
                textAlign: 'left',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                fontSize: '12px',
                color: 'var(--text-secondary)',
                transition: 'backgroundColor 150ms ease',
                position: 'relative',
              }}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLElement).style.backgroundColor =
                  'color-mix(in srgb, var(--text-primary) 5%, transparent)')
              }
              onMouseLeave={(e) => {
                ((e.currentTarget as HTMLElement).style.backgroundColor = 'transparent');
              }}
            >
              <MessageSquare size={12} style={{ flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    color: 'var(--text-primary)',
                  }}
                >
                  {formatTime(session.lastMessageAt)}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  {session.messageCount} {t('context.chat.messages')}
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => handleDeleteSession(session.contextSourceKey, e)}
                onKeyDown={(e) => e.stopPropagation()}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: '2px',
                  display: 'flex',
                  alignItems: 'center',
                  opacity: 0.6,
                  transition: 'opacity 150ms ease',
                  flexShrink: 0,
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.opacity = '1')}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.opacity = '0.6')}
                title={t('common.delete')}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      </div>
      {dialog}
    </>
  );
});
