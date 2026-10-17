'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@open-design/components';
import type { CodeOntologyContextResponse } from '@open-design/contracts';
import { useT } from '../i18n';
import styles from './CodeOntologyPanel.module.css';

export function OntologyContextPanel({ projectId, projectPath, documents, defaultQuestion, selectedNodeId, revisionKey, ready, onRequestDraft, onBusyChange }: {
  projectId: string; projectPath: string | null | undefined; documents: string; defaultQuestion: string; selectedNodeId: string; revisionKey: string | undefined;
  ready: boolean; onRequestDraft: ((prompt: string) => void) | undefined;
  onBusyChange?: (busy: boolean) => void;
}) {
  const t = useT();
  const [open,setOpen] = useState(false),[question,setQuestion] = useState(defaultQuestion),[maxBytes,setMaxBytes] = useState(4096),[localJudge,setLocalJudge] = useState(false);
  const [result,setResult] = useState<CodeOntologyContextResponse|null>(null),[busy,setBusy] = useState(false),[error,setError] = useState('');
  const [evidenceMode,setEvidenceMode] = useState<'references'|'excerpts'>('references');
  const generation=useRef(0),abort=useRef<AbortController|null>(null);
  useEffect(()=>{onBusyChange?.(busy);},[busy,onBusyChange]);
  useEffect(()=>()=>onBusyChange?.(false),[onBusyChange]);
  useEffect(()=>{generation.current++;abort.current?.abort();setResult(null);setBusy(false);setError('');return()=>{generation.current++;abort.current?.abort();};},
    [projectId,projectPath,documents,question,maxBytes,localJudge,selectedNodeId,revisionKey,ready,evidenceMode]);
  useEffect(()=>setQuestion(defaultQuestion),[defaultQuestion]);
  async function prepare(){
    const current=++generation.current,controller=new AbortController();abort.current?.abort();abort.current=controller;setBusy(true);setError('');setResult(null);
    try{
      const response=await fetch(`/api/projects/${encodeURIComponent(projectId)}/ontology/context`,{method:'POST',headers:{'content-type':'application/json'},signal:controller.signal,
        body:JSON.stringify({...(projectPath?{projectPath}:{}),businessFiles:documents.split('\n').map(s=>s.trim()).filter(Boolean),request:question,maxBytes,localJudge,evidenceMode,focusNodeIds:selectedNodeId?[selectedNodeId]:[]})});
      const value=await response.json();if(!response.ok)throw new Error(value?.error?.message??t('ontology.failed'));
      if(generation.current===current)setResult(value);
    }catch(e){if(generation.current===current&&!controller.signal.aborted)setError(e instanceof Error?e.message:String(e));}
    finally{if(generation.current===current)setBusy(false);}
  }
  return <section className={styles.contextPanel} aria-label={t('ontology.contextPack.title')}>
    <Button aria-expanded={open} onClick={()=>setOpen(value=>!value)}>{t('ontology.contextPack.title')}</Button>
    {open?<div className={styles.contextBody}>
      <p>{t('ontology.contextPack.description')}</p>
      <label>{t('ontology.contextPack.question')}<textarea rows={2} maxLength={2000} value={question} onChange={e=>setQuestion(e.target.value)} /></label>
      <div className={styles.actions}><label>{t('ontology.contextPack.budget')}<select value={maxBytes} onChange={e=>setMaxBytes(Number(e.target.value))}>
        {[4096,8192,16384].map(n=><option key={n} value={n}>{n/1024} KB</option>)}</select></label>
        <label>{t('ontology.contextPack.mode')}<select value={evidenceMode} onChange={e=>setEvidenceMode(e.target.value as 'references'|'excerpts')}>
          <option value="references">{t('ontology.contextPack.references')}</option><option value="excerpts">{t('ontology.contextPack.excerpts')}</option></select></label></div>
      <label className={styles.scope}><input type="checkbox" checked={localJudge} onChange={e=>setLocalJudge(e.target.checked)} />{t('ontology.contextPack.localJudge')}</label>
      <p className={styles.meta}>{t('ontology.contextPack.judgeHint')}</p>
      {selectedNodeId?<p className={styles.meta}>{t('ontology.contextPack.focused')}</p>:null}
      <div className={styles.actions}><Button disabled={busy||!ready||!question.trim()} onClick={()=>void prepare()}>{busy?t('ontology.working'):t('ontology.contextPack.prepare')}</Button>
        {busy?<Button onClick={()=>{generation.current++;abort.current?.abort();setBusy(false);}}>{t('common.cancel')}</Button>:null}</div>
      {error?<p role="alert" className={styles.error}>{error}</p>:null}
      {result?<div className={styles.report}>
        <p role="status">{t('ontology.contextPack.summary',{files:new Set(result.evidence.map(e=>e.path)).size,bytes:result.budget.promptBytes,budget:result.budget.maxBytes})}</p>
        <p className={styles.meta}>{t('ontology.contextPack.baselines',{graph:result.budget.fullGraphBytes,draft:result.budget.existingHandoffBytes})}</p>
        <p className={styles.meta}>{t('ontology.contextPack.costBoundary')}</p>
        <p>{t('ontology.contextPack.judgeResult',{reason:t(`ontology.contextPack.judge.${result.judge.reason}`),attempts:result.judge.evaluationAttempts})}{result.judge.cached?' · '+t('ontology.contextPack.cached'):''}</p>
        {result.judge.usage?<p className={styles.meta}>{t('ontology.contextPack.judgeUsage',{input:result.judge.usage.input_tokens,output:result.judge.usage.output_tokens})}</p>:null}
        <ul className={styles.evidenceFiles}>{result.evidence.map((item,i)=><li key={`${item.path}:${i}`}><strong>{item.path}:{item.startLine}–{item.endLine}</strong>
          <details><summary>{t('ontology.evidence')}</summary>{item.text?<pre>{item.text}</pre>:<p>{t('ontology.contextPack.referencesHint')}</p>}<small>SHA-256 {item.sha256}</small></details></li>)}</ul>
        {result.businessRules.length?<p>{t('ontology.rules.pending',{count:result.businessRules.length})}</p>:null}
        {result.warnings.length?<details><summary>{t('docs.graph.warnings')}</summary><ul>{result.warnings.map((warning,i)=><li key={i}>{warning}</li>)}</ul></details>:null}
        <details><summary>{t('ontology.contextPack.preview')}</summary><textarea readOnly rows={8} value={result.prompt} aria-label={t('ontology.contextPack.preview')} /></details>
        <div className={styles.actions}><Button disabled={!ready} onClick={()=>onRequestDraft?.(result.prompt)}>{t('ontology.contextPack.draft')}</Button>
          <Button onClick={()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='monofield-focused-context.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),0);}}>{t('ontology.contextPack.export')}</Button></div>
      </div>:null}
    </div>:null}
  </section>;
}
