import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle, Input, Select } from '@open-design/components';
import {
  RUN_OUTPUT_FORMATS,
  type RunLogEntry,
  type RunLogListResponse,
  type RunLogStatus,
  type RunOutput,
  type RunOutputDetailResponse,
  type RunOutputFormat,
  type RunOutputListResponse,
  type RunUsageBucket,
  type RunUsageSummaryResponse,
  WORK_ISSUE_STATUSES,
  type WorkIssue,
  type WorkIssueStatus,
  type WorkQueueResponse,
} from '@open-design/contracts';
import { useI18n, useT } from '../../i18n';
import type { Dict } from '../../i18n/types';
import { navigate } from '../../router';
import { formatBytes, previewKind, resultsApi } from './api';
import { CheckBadge, CheckDialog } from './RunCheck';
import styles from './ResultsView.module.css';

type DictKey = keyof Dict;
type Translate = ReturnType<typeof useT>;
type Tab = 'board' | 'files' | 'runs';
type FilesLayout = 'list' | 'grid';

const FORMAT_KEY: Record<RunOutputFormat, DictKey> = {
  document: 'results.format.document', sheet: 'results.format.sheet', slides: 'results.format.slides', image: 'results.format.image',
  data: 'results.format.data', web: 'results.format.web', media: 'results.format.media',
};
const STATUS_KEY: Record<RunLogStatus, DictKey> = {
  running: 'designs.status.running', succeeded: 'designs.status.succeeded', failed: 'designs.status.failed', canceled: 'designs.status.canceled',
};
const CHANGE_KEY: Record<RunOutput['change'], DictKey> = {
  created: 'results.change.created', modified: 'results.change.modified', 'before-restore': 'results.change.beforeRestore',
};
const CURRENT_KEY: Record<RunOutputDetailResponse['current'], DictKey> = {
  same: 'results.current.same', changed: 'results.current.changed', missing: 'results.current.missing',
};
const ISSUE_STATUS_KEY: Record<WorkIssueStatus, DictKey> = {
  running: 'designs.status.running', 'needs-reply': 'results.board.needsReply', done: 'designs.status.succeeded', failed: 'results.board.failed',
};
const TAB_KEY: Record<Tab, DictKey> = { board: 'results.tabBoard', files: 'results.tabFiles', runs: 'results.tabRuns' };
const LAYOUT_STORAGE_KEY = 'monofield:results-layout';
const PREVIEW_TEXT_LIMIT = 200_000;
const STATUSES: RunLogStatus[] = ['running', 'succeeded', 'failed', 'canceled'];

function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

function useFormatters() {
  const { locale } = useI18n();
  return useMemo(() => {
    const time = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
    const number = new Intl.NumberFormat(locale);
    return { time: (ms: number) => time.format(new Date(ms)), count: (value: number) => number.format(value) };
  }, [locale]);
}

/** What the files tab is narrowed to after a jump from the board or the work log. */
type FilesScope = { kind: 'run'; run: RunLogEntry } | { kind: 'issue'; issue: WorkIssue } | null;

/**
 * The work queue: a board of request threads by what each needs next, the files AI runs left (found by request,
 * tool, project or format, with their versions), and the work log with what each tool reported using. The CLI reads
 * the same data (`monofield queue`, `monofield outputs`, `monofield usage`).
 */
export function ResultsView() {
  const t = useT();
  const [tab, setTab] = useState<Tab>('board');
  const [scope, setScope] = useState<FilesScope>(null);
  const showFiles = (next: FilesScope) => { setScope(next); setTab('files'); };

  return (
    <div className={styles.page} data-testid="results-view">
      <header className={styles.hero}>
        <div>
          <h1 className={styles.title}>{t('results.title')}</h1>
          <p className={styles.lede}>{t('results.subtitle')}</p>
        </div>
        <Button variant="primary" onClick={() => navigate({ kind: 'home', view: 'home' })} data-testid="results-new-request">{t('results.board.newRequest')}</Button>
      </header>
      <div className={styles.tabs} role="tablist" aria-label={t('results.title')}>
        {(['board', 'files', 'runs'] as const).map((id) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`${styles.tab} ${tab === id ? styles.tabActive : ''}`}
            onClick={() => setTab(id)} data-testid={`results-tab-${id}`}>
            {t(TAB_KEY[id])}
          </button>
        ))}
      </div>
      {tab === 'board' ? <BoardPanel t={t} onShowFiles={(issue) => showFiles({ kind: 'issue', issue })} /> : null}
      {tab === 'files' ? <FilesPanel t={t} scope={scope} onClearScope={() => setScope(null)} /> : null}
      {tab === 'runs' ? <RunsPanel t={t} onShowFiles={(run) => showFiles({ kind: 'run', run })} /> : null}
    </div>
  );
}

