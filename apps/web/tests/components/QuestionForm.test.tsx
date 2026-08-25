// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuestionFormView, parseSubmittedAnswers } from '../../src/components/QuestionForm';
import type { QuestionForm } from '../../src/artifacts/question-form';

const form: QuestionForm = {
  id: 'discovery',
  title: 'Quick brief',
  questions: [
    {
      id: 'tone',
      label: 'Visual tone (pick up to two)',
      type: 'checkbox',
      options: [
        { label: 'Editorial / magazine', value: 'Editorial / magazine' },
        { label: 'Modern minimal', value: 'Modern minimal' },
        { label: 'Soft gradients', value: 'Soft gradients' },
      ],
      maxSelections: 2,
      required: true,
    },
  ],
};

const voiceForm: QuestionForm = {
  id: 'elevenlabs-voice',
  title: 'Choose an ElevenLabs voice',
  description:
    'Pick a voice by description. The selected answer will be the exact voice_id passed to the renderer.',
  questions: [
    {
      id: 'voice',
      label: 'Voice',
      type: 'select',
      required: true,
      placeholder: 'Choose a voice',
      help: 'Select a voice description; the answer submits the matching Voice ID.',
      options: [
        { label: 'Rachel — american · female', value: '21m00Tcm4TlvDq8ikWAM' },
        { label: 'Adam — american · male', value: 'pNInz6obpgDQGcFmaJgB' },
      ],
    },
  ],
  submitLabel: 'Use voice',
};

const richForm = {
  id: 'discovery',
  title: 'Quick brief',
  questions: [
    {
      id: 'platform',
      label: 'Primary surface',
      type: 'radio',
      required: true,
      options: [
        { label: 'Responsive', value: 'Responsive' },
        {
          label: 'Mobile (iOS/Android)',
          description: 'Phone-first app prototype',
          value: 'mobile',
        },
        {
          label: 'Desktop web',
          description: 'Browser-first prototype',
          value: 'Desktop web',
        },
      ],
    },
  ],
} as QuestionForm;

const checkboxObjectForm = {
  id: 'discovery',
  title: 'Quick brief',
  questions: [
    {
      id: 'tone',
      label: 'Visual tone',
      type: 'checkbox',
      required: true,
      options: [
        { label: 'Editorial / magazine', value: 'editorial' },
        { label: 'Soft gradients', value: 'soft-gradients' },
        { label: 'Modern minimal', value: 'modern-minimal' },
      ],
    },
  ],
} as QuestionForm;

const selectObjectForm = {
  id: 'discovery',
  title: 'Quick brief',
  questions: [
    {
      id: 'platform',
      label: 'Primary surface',
      type: 'select',
      required: true,
      options: [
        { label: 'Mobile (iOS/Android)', value: 'mobile' },
        { label: 'Desktop web', value: 'desktop-web' },
      ],
    },
  ],
} as QuestionForm;

