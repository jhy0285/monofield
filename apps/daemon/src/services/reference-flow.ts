import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access } from 'node:fs/promises';
import path from 'node:path';
import {
  REFERENCE_BOARD_FOLDER,
  compareReferenceFlows,
  generalizeObservedPath,
  isApiTransaction,
  normalizeReferenceFlowSteps,
  referenceFlowAgentRequest,
  referenceFlowScenario,
  referenceComparisonBlock,
  referenceFlowStepLabel,
  sanitizeReferenceUrl,
  type ReferenceCompareResponse,
  type ReferenceFlowResponse,
  type ReferenceFlowStep,
  type ReferenceFlowSummary,
} from '@open-design/contracts';
import { locateBundledRea } from './bundled-rea.js';
import { BROWSER_EVIDENCE_PREDICATE, readBrowserEvidence } from './browser-evidence.js';
import { findBrowser } from './rea-doctor.js';
import { buildReaEvidenceView } from './rea-evidence.js';
import { ReferenceBoardError, readReferenceBoard, updateReferenceItem, type ReferenceFileAccess } from './references.js';

/**
 * "Record the flow with REA" for a kept reference: MonoField runs the REA copy it ships with
 * (`rea capture-browser-scenario`) on the reference's URL with the person's steps, keeps REA's evidence next to the
 * board as `references/<id>.flow.json` and links a summary to the card. REA launches the browser with a temporary
 * profile of its own, so nothing the person is signed in to is reused.
 */
export interface ReferenceFlowDeps {
  /** Runs REA with one scenario and returns its stdout (the evidence JSON). */
  runRea: (scenario: Record<string, unknown>, signal?: AbortSignal) => Promise<Buffer>;
  /** A Chromium-family browser, or null. */
  findBrowser: () => Promise<string | null>;
  exists: (file: string) => Promise<boolean>;
  now: () => Date;
}

const RUN_TIMEOUT_MS = 150_000;

export function defaultReferenceFlowDeps(): ReferenceFlowDeps {
  const exists = async (file: string) => { try { await access(file); return true; } catch { return false; } };
  return {
    runRea: (scenario, signal) => new Promise((resolve, reject) => {
      const lookup = locateBundledRea();
      if (!lookup.available) {
        reject(new ReferenceBoardError(`The REA copy that ships with MonoField cannot run here (${lookup.reason}). Check Settings → External MCP → REA setup check.`, 409, 'REFERENCE_FLOW_NO_REA'));
        return;
      }
      const { runtime } = lookup;
      // The scenario goes inline as one argument: no temporary file, and execFile passes it without a shell.
      execFile(runtime.command, [runtime.entry, 'capture-browser-scenario', JSON.stringify(scenario), '--format', 'json'], {
        env: { ...process.env, ...runtime.env }, timeout: RUN_TIMEOUT_MS, maxBuffer: 96 * 1024 * 1024, windowsHide: true, encoding: 'buffer',
        ...(signal ? { signal } : {}),
      }, (error, stdout, stderr) => {
        if (stdout?.length && stdout.toString('utf8', 0, 200).trimStart().startsWith('{')) { resolve(stdout); return; }
        const detail = `${stderr?.toString('utf8') ?? ''}${error ? `\n${error.message}` : ''}`.trim().slice(-600);
        reject(new ReferenceBoardError(`REA did not return a browser capture.${detail ? `\n${detail}` : ''}`, 502, 'REFERENCE_FLOW_FAILED'));
      });
    }),
    findBrowser: () => findBrowser({ platform: process.platform, env: process.env, exists }),
    exists,
    now: () => new Date(),
  };
}

const running = new Set<string>();
const sha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex');

