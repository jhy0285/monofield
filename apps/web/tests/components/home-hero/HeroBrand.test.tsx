// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  HeroBrand,
  hasRightToLeftText,
  splitPipelineSteps,
  splitTitleWords,
} from '../../../src/components/home-hero/HeroBrand';

afterEach(() => {
  cleanup();
});

function renderHeroBrand() {
  return render(
    <HeroBrand
      brand="MonoField"
      title="Codex and Claude Code, all the way to SI deliverables"
      subtitle="code / interface spec / screen spec"
      trustLine="For SI and public-sector teams who keep specs in step with the code."
    />,
  );
}

describe('splitPipelineSteps', () => {
  it('turns the slash-separated subtitle into steps', () => {
    expect(splitPipelineSteps('code / interface spec / screen spec')).toEqual([
      'code',
      'interface spec',
      'screen spec',
    ]);
    expect(splitPipelineSteps('코드 / 인터페이스 명세서 / 화면명세서')).toEqual([
      '코드',
      '인터페이스 명세서',
      '화면명세서',
    ]);
  });

  it('keeps a subtitle without slashes as one step', () => {
    expect(splitPipelineSteps('from code to specs')).toEqual(['from code to specs']);
  });
});

describe('splitTitleWords', () => {
  it('keeps the spaces, so the words join back into the sentence', () => {
    const title = 'Codex·Claude Code로 SI 산출물까지';
    const words = splitTitleWords(title);
    expect(words).toEqual(['Codex·Claude ', 'Code로 ', 'SI ', '산출물까지']);
    expect(words.join('')).toBe(title);
  });
});

describe('hasRightToLeftText', () => {
  it('spots Arabic, Persian and Hebrew text, mixed with Latin or not', () => {
    expect(hasRightToLeftText('من Codex وClaude Code حتى مخرجات مشاريع SI')).toBe(true);
    expect(hasRightToLeftText('از Codex و Claude Code')).toBe(true);
    expect(hasRightToLeftText('שלום')).toBe(true);
    expect(hasRightToLeftText('Codex·Claude Code로 SI 산출물까지')).toBe(false);
  });
});

describe('HeroBrand', () => {
  it('moves each word of a left-to-right heading on its own, with the spaces between the boxes', () => {
    const { container } = renderHeroBrand();
    const words = [...container.querySelectorAll('[data-word]')].map((node) => node.textContent);
    expect(words).toEqual(['Codex', 'and', 'Claude', 'Code,', 'all', 'the', 'way', 'to', 'SI', 'deliverables']);
  });

  it('keeps a right-to-left heading in one box, so mixed runs stay in order', () => {
    const { container } = render(
      <HeroBrand
        brand="MonoField"
        title="من Codex وClaude Code حتى مخرجات مشاريع SI"
        subtitle="الشيفرة / مواصفات الواجهات / مواصفات الشاشات"
        trustLine=""
      />,
    );
    const words = container.querySelectorAll('[data-word]');
    expect(words).toHaveLength(1);
    expect(words[0]?.textContent).toBe('من Codex وClaude Code حتى مخرجات مشاريع SI');
  });

  it('lays the brand letters out left to right whatever the page direction', () => {
    const { container } = renderHeroBrand();
    const letters = container.querySelector('[dir="auto"]');
    expect(letters?.textContent).toBe('monofield');
  });

  it('reads the heading as the whole sentence while each word animates on its own', () => {
    renderHeroBrand();

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Codex and Claude Code, all the way to SI deliverables',
      }),
    ).toBeTruthy();
  });

  it('gives assistive technology the brand and the subtitle as plain text', () => {
    const { container } = renderHeroBrand();

    expect(screen.getByText('MonoField')).toBeTruthy();
    expect(screen.getByText('code / interface spec / screen spec')).toBeTruthy();
    // The letter-by-letter name and the drawn pipeline are decoration only.
    const pipelineSteps = container.querySelectorAll('[data-step]');
    expect(pipelineSteps).toHaveLength(3);
    for (const step of pipelineSteps) expect(step.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelectorAll('[data-link]')).toHaveLength(2);
  });

  it('keeps the motion layers out of the accessibility tree', () => {
    const { container } = renderHeroBrand();
    const decorative = container.querySelectorAll('[aria-hidden="true"]');
    expect(decorative.length).toBeGreaterThan(0);
    expect(screen.getByText('For SI and public-sector teams who keep specs in step with the code.')).toBeTruthy();
  });
});
