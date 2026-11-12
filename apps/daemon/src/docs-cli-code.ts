import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import nodePath from 'node:path';
import type { InterfaceSpecReportLanguage } from '@open-design/contracts';
import { renderInterfaceSpecXlsx } from './doc-renderers/interface-spec/render-xlsx.js';
import { compareCodeWithRevision, scanCodebase } from './services/document-rescan.js';
import {
  checkPasses, checkSummaryLine, renderCheckReport, type CheckFailOn, type CheckReportFormat,
} from './services/interface-spec-check-report.js';
import { resolveInterfaceSpecScriptsDir } from './services/interface-spec-scripts.js';

/**
 * `monofield docs scan` and `monofield docs check`: the two commands that read code directly, with neither an AI
 * tool nor the running app. Exit codes: 0 done (or the gate passed), 1 the gate failed, 2 the command could not run.
 */
export const CODE_COMMANDS = new Set(['scan', 'check']);

const CANNOT_RUN = 2;

function flags(rest: string[], valued: string[], switches: string[]): Record<string, string | true> | string {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i]!;
    const name = flag.replace(/^--/, '');
    if (flag.startsWith('--') && switches.includes(name)) out[name] = true;
    else if (flag.startsWith('--') && valued.includes(name)) {
      const value = rest[i + 1];
      if (value === undefined) return `Missing value for ${flag}`;
      out[name] = value;
      i += 1;
    } else return `Unknown flag: ${flag}`;
  }
  return out;
}

async function codebaseOf(value: string | true | undefined): Promise<string> {
  const dir = nodePath.resolve(typeof value === 'string' ? value : '.');
  const info = await stat(dir).catch(() => null);
  if (!info?.isDirectory()) throw new Error(`codebase folder not found: ${dir}`);
  return dir;
}

async function scriptsDirOf(value: string | true | undefined): Promise<string> {
  const dir = await resolveInterfaceSpecScriptsDir(typeof value === 'string' ? value : undefined);
  if (!dir) throw new Error('the interface-spec scanner was not found; pass --scripts-dir <folder with scan_spring.py>');
  return dir;
}

export async function runDocsScan(rest: string[]): Promise<{ exitCode: number }> {
  const parsed = flags(rest, ['codebase', 'out', 'xlsx', 'name-dict', 'name', 'scripts-dir'], ['include-audit-fields']);
  if (typeof parsed === 'string') {
    console.error(parsed);
    return { exitCode: CANNOT_RUN };
  }
  try {
    const codebase = await codebaseOf(parsed.codebase);
    const out = nodePath.resolve(typeof parsed.out === 'string' ? parsed.out : nodePath.join(codebase, 'docs', 'api.interface-spec.json'));
    const doc = await scanCodebase({
      codebasePath: codebase, out, scriptsDir: await scriptsDirOf(parsed['scripts-dir']),
      codebaseName: typeof parsed.name === 'string' ? parsed.name : nodePath.basename(codebase),
      ...(typeof parsed['name-dict'] === 'string' ? { nameDict: nodePath.resolve(parsed['name-dict']) } : {}),
      includeAuditFields: parsed['include-audit-fields'] === true,
    });
    if (doc.endpoints.length === 0) {
      await rm(out, { force: true });
      throw new Error(`no Spring controllers were found under ${codebase} (looked for @RestController/@Controller in .java and .kt files)`);
    }
    let xlsx: string | undefined;
    if (typeof parsed.xlsx === 'string') {
      xlsx = nodePath.resolve(parsed.xlsx);
      // Render what was written, so the workbook and the JSON never disagree.
      const rendered = await renderInterfaceSpecXlsx(JSON.parse(await readFile(out, 'utf8')));
      await writeFile(xlsx, rendered.buffer);
    }
    const undecided = doc.endpoints.filter((endpoint) => endpoint.auth?.type === 'undecided').length;
    console.log(JSON.stringify({
      output: out, endpointCount: doc.endpoints.length, language: doc.source.language,
      ...(doc.source.revision ? { revision: doc.source.revision } : {}),
      authUndecided: undecided, ...(xlsx ? { xlsx } : {}),
    }, null, 2));
    return { exitCode: 0 };
  } catch (err) {
    console.error((err as Error).message);
    return { exitCode: CANNOT_RUN };
  }
}

export async function runDocsCheck(rest: string[]): Promise<{ exitCode: number }> {
  const parsed = flags(rest, ['codebase', 'base', 'format', 'lang', 'fail-on', 'out', 'scripts-dir'], []);
  if (typeof parsed === 'string') {
    console.error(parsed);
    return { exitCode: CANNOT_RUN };
  }
  const format = (parsed.format ?? 'text') as CheckReportFormat;
  const lang = (parsed.lang ?? 'ko') as InterfaceSpecReportLanguage;
  const failOn = (parsed['fail-on'] ?? 'breaking') as CheckFailOn;
  if (typeof parsed.base !== 'string') {
    console.error('Missing required --base <git revision> (for example origin/main or the merge base of the pull request)');
    return { exitCode: CANNOT_RUN };
  }
  if (!['text', 'markdown', 'json'].includes(format) || !['ko', 'en'].includes(lang) || !['breaking', 'warning', 'never'].includes(failOn)) {
    console.error('--format is text|markdown|json, --lang is ko|en, --fail-on is breaking|warning|never');
    return { exitCode: CANNOT_RUN };
  }
  try {
    const comparison = await compareCodeWithRevision({
      codeRoot: await codebaseOf(parsed.codebase), base: parsed.base, scriptsDir: await scriptsDirOf(parsed['scripts-dir']),
    });
    const report = renderCheckReport(comparison, { format, lang, failOn });
    if (typeof parsed.out === 'string') {
      const target = nodePath.resolve(parsed.out);
      await writeFile(target, report, 'utf8');
      console.log(`${checkSummaryLine(comparison, lang)} → ${target}`);
    } else {
      console.log(report.trimEnd());
    }
    return { exitCode: checkPasses(comparison, failOn) ? 0 : 1 };
  } catch (err) {
    console.error((err as Error).message);
    return { exitCode: CANNOT_RUN };
  }
}
