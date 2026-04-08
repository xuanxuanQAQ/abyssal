import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import {
  Download, ExternalLink, GripVertical, Globe, BookOpen, RefreshCw,
  Shield, Loader2, Check,
} from 'lucide-react';
import type { SettingsData } from '../../../../shared-types/models';
import type { UpdateSectionFn } from '../types';
import { PUBLISHER_REGISTRY } from '../constants';
import { Section, Row, Toggle, NumberInput, SegmentedControl, SliderRow } from '../components/ui';
import { getAPI } from '../../../core/ipc/bridge';

const DEFAULT_SOURCE_ORDER = ['unpaywall', 'arxiv', 'pmc', 'china-institutional', 'institutional', 'scihub'] as const;

export function AcquisitionTab({ settings, onUpdate }: { settings: SettingsData; onUpdate: UpdateSectionFn }) {
  const { t } = useTranslation();
  const { acquire } = settings;

  const sourceOrder = useMemo(() => {
    const enabled = acquire.enabledSources.filter((s) => DEFAULT_SOURCE_ORDER.includes(s as typeof DEFAULT_SOURCE_ORDER[number]));
    const disabled = DEFAULT_SOURCE_ORDER.filter((s) => !enabled.includes(s));
    return [...enabled, ...disabled];
  }, [acquire.enabledSources]);

  const toggleSource = (source: string) => {
    const current = acquire.enabledSources;
    const next = current.includes(source)
      ? current.filter((s) => s !== source)
      : [...current, source];
    onUpdate('acquire', { enabledSources: next });
  };

  // ─── Pointer-driven drag reordering ───
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [dragState, setDragState] = useState<{
    active: boolean;
    idx: number;
    currentIdx: number;
    offsetY: number;
    startY: number;
    pointerY: number;
  } | null>(null);

  const rowRectsRef = useRef<DOMRect[]>([]);

  const handlePointerDown = (e: React.PointerEvent, idx: number) => {
    const target = e.target as HTMLElement;
    if (!target.closest('[data-grip]')) return;
    e.preventDefault();
    const el = itemRefs.current[idx];
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    rowRectsRef.current = itemRefs.current.map((r) => r!.getBoundingClientRect());
    const rect = el.getBoundingClientRect();
    setDragState({
      active: true,
      idx,
      currentIdx: idx,
      offsetY: e.clientY - rect.top,
      startY: e.clientY,
      pointerY: e.clientY,
    });
  };

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragState?.active) return;
    e.preventDefault();
    const rects = rowRectsRef.current;
    const pointerY = e.clientY;
    let newIdx = dragState.idx;
    for (let i = 0; i < rects.length; i++) {
      const mid = rects[i]!.top + rects[i]!.height / 2;
      if (pointerY < mid) { newIdx = i; break; }
      newIdx = i;
    }
    setDragState((prev) => prev ? { ...prev, pointerY, currentIdx: newIdx } : prev);
  }, [dragState?.active, dragState?.idx]);

  const handlePointerUp = useCallback(() => {
    if (!dragState?.active) return;
    const { idx, currentIdx } = dragState;
    if (idx !== currentIdx) {
      const reordered = [...sourceOrder];
      const [moved] = reordered.splice(idx, 1);
      reordered.splice(currentIdx, 0, moved!);
      const enabledSet = new Set(acquire.enabledSources);
      const newEnabled = reordered.filter((s) => enabledSet.has(s));
      onUpdate('acquire', { enabledSources: newEnabled });
    }
    setDragState(null);
  }, [dragState, sourceOrder, acquire.enabledSources, onUpdate]);

  const getItemStyle = (idx: number): React.CSSProperties => {
    if (!dragState?.active) return {};
    const { idx: dragIdx, currentIdx, pointerY, startY } = dragState;
    if (idx === dragIdx) {
      return {
        transform: `translateY(${pointerY - startY}px)`,
        zIndex: 10,
        boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
        transition: 'box-shadow 0.2s',
        position: 'relative',
      };
    }
    const rowH = rowRectsRef.current[dragIdx]?.height ?? 40;
    if (dragIdx < currentIdx && idx > dragIdx && idx <= currentIdx) {
      return { transform: `translateY(${-rowH}px)`, transition: 'transform 0.2s ease' };
    }
    if (dragIdx > currentIdx && idx < dragIdx && idx >= currentIdx) {
      return { transform: `translateY(${rowH}px)`, transition: 'transform 0.2s ease' };
    }
    return { transform: 'translateY(0)', transition: 'transform 0.2s ease' };
  };

  return (
    <>
      <Section icon={<Download size={16} />} title={t('settings.acquisition.sourceCascade')} description={t('settings.acquisition.sourceCascadeDesc')}>
        <div ref={listRef} style={{ userSelect: dragState ? 'none' : undefined }}>
          {sourceOrder.map((src, idx) => {
            const enabled = acquire.enabledSources.includes(src);
            const isScihub = src === 'scihub';
            const isChinaInst = src === 'china-institutional';
            const isDragging = dragState?.active && dragState.idx === idx;
            return (
              <div
                key={src}
                ref={(el) => { itemRefs.current[idx] = el; }}
                onPointerDown={(e) => handlePointerDown(e, idx)}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 0',
                  borderBottom: '1px solid var(--border-subtle)',
                  opacity: enabled ? 1 : 0.5,
                  background: isDragging ? 'var(--bg-subtle)' : undefined,
                  borderRadius: isDragging ? 'var(--radius-sm)' : undefined,
                  ...getItemStyle(idx),
                }}
              >
                <div data-grip style={{ display: 'flex', cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none' }}>
                  <GripVertical size={14} style={{ color: 'var(--text-muted)' }} />
                </div>
                <Toggle checked={enabled} onChange={() => toggleSource(src)} />
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                    {t(`settings.acquisition.sources.${src}`, { defaultValue: src })}
                  </span>
                  {isScihub && (
                    <div style={{ fontSize: 10, color: 'var(--warning, #f59e0b)', marginTop: 2 }}>
                      {t('settings.acquisition.scihubWarning')}
                    </div>
                  )}
                  {isChinaInst && (
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                      {t('settings.acquisition.chinaInstitutional.carsiHint')}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <ChinaInstitutionalSection acquire={acquire} onUpdate={onUpdate} />

      <Section icon={<ExternalLink size={16} />} title={t('settings.acquisition.institutionalProxy')}>
        <Row label={t('settings.acquisition.proxyUrl')} hint={t('settings.acquisition.proxyUrlHint')} noBorder>
          <input
            type="text"
            value={acquire.institutionalProxyUrl ?? ''}
            placeholder={t('settings.acquisition.proxyUrlPlaceholder')}
            onChange={(e) => onUpdate('acquire', { institutionalProxyUrl: e.target.value || null })}
            style={{
              width: 260, padding: '4px 8px', fontSize: 13,
              background: 'var(--bg-base)', color: 'var(--text-primary)',
              border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)',
              outline: 'none',
            }}
          />
        </Row>
      </Section>

      <Section icon={<Globe size={16} />} title={t('settings.acquisition.networkProxy')} description={t('settings.acquisition.networkProxyDesc')}>
        <Row label={t('settings.acquisition.networkProxyEnabled')}>
          <Toggle checked={acquire.proxyEnabled ?? false} onChange={(v) => onUpdate('acquire', { proxyEnabled: v })} />
        </Row>
        <Row label={t('settings.acquisition.networkProxyUrl')} hint={t('settings.acquisition.networkProxyUrlHint')}>
          <input
            type="text"
            value={acquire.proxyUrl ?? 'http://127.0.0.1:7890'}
            onChange={(e) => onUpdate('acquire', { proxyUrl: e.target.value || 'http://127.0.0.1:7890' })}
            disabled={!acquire.proxyEnabled}
            style={{
              width: 260, padding: '4px 8px', fontSize: 13,
              background: 'var(--bg-base)', color: 'var(--text-primary)',
              border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)',
              outline: 'none',
              opacity: acquire.proxyEnabled ? 1 : 0.5,
            }}
          />
        </Row>
        <Row label={t('settings.acquisition.networkProxyMode')} hint={t('settings.acquisition.networkProxyModeHint')} noBorder>
          <SegmentedControl
            value={acquire.proxyMode ?? 'blocked-only'}
            options={[
              { value: 'blocked-only', label: t('settings.acquisition.networkProxyModeBlocked') },
              { value: 'all', label: t('settings.acquisition.networkProxyModeAll') },
            ]}
            onChange={(v) => onUpdate('acquire', { proxyMode: v as 'all' | 'blocked-only' })}
          />
        </Row>
      </Section>

      <Section icon={<BookOpen size={16} />} title={t('settings.acquisition.chineseDb')} description={t('settings.acquisition.chineseDbDesc')}>
        <Row label={t('settings.acquisition.enableCnki')} hint={t('settings.acquisition.enableCnkiHint')}>
          <Toggle checked={acquire.enableCnki ?? false} onChange={(v) => onUpdate('acquire', { enableCnki: v })} />
        </Row>
        <Row label={t('settings.acquisition.enableWanfang')} hint={t('settings.acquisition.enableWanfangHint')} noBorder>
          <Toggle checked={acquire.enableWanfang ?? false} onChange={(v) => onUpdate('acquire', { enableWanfang: v })} />
        </Row>
      </Section>

      <PublisherLibrarySection />

      <Section icon={<RefreshCw size={16} />} title={t('settings.acquisition.downloadSettings')}>
        <SliderRow
          label={t('settings.acquisition.downloadTimeout')}
          value={acquire.perSourceTimeoutMs / 1000}
          min={10}
          max={120}
          suffix="s"
          onChange={(v) => onUpdate('acquire', { perSourceTimeoutMs: v * 1000 })}
        />
        <Row label={t('settings.acquisition.maxRedirects')} noBorder>
          <NumberInput
            value={acquire.maxRedirects}
            min={1}
            max={10}
            onChange={(v) => onUpdate('acquire', { maxRedirects: v })}
            width={80}
          />
        </Row>
      </Section>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Publisher Library Section
// ═══════════════════════════════════════════════════════════════════

function PublisherLibrarySection() {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  return (
    <Section
      icon={<BookOpen size={16} />}
      title={t('settings.acquisition.publisherLibrary')}
      description={t('settings.acquisition.publisherLibraryDesc')}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: expanded ? 10 : 0 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {t('settings.acquisition.publisherCount', { count: PUBLISHER_REGISTRY.length })}
        </span>
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            padding: '3px 10px', fontSize: 12, border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-sm)', cursor: 'pointer',
            background: 'transparent', color: 'var(--text-secondary)',
          }}
        >
          {expanded ? t('settings.acquisition.collapse') : t('settings.acquisition.expand')}
        </button>
      </div>
      {expanded && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {PUBLISHER_REGISTRY.map((pub) => (
            <div
              key={pub.name}
              style={{
                padding: '6px 10px',
                background: 'var(--bg-base)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
                {pub.name}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                {pub.doiPrefixes.join(', ')} — {pub.domains[0]}
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// ═══════════════════════════════════════════════════════════════════
// China Institutional Access Section
// ═══════════════════════════════════════════════════════════════════

const CHINA_PUBLISHER_LABELS: Record<string, string> = {
  ieee: 'IEEE Xplore',
  elsevier: 'Elsevier / ScienceDirect',
  springer: 'Springer / Nature',
  wiley: 'Wiley',
  acs: 'ACS Publications',
  rsc: 'RSC',
  cnki: 'CNKI (知网)',
  wanfang: 'Wanfang (万方)',
};

const CHINA_PUBLISHER_DOMAINS: Record<string, string[]> = {
  ieee: ['ieeexplore.ieee.org', 'ieee.org'],
  elsevier: ['sciencedirect.com', 'elsevier.com'],
  springer: ['link.springer.com', 'springer.com', 'nature.com'],
  wiley: ['onlinelibrary.wiley.com', 'wiley.com'],
  acs: ['pubs.acs.org'],
  rsc: ['pubs.rsc.org'],
  cnki: ['cnki.net', 'cnki.com.cn', 'kns.cnki.net', 'fsso.cnki.net'],
  wanfang: ['wanfangdata.com.cn', 'd.wanfangdata.com.cn'],
};

function ChinaInstitutionalSection({ acquire, onUpdate }: {
  acquire: SettingsData['acquire'];
  onUpdate: UpdateSectionFn;
}) {
  const { t } = useTranslation();
  const [institutions, setInstitutions] = useState<Array<{ id: string; name: string; nameEn: string; publishers: string[] }>>([]);
  const [sessionStatus, setSessionStatus] = useState<{
    loggedIn: boolean;
    institutionId: string | null;
    institutionName: string | null;
    lastLogin: string | null;
    activeDomains: string[];
  } | null>(null);
  const [loginLoading, setLoginLoading] = useState<string | null>(null);
  const [verifyState, setVerifyState] = useState<Record<string, 'loading' | 'valid' | 'expired' | null>>({});
  const [loginResult, setLoginResult] = useState<{ publisher: string; success: boolean; cookieCount: number } | null>(null);
  void loginResult; // tracked for future UI display

  const api = getAPI();

  useEffect(() => {
    api.acquire.getInstitutions().then((list) => list && setInstitutions(list)).catch(() => {});
    api.acquire.sessionStatus().then((s) => s && setSessionStatus(s)).catch(() => {});
  }, []);

  const selectedInst = institutions.find((i) => i.id === acquire.chinaInstitutionId);

  const handleLogin = async (publisher: string) => {
    if (!acquire.chinaInstitutionId) return;
    setLoginLoading(publisher);
    setLoginResult(null);
    try {
      const result = await api.acquire.institutionalLogin(acquire.chinaInstitutionId, publisher);
      if (result) {
        setLoginResult({ publisher, success: result.success, cookieCount: result.cookieCount });
        const label = CHINA_PUBLISHER_LABELS[publisher] ?? publisher;
        if (result.success) {
          toast.success(t('settings.acquisition.chinaInstitutional.loginSuccess', { label, count: result.cookieCount }));
        } else {
          toast.error(t('settings.acquisition.chinaInstitutional.loginFailed', { label }));
        }
      }
    } catch (err) {
      console.error('Institutional login failed:', err);
      setLoginResult({ publisher, success: false, cookieCount: 0 });
      toast.error(t('settings.acquisition.chinaInstitutional.loginError', { label: CHINA_PUBLISHER_LABELS[publisher] ?? publisher }));
    } finally {
      try {
        const status = await api.acquire.sessionStatus();
        if (status) setSessionStatus(status);
      } catch { /* ignore */ }
      setLoginLoading(null);
    }
  };

  const handleVerify = async (publisher: string) => {
    setVerifyState((prev) => ({ ...prev, [publisher]: 'loading' }));
    try {
      const result = await api.acquire.verifyCookies(publisher);
      setVerifyState((prev) => ({ ...prev, [publisher]: result.valid ? 'valid' : 'expired' }));
    } catch {
      setVerifyState((prev) => ({ ...prev, [publisher]: 'expired' }));
    }
  };

  const handleClearSession = async () => {
    await api.acquire.clearSession();
    setSessionStatus({ loggedIn: false, institutionId: null, institutionName: null, lastLogin: null, activeDomains: [] });
    setVerifyState({});
  };

  return (
    <Section
      icon={<Shield size={16} />}
      title={t('settings.acquisition.chinaInstitutional.title')}
      description={t('settings.acquisition.chinaInstitutional.description')}
    >
      <Row label={t('settings.acquisition.chinaInstitutional.university')} noBorder={!acquire.chinaInstitutionId}>
        <select
          value={acquire.chinaInstitutionId ?? ''}
          onChange={(e) => {
            const id = e.target.value || null;
            onUpdate('acquire', {
              chinaInstitutionId: id,
              enableChinaInstitutional: !!id,
            });
          }}
          style={{
            width: 220, padding: '4px 8px', fontSize: 13,
            background: 'var(--bg-base)', color: 'var(--text-primary)',
            border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)',
          }}
        >
          <option value="">{t('settings.acquisition.chinaInstitutional.selectUniversity')}</option>
          {institutions.map((inst) => (
            <option key={inst.id} value={inst.id}>
              {inst.name} ({inst.nameEn})
            </option>
          ))}
          <option value="__custom">{t('settings.acquisition.chinaInstitutional.customIdp')}</option>
        </select>
      </Row>

      {acquire.chinaInstitutionId === '__custom' && (
        <Row
          label={t('settings.acquisition.chinaInstitutional.idpEntityId')}
          hint={t('settings.acquisition.chinaInstitutional.idpEntityIdHint')}
          noBorder
        >
          <input
            type="text"
            value={acquire.chinaCustomIdpEntityId ?? ''}
            placeholder="https://idp.your-university.edu.cn/idp/shibboleth"
            onChange={(e) => onUpdate('acquire', { chinaCustomIdpEntityId: e.target.value || null })}
            style={{
              width: 340, padding: '4px 8px', fontSize: 13,
              background: 'var(--bg-base)', color: 'var(--text-primary)',
              border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)',
            }}
          />
        </Row>
      )}

      {acquire.chinaInstitutionId && acquire.chinaInstitutionId !== '__custom' && selectedInst && (
        <div style={{ padding: '12px 0' }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
            {t('settings.acquisition.chinaInstitutional.databaseLogins')}
            {sessionStatus?.lastLogin && (
              <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                {t('settings.acquisition.chinaInstitutional.lastLogin', { time: new Date(sessionStatus.lastLogin).toLocaleString() })}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {selectedInst.publishers.map((pub) => {
              const isLoading = loginLoading === pub;
              const domains = CHINA_PUBLISHER_DOMAINS[pub] ?? [];
              const hasSession = sessionStatus?.activeDomains.some((d) =>
                domains.some((pd) => d.includes(pd)),
              );
              return (
                <div
                  key={pub}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '6px 10px',
                    background: 'var(--bg-base)',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-sm)',
                  }}
                >
                  <div style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)' }}>
                    {CHINA_PUBLISHER_LABELS[pub] ?? pub}
                  </div>
                  {hasSession && verifyState[pub] !== 'expired' ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {verifyState[pub] === 'valid' ? (
                        <span style={{ fontSize: 12, color: 'var(--success, #22c55e)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Check size={14} /> {t('settings.acquisition.chinaInstitutional.statusValid')}
                        </span>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--success, #22c55e)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Check size={14} /> {t('settings.acquisition.chinaInstitutional.statusLoggedIn')}
                        </span>
                      )}
                      <button
                        onClick={() => handleVerify(pub)}
                        disabled={verifyState[pub] === 'loading'}
                        style={{
                          padding: '2px 8px', fontSize: 11,
                          background: 'transparent',
                          color: 'var(--text-muted)',
                          border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)',
                          cursor: verifyState[pub] === 'loading' ? 'wait' : 'pointer',
                        }}
                      >
                        {verifyState[pub] === 'loading'
                          ? t('settings.acquisition.chinaInstitutional.verifying')
                          : t('settings.acquisition.chinaInstitutional.verify')}
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {verifyState[pub] === 'expired' && (
                        <span style={{ fontSize: 11, color: 'var(--warning, #f59e0b)' }}>
                          {t('settings.acquisition.chinaInstitutional.sessionExpired')}
                        </span>
                      )}
                      <button
                        onClick={() => { setVerifyState((prev) => ({ ...prev, [pub]: null })); handleLogin(pub); }}
                        disabled={!!loginLoading}
                        style={{
                          padding: '3px 12px', fontSize: 12,
                          background: isLoading ? 'var(--bg-muted)' : 'var(--bg-base)',
                          color: isLoading ? 'var(--text-muted)' : 'var(--text-primary)',
                          border: `1px solid ${verifyState[pub] === 'expired' ? 'var(--warning, #f59e0b)' : 'var(--border-default)'}`,
                          borderRadius: 'var(--radius-sm)',
                          cursor: isLoading ? 'wait' : 'pointer',
                          display: 'flex', alignItems: 'center', gap: 4,
                        }}
                      >
                        {isLoading ? <Loader2 size={12} className="spin" /> : <ExternalLink size={12} />}
                        {isLoading
                          ? t('settings.acquisition.chinaInstitutional.loggingIn')
                          : verifyState[pub] === 'expired'
                            ? t('settings.acquisition.chinaInstitutional.reLogin')
                            : t('settings.acquisition.chinaInstitutional.login')}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {sessionStatus?.loggedIn && (
            <button
              onClick={handleClearSession}
              style={{
                marginTop: 10, padding: '4px 12px', fontSize: 12,
                background: 'transparent',
                color: 'var(--text-muted)',
                border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
              }}
            >
              {t('settings.acquisition.chinaInstitutional.clearSessions')}
            </button>
          )}
        </div>
      )}
    </Section>
  );
}
