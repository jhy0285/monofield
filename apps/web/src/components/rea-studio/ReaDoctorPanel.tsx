'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@open-design/components';
import type { ReaDoctorCheck, ReaDoctorCheckId, ReaDoctorResponse } from '@open-design/contracts';
import { useI18n } from '../../i18n';
import styles from './ReaDoctorPanel.module.css';

const NEED_KEY = {
  bundled: 'reaDoctor.need.bundled', node: 'reaDoctor.need.node', npx: 'reaDoctor.need.npx', mcp: 'reaDoctor.need.mcp', browser: 'reaDoctor.need.browser', ghidra: 'reaDoctor.need.ghidra', native: 'reaDoctor.need.native',
  java: 'reaDoctor.need.java', jadx: 'reaDoctor.need.jadx', apktool: 'reaDoctor.need.apktool', tshark: 'reaDoctor.need.tshark', adb: 'reaDoctor.need.adb',
} as const satisfies Record<ReaDoctorCheckId, string>;
const NOTE_KEY = {
  'outside-range': 'reaDoctor.note.outsideRange', disabled: 'reaDoctor.note.disabled', 'other-version': 'reaDoctor.note.otherVersion', 'custom-command': 'reaDoctor.note.customCommand',
  'not-set': 'reaDoctor.note.notSet', 'empty-value': 'reaDoctor.note.emptyValue', 'not-absolute': 'reaDoctor.note.notAbsolute',
  'no-analyze-headless': 'reaDoctor.note.noAnalyzeHeadless', 'no-java': 'reaDoctor.note.noJava',
  'not-installed': 'reaDoctor.note.notInstalled', 'not-needed': 'reaDoctor.note.notNeeded', 'runs-bundled': 'reaDoctor.note.runsBundled',
} as const;
const noteKey = (note: string | undefined) => (note && note in NOTE_KEY ? NOTE_KEY[note as keyof typeof NOTE_KEY] : null);
const GLYPH: Readonly<Record<ReaDoctorCheck['status'], string>> = { ok: '✓', warn: '!', missing: '✕' };

/**
 * Everything REA needs, checked in one place: the REA copy that ships with MonoField (or else Node.js and npx), the REA MCP server in these settings, and the browser and
 * engines some targets use. The daemon looks; this shows what it found, what each item is for, and adds REA to the MCP
 * list (saved with the section's own Save button) when it is missing.
 */
export function ReaDoctorPanel({ mcpRow, onAddRea, refreshKey }: {
  /** The REA entry in the MCP list being edited: absent, added or changed but not saved yet, or saved. */
  mcpRow: 'none' | 'unsaved' | 'saved';
  onAddRea?: () => void;
  /** Changes after a save, so the check reads the saved settings again. */
  refreshKey?: number | null;
}) {
  const { t } = useI18n();
  const [result, setResult] = useState<ReaDoctorResponse | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/rea/doctor');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setResult(await response.json() as ReaDoctorResponse);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    setBusy(false);
  }, []);
  useEffect(() => { void run(); }, [run, refreshKey]);

  const label = (id: ReaDoctorCheckId) => (id === 'bundled' ? t('reaDoctor.label.bundled') : id === 'node' ? `Node.js ${result?.package.node ?? ''}`.trim()
    : id === 'mcp' ? t('reaDoctor.label.mcp') : id === 'browser' ? t('reaDoctor.label.browser') : id === 'native' ? t('reaDoctor.label.native')
      : ({ npx: 'npx', ghidra: 'Ghidra', java: 'Java', jadx: 'JADX', apktool: 'Apktool', tshark: 'tshark', adb: 'adb' } as const)[id]);
  const checks = result ? [...result.checks].sort((a, b) => Number(b.required) - Number(a.required)) : [];

  return <section className={styles.root} data-testid="rea-doctor" aria-label={t('reaDoctor.title')}>
    <div className={styles.head}>
      <div>
        <h4 className={styles.title}>{t('reaDoctor.title')} {result ? <span className={styles.version}>rea-agents {result.package.version}</span> : null}</h4>
        {result ? <p className={styles.verdict} data-ready={result.ready} role="status">{t(result.ready ? 'reaDoctor.ready' : 'reaDoctor.notReady')}</p> : null}
      </div>
      <Button variant="ghost" onClick={() => void run()} disabled={busy} data-testid="rea-doctor-run">{busy ? t('common.loading') : t('reaDoctor.run')}</Button>
    </div>
    {error ? <p className={styles.alert} role="alert">{t('reaDoctor.failed')} {error}</p> : null}
    {checks.length ? <ul className={styles.list}>
      {checks.map((check) => <li key={check.id} className={styles.item} data-status={check.status} data-testid={`rea-doctor-${check.id}`}>
        <span className={styles.glyph} aria-hidden>{GLYPH[check.status]}</span>
        <div className={styles.body}>
          <div className={styles.line}>
            <b>{label(check.id)}</b>
            <span className={styles.tag}>{t(check.required ? 'reaDoctor.required' : 'reaDoctor.optional')}</span>
            {noteKey(check.note) ? <span className={styles.note}>{t(noteKey(check.note)!)}</span> : null}
          </div>
          <p className={styles.need}>{t(NEED_KEY[check.id])}</p>
          <code className={styles.found}>{check.found ?? t('reaDoctor.notFound')}</code>
          {check.id === 'mcp' && check.status === 'missing' && onAddRea ? (mcpRow === 'none'
            ? <Button variant="primary" onClick={onAddRea} data-testid="rea-doctor-add">{t('reaDoctor.addMcp')}</Button>
            : <p className={styles.need} role="status">{t('reaDoctor.saveHint')}</p>) : null}
          {check.id === 'mcp' && check.status !== 'missing' && mcpRow === 'unsaved' ? <p className={styles.need}>{t('reaDoctor.saveHint')}</p> : null}
        </div>
      </li>)}
    </ul> : null}
    {result?.bundled ? <details className={styles.launch} data-testid="rea-doctor-launch">
      <summary>{t('reaDoctor.launchTitle')}</summary>
      <dl>
        <dt>{t('reaDoctor.launchCommand')}</dt><dd><code>{result.bundled.command}</code></dd>
        <dt>{t('reaDoctor.launchArgs')}</dt><dd><code>{result.bundled.args.join(' ')}</code></dd>
        {Object.keys(result.bundled.env).length ? <><dt>{t('reaDoctor.launchEnv')}</dt>
          <dd><code>{Object.entries(result.bundled.env).map(([key, value]) => `${key}=${value}`).join(' ')}</code></dd></> : null}
      </dl>
    </details> : null}
    <p className={styles.scope}>{t('reaDoctor.scope')} <code>monofield rea doctor</code></p>
  </section>;
}
