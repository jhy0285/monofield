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
  // the guide body is Korean only; the shared header, footer and buttons switch language
  assert.ok(tags.length >= 10);
  for (const tag of tags) {
    const ko = tag.match(/\sdata-ko="([^"]*)"/)?.[1];
    const en = tag.match(/\sdata-en="([^"]*)"/)?.[1];
    assert.ok(ko && en, `both languages on ${tag.slice(0, 80)}`);
    assert.notEqual(ko, en, `languages differ on ${tag.slice(0, 80)}`);
  }
});

test('guide names the real menus and the current release, and links only to existing places', () => {
  assert.match(page, /0\.11\.7-preview\.11/);
  assert.match(page, /외부 MCP/);
  assert.match(page, /대화에서 AI가 REA 쓰기/);
  assert.match(page, /레퍼런스로 담기/);
  assert.match(page, /Git 변경 분석/);
  assert.doesNotMatch(page, /설정 → MCP/);
  assert.doesNotMatch(page, /monifiled/i);
  // the download button follows the site's download section, so it never names an unpublished release
  assert.doesNotMatch(page, /releases\/download\//);
  for (const [, href] of page.matchAll(/href="([^"]+)"/g)) {
    assert.ok(/^(https:\/\/|\/|#)/.test(href!), `absolute or in-page link: ${href}`);
  }
  for (const [, id] of page.matchAll(/href="#([a-z-]+)"/g)) assert.match(page, new RegExp(`id="${id}"`), `anchor target ${id}`);
});

test('guide is written for two readers and shows the real screens', async () => {
  for (const id of ['developer', 'reader', 'notes', 'trouble']) assert.match(page, new RegExp(`<section id="${id}"`));
  // the two doors at the top lead to each reader's part
  assert.match(page, /<a class="ug-door" href="#developer">/);
  assert.match(page, /<a class="ug-door" href="#reader">/);
  const images = [...page.matchAll(/<img src="\/guide-img\/([^"]+)" alt="([^"]+)" width="(\d+)" height="(\d+)"/g)];
  assert.deepEqual(images.map((match) => match[1]), ['home.webp', 'preview.webp', 'impact.webp', 'impact-breaking.webp']);
  for (const [, file] of images) {
    const bytes = await readFile(new URL(`../guide-img/${file}`, import.meta.url));
    assert.equal(bytes.subarray(8, 12).toString('ascii'), 'WEBP', `${file} is a WebP image`);
    assert.ok(bytes.length < 200_000, `${file} stays small`);
  }
  // no wall of tables: one table for the compatibility levels
  assert.equal((page.match(/<table>/g) ?? []).length, 1);
});

test('guide says what leaves the PC and keeps the limits next to the claims', () => {
  assert.match(page, /AI를 쓰지 않고 PC 안에서만/);
  assert.match(page, /코드 일부가 그 회사로 넘어가요/);
  assert.match(page, /외부 AI를 쓸 수 없는 현장이라면/);
  assert.match(page, /메서드 안에서 정하는 코드/);
  assert.match(page, /Kotlin/);
  assert.match(page, /공개된 실제 Spring 프로젝트 두 곳에서도 다시 쟀어요/);
  assert.match(page, /36건 중 35건/);
});

test('the home page states the measured strengths and their limits', () => {
  const proof = home.match(/<section class="proof-section[\s\S]*?<\/section>/)?.[0] ?? '';
  assert.match(proof, /바뀐 항목은 빠짐없이/);
  assert.match(proof, /156\/156/);
  assert.match(proof, /19\/19/);
  assert.match(proof, /메서드 안에서 정하는 기본값은 읽지 못해/);
  assert.match(proof, /real-projects-2026-11-11\.md/);
  assert.match(proof, /href="https:\/\/github\.com\/jhy0285\/monofield\/blob\/main\/docs\/testing\//);
});

test('the home page and the page footers lead to the guide', () => {
  assert.match(home, /<a class="button button-primary" href="\/guide"/);
  assert.match(home, /href="\/guide"/);
  assert.match(page, /<a href="\/guide">/);
});
