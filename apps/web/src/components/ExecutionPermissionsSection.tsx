import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  EXECUTION_PERMISSION_LEVELS,
  executionPermissionsNeedRestart,
  resolveExecutionPermissions,
  type ExecutionPermissionLevel,
  type ExecutionPermissionsResponse,
} from '@open-design/contracts';
import { getOpenDesignHost } from '@open-design/host';
import { Button, Dialog, DialogDescription, DialogFooter, DialogTitle } from '@open-design/components';
import { useT } from '../i18n';
import type { Dict } from '../i18n/types';
import { saveExecutionPermissionLevel, useExecutionPermissions } from '../providers/execution-permissions';
import { RemixIcon } from './RemixIcon';
import styles from './ExecutionPermissionsSection.module.css';

type Translate = ReturnType<typeof useT>;

const LEVEL_COPY: Record<ExecutionPermissionLevel, { icon: string; title: keyof Dict; desc: keyof Dict }> = {
  'read-only': {
    icon: 'eye-line',
    title: 'executionPermissions.readOnlyTitle',
    desc: 'executionPermissions.readOnlyDesc',
  },
  default: {
    icon: 'folder-shield-2-line',
    title: 'executionPermissions.defaultTitle',
    desc: 'executionPermissions.defaultDesc',
  },
  full: {
    icon: 'shield-flash-line',
    title: 'executionPermissions.fullTitle',
    desc: 'executionPermissions.fullDesc',
  },
};

/** One line per tool, in the order a reader compares the cards. */
function effectLines(level: ExecutionPermissionLevel, platform: string, t: Translate) {
  const effective = resolveExecutionPermissions(level, { platform });
  return [
    {
      key: 'codex',
      wide: effective.codexSandbox === 'danger-full-access',
      text: t(
        effective.codexSandbox === 'read-only'
          ? 'executionPermissions.codexReadOnly'
          : effective.codexSandbox === 'workspace-write'
            ? 'executionPermissions.codexWorkspace'
            : 'executionPermissions.codexFull',
      ),
    },
    {
      key: 'claude',
      wide: false,
      text: t(
        effective.claudePermissionMode === 'plan'
          ? 'executionPermissions.claudePlan'
          : 'executionPermissions.claudeAll',
      ),
    },
    {
      key: 'admin',
      wide: level === 'full',
      text: t(level === 'full' ? 'executionPermissions.adminYes' : 'executionPermissions.adminNo'),
    },
  ];
}

