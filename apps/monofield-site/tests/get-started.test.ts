import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const siteUrl = 'https://monofield.vercel.app';
const [page, demoSource, script, sitemap, home] = await Promise.all([
  readFile(new URL('../get-started.html', import.meta.url), 'utf8'),
  readFile(new URL('../get-started-demo.json', import.meta.url), 'utf8'),
  readFile(new URL('../get-started.js', import.meta.url), 'utf8'),
  readFile(new URL('../sitemap.xml', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
]);
const demo = JSON.parse(demoSource) as {
  scenarios: Record<string, { flags: Record<string, boolean>; summary: { warnings: number; errors: number }; compare: string; apply: string; recheck: string; judge: string }>;
  render: { endpointCount: number; warningCount: number; sampleWarnings: string[]; bytes: number };
  evidence: { listing: string; calls: unknown[] };
};

const unescapeHtml = (value: string) => value.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&#x27;', "'").replaceAll('&amp;', '&');

test('get-started page has its own identity: one h1, canonical URL, per-language titles, structured data', () => {
  const head = page.match(/<head>([\s\S]*?)<\/head>/i)?.[1] ?? '';
  assert.equal((page.match(/<h1(?:\s|>)/gi) ?? []).length, 1);
  assert.match(head, new RegExp(`<link rel="canonical" href="${siteUrl}/get-started" />`));
  assert.match(head, new RegExp(`<meta property="og:url" content="${siteUrl}/get-started" />`));
  const titleKo = page.match(/<html[^>]*data-title-ko="([^"]+)"/)?.[1];
  const titleEn = page.match(/<html[^>]*data-title-en="([^"]+)"/)?.[1];
  assert.ok(titleKo && titleEn && titleKo !== titleEn, 'both language titles are set on <html>');
  assert.equal(head.match(/<title>([^<]+)<\/title>/)?.[1], titleKo);
  assert.match(head, /<meta property="og:image:width" content="1200" \/>/);
  const data = JSON.parse(head.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
  assert.equal(data['@type'], 'TechArticle');
  assert.equal(data.url, `${siteUrl}/get-started`);
  assert.match(sitemap, new RegExp(`<loc>${siteUrl}/get-started</loc>`));
  assert.doesNotMatch(page, /monifiled/i);
});

test('get-started page runs no inline script and loads only its own and the shared script', () => {
  const scripts = [...page.matchAll(/<script\b([^>]*)>/gi)].map((match) => match[1]!);
  const executable = scripts.filter((attributes) => !/type="application\/ld\+json"/.test(attributes));
  assert.deepEqual(executable.map((attributes) => attributes.match(/src="([^"]+)"/)?.[1]), ['/script.js', '/get-started.js']);
  assert.ok(executable.every((attributes) => /\bdefer\b/.test(attributes)));
  assert.doesNotMatch(page, /\son[a-z]+="/i, 'no inline event handlers under script-src self');
});

test('every translated element carries both languages', () => {
  const tags = [...page.matchAll(/<[a-z0-9]+\b[^>]*\bdata-(?:ko|en)=[^>]*>/gi)].map((match) => match[0]);
  assert.ok(tags.length > 60);
  for (const tag of tags) {
    const ko = tag.match(/\sdata-ko="([^"]*)"/)?.[1];
    const en = tag.match(/\sdata-en="([^"]*)"/)?.[1];
    assert.ok(ko && en, `both languages on ${tag.slice(0, 80)}`);
    assert.notEqual(ko, en, `languages differ on ${tag.slice(0, 80)}`);
  }
});

test('the site header and footer link to the page', () => {
  assert.equal((home.match(/href="\/get-started"/g) ?? []).length, 2);
  assert.match(page, /<a href="\/get-started" aria-current="page">/);
});

test('demo data covers all eight drifts and is consistent with itself', () => {
  assert.deepEqual(Object.keys(demo.scenarios).sort(), ['000', '001', '010', '011', '100', '101', '110', '111']);
  for (const [key, scenario] of Object.entries(demo.scenarios)) {
    const drifts = Object.values(scenario.flags).filter(Boolean).length;
    assert.equal(scenario.summary.warnings, drifts, `${key}: each drift raises exactly one warning`);
    assert.equal(scenario.summary.errors, 0, key);
    const listed = scenario.compare.split('\n').filter((line) => /^\s+warning\s/.test(line)).length;
    assert.equal(listed, scenario.summary.warnings, `${key}: the printed warnings match the summary`);
    assert.match(scenario.compare, new RegExp(`${scenario.summary.warnings} warning`), key);
    // After apply, the spec agrees with the capture again.
    assert.match(scenario.recheck, /0 error · 0 warning · 0 info/, key);
    assert.match(scenario.apply, /written: docs\/orders\.interface-spec\.json/, key);
    for (const field of ['compare', 'apply', 'recheck', 'judge'] as const) assert.ok(scenario[field].length > 20, `${key}.${field}`);
  }
  // Added rows have empty Korean labels, and the rules catch them even with no model.
  assert.match(demo.scenarios['111']!.judge, /flag .*\(empty\)/);
  assert.equal(demo.render.endpointCount, 3);
  assert.ok(demo.render.warningCount > demo.render.sampleWarnings.length);
  assert.equal(demo.evidence.calls.length, 6);
});

test('demo data leaks neither project IDs nor local paths', () => {
  assert.doesNotMatch(demoSource, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/, 'no project IDs');
  assert.doesNotMatch(demoSource, /\/tmp\/|\/home\/|scratchpad|C:\\\\/, 'no local paths');
  assert.doesNotMatch(page, /\/tmp\/|\/home\/|scratchpad/);
});

test('the page ships the recorded output without JavaScript, matching the data file', () => {
  const live = page.match(/<pre class="gs-pre gs-pre-live"[^>]*><code>([\s\S]*?)<\/code><\/pre>/)?.[1];
  assert.ok(live);
  assert.ok(unescapeHtml(live!).includes(demo.scenarios['111']!.compare));
  assert.ok(unescapeHtml(page).includes(demo.evidence.listing));
});

test('the demo script knows every step and fetches only its own data file', () => {
  for (const step of ['compare', 'apply', 'recheck', 'judge', 'render']) {
    assert.match(script, new RegExp(`\\b${step}:\\s*\\n?\\s*"monofield `), `command for ${step}`);
    assert.match(page, new RegExp(`data-step="${step}"`));
  }
  assert.match(script, /fetch\("\/get-started-demo\.json"/);
  assert.doesNotMatch(script, /eval\(|new Function|innerHTML/);
});
