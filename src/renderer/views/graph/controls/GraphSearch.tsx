import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import type Graph from 'graphology';
import { useAppStore } from '../../../core/store';
import { resolveNodeType, resolveNodeLabel } from '../resolveNode';

export interface GraphSearchProps {
  graph: Graph | null;
  onSelectNode: (nodeId: string, nodeType: 'paper' | 'concept' | 'memo' | 'note') => void;
}

interface NodeEntry {
  id: string;
  label: string;
  type: 'paper' | 'concept' | 'memo' | 'note';
}

export function GraphSearch({ graph, onSelectNode }: GraphSearchProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [showResults, setShowResults] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounce the query by 200ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  // Close results on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Search graph nodes
  const results = useMemo<NodeEntry[]>(() => {
    if (!graph || debouncedQuery.trim().length === 0) return [];

    const lowerQuery = debouncedQuery.toLowerCase();
    const matches: NodeEntry[] = [];

    graph.forEachNode((nodeId, attributes) => {
      if (matches.length >= 8) return;
      const label = resolveNodeLabel(attributes as Record<string, unknown>, matches.length + 1);
      if (label.toLowerCase().includes(lowerQuery)) {
        matches.push({
          id: nodeId,
          label,
          type: resolveNodeType(attributes as Record<string, unknown>),
        });
      }
    });

    return matches;
  }, [graph, debouncedQuery]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    setShowResults(true);
  }, []);

  const handleSelect = useCallback(
    (nodeId: string, nodeType: 'paper' | 'concept' | 'memo' | 'note') => {
      onSelectNode(nodeId, nodeType);
      setShowResults(false);
      setQuery('');
    },
    [onSelectNode],
  );

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setShowResults(false);
      inputRef.current?.blur();
    }
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        bottom: 12,
        left: 12,
        zIndex: 25,
        width: 200,
      }}
    >
      {/* Search input */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 8px',
          background: 'var(--bg-surface)',
          backdropFilter: 'blur(8px)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-md)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        }}
      >
        <Search size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInputChange}
          onFocus={() => setShowResults(true)}
          onKeyDown={handleKeyDown}
          placeholder={t('graph.search')}
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontSize: 'var(--text-sm)',
            color: 'var(--text-primary)',
            padding: 0,
            minWidth: 0,
          }}
        />
      </div>

      {/* Results dropdown */}
      {showResults && results.length > 0 && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 0,
            right: 0,
            marginBottom: 4,
            zIndex: 26,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            overflow: 'hidden',
          }}
        >
          {results.map((node) => (
            <div
              key={node.id}
              onClick={() => handleSelect(node.id, node.type)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 8px',
                cursor: 'pointer',
                fontSize: 'var(--text-sm)',
                color: 'var(--text-primary)',
                borderBottom: '1px solid var(--border-subtle)',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-surface)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.background = 'transparent';
              }}
            >
              <span
                style={{
                  flexShrink: 0,
                  fontSize: 'var(--text-xs)',
                  color: node.type === 'paper' ? 'var(--accent-color)' : 'var(--text-muted)',
                }}
              >
                {node.type === 'paper' ? '●' : '◇'}
              </span>
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {node.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