export function ExecutionPermissionsSection() {
  const t = useT();
  const { permissions, error: loadError } = useExecutionPermissions();
  const [pendingFull, setPendingFull] = useState(false);
  const [saving, setSaving] = useState(false);
  const [relaunching, setRelaunching] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const confirmTitleId = useId();
  const confirmBodyId = useId();
  const optionIdPrefix = useId();
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Escape closes only the confirmation. Settings closes on any Escape that
  // reaches `document`, so stop it at the window capture phase first.
  useEffect(() => {
    if (!pendingFull) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      event.preventDefault();
      setPendingFull(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [pendingFull]);

  const elevation = getOpenDesignHost()?.elevation;
  const level = permissions?.level ?? null;
  const platform = permissions?.platform ?? '';
  const isWindows = platform === 'win32';

  async function relaunchAsAdministrator() {
    if (!elevation) {
      setError(t('executionPermissions.relaunchUnavailable'));
      return;
    }
    setRelaunching(true);
    setError(null);
    const result = await elevation.relaunchAsAdministrator();
    if (result.ok) return; // The app quits; the elevated copy takes over.
    setRelaunching(false);
    if (result.reason === 'declined') setStatus(t('executionPermissions.relaunchDeclined'));
    else if (result.reason === 'not-administrator') setStatus(t('executionPermissions.notAdminAccount'));
    else if (result.reason === 'unsupported') setError(t('executionPermissions.relaunchUnavailable'));
    else setError(t('executionPermissions.relaunchFailed', { reason: result.reason }));
  }

  async function apply(next: ExecutionPermissionLevel) {
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const saved = await saveExecutionPermissionLevel(next);
      setStatus(t('executionPermissions.saved'));
      if (next === 'full' && saved.elevated === false && saved.canElevate !== false && elevation) {
        await relaunchAsAdministrator();
      }
    } catch {
      setError(t('executionPermissions.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  function choose(next: ExecutionPermissionLevel) {
    if (saving || next === level) return;
    if (next === 'full') {
      setPendingFull(true);
      return;
    }
    void apply(next);
  }

  // Arrow keys move between the three options, as in a native radio group.
  function onOptionKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown'
      ? 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
        ? -1
        : 0;
    if (delta === 0) return;
    event.preventDefault();
    const nextIndex = (index + delta + EXECUTION_PERMISSION_LEVELS.length) % EXECUTION_PERMISSION_LEVELS.length;
    optionRefs.current[nextIndex]?.focus();
    choose(EXECUTION_PERMISSION_LEVELS[nextIndex]!);
  }

  const restartNeeded = permissions ? executionPermissionsNeedRestart(permissions) : false;
  // A standard account is never restarted as administrator (see canElevate in
  // the contract), so the dialog must not promise a restart or a UAC prompt.
  const standardAccount = isWindows && permissions?.canElevate === false;
  const confirmLabel = isWindows && elevation && !standardAccount
    ? t('executionPermissions.confirmActionRestart')
    : t('executionPermissions.confirmAction');

  return (
    <section className="settings-section" data-testid="execution-permissions-section">
      <div className="section-head">
        <div>
          <p className="hint">{t('executionPermissions.intro')}</p>
        </div>
      </div>

      {loadError && !permissions ? (
        <p className={styles.error} role="alert">{t('executionPermissions.loadFailed')}</p>
      ) : null}

      <div className={styles.optionsWrap}>
        <div
          className={styles.options}
          role="radiogroup"
          aria-label={t('executionPermissions.groupLabel')}
          aria-busy={saving || permissions == null ? true : undefined}
        >
          {EXECUTION_PERMISSION_LEVELS.map((option, index) => {
            const copy = LEVEL_COPY[option];
            const selected = option === level;
            const tabbable = selected || (level == null && option === 'default');
            const titleId = `${optionIdPrefix}-${option}-title`;
            const detailId = `${optionIdPrefix}-${option}-detail`;
            return (
              <button
                key={option}
                ref={(node) => {
                  optionRefs.current[index] = node;
                }}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-labelledby={titleId}
                aria-describedby={detailId}
                tabIndex={tabbable ? 0 : -1}
                disabled={permissions == null}
                data-level={option}
                data-selected={selected ? 'true' : undefined}
                className={styles.option}
                onClick={() => choose(option)}
                onKeyDown={(event) => onOptionKeyDown(event, index)}
              >
                <span className={styles.optionTop}>
                  <span className={styles.optionIcon} aria-hidden>
                    <RemixIcon name={copy.icon} size={18} />
                  </span>
                  {option === 'default' ? (
                    <span className={styles.recommended}>{t('executionPermissions.recommended')}</span>
                  ) : null}
                  <span className={styles.check} aria-hidden>
                    <RemixIcon name="check-line" size={14} />
                  </span>
                </span>
                <span id={titleId} className={styles.optionTitle}>{t(copy.title)}</span>
                <span id={detailId} className={styles.optionDetail}>
                  <span className={styles.optionDesc}>{t(copy.desc)}</span>
                  <span className={styles.effects}>
                    {effectLines(option, platform, t).map((line) => (
                      <span key={line.key} className={styles.effect} data-wide={line.wide ? 'true' : undefined}>
                        <span className={styles.effectDot} aria-hidden />
                        {line.text}
                      </span>
                    ))}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {permissions ? (
        <PermissionsStatus
          permissions={permissions}
          restartNeeded={restartNeeded}
          canRelaunch={Boolean(elevation)}
          relaunching={relaunching}
          onRelaunch={() => void relaunchAsAdministrator()}
          t={t}
        />
      ) : null}

      <p className={styles.footnote}>{t('executionPermissions.otherAgentsNote')}</p>
      {status ? <p className="hint" role="status">{status}</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      {/* Portaled to <body>: inside the Settings panel a fixed backdrop would
          only cover the section, not the window. */}
      {pendingFull ? createPortal(
        <Dialog
          role="alertdialog"
          className={styles.confirm}
          onClose={() => setPendingFull(false)}
          ariaLabelledBy={confirmTitleId}
          ariaDescribedBy={confirmBodyId}
          data-testid="execution-permissions-confirm"
        >
          <div className={styles.confirmIcon} aria-hidden>
            <RemixIcon name="shield-flash-line" size={22} />
          </div>
          <DialogTitle id={confirmTitleId}>{t('executionPermissions.confirmTitle')}</DialogTitle>
          <div id={confirmBodyId} className={styles.confirmBody}>
            <DialogDescription>{t('executionPermissions.confirmBody')}</DialogDescription>
            {isWindows ? (
              <DialogDescription>
                {t(standardAccount ? 'executionPermissions.confirmNotAdmin' : 'executionPermissions.confirmWindows')}
              </DialogDescription>
            ) : null}
          </div>
          <DialogFooter className={styles.confirmFooter}>
            <Button type="button" variant="ghost" onClick={() => setPendingFull(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="primary"
              className={styles.dangerButton}
              autoFocus
              onClick={() => {
                setPendingFull(false);
                void apply('full');
              }}
            >
              {confirmLabel}
            </Button>
          </DialogFooter>
        </Dialog>,
        document.body,
      ) : null}
    </section>
  );
}

function PermissionsStatus({
  permissions,
  restartNeeded,
  canRelaunch,
  relaunching,
  onRelaunch,
  t,
}: {
  permissions: ExecutionPermissionsResponse;
  restartNeeded: boolean;
  canRelaunch: boolean;
  relaunching: boolean;
  onRelaunch: () => void;
  t: Translate;
}) {
  const wantsElevation = permissions.effective.startElevated;
  const notes: string[] = [];
  if (permissions.level === 'read-only') notes.push(t('executionPermissions.readOnlyNote'));
  if (permissions.codexSandboxLockedByEnv) notes.push(t('executionPermissions.lockedByEnv'));
  if (permissions.platform === 'win32' && permissions.level === 'full') {
    notes.push(
      permissions.canElevate === false
        ? t('executionPermissions.notAdminAccount')
        : t('executionPermissions.adminCaveats'),
    );
  }
  if (permissions.platform !== 'win32' && permissions.level === 'full') notes.push(t('executionPermissions.nonWindowsNote'));

  return (
    <div className={styles.status} data-tone={restartNeeded && wantsElevation ? 'warn' : undefined}>
      {permissions.elevated != null ? (
        <div className={styles.statusRow}>
          <span
            className={styles.statusDot}
            data-state={permissions.elevated ? 'elevated' : 'normal'}
            aria-hidden
          />
          <span>
            {permissions.elevated
              ? t('executionPermissions.statusElevated')
              : t('executionPermissions.statusNotElevated')}
          </span>
        </div>
      ) : null}
      {restartNeeded && wantsElevation ? (
        <div className={styles.statusAction}>
          <span>{t('executionPermissions.needElevation')}</span>
          {canRelaunch ? (
            <Button type="button" onClick={onRelaunch} disabled={relaunching}>
              {relaunching ? t('executionPermissions.relaunching') : t('executionPermissions.relaunchAdmin')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {restartNeeded && !wantsElevation ? (
        <p className={styles.statusNote}>{t('executionPermissions.dropElevation')}</p>
      ) : null}
      {notes.map((note) => (
        <p key={note} className={styles.statusNote}>{note}</p>
      ))}
    </div>
  );
}
