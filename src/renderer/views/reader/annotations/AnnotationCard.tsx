import React from 'react';
import { useTranslation } from 'react-i18next';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { useDeferredMenuAction } from '../../../shared/useDeferredMenuAction';
import type { Annotation } from '../../../../shared-types/models';
import type { HighlightColor } from '../../../../shared-types/enums';
import {
  HIGHLIGHT_COLOR_MAP as COLOR_MAP,
  HIGHLIGHT_COLOR_LABELS as COLOR_LABELS,
  ALL_HIGHLIGHT_COLORS as ALL_COLORS,
} from '../shared/highlightColors';

function getTypeIcon(type: Annotation['type']): string {
  switch (type) {
    case 'highlight':
      return '🟡';
    case 'note':
      return '📝';
    case 'conceptTag':
      return '🏷';
    default:
      return '🟡';
  }
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '…';
}

export function AnnotationCard({
  annotation,
  onClick,
  onDelete,
  onUpdateColor,
}: {
  annotation: Annotation;
  onClick: () => void;
  onDelete: () => void;
  onUpdateColor: (color: HighlightColor) => void;
}) {
  const { t } = useTranslation();
  const deferMenuAction = useDeferredMenuAction();
  const highlightColor = (annotation.color as HighlightColor) ?? 'yellow';
  const displayColor = COLOR_MAP[highlightColor] ?? COLOR_MAP.yellow;

  const menuItemStyle: React.CSSProperties = {
    padding: '6px 12px',
    fontSize: 13,
    cursor: 'pointer',
    outline: 'none',
    borderRadius: 4,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    color: 'var(--text-primary)',
  };

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div
          onClick={onClick}
          role="button"
          tabIndex={0}
          className="reader-annotation-card"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') onClick();
          }}
          style={{
            display: 'flex',
            flexDirection: 'row',
            padding: '8px 12px',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            gap: 8,
            transition: 'background-color 120ms ease, transform 120ms ease, box-shadow 120ms ease',
          }}
        >
          {/* Left colored bar */}
          <div
            style={{
              width: 4,
              alignSelf: 'stretch',
              backgroundColor: displayColor,
              borderRadius: 2,
              flexShrink: 0,
            }}
          />

          {/* Content area */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: 1 }}>
            {/* Type icon + color dot */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 'var(--text-xs)',
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: displayColor,
                  display: 'inline-block',
                  flexShrink: 0,
                }}
              />
              <span>{getTypeIcon(annotation.type)}</span>
            </div>

            {/* Selected text */}
            <div
              style={{
                fontSize: 'var(--text-sm)',
                color: 'var(--text-primary)',
                lineHeight: 1.4,
                wordBreak: 'break-word',
              }}
            >
              {truncateText(annotation.selectedText, 80)}
            </div>

            {/* Note text */}
            {annotation.type === 'note' && annotation.text && (
              <div
                style={{
                  fontSize: 'var(--text-xs)',
                  color: 'var(--text-muted)',
                  lineHeight: 1.3,
                }}
              >
                {t('reader.annotations.notePrefix')}{annotation.text}
              </div>
            )}

            {/* Concept ID */}
            {annotation.type === 'conceptTag' && annotation.conceptId && (
              <div
                style={{
                  fontSize: 'var(--text-xs)',
                  color: 'var(--text-muted)',
                  lineHeight: 1.3,
                }}
              >
                {t('reader.annotations.conceptPrefix')}{annotation.conceptId}
              </div>
            )}
          </div>
        </div>
      </ContextMenu.Trigger>

      <ContextMenu.Portal>
        <ContextMenu.Content
          className="workspace-floating-menu reader-annotation-menu"
          style={{
            backgroundColor: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: 8,
            padding: 4,
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.15)',
            minWidth: 140,
            zIndex: 50,
          }}
        >
          <ContextMenu.Sub>
            <ContextMenu.SubTrigger style={menuItemStyle}>
              {t('reader.annotations.changeColor')}
              <span style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>▸</span>
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent
                className="workspace-floating-menu reader-annotation-menu"
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 8,
                  padding: 4,
                  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.15)',
                  minWidth: 100,
                  zIndex: 51,
                }}
              >
                {ALL_COLORS.map((color) => (
                  <ContextMenu.Item
                    key={color}
                    onSelect={() => deferMenuAction(() => onUpdateColor(color))}
                    style={menuItemStyle}
                  >
                    <span
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: '50%',
                        backgroundColor: COLOR_MAP[color],
                        display: 'inline-block',
                        flexShrink: 0,
                      }}
                    />
                    {COLOR_LABELS[color]}
                  </ContextMenu.Item>
                ))}
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>

          <ContextMenu.Separator
            style={{
              height: 1,
              backgroundColor: 'var(--border-subtle)',
              margin: '4px 0',
            }}
          />

          <ContextMenu.Item
            onSelect={() => deferMenuAction(onDelete)}
            style={{
              ...menuItemStyle,
              color: '#f87171',
            }}
          >
            {t('common.delete')}
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
