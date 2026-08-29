import { useEffect, useMemo, useRef, useState } from 'react';
import type { InstalledPluginRecord } from '@open-design/contracts';
import { trackPageView } from '../analytics/events';
import { useAnalytics } from '../analytics/provider';
import { useI18n } from '../i18n';
import { getPluginDetails, listPlugins } from '../state/projects';
import { Icon } from './Icon';
import { PluginDetailsModal } from './PluginDetailsModal';
import { PluginsHomeSection } from './PluginsHomeSection';
import type { PluginUseAction } from './plugins-home/useActions';

interface Props {
  onUse: (record: InstalledPluginRecord, action: PluginUseAction) => void;
  onManagePlugins: () => void;
}

export function OpenWorkView({ onUse, onManagePlugins }: Props) {
  const { locale, t } = useI18n();
  const analytics = useAnalytics();
  const [plugins, setPlugins] = useState<InstalledPluginRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailsRecord, setDetailsRecord] = useState<InstalledPluginRecord | null>(null);
  const pageViewFiredRef = useRef(false);

  useEffect(() => {
    if (pageViewFiredRef.current) return;
    pageViewFiredRef.current = true;
    trackPageView(analytics.track, { page_name: 'open_work' });
  }, [analytics.track]);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      setLoading(true);
      void listPlugins({ summary: true, locale }).then((rows) => {
        if (cancelled) return;
        setPlugins(rows);
        setLoading(false);
      });
    };
    load();
    window.addEventListener('open-design:plugins-changed', load);
    return () => {
      cancelled = true;
      window.removeEventListener('open-design:plugins-changed', load);
    };
  }, [locale]);

  const openPluginDetails = (record: InstalledPluginRecord) => {
    setDetailsRecord(record);
    void getPluginDetails(record.id).then((detail) => {
      if (!detail) return;
      setDetailsRecord((current) => current?.id === record.id ? detail : current);
    });
  };

  const rows = useMemo(
    () => plugins.filter((plugin) => plugin.manifest?.od?.hidden !== true),
    [plugins],
  );

  return (
    <section className="open-work-view" aria-labelledby="open-work-title">
      <header className="open-work-view__hero">
        <div className="open-work-view__hero-copy">
          <p className="open-work-view__kicker">{t('openWork.kicker')}</p>
          <h1 id="open-work-title">{t('openWork.title')}</h1>
          <p className="open-work-view__lede">{t('openWork.lede')}</p>
        </div>
        <button
          type="button"
          className="open-work-view__manage"
          onClick={onManagePlugins}
          data-testid="open-work-manage-plugins"
        >
          <Icon name="puzzle" size={15} />
          <span>{t('openWork.manage')}</span>
        </button>
      </header>

      <dl className="open-work-view__manifest" aria-label={t('openWork.routeLabel')}>
        <div>
          <dt>{t('openWork.routeLabel')}</dt>
          <dd>{t('openWork.routeValue')}</dd>
        </div>
        <div>
          <dt>{t('openWork.keepLabel')}</dt>
          <dd>{t('openWork.keepValue')}</dd>
        </div>
        <div className="open-work-view__manifest-row--private">
          <dt>{t('openWork.excludeLabel')}</dt>
          <dd>{t('openWork.excludeValue')}</dd>
        </div>
      </dl>

      <div className="open-work-view__catalog">
        <PluginsHomeSection
          plugins={rows}
          loading={loading}
          activePluginId={detailsRecord?.id ?? null}
          pendingApplyId={null}
          onUse={(record, action) => onUse(record, action)}
          onOpenDetails={openPluginDetails}
          preferDefaultFacet={false}
          title={t('openWork.catalogTitle')}
          subtitle={t('openWork.catalogSubtitle')}
          emptyMessage={t('openWork.empty')}
          searchPlaceholder={t('openWork.searchPlaceholder')}
          searchAriaLabel={t('openWork.searchAria')}
          filtersAriaLabel={t('openWork.filtersAria')}
          cardLayout="gallery"
        />
      </div>

      {detailsRecord ? (
        <PluginDetailsModal
          record={detailsRecord}
          onClose={() => setDetailsRecord(null)}
          onUse={(record, action) => {
            setDetailsRecord(null);
            onUse(record, action);
          }}
        />
      ) : null}
    </section>
  );
}
