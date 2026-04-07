import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import * as Popover from '@radix-ui/react-popover';
import { Search } from 'lucide-react';
import type { Concept } from '../../../../shared-types/models';

function normalizeSearchValue(value: string): string {
  return value.trim().toLowerCase();
}

function getConceptPrimaryLabel(concept: Concept): string {
  return concept.nameZh.trim() || concept.nameEn.trim() || concept.id;
}

function getConceptSecondaryLabel(concept: Concept, primaryLabel: string): string {
  const englishName = concept.nameEn.trim();
  if (englishName && englishName !== primaryLabel) {
    return englishName;
  }

  if (concept.searchKeywords.length > 0) {
    return concept.searchKeywords.slice(0, 3).join(', ');
  }

  return '';
}

function matchesConceptQuery(concept: Concept, query: string): boolean {
  if (!query) {
    return true;
  }

  return [
    concept.id,
    concept.nameZh,
    concept.nameEn,
    concept.definition,
    ...concept.searchKeywords,
  ]
    .map(normalizeSearchValue)
    .some((value) => value.includes(query));
}

export function ConceptSelector({
  open,
  onOpenChange,
  anchorRect,
  concepts,
  onSelect,
  onCreateNew,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRect: { x: number; y: number } | null;
  concepts: Concept[];
  onSelect: (conceptId: string) => void;
  onCreateNew: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  const filteredConcepts = useMemo(() => {
    const normalizedQuery = normalizeSearchValue(query);
    return concepts.filter((concept) => matchesConceptQuery(concept, normalizedQuery));
  }, [concepts, query]);

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      {anchorRect && (
        <Popover.Anchor asChild>
          <div
            style={{
              position: 'fixed',
              left: anchorRect.x,
              top: anchorRect.y,
              width: 0,
              height: 0,
              pointerEvents: 'none',
            }}
          />
        </Popover.Anchor>
      )}
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={8}
          style={{
            zIndex: 30,
            backgroundColor: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            padding: 8,
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            width: 260,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 8px',
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            <Search size={14} color="var(--text-muted)" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('reader.annotations.searchConcepts')}
              autoFocus
              style={{
                flex: 1,
                border: 'none',
                outline: 'none',
                backgroundColor: 'transparent',
                color: 'var(--text-primary)',
                fontSize: 'var(--text-sm)',
                fontFamily: 'inherit',
              }}
            />
          </div>

          <div
            style={{
              maxHeight: 200,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {filteredConcepts.map((concept) => (
              <button
                key={concept.id}
                type="button"
                onClick={() => onSelect(concept.id)}
                title={concept.id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  padding: '6px 8px',
                  backgroundColor: 'transparent',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  color: 'var(--text-primary)',
                  fontSize: 'var(--text-sm)',
                  textAlign: 'left',
                  width: '100%',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--bg-surface)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span>{getConceptPrimaryLabel(concept)}</span>
                  {getConceptSecondaryLabel(concept, getConceptPrimaryLabel(concept)) && (
                    <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>
                      {getConceptSecondaryLabel(concept, getConceptPrimaryLabel(concept))}
                    </span>
                  )}
                </div>
              </button>
            ))}
            {filteredConcepts.length === 0 && (
              <div
                style={{
                  padding: '8px',
                  color: 'var(--text-muted)',
                  fontSize: 'var(--text-sm)',
                  textAlign: 'center',
                }}
              >
                {t('reader.annotations.noMatchingConcepts')}
              </div>
            )}
          </div>

          <div
            style={{
              borderTop: '1px solid var(--border-subtle)',
              paddingTop: 4,
            }}
          >
            <button
              type="button"
              onClick={onCreateNew}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '6px 8px',
                backgroundColor: 'transparent',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                color: 'var(--accent-color)',
                fontSize: 'var(--text-sm)',
                width: '100%',
                textAlign: 'left',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--bg-surface)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              {t('reader.annotations.createNewConcept')}
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
