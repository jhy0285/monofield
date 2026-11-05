// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MCP_MASKED_SECRET, type McpTemplateField } from '@open-design/contracts';
import { I18nProvider } from '../../src/i18n';
import { McpFolderFields } from '../../src/components/McpFolderFields';

const FIELDS: McpTemplateField[] = [
  { key: 'GHIDRA_INSTALL_DIR', label: 'Ghidra folder', folder: true, placeholder: 'C:\\ghidra_PUBLIC' },
  { key: 'JAVA_HOME', label: 'Java (JDK) folder', folder: true },
];

beforeEach(() => { localStorage.setItem('open-design:locale', 'en'); });
afterEach(cleanup);

function Harness({ initial }: { initial: string }) {
  const [text, setText] = useState(initial);
  return (
    <I18nProvider>
      <McpFolderFields fields={FIELDS} envText={text} onChange={setText} />
      <pre data-testid="env">{text}</pre>
    </I18nProvider>
  );
}
const env = () => screen.getByTestId('env').textContent;

describe('McpFolderFields', () => {
  it('shows one labelled input per folder and writes a typed path into the env text', () => {
    render(<Harness initial="API_KEY=abc" />);
    const ghidra = screen.getByLabelText('Ghidra folder') as HTMLInputElement;
    expect(ghidra.placeholder).toBe('C:\\ghidra_PUBLIC');
    fireEvent.change(ghidra, { target: { value: 'C:\\Program Files\\ghidra' } });
    expect(env()).toBe('API_KEY=abc\nGHIDRA_INSTALL_DIR=C:\\Program Files\\ghidra');
    fireEvent.change(screen.getByLabelText('Java (JDK) folder'), { target: { value: '/opt/jdk' } });
    expect(env()).toBe('API_KEY=abc\nGHIDRA_INSTALL_DIR=C:\\Program Files\\ghidra\nJAVA_HOME=/opt/jdk');
  });

  it('reflects what is already in the env text, including lines edited in the text box', () => {
    render(<Harness initial={'JAVA_HOME=/opt/jdk'} />);
    expect((screen.getByLabelText('Java (JDK) folder') as HTMLInputElement).value).toBe('/opt/jdk');
    expect((screen.getByLabelText('Ghidra folder') as HTMLInputElement).value).toBe('');
  });

  it('removes the line instead of saving an empty value', () => {
    render(<Harness initial={'API_KEY=abc\nJAVA_HOME=/opt/jdk'} />);
    fireEvent.change(screen.getByLabelText('Java (JDK) folder'), { target: { value: '' } });
    expect(env()).toBe('API_KEY=abc');
  });

  it('warns about a relative path, without blocking it', () => {
    render(<Harness initial="" />);
    fireEvent.change(screen.getByLabelText('Ghidra folder'), { target: { value: 'tools/ghidra' } });
    expect(screen.getByRole('alert').textContent).toContain('full path');
    expect(env()).toBe('GHIDRA_INSTALL_DIR=tools/ghidra');
    fireEvent.change(screen.getByLabelText('Ghidra folder'), { target: { value: '/opt/ghidra' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a stored (masked) folder as saved, keeps it until replaced, and can remove it', () => {
    render(<Harness initial={`GHIDRA_INSTALL_DIR=${MCP_MASKED_SECRET}`} />);
    const ghidra = screen.getByLabelText('Ghidra folder') as HTMLInputElement;
    expect(ghidra.value).toBe('');
    expect(ghidra.placeholder).toMatch(/^Saved \(hidden\)/);
    expect(env()).toBe(`GHIDRA_INSTALL_DIR=${MCP_MASKED_SECRET}`);
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(env()).toBe('');
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });

  it('replaces a stored folder when a new path is typed', () => {
    render(<Harness initial={`GHIDRA_INSTALL_DIR=${MCP_MASKED_SECRET}`} />);
    fireEvent.change(screen.getByLabelText('Ghidra folder'), { target: { value: '/opt/new' } });
    expect(env()).toBe('GHIDRA_INSTALL_DIR=/opt/new');
  });

  it('renders nothing without fields', () => {
    const { container } = render(<I18nProvider><McpFolderFields fields={[]} envText="" onChange={() => {}} /></I18nProvider>);
    expect(container.querySelector('[data-testid="mcp-folder-fields"]')).toBeNull();
  });
});
