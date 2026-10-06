import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { CenteredLoader } from './Loading';
import { useT } from '../i18n';

/** Load a destination on first use; retain its draft and scroll state on return. */
export function EntryViewPane({ active, name, children }: {
  active: boolean;
  name: string;
  children: ReactNode;
}) {
  const t = useT();
  const [visited, setVisited] = useState(active);
  useEffect(() => { if (active) setVisited(true); }, [active]);
  return (
    <div
      data-testid={`entry-view-${name}`}
      data-active={active ? 'true' : 'false'}
      hidden={!active}
      aria-hidden={!active}
      ref={(node) => { node?.toggleAttribute('inert', !active); }}
    >
      {active || visited ? (
        <Suspense fallback={<CenteredLoader label={t('common.loading')} />}>
          {children}
        </Suspense>
      ) : null}
    </div>
  );
}
