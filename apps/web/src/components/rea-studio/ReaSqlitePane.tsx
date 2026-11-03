'use client';

import { useState } from 'react';
import type { ReaSqliteTable, ReaSqliteView } from '@open-design/contracts';
import { useI18n } from '../../i18n';
import { ER_HEADER, ER_ROW, layoutEr } from './layout';
import styles from './ReaStudio.module.css';

/** A SQLite inspection: the tables as a relationship diagram, then each table's columns, constraints and sampled rows. */
export function ReaSqlitePane({ view }: { view: ReaSqliteView }) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<string | null>(view.tables[0]?.name ?? null);
  const layout = layoutEr(view.tables);
  const table: ReaSqliteTable | undefined = view.tables.find((item) => item.name === selected);
  const linked = (name: string) => layout.links.some((link) => (link.fromTable === selected && link.toTable === name) || (link.toTable === selected && link.fromTable === name));

  return <div data-testid="rea-sqlite">
    <div className={styles.tiles}>
      <div className={styles.tile}><b>{view.tables.length}</b><span>{t('reaStudio.tables')}</span></div>
      <div className={styles.tile}><b>{view.tables.reduce((sum, item) => sum + item.foreignKeys.length, 0)}</b><span>{t('reaStudio.references')}</span></div>
      <div className={styles.tile}><b>{view.engine}</b><span>{view.encoding ?? ''}</span></div>
      <div className={styles.tile} data-tone={view.completeness === 'complete' ? 'ok' : 'warn'}><b>{view.completeness}</b><span>{t('reaStudio.completeness')}</span></div>
    </div>
    <h4 className={styles.sectionTitle}>{t('reaStudio.diagram')}</h4>
    <div className={styles.diagram}>
      <svg viewBox={`0 0 ${layout.width} ${layout.height}`} width={layout.width} height={layout.height} role="img" aria-label={t('reaStudio.diagram')} data-testid="rea-er">
        <defs><marker id="rea-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" className={styles.arrow} /></marker></defs>
        {layout.links.map((link) => <path key={`${link.fromTable}.${link.fromColumn}`} d={link.d} className={styles.link} data-focus={link.fromTable === selected || link.toTable === selected} markerEnd="url(#rea-arrow)" />)}
        {layout.boxes.map((box) => <g key={box.name} transform={`translate(${box.x},${box.y})`} className={styles.erBox} data-selected={box.name === selected} data-linked={linked(box.name)} onClick={() => setSelected(box.name)} role="button" tabIndex={0} aria-label={box.name}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(box.name); } }}>
          <rect width={box.width} height={box.height} rx="10" className={styles.erFrame} />
          <rect width={box.width} height={ER_HEADER} rx="10" className={styles.erHead} />
          <text x="12" y="19" className={styles.erTitle}>{box.name}</text>
          {box.columns.map((column, index) => <g key={column.name} transform={`translate(0,${ER_HEADER + index * ER_ROW})`}>
            <text x="12" y="16" className={styles.erColumn}>{column.name}</text>
            <text x={box.width - 12} y="16" textAnchor="end" className={styles.erType}>{[column.primaryKey ? 'PK' : '', column.notNull ? 'NN' : '', column.type].filter(Boolean).join(' ')}</text>
          </g>)}
        </g>)}
      </svg>
    </div>

    <div className={styles.tabs} role="tablist" aria-label={t('reaStudio.tables')}>
      {view.tables.map((item) => <button key={item.name} type="button" role="tab" aria-selected={item.name === selected} data-active={item.name === selected} onClick={() => setSelected(item.name)}>{item.name}</button>)}
    </div>
    {table ? <section className={styles.panel} aria-label={table.name}>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>{t('reaStudio.columns')}</th><th>{t('reaStudio.type')}</th><th /><th>{t('reaStudio.default')}</th></tr></thead>
          <tbody>{table.columns.map((column) => <tr key={column.name}>
            <td><code>{column.name}</code></td><td>{column.type}</td>
            <td>{column.primaryKey ? <span className={styles.tag}>PK{column.primaryKey > 1 ? column.primaryKey : ''}</span> : null}{column.notNull ? <span className={styles.tag}>NOT NULL</span> : null}</td>
            <td>{column.defaultSql ? <code>{column.defaultSql}</code> : null}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {table.foreignKeys.length || table.unique.length || table.checks.length ? <ul className={styles.constraints}>
        {table.foreignKeys.map((key) => <li key={`fk-${key.column}`}><b>{t('reaStudio.references')}</b> <code>{key.column}</code> → <code>{key.refTable}.{key.refColumn}</code></li>)}
        {table.unique.map((unique) => <li key={`u-${unique}`}><b>UNIQUE</b> <code>{unique}</code></li>)}
        {table.checks.map((check) => <li key={`c-${check}`}><b>CHECK</b> <code>{check}</code></li>)}
      </ul> : null}
      <p className={styles.muted}>{t('reaStudio.declarationsOnly')}</p>
      {table.rows ? <>
        <h4 className={styles.sectionTitle}>{t('reaStudio.sampleRows')} <span className={styles.muted}>{table.rows.returned}{table.rows.truncated ? '+' : ''}</span></h4>
        <div className={styles.tableWrap}><table className={styles.table}>
          <thead><tr>{table.rows.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
          <tbody>{table.rows.values.map((row, index) => <tr key={index}>{row.map((cell, i) => <td key={i}><code>{cell}</code></td>)}</tr>)}</tbody>
        </table></div>
      </> : null}
    </section> : null}
    {view.views.length || view.triggers.length ? <p className={styles.muted}>{view.views.length} views · {view.triggers.length} triggers</p> : null}
  </div>;
}
