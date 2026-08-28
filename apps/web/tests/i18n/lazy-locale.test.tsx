// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { I18nProvider, useI18n } from '../../src/i18n';

function LocaleProbe() {
  const { setLocale, t } = useI18n();
  return (
    <>
      <span>{t('common.cancel')}</span>
      <button type="button" onClick={() => setLocale('fr')}>French</button>
    </>
  );
}

afterEach(cleanup);

describe('lazy locale dictionaries', () => {
  it('loads a non-startup dictionary when the user selects it', async () => {
    render(
      <I18nProvider initial="en">
        <LocaleProbe />
      </I18nProvider>,
    );

    expect(screen.getByText('Cancel')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'French' }));
    expect(await screen.findByText('Annuler')).toBeTruthy();
  });
});
