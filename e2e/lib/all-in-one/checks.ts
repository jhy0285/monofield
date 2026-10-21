export interface Check { name: string; passed: boolean; observed: unknown }

/** An evaluator outside either model's workspace. Never trusts the agent's claimed checks. */
export async function checkTraffic(base: string): Promise<Check[]> {
  const checks: Check[] = [];
  async function request(route: string, cycle?: unknown) {
    const response = await fetch(`${base}/api/intersections${route}`, {
      method: cycle === undefined ? 'GET' : 'PUT', headers: { 'content-type': 'application/json' },
      ...(cycle === undefined ? {} : { body: JSON.stringify({ signalCycle: cycle }) }),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    let body: any; try { body = JSON.parse(text); } catch { body = text; }
    return { status: response.status, body };
  }
  const record = (name: string, passed: boolean, observed: unknown) => checks.push({ name, passed, observed });
  const list = await request(''); record('existing list', list.status === 200 && Array.isArray(list.body) && list.body.length === 2, list);
  const before = await request('/1/signal-cycle'); record('existing read', before.status === 200 && typeof before.body.signalCycle === 'number', before);
  const initialHistory = await request('/1/history');
  record('history is a JSON array', initialHistory.status === 200 && Array.isArray(initialHistory.body), initialHistory);
  if (!Array.isArray(initialHistory.body)) return checks;
  let previous = before.body.signalCycle;
  for (const cycle of [30, 180, 75]) {
    const updated = await request('/1/signal-cycle', cycle);
    const read = await request('/1/signal-cycle');
    record(`accept ${cycle} and return persisted value`, updated.status === 200 && updated.body.signalCycle === cycle && read.body.signalCycle === cycle, { updated, read });
    const history = await request('/1/history');
    const entry = Array.isArray(history.body) ? history.body.find((item: any) => item.oldCycle === previous && item.newCycle === cycle && typeof item.changedAt === 'string' && Number.isFinite(Date.parse(item.changedAt))) : null;
    record(`audit ${previous}→${cycle}`, Boolean(entry), history);
    previous = cycle;
  }
  const validHistory = await request('/1/history');
  for (const cycle of [29, 181, 31, 35.5, null, '75']) {
    const result = await request('/1/signal-cycle', cycle);
    record(`reject invalid ${JSON.stringify(cycle)}`, result.status === 400, result);
  }
  record('unknown update is 404', (await request('/999/signal-cycle', 75)).status === 404, 'id=999');
  record('unknown read is 404', (await request('/999/signal-cycle')).status === 404, 'id=999');
  const after = await request('/1/signal-cycle');
  const afterHistory = await request('/1/history');
  record('invalid requests never mutate cycle or audit', after.body.signalCycle === 75 && JSON.stringify(afterHistory.body) === JSON.stringify(validHistory.body), { after, afterHistory });
  const other = await request('/2/signal-cycle'); record('other intersection is unchanged', other.body.signalCycle === 90, other);
  return checks;
}