const issueLabel = (issue: Pick<WorkIssue, 'number' | 'title'>) => `#${issue.number} ${issue.title}`;

function BoardPanel({ t, onShowFiles }: { t: Translate; onShowFiles: (issue: WorkIssue) => void }) {
  const format = useFormatters();
  const [queue, setQueue] = useState<WorkQueueResponse | null>(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    void resultsApi.queue().then((result) => {
      if (!live) return;
      if (result.ok) { setQueue(result.value); setError(''); } else setError(result.message);
    });
    return () => { live = false; };
  }, [tick]);

  // The board is a live view: quick while something runs, slow otherwise, so a request sent from another tab shows up.
  const [checkRun, setCheckRun] = useState<string | null>(null);
  const busy = (queue?.running ?? 0) > 0 || Boolean(queue?.issues.some((issue) => issue.lastRun.check?.state === 'pending'));
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), busy ? 3000 : 15000);
    return () => window.clearInterval(timer);
  }, [busy]);

  if (error && !queue) return <p className={styles.error} role="alert">{t('results.loadFailed')} {error}</p>;
  if (!queue) return null;
  if (queue.issues.length === 0) return <p className={styles.empty}>{t('results.board.empty')}</p>;

  return (
    <div className={styles.board} data-testid="results-board">
      <p className={`${styles.runner} ${busy ? styles.runnerBusy : ''}`} aria-live="polite">{t('results.board.running', { n: queue.running })}</p>
      <div className={styles.columns}>
        {WORK_ISSUE_STATUSES.map((status) => {
          const issues = queue.issues.filter((issue) => issue.status === status);
          return (
            <section key={status} className={styles.column} aria-label={t(ISSUE_STATUS_KEY[status])} data-testid={`results-column-${status}`}>
              <h2 className={styles.columnTitle}>
                <span className={`${styles.dot} ${styles[`dot_${status}`] ?? ''}`} aria-hidden="true" />
                {t(ISSUE_STATUS_KEY[status])}
                <span className={styles.columnCount}>{issues.length}</span>
              </h2>
              {issues.length === 0 ? <p className={styles.columnEmpty}>{t('results.board.emptyColumn')}</p> : null}
              {issues.map((issue) => (
                <article key={issue.conversationId} className={styles.card}>
                  <button type="button" className={styles.cardTitle} disabled={!issue.projectId || !issue.projectName}
                    onClick={() => issue.projectId && navigate({ kind: 'project', projectId: issue.projectId, conversationId: issue.conversationId, fileName: null })}>
                    <span className={styles.issueNumber}>#{issue.number}</span>
                    <span>{issue.title}</span>
                  </button>
                  {issue.lastRun.request && issue.lastRun.request !== issue.title ? <p className={styles.cardRequest}>{issue.lastRun.request}</p> : null}
                  <p className={styles.cardMeta}>
                    {issue.projectName ?? t('results.deletedProject')} · {t('results.board.runs', { n: issue.runCount })}
                    {issue.totalTokens ? ` · ${t('results.runs.tokens', { n: format.count(issue.totalTokens) })}` : ''}
                  </p>
                  <CheckBadge check={issue.lastRun.check} onOpen={() => setCheckRun(issue.lastRun.runId)} />
                  <div className={styles.cardFoot}>
                    {issue.lastRun.agentName ? <span className={styles.agent}>{issue.lastRun.agentName}</span> : null}
                    <span className={styles.when}>{format.time(issue.updatedAt)}</span>
                    {issue.outputCount > 0 ? <Button onClick={() => onShowFiles(issue)}>{t('results.runs.files', { n: issue.outputCount })}</Button> : null}
                  </div>
                </article>
              ))}
            </section>
          );
        })}
      </div>
      {checkRun ? <CheckDialog runId={checkRun} onClose={() => setCheckRun(null)} /> : null}
    </div>
  );
}

