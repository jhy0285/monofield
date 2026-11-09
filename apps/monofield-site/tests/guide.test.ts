import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const siteUrl = 'https://monofield.vercel.app';
const [page, sitemap, home] = await Promise.all([
  readFile(new URL('../guide.html', import.meta.url), 'utf8'),
  readFile(new URL('../sitemap.xml', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
]);

test('guide page has its own identity: one h1, canonical URL, per-language titles, structured data', () => {
  const head = page.match(/<head>([\s\S]*?)<\/head>/i)?.[1] ?? '';
  assert.equal((page.match(/<h1(?:\s|>)/gi) ?? []).length, 1);
  assert.match(head, new RegExp(`<link rel="canonical" href="${siteUrl}/guide" />`));
  assert.match(head, new RegExp(`<meta property="og:url" content="${siteUrl}/guide" />`));
  const titleKo = page.match(/<html[^>]*data-title-ko="([^"]+)"/)?.[1];
  const titleEn = page.match(/<html[^>]*data-title-en="([^"]+)"/)?.[1];
  assert.ok(titleKo && titleEn && titleKo !== titleEn, 'both language titles are set on <html>');
  assert.equal(head.match(/<title>([^<]+)<\/title>/)?.[1], titleKo);
  const data = JSON.parse(head.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
  assert.equal(data['@type'], 'TechArticle');
  assert.equal(data.url, `${siteUrl}/guide`);
  assert.match(sitemap, new RegExp(`<loc>${siteUrl}/guide</loc>`));
});

test('guide page runs no inline script and loads only the shared script', () => {
  const scripts = [...page.matchAll(/<script\b([^>]*)>/gi)].map((match) => match[1]!);
  const executable = scripts.filter((attributes) => !/type="application\/ld\+json"/.test(attributes));
  assert.deepEqual(executable.map((attributes) => attributes.match(/src="([^"]+)"/)?.[1]), ['/script.js']);
  assert.doesNotMatch(page, /\son[a-z]+="/i, 'no inline event handlers under script-src self');
});

test('every translated element carries both languages', () => {
  const tags = [...page.matchAll(/<[a-z0-9]+\b[^>]*\bdata-(?:ko|en)=[^>]*>/gi)].map((match) => match[0]);
  assert.ok(tags.length > 20);
  for (const tag of tags) {
    const ko = tag.match(/\sdata-ko="([^"]*)"/)?.[1];
    const en = tag.match(/\sdata-en="([^"]*)"/)?.[1];
    assert.ok(ko && en, `both languages on ${tag.slice(0, 80)}`);
    assert.notEqual(ko, en, `languages differ on ${tag.slice(0, 80)}`);
  }
});

test('guide names the real menus, the current release and links only to existing places', () => {
  assert.match(page, /0\.11\.7-preview\.8/);
  assert.match(page, /외부 MCP/);
  assert.match(page, /대화에서 AI가 REA 쓰기/);
  assert.match(page, /레퍼런스로 담기/);
  assert.doesNotMatch(page, /설정 → MCP/);
  assert.doesNotMatch(page, /monifiled/i);
  for (const [, href] of page.matchAll(/href="([^"]+)"/g)) {
    assert.ok(/^(https:\/\/|\/|#)/.test(href!), `absolute or in-page link: ${href}`);
  }
  assert.ok((page.match(/href="#[a-z-]+"/g) ?? []).length >= 9, 'table of contents');
  for (const [, id] of page.matchAll(/href="#([a-z-]+)"/g)) assert.match(page, new RegExp(`id="${id}"`), `anchor target ${id}`);
});

test('the home page and the page footers lead to the guide', () => {
  assert.match(home, /<a class="button button-primary" href="\/guide"/);
  assert.match(home, /href="\/guide"/);
  assert.match(page, /<a href="\/guide">/);
});
