import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildOntology } from '../src/services/ontology/build.js';
import { prepareOntologyContext } from '../src/services/ontology/context.js';
import { rankContextCandidates } from '../src/services/ontology/context-judge.js';
import type { JevEvaluation } from '@open-design/contracts';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
async function fixture(){const root=await mkdtemp(path.join(os.tmpdir(),'mf-context-'));roots.push(root);
 await writeFile(path.join(root,'SignalService.java'),'package traffic; public class SignalService { public int find(){return 30;} }');
 await writeFile(path.join(root,'SignalController.java'),'package traffic; import org.springframework.web.bind.annotation.*; @RestController class SignalController { SignalService service; @GetMapping("/signals") public int signal(){return service.find();} }');
 await writeFile(path.join(root,'Payments.ts'),'export function chargeCustomer(){return "UNRELATED_PAYMENT_SECRET_FIXTURE";}');
 await writeFile(path.join(root,'business.md'),'# 信号 서비스 (SignalService)\n- 최소 녹색 시간: 20초\n');
 await writeFile(path.join(root,'other.md'),'# 信号 서비스 (SignalService)\n- 최소 녹색 시간: 15초\n');
 const job={root,projectPath:'.',businessFiles:[] as string[],request:'SignalService.find',cacheFile:path.join(root,'cached.json')};return{root,job};}
