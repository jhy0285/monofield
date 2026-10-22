import { mkdir, copyFile, writeFile, readFile, open } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve, join } from 'node:path';
import { createInterface } from 'node:readline';

// Only creates a new output directory. Never overwrites a previous investigation.
const [reaArg, monoArg, outArg] = process.argv.slice(2);
if (!reaArg || !monoArg || !outArg) throw new Error('Usage: node run-demo.ts <built-rea-repo> <built-monofield-repo> <new-output-directory>');
const rea = resolve(reaArg, 'scripts/rea.mjs');
const mono = resolve(monoArg, 'apps/daemon/bin/monofield.mjs');
const out = resolve(outArg);
await mkdir(out); // EEXIST is deliberate: retain prior evidence.
for (const dir of ['evidence', 'deliverables', 'fixture-source']) await mkdir(join(out, dir));
await copyFile(join(import.meta.dirname, 'fixture-source/prepare.ts'), join(out, 'fixture-source/prepare.ts'));
await copyFile(join(import.meta.dirname, 'collect-documents.ts'), join(out, 'collect-documents.ts'));
async function command(label: string, args: string[]) {
  const stdout = await open(join(out, 'evidence', label + '.json'), 'w');
  const stderr = await open(join(out, 'evidence', label + '.stderr.log'), 'w');
  try {
    const process = spawn(globalThis.process.execPath, args, { cwd: out, stdio: ['ignore', stdout.fd, stderr.fd] });
    const [code] = await once(process, 'exit');
    if (code !== 0) throw new Error(label + ' failed; see ' + join(out, 'evidence', label + '.stderr.log'));
  } finally { await stdout.close(); await stderr.close(); }
}
await command('prepare', ['fixture-source/prepare.ts']);
const target = join(out, 'shipped-legacy');
await copyFile(join(target, 'legacy.sqlite'), join(out, 'evidence/legacy-before.sqlite'));
await command('static', [rea, 'analyze-javascript-application', target, '--json']);
await command('db-before', [rea, 'inspect-sqlite-database', join(target, 'legacy.sqlite'), '--schema-scope', 'database', '--json']);
const app = spawn(process.execPath, ['server.js'], {cwd:target,env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
const appExit = once(app, 'exit');
try {
  const lines = createInterface({input:app.stdout!});
  const ready = await Promise.race([
    once(lines, 'line').then(([line]) => JSON.parse(line)),
    appExit.then(() => { throw new Error('Fixture exited before readiness'); }),
    new Promise((_, reject) => { const t = setTimeout(() => reject(new Error('Fixture readiness timeout')), 10000);t.unref(); }),
  ]) as {url:string};
  lines.close();
  for (const [input, output] of [['browser-scenario', 'browser'], ['browser-overview', 'browser-overview']]) {
    const scenario = JSON.parse(await readFile(join(import.meta.dirname, input + '.json'), 'utf8'));
    scenario.start_url.url = ready.url;
    const path = join(out, input + '.json'); await writeFile(path, JSON.stringify(scenario,null,2));
    await command(output, [rea, 'capture-browser-scenario', path, '--json']);
  }
  for (const [name,table,columns] of [['db-settlements','settlements',['id','order_id','gross_amount','fee_amount','net_amount']],['db-audit','audit_log',['id','event','order_id','detail']]] as const) {
    await command(name,[rea,'inspect-sqlite-database',join(target,'legacy.sqlite'),'--table',table,...columns.flatMap(c=>['--column',c]),'--row-limit','20','--json']);
  }
} finally {
  app.kill('SIGTERM');
  const timer = setTimeout(() => app.kill('SIGKILL'), 5000);timer.unref();
  await appExit; clearTimeout(timer);
}
const staticEvidence = JSON.parse(await readFile(join(out,'evidence/static.json'),'utf8'));
await writeFile(join(out,'evidence/view-request.json'),JSON.stringify({source:{kind:'inline',evidence:staticEvidence},view:{kind:'summary'}}));
await command('static-summary',[rea,'inspect-analysis-view',join(out,'evidence/view-request.json'),'--json']);
await command('collect',['collect-documents.ts']);
for(const [op,input,output] of [['render-interface-spec','interface-spec.json','interface-spec.xlsx'],['preview-interface-spec','interface-spec.json','interface-spec.html'],['render-screen-spec','screen-spec.json','screen-spec.pptx'],['preview-screen-spec','screen-spec.json','screen-spec.html']]) {
  await command(op,[mono,'docs',op,'--input','deliverables/'+input,'--out','deliverables/'+output]);
}
console.log(JSON.stringify({ok:true,output:out,note:'Real REA CLI + MonoField docs CLI; controlled synthetic target.'}));
