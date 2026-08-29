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
