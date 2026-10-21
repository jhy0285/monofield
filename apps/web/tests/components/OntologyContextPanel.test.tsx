// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodeOntologyContextResponse } from '@open-design/contracts';
import { I18nProvider } from '../../src/i18n';
import { OntologyContextPanel } from '../../src/components/OntologyContextPanel';

const result:CodeOntologyContextResponse={schemaVersion:1,projectPath:'.',snapshotSha256:'a'.repeat(64),question:'signal',evidenceMode:'references',businessContext:undefined,
 evidence:[{path:'SignalService.java',startLine:1,endLine:4,sha256:'b'.repeat(64),text:'class SignalService {}',reason:'direct-match',nodeIds:['service']}],businessRules:[],
 budget:{maxBytes:4096,promptBytes:1500,fullGraphBytes:16000,existingHandoffBytes:5000,includedEvidenceBytes:30,omittedCandidateFiles:2},tokenUsage:null,
 judge:{reason:'disabled',evaluationAttempts:0,cached:false,elapsedMs:0,model:null,usage:null},warnings:['Static candidates require review.'],prompt:'Inspect only these current source excerpts. Business rules are unverified.',constructionModelCalls:0,elapsedMs:10};
const props={projectId:'traffic',projectPath:'.',documents:'business.md',defaultQuestion:'signal',selectedNodeId:'',revisionKey:'one',ready:true,onRequestDraft:vi.fn()};
beforeEach(()=>{localStorage.setItem('open-design:locale','en');vi.stubGlobal('fetch',vi.fn(async()=>Response.json(result)));props.onRequestDraft.mockClear();});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const open=()=>fireEvent.click(screen.getByRole('button',{name:'Prepare focused AI evidence'}));
describe('question-directed source evidence',()=>{
 it('prepares only on explicit request, shows honest cost boundaries and fills a draft without sending it',async()=>{
  render(<I18nProvider><OntologyContextPanel {...props} /></I18nProvider>);open();expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Build focused evidence'}));await waitFor(()=>expect(screen.getByText('SignalService.java:1–4')).toBeTruthy());
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]?.body))).toMatchObject({request:'signal',maxBytes:4096,localJudge:false,businessFiles:['business.md']});
  expect(screen.getByText(/Bytes are not provider input\/cache\/output tokens/)).toBeTruthy();expect(screen.getByText(/0 evaluation attempts/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Prepare a request with this evidence'}));expect(props.onRequestDraft).toHaveBeenCalledWith(result.prompt);expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('makes local ranking opt-in and invalidates results after a question, budget or revision changes',async()=>{
  const view=render(<I18nProvider><OntologyContextPanel {...props} selectedNodeId="service" /></I18nProvider>);open();
  fireEvent.click(screen.getByRole('checkbox',{name:'Use a local decision model to help order ambiguous candidates'}));
  fireEvent.click(screen.getByRole('button',{name:'Build focused evidence'}));await waitFor(()=>expect(screen.getByText('SignalService.java:1–4')).toBeTruthy());
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]?.body))).toMatchObject({localJudge:true,focusNodeIds:['service']});
  view.rerender(<I18nProvider><OntologyContextPanel {...props} revisionKey="two" selectedNodeId="service" /></I18nProvider>);expect(screen.queryByText('SignalService.java:1–4')).toBeNull();
  fireEvent.change(screen.getByLabelText('Question for the AI'),{target:{value:'new question'}});expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('aborts an in-flight result when input changes and never presents the late reply as current',async()=>{
  let finish!:(r:Response)=>void;vi.mocked(fetch).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  render(<I18nProvider><OntologyContextPanel {...props} /></I18nProvider>);open();fireEvent.click(screen.getByRole('button',{name:'Build focused evidence'}));
  const signal=vi.mocked(fetch).mock.calls[0]![1]?.signal as AbortSignal;fireEvent.change(screen.getByLabelText('Question for the AI'),{target:{value:'changed'}});expect(signal.aborted).toBe(true);
  finish(Response.json(result));await waitFor(()=>expect(screen.queryByText('SignalService.java:1–4')).toBeNull());
 });
});
