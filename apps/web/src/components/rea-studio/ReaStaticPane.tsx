'use client';

import type { ReaOtherView, ReaStaticView, ReaTraceView } from '@open-design/contracts';
import { useI18n } from '../../i18n';
import { GRAPH_NODE_HEIGHT, GRAPH_NODE_WIDTH, layoutGraph } from './layout';
import styles from './ReaStudio.module.css';

const coverageTone = (status: string | null) => (status === 'complete' ? 'ok' : status === null ? 'info' : 'warn');
const KIND_TONE: Readonly<Record<string, string>> = { artifact: 'root', package: 'pack', 'electron-renderer': 'pack', 'javascript-asset': 'pack', 'javascript-module': 'code', endpoint: 'endpoint' };

/** A static analysis: REA's counters and coverage as it stated them, and the application graph. */
export function ReaStaticPane({ view }: { view: ReaStaticView }) {
  const { t } = useI18n();
  const layout = layoutGraph(view.nodes, view.edges);
  const counters = [...view.statistics].sort((a, b) => Number(b.value > 0) - Number(a.value > 0));
  const label = (value: string) => value.replace(/[_-]/g, ' ');
  return <div data-testid="rea-static">
    <div className={styles.tiles}>
      <div className={styles.tile} data-tone={coverageTone(view.applicationCoverage)}><b>{view.applicationCoverage ?? '—'}</b><span>{t('reaStudio.applicationCoverage')}</span></div>
      <div className={styles.tile} data-tone={coverageTone(view.semanticCoverage)}><b>{view.semanticCoverage ?? '—'}</b><span>{t('reaStudio.semanticCoverage')}</span></div>
      <div className={styles.tile} data-tone={view.semanticUnknowns ? 'warn' : 'ok'}><b>{view.semanticUnknowns}</b><span>{t('reaStudio.semanticUnknowns')}</span></div>
      <div className={styles.tile}><b>{view.nodeTotal}/{view.edgeTotal}</b><span>{t('reaStudio.nodesEdges')}</span></div>
    </div>
    <p className={styles.muted}>{t('reaStudio.staticNote')}</p>
    <h4 className={styles.sectionTitle}>{t('reaStudio.graph')} <span className={styles.muted}>{view.nodes.length < view.nodeTotal ? t('reaStudio.graphCut', { shown: view.nodes.length, total: view.nodeTotal }) : ''}</span></h4>
    <div className={styles.diagram}>
      <svg viewBox={`0 0 ${layout.width} ${layout.height}`} width={layout.width} height={layout.height} role="img" aria-label={t('reaStudio.graph')} data-testid="rea-graph">
        {layout.links.map((link, index) => <path key={index} d={link.d} className={styles.link} />)}
        {layout.boxes.map((box) => <g key={box.id} transform={`translate(${box.x},${box.y})`} className={styles.graphNode} data-tone={KIND_TONE[box.kind] ?? 'other'}>
          <rect width={GRAPH_NODE_WIDTH} height={GRAPH_NODE_HEIGHT} rx="9" />
          <text x="10" y="16" className={styles.erType}>{box.kind}</text>
          <text x="10" y="32" className={styles.erColumn}>{box.label.length > 30 ? `${box.label.slice(0, 29)}…` : box.label}</text>
        </g>)}
      </svg>
    </div>
    <ul className={styles.srOnly}>{view.nodes.map((node) => <li key={node.id}>{node.kind}: {node.label}</li>)}</ul>
    {counters.length ? <>
      <h4 className={styles.sectionTitle}>{t('reaStudio.counters')}</h4>
      <div className={styles.chips}>{counters.map((counter) => <span key={counter.key} className={styles.chip} data-zero={counter.value === 0}>{label(counter.key)} <b>{counter.value}</b></span>)}</div>
    </> : null}
    {view.unknownReasons.length ? <>
      <h4 className={styles.sectionTitle}>{t('reaStudio.unknownReasons')}</h4>
      <ul className={styles.bars}>{view.unknownReasons.map((reason) => <li key={reason.reason}>
        <span>{label(reason.reason)}</span><span className={styles.barTrack}><i style={{ width: `${(reason.count / Math.max(...view.unknownReasons.map((item) => item.count))) * 100}%` }} /></span><b>{reason.count}</b>
      </li>)}</ul>
    </> : null}
  </div>;
}

export function ReaTracePane({ view }: { view: ReaTraceView }) {
  const { t } = useI18n();
  return <div data-testid="rea-trace">
    <div className={styles.tiles}>
      <div className={styles.tile}><b><code>{view.seed}</code></b><span>{t('reaStudio.seed')} · {view.direction}</span></div>
      <div className={styles.tile} data-tone={view.status === 'no-match' ? 'warn' : 'ok'}><b>{view.status}</b><span>{t('reaStudio.status')}</span></div>
      <div className={styles.tile}><b>{view.matches}</b><span>{t('reaStudio.matches')}</span></div>
      <div className={styles.tile}><b>{view.terminalPaths}</b><span>{t('reaStudio.paths')}</span></div>
    </div>
    {view.status === 'no-match' ? <p className={styles.muted} role="note">{t('reaStudio.noMatch')}</p> : null}
    {view.paths.map((path, index) => <div key={index} className={styles.path}>{path.map((step, i) => <span key={i}>{i ? <i aria-hidden> → </i> : null}<span className={styles.chip}>{step}</span></span>)}</div>)}
  </div>;
}

export function ReaFactsPane({ view }: { view: ReaOtherView }) {
  const { t } = useI18n();
  return <div data-testid="rea-facts">
    <h4 className={styles.sectionTitle}>{t('reaStudio.facts')}</h4>
    <dl className={styles.facts}>{view.facts.map((fact) => <div key={fact.key}><dt>{fact.key.replace(/[_-]/g, ' ')}</dt><dd><code>{fact.value}</code></dd></div>)}</dl>
  </div>;
}