describe('QuestionFormView', () => {
  afterEach(() => cleanup());

  it('updates locked answers when submitted history arrives after the initial render', () => {
    const onSubmit = vi.fn();
    const { container, rerender } = render(
      <QuestionFormView form={form} interactive submittedAnswers={undefined} onSubmit={onSubmit} />,
    );

    expect(container.querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(0);

    rerender(
      <QuestionFormView
        form={form}
        interactive={false}
        submittedAnswers={{ tone: ['Editorial / magazine', 'Modern minimal'] }}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByText('answered')).toBeTruthy();
    expect(container.querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(2);
  });

  it('renders select options with labels and submits the selected voice id', () => {
    const onSubmit = vi.fn();
    const { container, rerender } = render(
      <QuestionFormView form={voiceForm} interactive submittedAnswers={undefined} onSubmit={onSubmit} />,
    );

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(container.querySelector('option[value="21m00Tcm4TlvDq8ikWAM"]')?.textContent).toBe(
      'Rachel — american · female',
    );

    fireEvent.change(select, { target: { value: '21m00Tcm4TlvDq8ikWAM' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use voice' }));

    expect(onSubmit).toHaveBeenCalledWith(
      '[form answers — elevenlabs-voice]\n- Voice: Rachel — american · female [value: 21m00Tcm4TlvDq8ikWAM]',
      { voice: '21m00Tcm4TlvDq8ikWAM' },
    );

    rerender(
      <QuestionFormView
        form={voiceForm}
        interactive={false}
        submittedAnswers={{ voice: 'Rachel — american · female' }}
        onSubmit={onSubmit}
      />,
    );

    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe(
      '21m00Tcm4TlvDq8ikWAM',
    );
  });

  it('parses submitted object-option values from readable answer text', () => {
    expect(
      parseSubmittedAnswers(
        richForm,
        [
          '[form answers - discovery]',
          '- Primary surface: Mobile (iOS/Android) [value: mobile]',
        ].join('\n'),
      ),
    ).toEqual({ platform: 'mobile' });
  });

  it('renders radio object options and submits the readable label with stable value', () => {
    const onSubmit = vi.fn();
    render(<QuestionFormView form={richForm} interactive onSubmit={onSubmit} />);

    expect(screen.getByText('Responsive')).toBeTruthy();
    expect(screen.getByText('Mobile (iOS/Android)')).toBeTruthy();
    expect(screen.queryByText('Phone-first app prototype')).toBeNull();

    fireEvent.click(screen.getByLabelText('Mobile (iOS/Android)'));
    expect(screen.getByText('Phone-first app prototype')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send answers' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).toContain(
      '- Primary surface: Mobile (iOS/Android) [value: mobile]',
    );
    expect(onSubmit.mock.calls[0]?.[1]).toEqual({ platform: 'mobile' });
  });

  it('submits required checkbox object options with stable values', () => {
    const onSubmit = vi.fn();
    const { container } = render(
      <QuestionFormView form={checkboxObjectForm} interactive onSubmit={onSubmit} />,
    );

    const submit = screen.getByRole('button', { name: 'Send answers' });
    // Required field unanswered → submit stays disabled (regression guard:
    // the Questions-tab refactor must not make required fields optional on the
    // standard submit path).
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByLabelText('Editorial / magazine'));
    fireEvent.click(screen.getByLabelText('Soft gradients'));

    expect(container.querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(2);
    expect((submit as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(submit);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).toContain('Editorial / magazine [value: editorial]');
    expect(onSubmit.mock.calls[0]?.[0]).toContain('Soft gradients [value: soft-gradients]');
    expect(onSubmit.mock.calls[0]?.[1]).toEqual({
      tone: ['editorial', 'soft-gradients'],
    });
  });

  it('reveals a dependent upload field only after its option is selected', () => {
    const onSubmit = vi.fn();
    const conditionalForm: QuestionForm = {
      id: 'interface-spec',
      title: 'Interface spec options',
      questions: [
        {
          id: 'dictionaryMode',
          label: 'Dictionary',
          type: 'radio',
          options: [
            { label: 'AI judgment', value: 'ai' },
            { label: 'Upload dictionary', value: 'upload', description: 'Upload a project dictionary.' },
          ],
        },
        {
          id: 'dictionaryUpload',
          label: 'Upload file',
          type: 'file',
          storage: 'dictionary',
          showWhen: { questionId: 'dictionaryMode', values: ['upload'] },
        },
      ],
    };

    render(<QuestionFormView form={conditionalForm} interactive onSubmit={onSubmit} />);
    expect(screen.queryByText('Upload file')).toBeNull();
    fireEvent.click(screen.getByLabelText('Upload dictionary'));
    expect(screen.getByText('Upload a project dictionary.')).toBeTruthy();
    expect(screen.getByText('Upload file')).toBeTruthy();
  });

  it('restores saved dictionaries from the project after reopening it', async () => {
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      calls.push(path);
      if (path.endsWith('/api/projects/project-1/files')) {
        return new Response(JSON.stringify({
          files: [{ path: '_open-docs/dictionaries/terms.xlsx', name: 'terms.xlsx' }],
        }), { status: 200 });
      }
      if (path.includes('/raw/_open-docs/dictionaries/terms.xlsx')) {
        return new Response('{"orderId":"주문번호"}', { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    try {
      const onSubmit = vi.fn();
      const { container } = render(
        <QuestionFormView
          form={{
            id: 'dictionary-reopen',
            title: 'Dictionary',
            questions: [{ id: 'dictionary', label: 'Saved dictionary', type: 'dictionary', required: true }],
          }}
          projectId="project-1"
          interactive
          onSubmit={onSubmit}
        />,
      );

      const dictionary = await screen.findByRole('combobox');
      expect(container.querySelector('input[type="file"]')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Upload dictionary' })).toBeNull();
      expect(screen.getByRole('option', { name: 'terms.xlsx' })).toBeTruthy();
      fireEvent.change(dictionary, { target: { value: '_open-docs/dictionaries/terms.xlsx' } });
      expect(await screen.findByText('{"orderId":"주문번호"}')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Send answers' }));

      expect(onSubmit.mock.calls[0]?.[1]).toEqual({ dictionary: '_open-docs/dictionaries/terms.xlsx' });
      expect(calls.some((path) => path.endsWith('/api/projects/project-1/files'))).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('reveals fixed global fields and renders post-scan domain mappings', () => {
    const onSubmit = vi.fn();
    render(
      <QuestionFormView
        form={{
          id: 'interface-spec-options',
          title: 'Interface spec options',
          questions: [
            {
              id: 'fillMode',
              label: 'Fill mode',
              type: 'radio',
              options: [
                { label: 'Blank', value: 'blank' },
                { label: 'Global', value: 'global' },
              ],
            },
            {
              id: 'globalBusinessCode',
              label: 'Business code',
              type: 'text',
              placeholder: 'global code',
              showWhen: { questionId: 'fillMode', values: ['global'] },
            },
          ],
        }}
        interactive
        onSubmit={onSubmit}
      />,
    );
    expect(screen.queryByLabelText('Business code')).toBeNull();
    fireEvent.click(screen.getByLabelText('Global'));
    fireEvent.change(screen.getByPlaceholderText('global code'), { target: { value: 'ORD-001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send answers' }));
    expect(onSubmit.mock.calls[0]?.[1]).toEqual({ fillMode: 'global', globalBusinessCode: 'ORD-001' });

    const domainSubmit = vi.fn();
    render(
      <QuestionFormView
        form={{
          id: 'interface-spec-domain-mapping',
          title: 'Domain mapping',
          questions: [{ id: 'domainMapping', label: 'Domain values', type: 'domain-mapping', domains: ['orders', 'admin'] }],
        }}
        interactive
        onSubmit={domainSubmit}
      />,
    );
    fireEvent.change(screen.getByLabelText('orders Business code'), { target: { value: 'ORD-001' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'orders' }));
    expect(screen.queryByLabelText('orders Business code')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'orders' }));
    expect((screen.getByLabelText('orders Business code') as HTMLInputElement).value).toBe('ORD-001');
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByLabelText('orders Business code')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect((screen.getByLabelText('orders Business code') as HTMLInputElement).value).toBe('ORD-001');
    fireEvent.click(screen.getAllByRole('button', { name: 'Send answers' }).at(-1)!);
    expect(domainSubmit.mock.calls[0]?.[1]?.domainMapping).toContain('"orders":{"businessCode":"ORD-001"');
  });

  it('sends only selected database tables in one batch inspection request', async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push([input, init]);
      const path = String(input);
      if (path.endsWith('/api/database/connections')) {
        return new Response(JSON.stringify({
          connections: [{ id: 'db-1', label: 'Development', host: 'lo...l', database: 'app', createdAt: '' }],
        }), { status: 200 });
      }
      if (path.includes('/schemas')) {
        return new Response(JSON.stringify({
          tables: [
            { schema: 'abtdb', table: 'users' },
            { schema: 'scmsdb', table: 'audit_log' },
          ],
        }), { status: 200 });
      }
      if (path.endsWith('/inspect')) {
        return new Response(JSON.stringify({
          tables: [{ schema: 'abtdb', table: 'users', columns: [], sampleRows: [] }],
        }), { status: 200 });
      }
      if (path.endsWith('/api/projects/project-1/files')) {
        return new Response(JSON.stringify({ file: { path: '.open-docs/database-context/approved-db-context.json' } }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    try {
      render(
        <QuestionFormView
          projectId="project-1"
          form={{
            id: 'database',
            title: 'Database context',
            questions: [{ id: 'db', label: 'Database', type: 'database-context', sampleRows: 5, databaseMode: 'manual' }],
          }}
          interactive
          onSubmit={vi.fn()}
        />,
      );
      const connection = await screen.findByRole('combobox');
      fireEvent.change(connection, { target: { value: 'db-1' } });
      const schema = await screen.findByRole('combobox', { name: 'Choose a schema' });
      fireEvent.change(schema, { target: { value: 'abtdb' } });
      const concurrency = await screen.findByRole('combobox', { name: 'Read concurrency' });
      fireEvent.change(concurrency, { target: { value: '16' } });
      await screen.findByLabelText('abtdb.users');
      expect(screen.queryByLabelText('scmsdb.audit_log')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Select all in this schema' }));
      fireEvent.change(schema, { target: { value: 'scmsdb' } });
      await screen.findByLabelText('scmsdb.audit_log');
      fireEvent.click(screen.getByRole('button', { name: 'Select all in this schema' }));
      fireEvent.click(screen.getByRole('button', { name: /Attach .*selected/ }));
      await waitFor(() => expect(calls.some(([input]) => String(input).endsWith('/inspect'))).toBe(true));

      const inspectCall = calls.find(([input]) => String(input).endsWith('/inspect'));
      expect(JSON.parse(String(inspectCall?.[1]?.body))).toEqual({
        tables: [
          { schema: 'abtdb', table: 'users' },
          { schema: 'scmsdb', table: 'audit_log' },
        ],
        limit: 5,
        concurrency: 16,
        selectedByUser: true,
      });

      fireEvent.change(schema, { target: { value: '' } });
      fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
      fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
      fireEvent.click(screen.getByRole('button', { name: /Attach .*selected/ }));
      await waitFor(() => expect(calls.filter(([input]) => String(input).endsWith('/inspect'))).toHaveLength(2));
      const globalInspectCall = calls.filter(([input]) => String(input).endsWith('/inspect')).at(-1);
      expect(JSON.parse(String(globalInspectCall?.[1]?.body))).toEqual({
        tables: [
          { schema: 'abtdb', table: 'users' },
          { schema: 'scmsdb', table: 'audit_log' },
        ],
        limit: 5,
        concurrency: 16,
        selectedByUser: true,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('attaches selected tables for prompt connections without candidate review', async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push([input, init]);
      const path = String(input);
      if (path.endsWith('/api/database/connections')) {
        return new Response(JSON.stringify({
          connections: [{ id: 'db-1', label: 'Development', host: 'local', database: 'app', createdAt: '' }],
        }), { status: 200 });
      }
      if (path.includes('/schemas')) {
        return new Response(JSON.stringify({
          tables: [{ schema: 'abtdb', table: 'users' }],
        }), { status: 200 });
      }
      if (path.endsWith('/inspect')) {
        return new Response(JSON.stringify({
          tables: [{ schema: 'abtdb', table: 'users', columns: [], sampleRows: [] }],
        }), { status: 200 });
      }
      if (path.endsWith('/api/projects/project-1/files')) {
        return new Response(JSON.stringify({ file: { path: '.open-docs/database-context/approved-db-context.json' } }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    try {
      const onSubmit = vi.fn();
      render(
        <QuestionFormView
          form={{
            id: 'database-prompt',
            title: 'Database context',
            questions: [{ id: 'db', label: 'Database', type: 'database-context', sampleRows: 5, databaseMode: 'candidates' }],
          }}
          projectId="project-1"
          interactive
          onSubmit={onSubmit}
        />,
      );
      const connection = await screen.findByRole('combobox');
      fireEvent.change(connection, { target: { value: 'db-1' } });
      const schema = await screen.findByRole('combobox', { name: 'Choose a schema' });
      fireEvent.change(schema, { target: { value: 'abtdb' } });
      await screen.findByLabelText('Choose a table to attach its schema and redacted sample...');
      fireEvent.click(screen.getByRole('button', { name: 'Select all in this schema' }));
      fireEvent.click(screen.getByRole('button', { name: 'Attach 1 selected table(s)' }));
      await waitFor(() => expect(calls.some(([input]) => String(input).endsWith('/inspect'))).toBe(true));
      fireEvent.click(screen.getByRole('button', { name: 'Send answers' }));
      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
      expect(onSubmit.mock.calls[0]?.[1]?.db).toContain('"connectionId":"db-1"');
      expect(onSubmit.mock.calls[0]?.[1]?.db).toContain('approved-db-context.json');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('uses the same explicit table selection for always-approved connections', async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push([input, init]);
      const path = String(input);
      if (path.endsWith('/api/database/connections')) {
        return new Response(JSON.stringify({
          connections: [{ id: 'db-1', label: 'Development', host: 'local', database: 'app', createdAt: '', readApproval: 'always' }],
        }), { status: 200 });
      }
      if (path.includes('/schemas')) {
        return new Response(JSON.stringify({
          tables: [
            { schema: 'abtdb', table: 'users' },
            { schema: 'scmsdb', table: 'audit_log' },
          ],
        }), { status: 200 });
      }
      if (path.endsWith('/inspect')) {
        return new Response(JSON.stringify({
          tables: [
            { schema: 'abtdb', table: 'users', columns: [], sampleRows: [] },
            { schema: 'scmsdb', table: 'audit_log', columns: [], sampleRows: [] },
          ],
        }), { status: 200 });
      }
      if (path.endsWith('/api/projects/project-1/files')) {
        return new Response(JSON.stringify({ file: { path: '.open-docs/database-context/approved-db-context.json' } }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    try {
      const onSubmit = vi.fn();
      render(
        <QuestionFormView
          form={{
            id: 'database-all',
            title: 'Database context',
            questions: [{ id: 'db', label: 'Database', type: 'database-context', sampleRows: 5 }],
          }}
          projectId="project-1"
          interactive
          onSubmit={onSubmit}
        />,
      );
      const connection = await screen.findByRole('combobox');
      fireEvent.change(connection, { target: { value: 'db-1' } });
      await screen.findByLabelText('Choose a table to attach its schema and redacted sample...');
      fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
      fireEvent.click(screen.getByRole('button', { name: 'Attach 2 selected table(s)' }));
      await waitFor(() => expect(calls.some(([input]) => String(input).endsWith('/inspect'))).toBe(true));
      fireEvent.click(screen.getByRole('button', { name: 'Send answers' }));
      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
      expect(onSubmit.mock.calls[0]?.[1]?.db).toContain('approved-db-context.json');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('finds code-based table candidates and applies them to the selection', async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push([input, init]);
      const path = String(input);
      if (path.endsWith('/api/database/connections')) {
        return new Response(JSON.stringify({
          connections: [{ id: 'db-1', label: 'Development', host: 'local', database: 'app', createdAt: '' }],
        }), { status: 200 });
      }
      if (path.includes('/schemas')) {
        return new Response(JSON.stringify({
          tables: [
            { schema: 'abtdb', table: 'orders' },
            { schema: 'abtdb', table: 'audit_log' },
          ],
        }), { status: 200 });
      }
      if (path === '/api/projects/project-1/files') {
        return new Response(JSON.stringify({ files: [{ path: 'src/orders.ts', name: 'orders.ts' }] }), { status: 200 });
      }
      if (path.includes('/raw/src/orders.ts')) {
        return new Response('const rows = await db.query("SELECT * FROM abtdb.orders");', { status: 200 });
      }
      if (path.endsWith('/inspect')) {
        return new Response(JSON.stringify({
          tables: [{ schema: 'abtdb', table: 'orders', columns: [], sampleRows: [] }],
        }), { status: 200 });
      }
      if (path.endsWith('/api/projects/project-1/files')) {
        return new Response(JSON.stringify({ file: { path: '_open-docs/database-context/approved-db-context.json' } }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    try {
      render(
        <QuestionFormView
          form={{
            id: 'database-candidates',
            title: 'Database context',
            questions: [{ id: 'db', label: 'Database', type: 'database-context', sampleRows: 5 }],
          }}
          projectId="project-1"
          interactive
          onSubmit={vi.fn()}
        />,
      );
      const connection = await screen.findByRole('combobox');
      fireEvent.change(connection, { target: { value: 'db-1' } });
      await screen.findByLabelText('abtdb.orders');
      fireEvent.click(screen.getByRole('button', { name: 'Find code-based candidates' }));
      expect(await screen.findByText('Selected 1 code-matched table(s).')).toBeTruthy();
      expect((screen.getByLabelText('abtdb.orders') as HTMLInputElement).checked).toBe(true);
      expect((screen.getByLabelText('abtdb.audit_log') as HTMLInputElement).checked).toBe(false);
      expect(calls.some(([input]) => String(input).includes('/raw/src/orders.ts'))).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('uses a persisted static-analysis candidate artifact from mapper scans', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/api/database/connections')) {
        return new Response(JSON.stringify({ connections: [{ id: 'db-1', label: 'Development', host: 'local', database: 'app', createdAt: '' }] }), { status: 200 });
      }
      if (path.includes('/schemas')) {
        return new Response(JSON.stringify({ tables: [{ schema: 'abtdb', table: 'tbadm001' }] }), { status: 200 });
      }
      if (path === '/api/projects/project-1/files') {
        return new Response(JSON.stringify({ files: [{ path: 'db-candidates.json', name: 'db-candidates.json' }] }), { status: 200 });
      }
      if (path.includes('/raw/db-candidates.json')) {
        return new Response(JSON.stringify({ kind: 'database-candidates', candidates: [{ schema: null, table: 'tbadm001', evidence: [{ path: 'src/main/resources/mybatis/mapper/AdminMapper.xml', line: 42 }] }] }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;
    try {
      render(
        <QuestionFormView
          form={{ id: 'database-candidate-artifact', title: 'Database context', questions: [{ id: 'db', label: 'Database', type: 'database-context' }] }}
          projectId="project-1"
          interactive
          onSubmit={vi.fn()}
        />,
      );
      fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'db-1' } });
      await screen.findByLabelText('abtdb.tbadm001');
      fireEvent.click(screen.getByRole('button', { name: 'Find code-based candidates' }));
      expect(await screen.findByText('Selected 1 code-matched table(s).')).toBeTruthy();
      expect((screen.getByLabelText('abtdb.tbadm001') as HTMLInputElement).checked).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('marks required fields with the inline indicator even when the footer is hidden', () => {
    // Panel path (Questions tab): hideInternalSubmit hides the form footer, so
    // the inline "*" next to a required label is the only per-field cue that a
    // field is mandatory. A mixed required/optional form must still advertise
    // which fields block the disabled Continue button.
    const mixedForm = {
      id: 'discovery',
      title: 'Quick brief',
      questions: [
        { id: 'taskType', label: 'Task type', type: 'text', required: true },
        { id: 'notes', label: 'Notes', type: 'text' },
      ],
    } as QuestionForm;

    const onSubmit = vi.fn();
    const { container } = render(
      <QuestionFormView form={mixedForm} interactive hideInternalSubmit onSubmit={onSubmit} />,
    );

    const fields = container.querySelectorAll('.qf-field');
    const requiredField = fields[0]!;
    const optionalField = fields[1]!;
    expect(requiredField.querySelector('.qf-required')?.textContent).toBe('*');
    expect(optionalField.querySelector('.qf-required')).toBeNull();
  });

  it('submits required select object options with stable values', () => {
    const onSubmit = vi.fn();
    const { container } = render(
      <QuestionFormView form={selectObjectForm} interactive onSubmit={onSubmit} />,
    );

    const submit = screen.getByRole('button', { name: 'Send answers' });
    // Required select unanswered → submit stays disabled (regression guard).
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    const select = container.querySelector('select');
    if (!select) throw new Error('expected select control');
    fireEvent.change(select, { target: { value: 'mobile' } });

    expect((submit as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(submit);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).toContain(
      '- Primary surface: Mobile (iOS/Android) [value: mobile]',
    );
    expect(onSubmit.mock.calls[0]?.[1]).toEqual({ platform: 'mobile' });
  });

  it('copies a selected library dictionary version into the project before submitting it', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/projects/project-1/files') return new Response(JSON.stringify({ files: [] }), { status: 200 });
      if (path === '/api/dictionaries') {
        return new Response(JSON.stringify({
          dictionaries: [{
            id: 'dictionary-1', name: 'Korean-English terms', createdAt: 1, updatedAt: 1,
            latestVersion: { id: 'version-1', dictionaryId: 'dictionary-1', version: 1, fileName: 'terms.xlsx', format: 'xlsx', size: 50, createdAt: 1, preview: { columns: ['ko', 'en'], rows: [['주문', 'order']] } },
          }],
        }), { status: 200 });
      }
      if (path === '/api/projects/project-1/dictionaries') return new Response(JSON.stringify({ snapshots: [] }), { status: 200 });
      if (path === '/api/dictionaries/dictionary-1') {
        return new Response(JSON.stringify({ dictionary: {
          id: 'dictionary-1', name: 'Korean-English terms', createdAt: 1, updatedAt: 1,
          latestVersion: { id: 'version-1', dictionaryId: 'dictionary-1', version: 1, fileName: 'terms.xlsx', format: 'xlsx', size: 50, createdAt: 1, preview: { columns: ['ko', 'en'], rows: [['주문', 'order']] } },
          versions: [{ id: 'version-1', dictionaryId: 'dictionary-1', version: 1, fileName: 'terms.xlsx', format: 'xlsx', size: 50, createdAt: 1, preview: { columns: ['ko', 'en'], rows: [['주문', 'order']] } }],
        } }), { status: 200 });
      }
      if (path === '/api/projects/project-1/dictionaries/attach') {
        return new Response(JSON.stringify({ snapshot: {
          id: 'snapshot-1', projectId: 'project-1', dictionaryId: 'dictionary-1', versionId: 'version-1',
          dictionaryName: 'Korean-English terms', version: 1, path: '_open-docs/dictionaries/korean-english-terms-v1.xlsx', createdAt: 1,
        } }), { status: 201 });
      }
      return new Response('{}', { status: 404 });
    });
    globalThis.fetch = fetchMock as typeof fetch;
    try {
      const onSubmit = vi.fn();
      render(
        <QuestionFormView
          form={{ id: 'dictionary-form', title: 'Dictionary', questions: [{ id: 'dictionary', label: 'Dictionary', type: 'dictionary', required: true }] }}
          projectId="project-1"
          interactive
          onSubmit={onSubmit}
        />,
      );
      fireEvent.click(screen.getByRole('tab', { name: 'My library' }));
      const select = await screen.findByRole('combobox');
      fireEvent.change(select, { target: { value: 'dictionary-1' } });
      await screen.findByText('Version 1');
      fireEvent.click(screen.getByRole('button', { name: 'Use this version' }));
      await screen.findByText('Project snapshot connected: Korean-English terms v1');
      fireEvent.click(screen.getByRole('button', { name: 'Send answers' }));
      expect(onSubmit.mock.calls[0]?.[1]).toEqual({ dictionary: '_open-docs/dictionaries/korean-english-terms-v1.xlsx' });
      expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/dictionaries/attach'))).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('asks where a new dictionary will be stored before revealing its file picker', () => {
    const { container } = render(
      <QuestionFormView
        form={{
          id: 'dictionary-upload',
          title: 'Dictionary upload',
          questions: [{ id: 'dictionaryFile', label: 'Dictionary file', type: 'file', storage: 'dictionary' }],
        }}
        projectId="project-1"
        interactive
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Save only in this project')).toBeTruthy();
    expect(screen.getByLabelText('Save to global library')).toBeTruthy();
    expect(container.querySelector('input[type="file"]')).toBeNull();

    fireEvent.click(screen.getByLabelText('Save to global library'));
    expect(screen.getByLabelText('Library dictionary name')).toBeTruthy();
    expect(container.querySelector('input[type="file"]')).toBeTruthy();
  });

  it('confirms a no-codebase interface draft and a real workbook template', () => {
    const draft = {
      documentName: '주문 API 인터페이스 명세서',
      version: '1.0',
      department: '',
      assistMode: 'manual' as const,
      reviewStage: 'review' as const,
      businessContext: '',
      referenceFiles: [],
      templatePreset: 'si-standard' as const,
      endpoints: [{
        id: 'endpoint-1',
        interfaceName: '주문 생성',
        interfaceId: 'IF-ORD-001',
        method: 'POST',
        path: '/api/orders',
        auth: 'bearer' as const,
        businessPurpose: '',
        requestMode: 'manual' as const,
        responseMode: 'manual' as const,
        requestFields: [],
        responseFields: [],
      }],
    };
    const onSubmit = vi.fn();
    render(
      <QuestionFormView
        form={{
          id: 'interface-spec-manual-draft',
          title: '신규 인터페이스 명세서',
          submitLabel: '초안 확정하고 미리보기',
          questions: [{
            id: 'draft',
            label: '명세서 초안',
            type: 'interface-spec-manual',
            required: true,
            defaultValue: JSON.stringify(draft),
            interfaceSpecDraft: draft,
          }],
        }}
        interactive
        onSubmit={onSubmit}
      />,
    );

    expect((screen.getByLabelText('인터페이스 1 Path') as HTMLInputElement).value).toBe('/api/orders');
    expect(screen.getByRole('button', { name: /기본 SI 표준/ }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getAllByRole('button', { name: '+ 필드 추가' })[0]!);
    fireEvent.change(screen.getByLabelText('REQUEST 1 영문명'), { target: { value: 'customerId' } });
    fireEvent.change(screen.getByLabelText('REQUEST 1 최소 크기'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('REQUEST 1 최대 크기'), { target: { value: '36' } });
    fireEvent.click(screen.getByRole('button', { name: /리뷰 강조/ }));
    fireEvent.click(screen.getByRole('button', { name: '초안 확정하고 미리보기' }));

    const submitted = JSON.parse(String(onSubmit.mock.calls[0]?.[1]?.draft));
    expect(submitted.templatePreset).toBe('review');
    expect(submitted.endpoints[0]).toMatchObject({
      interfaceId: 'IF-ORD-001',
      method: 'POST',
      auth: 'bearer',
      requestFields: [{ nameEn: 'customerId', minSize: '1', maxSize: '36', required: 'TBD' }],
    });
  });

  it('requires explicit acceptance of AI-proposed interface fields', () => {
    const draft = {
      documentName: '주문 API 인터페이스 명세서',
      version: '1.0',
      department: '',
      assistMode: 'ai' as const,
      reviewStage: 'review' as const,
      businessContext: '주문 생성',
      referenceFiles: [],
      templatePreset: 'si-standard' as const,
      endpoints: [{
        id: 'endpoint-1',
        interfaceName: '주문 생성',
        interfaceId: '',
        method: 'POST',
        path: '/api/orders',
        auth: 'undecided' as const,
        businessPurpose: '주문을 생성합니다.',
        requestMode: 'ai' as const,
        responseMode: 'none' as const,
        requestFields: [{
          id: 'request-1',
          nameEn: 'customerId',
          nameKo: '고객 ID',
          dataType: 'UUID',
          minSize: '1',
          maxSize: '36',
          required: 'Y' as const,
          note: '',
          suggested: true,
          evidence: 'requirements.pdf section 3',
        }],
        responseFields: [],
      }],
    };
    const onSubmit = vi.fn();
    render(
      <QuestionFormView
        form={{
          id: 'interface-spec-manual-draft',
          title: '신규 인터페이스 명세서',
          submitLabel: '검토 확정하고 미리보기',
          questions: [{
            id: 'draft',
            label: '명세서 초안',
            type: 'interface-spec-manual',
            required: true,
            defaultValue: JSON.stringify(draft),
            interfaceSpecDraft: draft,
          }],
        }}
        interactive
        onSubmit={onSubmit}
      />,
    );

    const submit = screen.getByRole('button', { name: '검토 확정하고 미리보기' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(screen.getByText(/근거: requirements\.pdf section 3/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '제안 1건 모두 채택' }));
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    const submitted = JSON.parse(String(onSubmit.mock.calls[0]?.[1]?.draft));
    expect(submitted.endpoints[0].requestFields[0].suggested).toBe(false);
  });

  it('uploads and classifies multiple manual interface-spec reference files', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      files: [
        { name: 'requirements.pdf', originalName: 'requirements.pdf', path: '_open-docs/interface-spec-inputs/requirements.pdf', size: 100 },
        { name: 'terms.xlsx', originalName: '용어사전.xlsx', path: '_open-docs/interface-spec-inputs/terms.xlsx', size: 200 },
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
    try {
      const draft = {
        documentName: '주문 API 인터페이스 명세서',
        version: '1.0',
        department: '',
        assistMode: 'ai' as const,
        reviewStage: 'intake' as const,
        businessContext: '',
        referenceFiles: [],
        templatePreset: 'si-standard' as const,
        endpoints: [{
          id: 'endpoint-1', interfaceName: '주문 생성', interfaceId: '', method: 'POST', path: '/api/orders',
          auth: 'undecided' as const, businessPurpose: '', requestMode: 'ai' as const, responseMode: 'ai' as const,
          requestFields: [], responseFields: [],
        }],
      };
      const onSubmit = vi.fn();
      render(
        <QuestionFormView
          projectId="project-1"
          form={{
            id: 'interface-spec-manual-draft', title: '신규 인터페이스 명세서', submitLabel: '자료 분석하고 AI 초안 만들기',
            questions: [{ id: 'draft', label: '명세서 초안', type: 'interface-spec-manual', required: true, defaultValue: JSON.stringify(draft), interfaceSpecDraft: draft }],
          }}
          interactive
          onSubmit={onSubmit}
        />,
      );

      const input = screen.getByLabelText('인터페이스 명세 참고자료 업로드');
      fireEvent.change(input, { target: { files: [
        new File(['requirement'], 'requirements.pdf', { type: 'application/pdf' }),
        new File(['dictionary'], '용어사전.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      ] } });

      await waitFor(() => expect(screen.getByText('requirements.pdf')).toBeTruthy());
      expect((screen.getByLabelText('requirements.pdf 자료 역할') as HTMLSelectElement).value).toBe('requirements');
      expect((screen.getByLabelText('용어사전.xlsx 자료 역할') as HTMLSelectElement).value).toBe('dictionary');
      fireEvent.click(screen.getByRole('button', { name: '자료 분석하고 AI 초안 만들기' }));
      const submitted = JSON.parse(String(onSubmit.mock.calls[0]?.[1]?.draft));
      expect(submitted.referenceFiles).toMatchObject([
        { name: 'requirements.pdf', role: 'requirements' },
        { name: '용어사전.xlsx', role: 'dictionary' },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