describe('business evidence and focused context',()=>{
 it('reuses unchanged parse facts after an edit but recomputes cross-file relationships',async()=>{
  const {root,job}=await fixture(),first=await buildOntology(job);expect(first.coverage.parsedNowFiles).toBe(3);await writeFile(job.cacheFile,JSON.stringify(first));
  await writeFile(path.join(root,'SignalService.java'),'package traffic; public class SignalService { public int find(){return 40;} }');
  const edited=await buildOntology(job);expect(edited.coverage).toMatchObject({reusedParsedFiles:2,parsedNowFiles:1});
  expect(edited.edges.some(e=>e.relation==='calls')).toBe(true);
  await writeFile(path.join(root,'SignalService.java'),'package traffic; public class SignalService { public int renamed(){return 40;} }');
  const removed=await buildOntology(job);expect(removed.coverage).toMatchObject({reusedParsedFiles:2,parsedNowFiles:1});expect(removed.edges.some(e=>e.relation==='calls')).toBe(false);
  expect(removed.issues.some(i=>i.message.includes('overloaded or unresolved'))).toBe(true);
  await writeFile(job.cacheFile+'.units.json','invalid cache');
  const recovered=await buildOntology(job);expect(recovered.coverage.parsedNowFiles).toBe(3);
 });
 it('extracts exact rule candidates and warns of different numeric literals without resolving business meaning',async()=>{
  const {job}=await fixture(),report=await buildOntology({...job,businessFiles:['business.md','other.md']});
  const rules=report.nodes.filter(n=>n.kind==='business-rule');expect(rules).toHaveLength(2);expect(rules[0]?.evidence.line).toBe(2);
  expect(report.edges.filter(e=>e.relation==='constrains').every(e=>e.basis==='candidate')).toBe(true);
  expect(report.businessRuleConflicts).toEqual([{ruleIds:rules.map(n=>n.id),reason:'different-literal-values'}]);expect(report.businessContext?.businessRulesVerified).toBe(false);
 });
 it('selects relevant hashed source under a strict byte budget, rather than including the full graph',async()=>{
  const {root,job}=await fixture(),ontology=await buildOntology(job);
  const options={ontology,question:'SignalService.find',focusNodeIds:[],maxBytes:4096,localJudge:false,dataDir:root,read:(p:string)=>readFile(path.join(root,p))};
  const packet=await prepareOntologyContext({...options,evidenceMode:'excerpts'});
  expect(packet.evidence.some(e=>e.path==='SignalService.java'&&e.text.includes('return 30'))).toBe(true);
  expect(packet.prompt).not.toContain('UNRELATED_PAYMENT_SECRET_FIXTURE');expect(packet.budget.promptBytes).toBe(Buffer.byteLength(packet.prompt));expect(packet.budget.promptBytes).toBeLessThanOrEqual(4096);
  expect(packet.constructionModelCalls).toBe(0);expect(packet.judge.evaluationAttempts).toBe(0);expect(packet.tokenUsage).toBeNull();
  const references=await prepareOntologyContext({...options,evidenceMode:'references'});expect(references.evidence.every(e=>e.text==='')).toBe(true);expect(references.prompt).not.toContain('return 30');expect(references.budget.promptBytes).toBeLessThan(packet.budget.promptBytes);
 });
 it('includes rule provenance and source links but refuses to treat documents as verified rules',async()=>{
  const {root,job}=await fixture(),ontology=await buildOntology({...job,businessFiles:['business.md','other.md']});const rule=ontology.nodes.find(n=>n.kind==='business-rule')!;
  const packet=await prepareOntologyContext({ontology,question:'최소 녹색 시간',focusNodeIds:[rule.id],maxBytes:8192,localJudge:false,dataDir:root,read:p=>readFile(path.join(root,p))});
  expect(packet.businessRules.some(r=>r.state==='unreviewed'&&r.relatedCodePaths.includes('SignalService.java'))).toBe(true);
  expect(packet.prompt).toContain('unverified');expect(packet.evidence.some(e=>e.path==='business.md')).toBe(true);
 });
 it('rejects stale evidence and reports uncertain fallback instead of inventing relevance',async()=>{
  const {root,job}=await fixture(),ontology=await buildOntology(job),options={ontology,question:'SignalService',focusNodeIds:[],maxBytes:4096,localJudge:false,dataDir:root,read:(p:string)=>readFile(path.join(root,p))};
  await writeFile(path.join(root,'SignalService.java'),'changed');await expect(prepareOntologyContext(options)).rejects.toThrow('changed after ontology');
  const fresh=await buildOntology(job);const unknown=await prepareOntologyContext({...options,ontology:fresh,question:'zzzzzzzzz'});expect(unknown.warnings.join()).toContain('fallback evidence may be unrelated');
 });
});
describe('bounded optional local evidence ordering',()=>{
 const candidates=[{id:'a',label:'alpha'},{id:'b',label:'beta'}];
 it('never calls a model by default or forwards candidate labels to a hosted backend',async()=>{
  const evaluate=vi.fn(),config=vi.fn(async()=>({backend:'typesafe' as const,model:'jev-latest',localBaseUrl:'http://127.0.0.1:8000'}));
  expect((await rankContextCandidates('unused','s','q',candidates,false,{config,evaluate})).judge.evaluationAttempts).toBe(0);expect(config).not.toHaveBeenCalled();
  expect((await rankContextCandidates('unused','s','q',candidates,true,{config,evaluate})).judge.reason).toBe('not-local');expect(evaluate).not.toHaveBeenCalled();
 });
 it('caches a confident advisory order by source/model/query, and invalidates it after source changes',async()=>{
  const config=async()=>({backend:'local' as const,model:'test-local',localBaseUrl:'http://127.0.0.1:18090'});
  const evaluate=vi.fn(async()=>({backend:'local',requestedModel:'test-local',elapsedMs:10,result:{model:'test-local',answers:{priority:{type:'choice',choice:'C2',confidence:.95,probabilities:{C1:.03,C2:.95,NONE:.02}}},usage:{input_tokens:100,output_tokens:0}}} as JevEvaluation));
  const first=await rankContextCandidates('unused','cache-one','question',candidates,true,{config,evaluate});expect(first.priority).toBe('b');expect(first.judge.usage?.input_tokens).toBe(100);
  const same=await rankContextCandidates('unused','cache-one','question',candidates,true,{config,evaluate});expect(same.judge).toMatchObject({cached:true,evaluationAttempts:0,usage:null});expect(evaluate).toHaveBeenCalledTimes(1);
  await rankContextCandidates('unused','cache-two','question',candidates,true,{config,evaluate});expect(evaluate).toHaveBeenCalledTimes(2);
 });
 it('falls back after a deadline, unavailable server or uncertain answer without inventing usage',async()=>{
  const config=async()=>({backend:'local' as const,model:'test-timeout',localBaseUrl:'http://127.0.0.1:18090'});
  const slow=await rankContextCandidates('unused','slow','q',candidates,true,{config,timeoutMs:15,evaluate:()=>new Promise(()=>{})});expect(slow.judge.reason).toBe('timeout');expect(slow.priority).toBeNull();expect(slow.judge.usage).toBeNull();
  const failed=await rankContextCandidates('unused','failed','q',candidates,true,{config,evaluate:async()=>{throw new Error('offline');}});expect(failed.judge.reason).toBe('unavailable');expect(failed.judge.usage).toBeNull();
  const uncertain=vi.fn(async()=>({backend:'local',requestedModel:'test-timeout',elapsedMs:1,result:{model:'test-timeout',answers:{priority:{type:'choice',choice:'C1',confidence:.5,probabilities:{C1:.5,C2:.45,NONE:.05}}},usage:{input_tokens:123,output_tokens:0}}} as JevEvaluation));
  await rankContextCandidates('unused','uncertain','q',candidates,true,{config,evaluate:uncertain});
  const repeat=await rankContextCandidates('unused','uncertain','q',candidates,true,{config,evaluate:uncertain});expect(repeat.judge).toMatchObject({reason:'uncertain',cached:true,evaluationAttempts:0,usage:null});expect(uncertain).toHaveBeenCalledTimes(1);
 });
 it('includes a stalled configuration read in the decision deadline',async()=>{
  const evaluate=vi.fn();
  const result=await Promise.race([
   rankContextCandidates('unused','hung-config','q',candidates,true,{timeoutMs:15,config:()=>new Promise(()=>{}),evaluate}),
   new Promise<null>(resolve=>setTimeout(()=>resolve(null),150)),
  ]);
  expect(result?.judge).toMatchObject({reason:'timeout',evaluationAttempts:0,usage:null});expect(evaluate).not.toHaveBeenCalled();
 });
});
