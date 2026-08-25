// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProjectWorkModeToggle } from '../../src/components/ProjectWorkModeToggle';
import { I18nProvider } from '../../src/i18n';

afterEach(() => cleanup());

describe('ProjectWorkModeToggle', () => {
  it('selects development as a project workflow rather than a separate product', () => {
    const onChange = vi.fn();
    render(<ProjectWorkModeToggle value="creation" onChange={onChange} />);

    expect(screen.getByRole('radio', { name: 'Create documents and designs' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'Develop software' }));
    expect(onChange).toHaveBeenCalledWith('development');
  });

  it('renders the workflow and explanation in Korean', () => {
    render(
      <I18nProvider initial="ko">
        <ProjectWorkModeToggle value="development" onChange={vi.fn()} />
      </I18nProvider>,
    );

    expect(screen.getByRole('radiogroup', { name: '어떤 방식으로 작업할까요?' })).toBeTruthy();
    expect(screen.getByText('소프트웨어 개발')).toBeTruthy();
    expect(screen.getByText(/승인된 DB와 내장 브라우저/)).toBeTruthy();
  });
});