/** What a REA browser capture says about a flow: each step's outcome and the API calls it made. */
export function summarizeFlowEvidence(buffer: Buffer, file: string, steps: ReferenceFlowStep[], browser: string, recordedAt: string): ReferenceFlowSummary {
  const { source, transactions } = readBrowserEvidence(buffer, file);
  const raw = JSON.parse(buffer.toString('utf8')) as { normalized_result?: { steps?: Array<{ step_id?: unknown; status?: unknown; error?: unknown }> } };
  const requested = new Map(steps.map((step, index) => [`step-${index + 1}`, step]));
  const recorded = (raw.normalized_result?.steps ?? []).filter((step) => step.step_id !== 'scenario_start');
  const summarySteps = recorded.map((step) => {
    const id = String(step.step_id ?? '');
    const error = typeof step.error === 'string' ? step.error.replace(/\u001b\[[0-9;]*m/g, '').split('\n')[0]!.slice(0, 160) : '';
    const request = requested.get(id);
    return { id, label: request ? referenceFlowStepLabel(request) : id === 'page-settled' ? 'open the page and let it settle' : id,
      status: String(step.status ?? 'unknown'), ...(error ? { error } : {}), ...(request ? { request } : {}) };
  });
  const calls = new Map<string, { method: string; path: string; status: number | null }>();
  for (const tx of transactions.filter(isApiTransaction)) {
    const call = { method: tx.method, path: generalizeObservedPath(tx.path), status: tx.status };
    calls.set(`${call.method} ${call.path} ${call.status}`, call);
  }
  return {
    file,
    evidenceId: source.evidenceId,
    sha256: sha256(buffer),
    recordedAt,
    browser,
    steps: summarySteps,
    completed: summarySteps.filter((step) => step.status === 'completed').length,
    total: summarySteps.length,
    apiCalls: [...calls.values()].slice(0, 30),
    completeness: source.completeness.status,
  };
}

/** The last screenshot REA captured in a flow, when its bytes match the hash REA recorded. */
export function lastFlowScreenshot(buffer: Buffer): Buffer | null {
  const raw = JSON.parse(buffer.toString('utf8')) as { normalized_result?: { steps?: Array<{ artifacts?: { screenshot?: { state?: unknown; value?: { sha256?: unknown; data_base64?: unknown; media_type?: unknown } } } }> } };
  for (const step of [...(raw.normalized_result?.steps ?? [])].reverse()) {
    const shot = step.artifacts?.screenshot;
    if (shot?.state !== 'captured' || shot.value?.media_type !== 'image/png' || typeof shot.value.data_base64 !== 'string') continue;
    const bytes = Buffer.from(shot.value.data_base64, 'base64');
    if (typeof shot.value.sha256 === 'string' && sha256(bytes) === shot.value.sha256) return bytes;
  }
  return null;
}

async function chooseBrowser(deps: ReferenceFlowDeps, requested: unknown): Promise<string> {
  if (requested !== undefined && requested !== null && requested !== '') {
    if (typeof requested !== 'string' || !(path.isAbsolute(requested) || path.win32.isAbsolute(requested))) {
      throw new ReferenceBoardError('browserPath must be an absolute path to a Chromium-family browser.');
    }
    if (!(await deps.exists(requested))) throw new ReferenceBoardError(`No browser at ${requested}.`, 404, 'REFERENCE_FLOW_NO_BROWSER');
    return requested;
  }
  const found = await deps.findBrowser();
  if (!found) throw new ReferenceBoardError('Recording needs Chrome, Edge or Chromium. Install one, or pass browserPath.', 409, 'REFERENCE_FLOW_NO_BROWSER');
  return found;
}

/**
 * Runs REA on one URL with the steps and keeps the evidence and its last matching screen as `references/<name>.json`
 * and `.png`. One run per reference at a time, whether it records the reference or compares the project's screen.
 */
async function captureFlow(files: ReferenceFileAccess, runKey: string, name: string, url: string, steps: ReferenceFlowStep[], browser: string,
  deps: ReferenceFlowDeps, signal?: AbortSignal): Promise<{ output: Buffer; flow: ReferenceFlowSummary }> {
  if (running.has(runKey)) throw new ReferenceBoardError('This reference is already being recorded.', 409, 'REFERENCE_FLOW_RUNNING');
  running.add(runKey);
  try {
    const output = await deps.runRea(referenceFlowScenario(url, steps, browser), signal);
    let predicate: unknown;
    try { predicate = (JSON.parse(output.toString('utf8')) as { predicate_type?: unknown }).predicate_type; } catch { predicate = undefined; }
    if (predicate !== BROWSER_EVIDENCE_PREDICATE) throw new ReferenceBoardError('REA did not return a browser capture.', 502, 'REFERENCE_FLOW_FAILED');
    const file = `${REFERENCE_BOARD_FOLDER}/${name}.json`;
    const flow = summarizeFlowEvidence(output, file, steps, path.basename(browser.replace(/\\/g, '/')), deps.now().toISOString());
    await files.write(file, output);
    const screen = lastFlowScreenshot(output);
    if (screen) {
      flow.screenshot = `${REFERENCE_BOARD_FOLDER}/${name}.png`;
      await files.write(flow.screenshot, screen);
    }
    return { output, flow };
  } finally {
    running.delete(runKey);
  }
}

export async function recordReferenceFlow(files: ReferenceFileAccess, key: string, id: string, body: Record<string, unknown>,
  deps: ReferenceFlowDeps = defaultReferenceFlowDeps(), signal?: AbortSignal): Promise<ReferenceFlowResponse> {
  const parsed = normalizeReferenceFlowSteps(body.steps);
  if (!parsed.ok) throw new ReferenceBoardError(parsed.error);
  const item = (await readReferenceBoard(files)).items.find((entry) => entry.id === id);
  if (!item) throw new ReferenceBoardError(`No reference ${id} on this board.`, 404, 'REFERENCE_NOT_FOUND');
  const browser = await chooseBrowser(deps, body.browserPath);
  const { flow } = await captureFlow(files, `${key}\u0000${id}`, `${id}.flow`, item.url, parsed.steps, browser, deps, signal);
  // A new reference flow makes an earlier comparison with our screen stale.
  const stale = [item.remake?.flow.file, item.remake?.flow.screenshot].filter((file): file is string => typeof file === 'string' && file.startsWith(`${REFERENCE_BOARD_FOLDER}/${id}.`));
  const updated = await updateReferenceItem(files, key, id, (entry) => { entry.flow = flow; entry.remake = null; });
  for (const file of stale) await files.remove(file).catch(() => undefined);
  return { item: updated, flow };
}

/**
 * Records the project's own screen (`url`, usually the app running locally) with the steps the reference's flow was
 * recorded with, or with `steps`, and compares the two as patterns (`compareReferenceFlows`).
 */
export async function compareReferenceFlow(files: ReferenceFileAccess, key: string, id: string, body: Record<string, unknown>,
  deps: ReferenceFlowDeps = defaultReferenceFlowDeps(), signal?: AbortSignal): Promise<ReferenceCompareResponse> {
  const url = typeof body.url === 'string' ? sanitizeReferenceUrl(body.url) : null;
  if (!url) throw new ReferenceBoardError('url must be the http(s) address of our screen.');
  const item = (await readReferenceBoard(files)).items.find((entry) => entry.id === id);
  if (!item) throw new ReferenceBoardError(`No reference ${id} on this board.`, 404, 'REFERENCE_NOT_FOUND');
  if (!item.flow) throw new ReferenceBoardError('Record the reference\'s flow first; the comparison replays its steps on our screen.', 409, 'REFERENCE_FLOW_MISSING');
  const reference = await files.read(item.flow.file);
  if (!reference) throw new ReferenceBoardError(`${item.flow.file} is missing; record the reference's flow again.`, 409, 'REFERENCE_FLOW_MISSING');
  const parsed = body.steps === undefined
    ? { ok: true as const, steps: item.flow.steps.flatMap((step) => (step.request ? [step.request] : [])) }
    : normalizeReferenceFlowSteps(body.steps);
  if (!parsed.ok) throw new ReferenceBoardError(parsed.error);
  const browser = await chooseBrowser(deps, body.browserPath);
  const { output, flow } = await captureFlow(files, `${key}\u0000${id}`, `${id}.remake.flow`, url, parsed.steps, browser, deps, signal);
  const referenceView = buildReaEvidenceView(reference, item.flow.file);
  const oursView = buildReaEvidenceView(output, flow.file);
  if (referenceView.kind !== 'browser' || oursView.kind !== 'browser') throw new ReferenceBoardError('Both recordings must be REA browser captures.', 409, 'REFERENCE_FLOW_MISSING');
  const labels = Object.fromEntries([...item.flow.steps, ...flow.steps].map((step) => [step.id, step.label]));
  const remake = { url, flow, comparison: compareReferenceFlows(referenceView, oursView, labels), comparedAt: deps.now().toISOString() };
  const updated = await updateReferenceItem(files, key, id, (entry) => { entry.remake = remake; });
  return { item: updated, remake, block: referenceComparisonBlock(updated) };
}

/** The request for the agent when the step editor cannot express the flow; nothing is run. */
export async function referenceFlowRequestText(files: ReferenceFileAccess, id: string, body: Record<string, unknown>): Promise<{ text: string }> {
  const parsed = normalizeReferenceFlowSteps(body.steps);
  if (!parsed.ok) throw new ReferenceBoardError(parsed.error);
  const item = (await readReferenceBoard(files)).items.find((entry) => entry.id === id);
  if (!item) throw new ReferenceBoardError(`No reference ${id} on this board.`, 404, 'REFERENCE_NOT_FOUND');
  return { text: referenceFlowAgentRequest(item, parsed.steps, typeof body.request === 'string' ? body.request : undefined) };
}
