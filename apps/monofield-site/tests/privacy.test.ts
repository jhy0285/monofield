import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// The Microsoft Store listing links here, so the page must stay reachable, bilingual, and honest about what leaves
// the PC. Facts it states are checked against the app source (no telemetry, no account, GitHub release check).
const siteUrl = 'https://monofield.vercel.app';
const read = (name: string) => readFile(new URL(`../${name}`, import.meta.url), 'utf8');
const [privacy, home, guide, getStarted, notices] = await Promise.all(
  ['privacy.html', 'index.html', 'guide.html', 'get-started.html', 'open-source.html'].map(read),
);

function section(lang: 'ko' | 'en') {
  return privacy.match(new RegExp(`<section id="${lang}"[^>]*lang="${lang}"[^>]*>([\\s\\S]*?)</section>`))?.[1] ?? '';
}

test('privacy page has its own canonical identity', () => {
  assert.match(privacy, /<title>개인정보 처리방침 \| MonoField<\/title>/);
  assert.match(privacy, new RegExp(`<link rel="canonical" href="${siteUrl}/privacy" />`));
  assert.match(privacy, new RegExp(`<meta property="og:url" content="${siteUrl}/privacy" />`));
  const data = JSON.parse(privacy.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] ?? '{}');
  assert.equal(data['@type'], 'WebPage');
  assert.equal(data.url, `${siteUrl}/privacy`);
});

test('the policy is written in Korean and English with the same effective date', () => {
  const ko = section('ko');
  const en = section('en');
  assert.match(ko, /시행일 2026년 11월 11일/);
  assert.match(en, /Effective November 11, 2026/);
  assert.match(privacy, /"dateModified": "2026-11-11"/);
  for (const [text, words] of [
    [ko, ['모으는 개인정보는 없습니다', '마이크로소프트 스토어', 'GitHub 릴리스', 'AI 도구', 'GitHub 이슈']],
    [en, ['We collect no personal data', 'Microsoft Store', 'GitHub Releases', 'AI tool', 'GitHub issue']],
  ] as const) {
    for (const word of words) assert.ok(text.includes(word), `missing: ${word}`);
  }
  assert.equal((ko.match(/<h2>/g) ?? []).length, (en.match(/<h2>/g) ?? []).length);
});

test('every page footer links to the policy', () => {
  for (const [name, page] of [['index', home], ['guide', guide], ['get-started', getStarted], ['open-source', notices]]) {
    assert.match(page, /href="\/privacy"/, name);
  }
});
