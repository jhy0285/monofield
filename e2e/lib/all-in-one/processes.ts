import { readdir, readFile } from 'node:fs/promises';

export interface ProcessSample {
  pid: number;
  parent: number;
  startTicks: string;
  name: string;
  pssKiB: number | null;
  rssKiB: number;
  cpuTicks: number;
}

/** PSS apportions shared pages; summing RSS alone double counts them. Linux only. */
export async function processTree(roots: number[], known = new Map<number, string>()): Promise<ProcessSample[]> {
  const rows = (await Promise.all((await readdir('/proc')).filter(name => /^\d+$/.test(name)).map(async name => {
    try {
      const pid = Number(name);
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
      const close = stat.lastIndexOf(')');
      const fields = stat.slice(close + 2).split(' ');
      return { pid, parent: Number(fields[1]), startTicks: fields[19]!, name: stat.slice(stat.indexOf('(') + 1, close), cpuTicks: Number(fields[11]) + Number(fields[12]) };
    } catch { return null; }
  }))).filter(row => row !== null);
  const selected = new Set(roots);
  for (const row of rows) if (known.get(row.pid) === row.startTicks) selected.add(row.pid);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) if (selected.has(row.parent) && !selected.has(row.pid)) { selected.add(row.pid); changed = true; }
  }
  const result = await Promise.all(rows.filter(row => selected.has(row.pid)).map(async row => {
    known.set(row.pid, row.startTicks);
    try {
      const rollup = await readFile(`/proc/${row.pid}/smaps_rollup`, 'utf8');
      return { ...row, pssKiB: Number(/^Pss:\s+(\d+)/m.exec(rollup)?.[1] ?? 0), rssKiB: Number(/^Rss:\s+(\d+)/m.exec(rollup)?.[1] ?? 0) };
    } catch {
      try {
        const status = await readFile(`/proc/${row.pid}/status`, 'utf8');
        return { ...row, pssKiB: null, rssKiB: Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1] ?? 0) };
      } catch { return null; }
    }
  }));
  return result.filter(row => row !== null);
}
