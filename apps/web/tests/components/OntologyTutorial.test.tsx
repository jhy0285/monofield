// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../src/i18n';
import { CodeOntologyPanel } from '../../src/components/CodeOntologyPanel';
import { OntologyTutorial } from '../../src/components/OntologyTutorial';

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); localStorage.setItem('open-design:locale','en'); vi.stubGlobal('fetch',vi.fn()); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const panel = () => render(<I18nProvider><CodeOntologyPanel projectId="demo" /></I18nProvider>);
const open = () => fireEvent.click(screen.getByRole('button',{name:'Build ontology from code'}));
const close = () => fireEvent.click(screen.getByRole('button',{name:'Close'}));
describe('ontology illustrative walkthrough', () => {
  it('opens on first panel visit, closes for this window, and remains manually available without analysis calls', () => {
    const view=panel();open();expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('This illustrative demo does not analyze your project or change files or documents.')).toBeTruthy();close();
    expect(screen.queryByRole('dialog')).toBeNull();open();open();expect(screen.queryByRole('dialog')).toBeNull();
    view.unmount();panel();open();expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Watch the ontology walkthrough'}));expect(screen.getByRole('dialog')).toBeTruthy();expect(fetch).not.toHaveBeenCalled();
  });
  it('persists never-again across a new session but allows manual replay and reversing that choice', () => {
    const view=panel();open();fireEvent.click(screen.getByRole('checkbox',{name:'Do not show automatically again'}));close();view.unmount();sessionStorage.clear();
    panel();open();expect(screen.queryByRole('dialog')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Watch the ontology walkthrough'}));
    expect((screen.getByRole('checkbox',{name:'Do not show automatically again'}) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('checkbox',{name:'Do not show automatically again'}));close();expect(localStorage.getItem('monofield:ontology-tutorial-dismissed:v1')).toBeNull();
  });
  it('demonstrates both evidence modes and all five steps without changing actual document inputs or calling APIs', () => {
    panel();open();fireEvent.click(screen.getByRole('button',{name:'With business documents'}));expect(screen.getByText(/20 seconds/)).toBeTruthy();
    expect((screen.getByLabelText('Optional business documents (module-relative Markdown/TXT paths, one per line)') as HTMLTextAreaElement).value).toBe('');
    fireEvent.click(screen.getByRole('button',{name:'Step 3 of 5'}));expect(screen.getByText('Inspect the evidence behind a link')).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'Next'}));expect(screen.getByText('Follow the effect of a change')).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'Next'}));expect(screen.getByText('Maven test · Needs to run')).toBeTruthy();
    expect(screen.getByText('Business rules unverified')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Start in my project'}));
    expect(screen.queryByRole('dialog')).toBeNull();expect(fetch).not.toHaveBeenCalled();
  });
  it('supports timed playback, pause and reduced-motion manual navigation', () => {
    vi.useFakeTimers();const view=render(<I18nProvider><OntologyTutorial onClose={()=>{}} /></I18nProvider>);
    act(()=>vi.advanceTimersByTime(7000));expect(screen.getByText('Business documents are optional')).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'Pause'}));act(()=>vi.advanceTimersByTime(14000));expect(screen.getByText('Business documents are optional')).toBeTruthy();view.unmount();
    vi.stubGlobal('matchMedia',vi.fn(()=>({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()})));
    render(<I18nProvider><OntologyTutorial onClose={()=>{}} /></I18nProvider>);act(()=>vi.advanceTimersByTime(14000));
    expect(screen.getByText('Choose the code scope')).toBeTruthy();expect(screen.getByRole('button',{name:'Play'}).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button',{name:'Next'}));expect(screen.getByText('Business documents are optional')).toBeTruthy();
  });
  it('traps keyboard focus and restores it to the guide trigger on Escape', () => {
    panel();screen.getByRole('button',{name:'Build ontology from code'}).focus();open();const first=screen.getByRole('button',{name:'Close'}),last=screen.getByRole('button',{name:'Next'});
    expect(document.activeElement).toBe(first);last.focus();fireEvent.keyDown(document,{key:'Tab'});expect(document.activeElement).toBe(first);
    fireEvent.keyDown(document,{key:'Tab',shiftKey:true});expect(document.activeElement).toBe(last);
    fireEvent.keyDown(document,{key:'Escape'});expect(screen.queryByRole('dialog')).toBeNull();expect(document.activeElement).toBe(screen.getByRole('button',{name:'Build ontology from code'}));
  });
});
