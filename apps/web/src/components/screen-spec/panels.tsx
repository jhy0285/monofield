'use client';

import { useState } from 'react';
import type {
  ScreenSpecCallout,
  ScreenSpecCalloutRelation,
  ScreenSpecScreen,
  ScreenSpecVisualSettings,
} from '@open-design/contracts';
import { useT } from '../../i18n';
import {
  LINE_WIDTH_RANGE,
  MARKER_SIZE_RANGE,
  type ScreenMetadataPatch,
  type VisualSettingsPatch,
} from './editor-model';
import styles from './ScreenSpecEditor.module.css';

/** Form panels of the screen-spec editor: Description table, relation
 * editor, Check Point list, and the metadata grid. All edits flow up as
 * patches; nothing here owns document state. */

export function CalloutTable({
  callouts,
  selectedCalloutNo,
  onDeleteCallout,
  onSelectCallout,
  onUpdateCallout,
}: {
  callouts: ScreenSpecCallout[];
  selectedCalloutNo: number | null;
  onDeleteCallout: (no: number) => void;
  onSelectCallout: (no: number) => void;
  onUpdateCallout: (no: number, patch: Pick<ScreenSpecCallout, 'label' | 'description'>) => void;
}) {
  const t = useT();
  return (
    <section className={styles.panel}>
      <div className={styles.panelHeading}>
        <h3>{t('screenSpec.descriptionTitle')}</h3>
      </div>
      <div className={styles.tableScroll}>
        <table className={styles.calloutTable}>
          <thead>
            <tr>
              <th>No</th>
              <th>{t('screenSpec.colLabel')}</th>
              <th>{t('screenSpec.colDescription')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {callouts.length === 0 ? (
              <tr>
                <td className={styles.emptyCell} colSpan={4}>
                  {t('screenSpec.emptyCallouts')}
                </td>
              </tr>
            ) : (
              callouts.map((callout) => (
                <tr
                  className={selectedCalloutNo === callout.no ? styles.rowSelected : undefined}
                  key={callout.no}
                  onClick={() => onSelectCallout(callout.no)}
                >
                  <td className={styles.numCell}>{callout.no}</td>
                  <td>
                    <input
                      aria-label={t('screenSpec.labelAria', { no: callout.no })}
                      onChange={(event) =>
                        onUpdateCallout(callout.no, {
                          label: event.target.value,
                          description: callout.description,
                        })
                      }
                      value={callout.label}
                    />
                  </td>
                  <td>
                    <textarea
                      aria-label={t('screenSpec.descriptionAria', { no: callout.no })}
                      onChange={(event) =>
                        onUpdateCallout(callout.no, {
                          label: callout.label,
                          description: event.target.value,
                        })
                      }
                      rows={2}
                      value={callout.description}
                    />
                  </td>
                  <td>
                    <button
                      className={styles.smallButton}
                      onClick={(event) => {
                        event.stopPropagation();
                        onDeleteCallout(callout.no);
                      }}
                      type="button"
                    >
                      {t('screenSpec.delete')}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function RelationEditor({
  callouts,
  relations,
  visualSettings,
  onAddRelation,
  onDeleteRelation,
  onUpdateRelation,
  onUpdateVisualSettings,
}: {
  callouts: ScreenSpecCallout[];
  relations: ScreenSpecCalloutRelation[];
  visualSettings: ScreenSpecVisualSettings;
  onAddRelation: () => void;
  onDeleteRelation: (index: number) => void;
  onUpdateRelation: (index: number, patch: Partial<ScreenSpecCalloutRelation>) => void;
  onUpdateVisualSettings: (patch: VisualSettingsPatch) => void;
}) {
  const t = useT();
  const canAddRelation = callouts.length >= 2;

  return (
    <section className={styles.panel}>
      <div className={styles.panelHeading}>
        <div>
          <h3>{t('screenSpec.relationsTitle')}</h3>
          <p className={styles.panelHint}>{t('screenSpec.relationsHint')}</p>
        </div>
        <button
          className={styles.smallButton}
          disabled={!canAddRelation}
          onClick={onAddRelation}
          type="button"
        >
          {t('screenSpec.addRelation')}
        </button>
      </div>

      {!canAddRelation ? (
        <p className={styles.emptyMessage}>{t('screenSpec.needTwoMarkers')}</p>
      ) : relations.length === 0 ? (
        <p className={styles.emptyMessage}>{t('screenSpec.emptyRelations')}</p>
      ) : (
        <div className={styles.relationList}>
          {relations.map((relation, index) => (
            <div className={styles.relationRow} key={`${relation.fromNo}-${relation.toNo}-${index}`}>
              <label>
                <span>{t('screenSpec.relationFrom')}</span>
                <select
                  onChange={(event) => onUpdateRelation(index, { fromNo: Number(event.target.value) })}
                  value={relation.fromNo}
                >
                  {callouts.map((callout) => (
                    <option key={callout.no} value={callout.no}>
                      {callout.no}. {callout.label || '-'}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>{t('screenSpec.relationTo')}</span>
                <select
                  onChange={(event) => onUpdateRelation(index, { toNo: Number(event.target.value) })}
                  value={relation.toNo}
                >
                  {callouts.map((callout) => (
                    <option key={callout.no} value={callout.no}>
                      {callout.no}. {callout.label || '-'}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>{t('screenSpec.lineMode')}</span>
                <select
                  onChange={(event) =>
                    onUpdateRelation(index, {
                      lineMode: event.target.value as ScreenSpecCalloutRelation['lineMode'],
                    })
                  }
                  value={relation.lineMode ?? 'straight'}
                >
                  <option value="orthogonal">{t('screenSpec.lineOrthogonal')}</option>
                  <option value="straight">{t('screenSpec.lineStraight')}</option>
                </select>
              </label>
              <label className={styles.relationLabelInput}>
                <span>{t('screenSpec.relationLabel')}</span>
                <input
                  onChange={(event) => onUpdateRelation(index, { label: event.target.value })}
                  placeholder={t('screenSpec.relationLabelPlaceholder')}
                  value={relation.label ?? ''}
                />
              </label>
              <button
                className={styles.smallButton}
                onClick={() => onDeleteRelation(index)}
                type="button"
              >
                {t('screenSpec.delete')}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className={styles.styleControls}>
        <label>
          <span>{t('screenSpec.markerSize')}</span>
          <input
            max={MARKER_SIZE_RANGE.max}
            min={MARKER_SIZE_RANGE.min}
            onChange={(event) => onUpdateVisualSettings({ markerSizePx: Number(event.target.value) })}
            type="range"
            value={visualSettings.markerSizePx}
          />
          <output>{visualSettings.markerSizePx}px</output>
        </label>
        <label>
          <span>{t('screenSpec.lineWidth')}</span>
          <input
            max={LINE_WIDTH_RANGE.max}
            min={LINE_WIDTH_RANGE.min}
            onChange={(event) =>
              onUpdateVisualSettings({ relationLineWidthPx: Number(event.target.value) })
            }
            type="range"
            value={visualSettings.relationLineWidthPx}
          />
          <output>{visualSettings.relationLineWidthPx}px</output>
        </label>
      </div>
    </section>
  );
}

export function CheckpointEditor({
  checkpoints,
  onAddCheckpoint,
  onDeleteCheckpoint,
  onUpdateCheckpoint,
}: {
  checkpoints: string[];
  onAddCheckpoint: (text: string) => void;
  onDeleteCheckpoint: (index: number) => void;
  onUpdateCheckpoint: (index: number, text: string) => void;
}) {
  const t = useT();
  const [newCheckpoint, setNewCheckpoint] = useState('');

  function handleAdd() {
    onAddCheckpoint(newCheckpoint);
    setNewCheckpoint('');
  }

  return (
    <section className={styles.panel}>
      <div className={styles.panelHeading}>
        <h3>{t('screenSpec.checkpointTitle')}</h3>
      </div>
      <div className={styles.checkpointList}>
        {checkpoints.map((checkpoint, index) => (
          <div className={styles.checkpointRow} key={index}>
            <textarea
              aria-label={t('screenSpec.checkpointAria', { no: index + 1 })}
              onChange={(event) => onUpdateCheckpoint(index, event.target.value)}
              rows={2}
              value={checkpoint}
            />
            <button
              className={styles.smallButton}
              onClick={() => onDeleteCheckpoint(index)}
              type="button"
            >
              {t('screenSpec.delete')}
            </button>
          </div>
        ))}
      </div>
      <div className={styles.checkpointAddRow}>
        <input
          onChange={(event) => setNewCheckpoint(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              handleAdd();
            }
          }}
          placeholder={t('screenSpec.newCheckpointPlaceholder')}
          value={newCheckpoint}
        />
        <button
          className={styles.smallButton}
          disabled={!newCheckpoint.trim()}
          onClick={handleAdd}
          type="button"
        >
          {t('screenSpec.add')}
        </button>
      </div>
    </section>
  );
}

export function MetadataPanel({
  screen,
  onAddLevel,
  onDeleteLevel,
  onUpdateLevel,
  onUpdateMetadata,
}: {
  screen: ScreenSpecScreen;
  onAddLevel: () => void;
  onDeleteLevel: (index: number) => void;
  onUpdateLevel: (index: number, value: string) => void;
  onUpdateMetadata: (patch: ScreenMetadataPatch) => void;
}) {
  const t = useT();
  return (
    <section className={styles.panel}>
      <div className={styles.panelHeading}>
        <h3>{t('screenSpec.metadataTitle')}</h3>
      </div>
      <div className={styles.fieldGrid}>
        <label>
          <span>{t('screenSpec.pageTitle')}</span>
          <input
            onChange={(event) => onUpdateMetadata({ pageTitle: event.target.value })}
            value={screen.pageTitle}
          />
        </label>
        <div className={styles.fieldRow}>
          <label>
            <span>{t('screenSpec.screenId')}</span>
            <input
              onChange={(event) => onUpdateMetadata({ id: event.target.value })}
              value={screen.id}
            />
          </label>
          <label>
            <span>{t('screenSpec.screenName')}</span>
            <input
              onChange={(event) => onUpdateMetadata({ screenName: event.target.value })}
              value={screen.screenName}
            />
          </label>
        </div>
        <label>
          <span>{t('screenSpec.screenPath')}</span>
          <input
            onChange={(event) => onUpdateMetadata({ screenPath: event.target.value })}
            value={screen.screenPath}
          />
        </label>
        <label>
          <span>{t('screenSpec.overview')}</span>
          <textarea
            onChange={(event) => onUpdateMetadata({ overview: event.target.value })}
            rows={3}
            value={screen.overview}
          />
        </label>
        <div className={styles.levelEditor}>
          <div className={styles.fieldHeading}>
            <span>Level</span>
            <button className={styles.smallButton} onClick={onAddLevel} type="button">
              {t('screenSpec.addLevel')}
            </button>
          </div>
          {screen.levels.map((level, index) => (
            <div className={styles.levelRow} key={`level-${index + 1}`}>
              <label>
                <span>{`Level ${index + 1}`}</span>
                <input onChange={(event) => onUpdateLevel(index, event.target.value)} value={level} />
              </label>
              <button
                aria-label={t('screenSpec.deleteLevelAria', { no: index + 1 })}
                className={styles.smallButton}
                onClick={() => onDeleteLevel(index)}
                type="button"
              >
                {t('screenSpec.delete')}
              </button>
            </div>
          ))}
        </div>
        <div className={styles.fieldRow}>
          <label>
            <span>{t('screenSpec.companyName')}</span>
            <input
              onChange={(event) => onUpdateMetadata({ companyName: event.target.value })}
              value={screen.companyName}
            />
          </label>
          <label>
            <span>{t('screenSpec.author')}</span>
            <input
              onChange={(event) => onUpdateMetadata({ author: event.target.value })}
              value={screen.author}
            />
          </label>
        </div>
        <div className={styles.fieldRow}>
          <label>
            <span>{t('screenSpec.date')}</span>
            <input
              onChange={(event) => onUpdateMetadata({ date: event.target.value })}
              value={screen.date}
            />
          </label>
          <label>
            <span>{t('screenSpec.version')}</span>
            <input
              onChange={(event) => onUpdateMetadata({ version: event.target.value })}
              value={screen.version}
            />
          </label>
        </div>
      </div>
    </section>
  );
}
