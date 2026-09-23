// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileViewer } from '../../src/components/FileViewer';
import type { ProjectFile } from '../../src/types';
import {
  fetchProjectFileText,
  writeProjectTextFileDetailed,
} from '../../src/providers/registry';

vi.mock('../../src/providers/registry', async () => {
  const actual = await vi.importActual<typeof import('../../src/providers/registry')>(
    '../../src/providers/registry',
  );
  return {
    ...actual,
    fetchProjectFileText: vi.fn(),
    writeProjectTextFileDetailed: vi.fn(),
  };
});

const fetchText = vi.mocked(fetchProjectFileText);
const writeText = vi.mocked(writeProjectTextFileDetailed);

function sourceFile(overrides: Partial<ProjectFile> = {}): ProjectFile {
  return {
    name: 'src/app.ts',
    path: 'src/app.ts',
    type: 'file',
    size: 32,
    mtime: 1710000000,
    kind: 'code',
    mime: 'text/typescript',
    ...overrides,
  };
}

describe('FileViewer text editor', () => {
  beforeEach(() => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fetchText.mockResolvedValue('export const value = 1;\n');
    writeText.mockResolvedValue({ ok: true, file: sourceFile({ mtime: 1710000001 }) });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('previews an unsaved Markdown draft, retains it across tabs, and saves through the guarded file API', async () => {
    fetchText.mockResolvedValue('# Weekly report\n\nBefore editing.');
    const file = sourceFile({ name: 'report.md', path: 'report.md', kind: 'text', mime: 'text/markdown' });
    const onFileSaved = vi.fn();
    render(<FileViewer projectId="markdown-workflow" projectKind="prototype" file={file} onFileSaved={onFileSaved} />);
    expect(await screen.findByRole('heading', { name: 'Weekly report' })).toBeTruthy();
    fireEvent.click(screen.getByTestId('markdown-edit'));
    const editor = await screen.findByTestId('text-editor-input');
    fireEvent.change(editor, { target: { value: '# Updated report\n\nApproved next steps.' } });
    fireEvent.click(screen.getByTestId('markdown-preview'));
    expect(await screen.findByRole('heading', { name: 'Updated report' })).toBeTruthy();
    expect(screen.getByTestId('text-editor-dirty')).toBeTruthy();
    expect(writeText).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('markdown-edit'));
    expect((screen.getByTestId('text-editor-input') as HTMLTextAreaElement).value).toContain('Approved next steps.');
    fireEvent.click(screen.getByTestId('text-editor-save'));
    await waitFor(() => expect(onFileSaved).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith('markdown-workflow', 'report.md', '# Updated report\n\nApproved next steps.', { expectedContentSha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(screen.queryByTestId('text-editor-dirty')).toBeNull();
  });

  it('keeps streaming Markdown read-only', async () => {
    fetchText.mockResolvedValue('# Still generating');
    render(<FileViewer projectId="markdown-stream" projectKind="prototype" streaming file={sourceFile({ name: 'stream.md', kind: 'text', mime: 'text/markdown' })} />);
    expect(await screen.findByRole('heading', { name: 'Still generating' })).toBeTruthy();
    expect(screen.queryByTestId('markdown-edit')).toBeNull();
  });

  it('ends the loading state when a document cannot be read', async () => {
    fetchText.mockResolvedValue(null);
    render(<FileViewer projectId="missing-document" projectKind="prototype" file={sourceFile({ name: 'missing.md', kind: 'text', mime: 'text/markdown' })} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText(/Loading…|불러오는 중/)).toBeNull();
    expect(screen.queryByTestId('text-editor-input')).toBeNull();
    expect((screen.getByTestId('text-editor-save') as HTMLButtonElement).disabled).toBe(true);
  });

  it('supports source indentation while allowing keyboard users to leave the editor', async () => {
    fetchText.mockResolvedValue('first\nsecond\n');
    render(<FileViewer projectId="indent-workflow" projectKind="prototype" file={sourceFile()} />);
    const editor = await screen.findByTestId('text-editor-input') as HTMLTextAreaElement;
    editor.setSelectionRange(0, 13);
    expect(fireEvent.keyDown(editor, { key: 'Tab' })).toBe(false);
    expect(editor.value).toBe('  first\n  second\n');
    editor.setSelectionRange(0, editor.value.length);
    fireEvent.keyDown(editor, { key: 'Tab', shiftKey: true });
    expect(editor.value).toBe('first\nsecond\n');
    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(fireEvent.keyDown(editor, { key: 'Tab' })).toBe(true);
  });

  it('preserves a Markdown draft when an external editor changed the document', async () => {
    fetchText.mockResolvedValueOnce('# Original').mockResolvedValue('# Changed externally');
    render(<FileViewer projectId="markdown-conflict" projectKind="prototype" file={sourceFile({ name: 'conflict.md', kind: 'text', mime: 'text/markdown' })} />);
    await screen.findByRole('heading', { name: 'Original' });
    fireEvent.click(screen.getByTestId('markdown-edit'));
    fireEvent.change(screen.getByTestId('text-editor-input'), { target: { value: '# My draft' } });
    fireEvent.click(screen.getByTestId('text-editor-save'));
    expect(await screen.findByTestId('text-editor-conflict')).toBeTruthy();
    expect(writeText).not.toHaveBeenCalled();
    expect((screen.getByTestId('text-editor-input') as HTMLTextAreaElement).value).toBe('# My draft');
    fireEvent.click(screen.getByRole('button', { name: /overwrite with my version|내 내용으로 덮어쓰기/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('markdown-conflict', 'conflict.md', '# My draft', { expectedContentSha256: expect.stringMatching(/^[a-f0-9]{64}$/) }));
  });

  it('edits and saves a source file after checking the latest disk version', async () => {
    const onFileSaved = vi.fn();
    render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={sourceFile()}
        onFileSaved={onFileSaved}
      />,
    );

    const editor = await screen.findByTestId('text-editor-input') as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'export const value = 2;\n' } });
    expect(screen.getByTestId('text-editor-dirty')).toBeTruthy();

    fireEvent.click(screen.getByTestId('text-editor-save'));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        'project-1',
        'src/app.ts',
        'export const value = 2;\n',
        { expectedContentSha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
      );
      expect(onFileSaved).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByTestId('text-editor-dirty')).toBeNull();
    expect(screen.getByRole('status').textContent).toMatch(/saved|저장됨/i);
  });

  it('saves with Ctrl+S and prevents the browser default action', async () => {
    render(<FileViewer projectId="project-shortcut" projectKind="prototype" file={sourceFile()} />);
    const editor = await screen.findByTestId('text-editor-input') as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'export const shortcut = true;\n' } });

    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: 's',
    });
    const dispatched = editor.dispatchEvent(event);

    expect(dispatched).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(
      'project-shortcut',
      'src/app.ts',
      'export const shortcut = true;\n',
      { expectedContentSha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
    ));
  });

  it('keeps the draft and shows a conflict when the server rejects an interleaved write', async () => {
    fetchText
      .mockResolvedValueOnce('export const value = 1;\n')
      .mockResolvedValueOnce('export const value = 1;\n')
      .mockResolvedValueOnce('export const value = 3;\n');
    writeText.mockResolvedValueOnce({
      ok: false,
      status: 409,
      code: 'FILE_CHANGED',
      message: 'The file changed after it was loaded.',
    });
    render(<FileViewer projectId="project-race" projectKind="prototype" file={sourceFile()} />);

    const editor = await screen.findByTestId('text-editor-input') as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'export const local = true;\n' } });
    fireEvent.click(screen.getByTestId('text-editor-save'));

    expect(await screen.findByTestId('text-editor-conflict')).toBeTruthy();
    expect((screen.getByTestId('text-editor-input') as HTMLTextAreaElement).value)
      .toBe('export const local = true;\n');
    expect(fetchText).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId('text-editor-dirty')).toBeTruthy();
  });

  it('keeps the unsaved draft when saving fails', async () => {
    writeText.mockResolvedValueOnce({ ok: false, status: 500, message: 'disk unavailable' });
    render(<FileViewer projectId="project-2" projectKind="prototype" file={sourceFile()} />);

    const editor = await screen.findByTestId('text-editor-input') as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'local draft' } });
    fireEvent.click(screen.getByTestId('text-editor-save'));

    expect(await screen.findByText('disk unavailable')).toBeTruthy();
    expect((screen.getByTestId('text-editor-input') as HTMLTextAreaElement).value).toBe('local draft');
    expect(screen.getByTestId('text-editor-dirty')).toBeTruthy();
  });

  it('does not overwrite a dirty draft when the file changes on disk', async () => {
    fetchText
      .mockResolvedValueOnce('export const value = 1;\n')
      .mockResolvedValueOnce('export const value = 3;\n');
    const { rerender } = render(
      <FileViewer projectId="project-3" projectKind="prototype" file={sourceFile()} />,
    );
    const editor = await screen.findByTestId('text-editor-input') as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'export const local = true;\n' } });

    rerender(
      <FileViewer
        projectId="project-3"
        projectKind="prototype"
        file={sourceFile({ mtime: 1710000002 })}
      />,
    );

    expect(await screen.findByTestId('text-editor-conflict')).toBeTruthy();
    expect((screen.getByTestId('text-editor-input') as HTMLTextAreaElement).value)
      .toBe('export const local = true;\n');

    const loadDisk = screen.getByRole('button', { name: /disk version|디스크 버전/i });
    fireEvent.click(loadDisk);
    await waitFor(() => {
      expect((screen.getByTestId('text-editor-input') as HTMLTextAreaElement).value)
        .toBe('export const value = 3;\n');
    });
  });

  it('restores the last saved text when editing is cancelled', async () => {
    render(<FileViewer projectId="project-4" projectKind="prototype" file={sourceFile()} />);
    const editor = await screen.findByTestId('text-editor-input') as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'temporary' } });
    fireEvent.click(screen.getByTestId('text-editor-cancel'));

    expect((screen.getByTestId('text-editor-input') as HTMLTextAreaElement).value)
      .toBe('export const value = 1;\n');
    expect(screen.queryByTestId('text-editor-dirty')).toBeNull();
  });

  it('keeps an unsaved draft in memory while switching files', async () => {
    fetchText.mockImplementation(async (_projectId, name) => (
      name === 'src/other.ts' ? 'export const other = true;\n' : 'export const value = 1;\n'
    ));
    const { rerender } = render(
      <FileViewer projectId="project-5" projectKind="prototype" file={sourceFile()} />,
    );
    const editor = await screen.findByTestId('text-editor-input') as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'export const draft = true;\n' } });

    rerender(
      <FileViewer
        projectId="project-5"
        projectKind="prototype"
        file={sourceFile({ name: 'src/other.ts', path: 'src/other.ts' })}
      />,
    );
    expect((await screen.findByTestId('text-editor-input') as HTMLTextAreaElement).value)
      .toBe('export const other = true;\n');

    rerender(<FileViewer projectId="project-5" projectKind="prototype" file={sourceFile()} />);
    await waitFor(() => {
      expect((screen.getByTestId('text-editor-input') as HTMLTextAreaElement).value)
        .toBe('export const draft = true;\n');
    });
    expect(screen.getByTestId('text-editor-dirty')).toBeTruthy();
  });
});