function storedLayout(): FilesLayout {
  try { return window.localStorage.getItem(LAYOUT_STORAGE_KEY) === 'grid' ? 'grid' : 'list'; } catch { return 'list'; }
}

function FilesPanel({ t, scope, onClearScope }: { t: Translate; scope: FilesScope; onClearScope: () => void }) {
  const format = useFormatters();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<RunOutputFormat | ''>('');
  const [projectId, setProjectId] = useState('');
  const [agentId, setAgentId] = useState('');
  const [allVersions, setAllVersions] = useState(false);
  const [data, setData] = useState<RunOutputListResponse | null>(null);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [layout, setLayout] = useState<FilesLayout>(storedLayout);
  const search = useDebounced(q, 250);
  const chooseLayout = (next: FilesLayout) => {
    setLayout(next);
    try { window.localStorage.setItem(LAYOUT_STORAGE_KEY, next); } catch { /* a remembered view is a convenience */ }
  };

  useEffect(() => {
    let live = true;
    void resultsApi.list({
      ...(search.trim() ? { q: search.trim() } : {}), ...(kind ? { format: kind } : {}), ...(projectId ? { projectId } : {}),
      ...(agentId ? { agentId } : {}), ...(allVersions ? { allVersions: true } : {}), ...(scope?.kind === 'run' ? { runId: scope.run.runId } : {}),
      ...(scope?.kind === 'issue' ? { conversationId: scope.issue.conversationId } : {}), limit: 200,
    }).then((result) => {
      if (!live) return;
      if (result.ok) { setData(result.value); setError(''); } else setError(result.message);
    });
    return () => { live = false; };
  }, [search, kind, projectId, agentId, allVersions, scope, reload]);

  const filtered = Boolean(search.trim() || kind || projectId || agentId || scope);
  const outputs = data?.outputs ?? [];

  return (
    <div className={styles.split}>
      <section className={styles.listPane} aria-label={t('results.tabFiles')}>
        <div className={styles.filters}>
          <Input type="search" value={q} onChange={(event) => setQ(event.target.value)} placeholder={t('results.searchPlaceholder')}
            aria-label={t('results.searchPlaceholder')} className={styles.search} data-testid="results-search" />
          <Select value={kind} onChange={(event) => setKind(event.target.value as RunOutputFormat | '')} aria-label={t('results.allFormats')}>
            <option value="">{t('results.allFormats')}</option>
            {RUN_OUTPUT_FORMATS.map((id) => {
              const found = data?.facets.formats.find((facet) => facet.id === id);
              return found || kind === id ? <option key={id} value={id}>{t(FORMAT_KEY[id])} ({found?.count ?? 0})</option> : null;
            })}
          </Select>
          <Select value={projectId} onChange={(event) => setProjectId(event.target.value)} aria-label={t('results.allProjects')}>
            <option value="">{t('results.allProjects')}</option>
            {data?.facets.projects.map((facet) => <option key={facet.id} value={facet.id}>{facet.label} ({facet.count})</option>)}
          </Select>
          <Select value={agentId} onChange={(event) => setAgentId(event.target.value)} aria-label={t('results.allAgents')}>
            <option value="">{t('results.allAgents')}</option>
            {data?.facets.agents.map((facet) => <option key={facet.id} value={facet.id}>{facet.label} ({facet.count})</option>)}
          </Select>
          <label className={styles.check}>
            <input type="checkbox" checked={allVersions} onChange={(event) => setAllVersions(event.target.checked)} />
            {t('results.allVersions')}
          </label>
          <span className={styles.layoutToggle} role="group" aria-label={`${t('results.viewList')} / ${t('results.viewGrid')}`}>
            {(['list', 'grid'] as const).map((id) => (
              <button key={id} type="button" aria-pressed={layout === id} className={layout === id ? styles.layoutActive : undefined} onClick={() => chooseLayout(id)}
                data-testid={`results-layout-${id}`}>{t(id === 'list' ? 'results.viewList' : 'results.viewGrid')}</button>
            ))}
          </span>
          <span className={styles.total} aria-live="polite">{data ? t('results.count', { n: format.count(data.total) }) : ''}</span>
        </div>
        {scope ? (
          <p className={styles.runFilter}>
            <span>{t('results.runFilter', { request: scope.kind === 'issue' ? issueLabel(scope.issue) : scope.run.request || t('results.runs.noRequest') })}</span>
            <Button variant="ghost" onClick={onClearScope}>{t('results.runFilterClear')}</Button>
          </p>
        ) : null}
        {error ? <p className={styles.error} role="alert">{t('results.loadFailed')} {error}</p> : null}
        {data && outputs.length === 0 && !error ? (
          <p className={styles.empty}>{t(filtered ? 'results.emptyFiltered' : 'results.empty')}</p>
        ) : null}
        {outputs.length > 0 && layout === 'grid' ? (
          <ul className={styles.grid}>
            {outputs.map((output) => (
              <li key={output.id}>
                <button type="button" className={`${styles.tile} ${output.id === selectedId ? styles.tileSelected : ''}`} aria-pressed={output.id === selectedId}
                  onClick={() => setSelectedId(output.id)}>
                  <span className={styles.thumb}>
                    {output.stored && previewKind(output.name) === 'image'
                      ? <img src={resultsApi.contentUrl(output.id)} alt="" loading="lazy" />
                      : <span className={styles.thumbFormat}>{output.name.split('.').pop()?.toUpperCase()}</span>}
                  </span>
                  <span className={styles.tileName}>{output.name}{output.versionCount > 1 ? <span className={styles.version}>v{output.version}/{output.versionCount}</span> : null}</span>
                  <span className={styles.tileMeta}>{origin(output, t) || output.projectName || t('results.deletedProject')} · {formatBytes(output.size)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {outputs.length > 0 && layout === 'list' ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t('results.colFile')}</th>
                  <th scope="col">{t('results.colRequest')}</th>
                  <th scope="col">{t('results.colAgent')}</th>
                  <th scope="col" className={styles.numeric}>{t('results.colSize')}</th>
                  <th scope="col">{t('results.colCreated')}</th>
                </tr>
              </thead>
              <tbody>
                {outputs.map((output) => (
                  <tr key={output.id} className={output.id === selectedId ? styles.rowSelected : undefined} onClick={() => setSelectedId(output.id)}>
                    <td>
                      <button type="button" className={styles.fileButton} aria-pressed={output.id === selectedId} onClick={() => setSelectedId(output.id)}>
                        <span className={styles.formatTag}>{t(FORMAT_KEY[output.format])}</span>
                        <span className={styles.fileName}>{output.name}</span>
                        {output.versionCount > 1 ? <span className={styles.version}>v{output.version}/{output.versionCount}</span> : null}
                      </button>
                      <span className={styles.project}>{[output.projectName ?? t('results.deletedProject'), origin(output, t)].filter(Boolean).join(' · ')}</span>
                    </td>
                    <td><span className={styles.request}>{output.request || (output.change === 'before-restore' ? t('results.change.beforeRestore') : '')}</span></td>
                    <td>{output.agentName ? <span className={styles.agent}>{output.agentName}</span> : null}</td>
                    <td className={styles.numeric}>{formatBytes(output.size)}</td>
                    <td className={styles.when}>{format.time(output.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
      <DetailPane t={t} id={selectedId} onSelect={setSelectedId} onChanged={() => setReload((value) => value + 1)} />
    </div>
  );
}

/** "#3 · 실행 12": the thread and run a result came from, as people say it. */
function origin(output: Pick<RunOutput, 'issueNumber' | 'runNumber'>, t: Translate): string {
  return output.issueNumber !== null && output.runNumber !== null ? `#${output.issueNumber} · ${t('results.usage.runs')} ${output.runNumber}` : '';
}

function DetailPane({ t, id, onSelect, onChanged }: { t: Translate; id: string | null; onSelect: (id: string) => void; onChanged: () => void }) {
  const format = useFormatters();
  const [detail, setDetail] = useState<RunOutputDetailResponse | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [large, setLarge] = useState(false);

  const load = useCallback(async (target: string) => {
    const result = await resultsApi.detail(target);
    if (result.ok) setDetail(result.value);
    else { setDetail(null); setMessage(result.message); }
  }, []);

  useEffect(() => {
    setDetail(null);
    setText(null);
    setMessage('');
    setLarge(false);
    if (id) void load(id);
  }, [id, load]);

  const output = detail?.output ?? null;
  const preview = output?.stored ? previewKind(output.name) : 'none';
  useEffect(() => {
    if (!output || preview !== 'text') return;
    let live = true;
    void fetch(resultsApi.contentUrl(output.id)).then((response) => response.ok ? response.text() : '').then((body) => {
      if (live) setText(body.slice(0, PREVIEW_TEXT_LIMIT));
    }).catch(() => { if (live) setText(''); });
    return () => { live = false; };
  }, [output, preview]);

  if (!id || !output || !detail) {
    return <aside className={styles.detail} aria-label={t('results.versions')}><p className={styles.hint}>{message || t('results.selectHint')}</p></aside>;
  }

  const restore = async () => {
    setBusy(true);
    const result = await resultsApi.restore(output.id);
    setBusy(false);
    if (!result.ok) { setMessage(result.message); return; }
    setMessage(t('results.restored', { name: output.name, version: output.version })
      + (result.value.savedBefore ? ` ${t('results.restoredSaved', { version: result.value.savedBefore.version })}` : ''));
    await load(output.id);
    onChanged();
  };

  return (
    <aside className={styles.detail} aria-label={t('results.versions')} data-testid="results-detail">
      <h2 className={styles.detailTitle}>
        {output.name}
        <span className={styles.version}>v{output.version}{output.latest ? ` · ${t('results.latest')}` : ''}</span>
      </h2>
      <div className={styles.actions}>
        <Button onClick={() => navigate({ kind: 'project', projectId: output.projectId, conversationId: output.conversationId, fileName: null })}
          disabled={!output.projectName}>{t('results.openProject')}</Button>
        {output.stored ? <a className={styles.linkButton} href={resultsApi.contentUrl(output.id, true)} download={output.name}>{t('results.download')}</a> : null}
        {preview !== 'none' ? <Button onClick={() => setLarge(true)}>{t('results.enlarge')}</Button> : null}
        <Button variant="primary" onClick={() => void restore()} disabled={busy || !output.stored || detail.current === 'same'}>{t('results.restore')}</Button>
      </div>
      <p className={`${styles.current} ${detail.current === 'same' ? styles.currentSame : ''}`}>{t(CURRENT_KEY[detail.current])}</p>
      {message ? <p className={styles.notice} role="status">{message}</p> : null}

      <div className={styles.preview}>
        {!output.stored ? <p className={styles.hint}>{t('results.notStored')}</p>
          : preview === 'image' ? <img src={resultsApi.contentUrl(output.id)} alt={output.name} />
            : preview === 'text' ? <pre>{text ?? ''}</pre>
              : <p className={styles.hint}>{t('results.noPreview')}</p>}
      </div>

      {large ? (
        <Dialog onClose={() => setLarge(false)} ariaLabel={output.name} className={styles.largeDialog}>
          <DialogHeader>
            <DialogTitle>{output.name}</DialogTitle>
          </DialogHeader>
          <DialogBody className={styles.largeBody}>
            {preview === 'image' ? <img src={resultsApi.contentUrl(output.id)} alt={output.name} /> : <pre>{text ?? ''}</pre>}
          </DialogBody>
          <DialogFooter>
            <Button onClick={() => setLarge(false)}>{t('common.close')}</Button>
          </DialogFooter>
        </Dialog>
      ) : null}

      <dl className={styles.meta}>
        {output.issueNumber !== null && output.issueTitle ? <><dt>#{output.issueNumber}</dt><dd>{output.issueTitle}{output.runNumber !== null ? ` · ${t('results.usage.runs')} ${output.runNumber}` : ''}</dd></> : null}
        {output.request ? <><dt>{t('results.colRequest')}</dt><dd>{output.request}</dd></> : null}
        <dt>{t('results.metaProject')}</dt><dd>{output.projectName ?? t('results.deletedProject')}</dd>
        <dt>{t('results.metaPath')}</dt><dd className={styles.mono}>{output.path}</dd>
        <dt>{t('results.colCreated')}</dt>
        <dd>{format.time(output.createdAt)} · {t(CHANGE_KEY[output.change])}{output.agentName ? ` · ${output.agentName}` : ''}</dd>
        <dt>{t('results.colSize')}</dt><dd>{formatBytes(output.size)} · {t(FORMAT_KEY[output.format])}</dd>
        {detail.run?.usage.measured ? <><dt>{t('results.usage.tokens')}</dt><dd>{format.count(detail.run.usage.totalTokens)}</dd></> : null}
        {output.sha256 ? <><dt>SHA-256</dt><dd className={styles.mono}>{output.sha256}</dd></> : null}
      </dl>

      {detail.versions.length > 1 ? (
        <section>
          <h3 className={styles.sectionTitle}>{t('results.versions')}</h3>
          <ul className={styles.sideList}>
            {detail.versions.map((version) => (
              <li key={version.id}>
                <button type="button" className={`${styles.sideItem} ${version.id === output.id ? styles.sideItemActive : ''}`} onClick={() => onSelect(version.id)}>
                  <span className={styles.version}>v{version.version}</span>
                  <span>{format.time(version.createdAt)}</span>
                  <span className={styles.sideMuted}>{version.agentName ?? t(CHANGE_KEY[version.change])}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {detail.sameRun.length ? (
        <section>
          <h3 className={styles.sectionTitle}>{t('results.sameRun', { n: detail.sameRun.length })}</h3>
          <ul className={styles.sideList}>
            {detail.sameRun.map((other) => (
              <li key={other.id}>
                <button type="button" className={styles.sideItem} onClick={() => onSelect(other.id)}>
                  <span>{other.name}</span>
                  <span className={styles.sideMuted}>{formatBytes(other.size)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </aside>
  );
}

function BucketTable({ t, title, column, buckets, count }: { t: Translate; title: string; column: string; buckets: RunUsageBucket[]; count: (value: number) => string }) {
  if (!buckets.length) return null;
  return (
    <section className={styles.bucket}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">{column}</th>
            <th scope="col" className={styles.numeric}>{t('results.usage.runs')}</th>
            <th scope="col" className={styles.numeric}>{t('results.usage.input')}</th>
            <th scope="col" className={styles.numeric}>{t('results.usage.output')}</th>
            <th scope="col" className={styles.numeric}>{t('results.usage.tokens')}</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((bucket) => (
            <tr key={bucket.key}>
              <th scope="row">{bucket.label}</th>
              <td className={styles.numeric}>{count(bucket.runs)}</td>
              <td className={styles.numeric}>{count(bucket.inputTokens)}</td>
              <td className={styles.numeric}>{count(bucket.outputTokens)}</td>
              <td className={styles.numeric}>{count(bucket.totalTokens)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function RunsPanel({ t, onShowFiles }: { t: Translate; onShowFiles: (run: RunLogEntry) => void }) {
  const format = useFormatters();
  const [days, setDays] = useState<'7' | '30' | 'all'>('7');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<RunLogStatus | ''>('');
  const [summary, setSummary] = useState<RunUsageSummaryResponse | null>(null);
  const [runs, setRuns] = useState<RunLogListResponse | null>(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const search = useDebounced(q, 250);

  useEffect(() => {
    let live = true;
    const from = days === 'all' ? {} : { from: Date.now() - Number(days) * 24 * 60 * 60 * 1000 };
    void resultsApi.usage(from).then((result) => { if (live && result.ok) setSummary(result.value); });
    void resultsApi.runs({ ...from, ...(search.trim() ? { q: search.trim() } : {}), ...(status ? { status } : {}), limit: 200 }).then((result) => {
      if (!live) return;
      if (result.ok) { setRuns(result.value); setError(''); } else setError(result.message);
    });
    return () => { live = false; };
  }, [days, search, status, tick]);

  // While something is still running, read the log again so its row and the totals settle without a reload.
  const [checkRun, setCheckRun] = useState<string | null>(null);
  const anyRunning = Boolean(runs?.runs.some((run) => run.status === 'running' || run.check?.state === 'pending'));
  useEffect(() => {
    if (!anyRunning) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 4000);
    return () => window.clearInterval(timer);
  }, [anyRunning]);

  const totals = summary?.totals;
  return (
    <div className={styles.runs}>
      <div className={styles.filters}>
        <Select value={days} onChange={(event) => setDays(event.target.value as typeof days)} aria-label={t('results.period')}>
          <option value="7">{t('results.period7')}</option>
          <option value="30">{t('results.period30')}</option>
          <option value="all">{t('results.periodAll')}</option>
        </Select>
        <Input type="search" value={q} onChange={(event) => setQ(event.target.value)} placeholder={t('results.runs.searchPlaceholder')}
          aria-label={t('results.runs.searchPlaceholder')} className={styles.search} />
        <Select value={status} onChange={(event) => setStatus(event.target.value as RunLogStatus | '')} aria-label={t('results.runs.allStatuses')}>
          <option value="">{t('results.runs.allStatuses')}</option>
          {STATUSES.map((id) => <option key={id} value={id}>{t(STATUS_KEY[id])}</option>)}
        </Select>
      </div>

      {totals ? (
        <div className={styles.stats} data-testid="results-usage">
          <div className={styles.stat}><strong>{format.count(totals.runs)}</strong><span>{t('results.usage.runs')}</span>
            <small>{t('results.usage.outcome', { succeeded: totals.succeeded, failed: totals.failed })}</small></div>
          <div className={styles.stat}><strong>{format.count(totals.totalTokens)}</strong><span>{t('results.usage.tokens')}</span>
            <small>{t('results.usage.split', { input: format.count(totals.inputTokens), output: format.count(totals.outputTokens) })}</small></div>
          <div className={styles.stat}><strong>{format.count(totals.cacheReadTokens)}</strong><span>{t('results.usage.cacheRead')}</span>
            <small>{totals.inputTokens > 0 ? `${Math.round((totals.cacheReadTokens / totals.inputTokens) * 100)}%` : '—'}</small></div>
          <div className={styles.stat}><strong>{format.count(totals.outputs)}</strong><span>{t('results.usage.files')}</span>
            <small /></div>
        </div>
      ) : null}
      <p className={styles.note}>
        {t('results.usage.note')}{totals?.unmeasuredRuns ? ` ${t('results.usage.unmeasured', { n: totals.unmeasuredRuns })}.` : ''}
      </p>
      {summary ? (
        <div className={styles.buckets}>
          <BucketTable t={t} title={t('results.usage.byAgent')} column={t('results.colAgent')} buckets={summary.byAgent} count={format.count} />
          <BucketTable t={t} title={t('results.usage.byProject')} column={t('results.metaProject')} buckets={summary.byProject} count={format.count} />
        </div>
      ) : null}

      <h3 className={styles.sectionTitle}>{t('results.tabRuns')}{runs ? ` · ${t('results.count', { n: format.count(runs.total) })}` : ''}</h3>
      {error ? <p className={styles.error} role="alert">{t('results.loadFailed')} {error}</p> : null}
      {runs && runs.runs.length === 0 ? <p className={styles.empty}>{t('results.runs.empty')}</p> : null}
      <ul className={styles.runList}>
        {runs?.runs.map((run) => (
          <li key={run.runId} className={styles.run}>
            <span className={`${styles.status} ${styles[`status_${run.status}`] ?? ''}`}>{t(STATUS_KEY[run.status])}</span>
            <div className={styles.runBody}>
              <p className={styles.runRequest}>{run.request || t('results.runs.noRequest')}</p>
              <p className={styles.runMeta}>
                {format.time(run.startedAt)} · {run.agentName ?? '—'} · {run.projectName ?? t('results.deletedProject')} ·{' '}
                {run.usage.measured ? t('results.runs.tokens', { n: format.count(run.usage.totalTokens) }) : t('results.runs.noUsage')}
              </p>
              {run.check ? <div className={styles.runCheck}><CheckBadge check={run.check} onOpen={() => setCheckRun(run.runId)} /></div> : null}
            </div>
            {run.outputCount > 0
              ? <Button onClick={() => onShowFiles(run)}>{t('results.runs.files', { n: run.outputCount })}</Button>
              : null}
          </li>
        ))}
      </ul>
      {checkRun ? <CheckDialog runId={checkRun} onClose={() => setCheckRun(null)} /> : null}
    </div>
  );
}
