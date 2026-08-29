// @vitest-environment jsdom

if (typeof HTMLElement.prototype.scrollTo !== 'function') {
  HTMLElement.prototype.scrollTo = function (
    options?: ScrollToOptions | number,
    _y?: number,
  ) {
    if (typeof options === 'object' && options !== null) {
      if (options.top !== undefined) this.scrollTop = options.top;
      if (options.left !== undefined) this.scrollLeft = options.left;
    }
  };
}

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatPane } from '../../src/components/ChatPane';
import { I18nProvider, type Locale } from '../../src/i18n';
import type { ChatMessage, ChatMessageFeedbackChange } from '../../src/types';

const externalMocks = vi.hoisted(() => ({
  openExternalUrl: vi.fn(async () => true),
}));

vi.mock('../../src/providers/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/providers/registry')>();
  return { ...actual, openExternalUrl: externalMocks.openExternalUrl };
});

const originalScrollIntoView = Element.prototype.scrollIntoView;

if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = vi.fn();
}

function completedAssistant(
  input: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: 'Done',
    createdAt: 1_700_000_000_000,
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_003_000,
    runStatus: 'succeeded',
    ...input,
  };
}

function completedArtifactAssistant(
  input: Partial<ChatMessage> = {},
): ChatMessage {
  return completedAssistant({
    producedFiles: [
      {
        name: 'index.html',
        size: 1024,
        mtime: 1_700_000_003_000,
        kind: 'html',
        mime: 'text/html',
      },
    ],
    ...input,
  });
}

function completedEditAssistant(
  input: Partial<ChatMessage> = {},
): ChatMessage {
  return completedAssistant({
    events: [
      {
        kind: 'tool_use',
        id: 'edit-1',
        name: 'Edit',
        input: { file_path: 'index.html' },
      },
      {
        kind: 'tool_result',
        toolUseId: 'edit-1',
        content: 'Done',
        isError: false,
      },
    ],
    ...input,
  });
}

function completedLiveArtifactAssistant(
  input: Partial<ChatMessage> = {},
): ChatMessage {
  return completedAssistant({
    events: [
      {
        kind: 'live_artifact',
        action: 'updated',
        projectId: 'project-1',
        artifactId: 'live-1',
        title: 'Ricky Dental Poster',
        refreshStatus: 'idle',
      },
    ],
    ...input,
  });
}

function renderChatPane({
  messages,
  streaming = false,
  onAssistantFeedback = vi.fn(),
  hasActiveDesignSystem = false,
  locale = 'en',
}: {
  messages: ChatMessage[];
  streaming?: boolean;
  onAssistantFeedback?: (
    assistantMessage: ChatMessage,
    change: ChatMessageFeedbackChange,
  ) => void;
  hasActiveDesignSystem?: boolean;
  locale?: Locale;
}) {
  return {
    onAssistantFeedback,
    ...render(
      <I18nProvider initial={locale}>
        <ChatPane
          projectKindForTracking="prototype"
          messages={messages}
          streaming={streaming}
          error={null}
          projectId="project-1"
          projectFiles={[]}
          hasActiveDesignSystem={hasActiveDesignSystem}
          onEnsureProject={async () => 'project-1'}
          onSend={() => {}}
          onStop={() => {}}
          conversations={[]}
          activeConversationId="conversation-1"
          onSelectConversation={() => {}}
          onDeleteConversation={() => {}}
          onAssistantFeedback={onAssistantFeedback}
        />
      </I18nProvider>,
    ),
  };
}

describe('chat assistant feedback', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    window.localStorage.clear();
    externalMocks.openExternalUrl.mockClear();
  });

  afterEach(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
    vi.restoreAllMocks();
  });

  it('collects feedback after any successfully completed assistant turn', () => {
    renderChatPane({
      messages: [completedAssistant()],
    });

    expect(screen.getByRole('group', { name: 'Rate this response' })).toBeTruthy();
  });

  it('collects positive and negative feedback on completed artifact results', () => {
    const { onAssistantFeedback } = renderChatPane({
      messages: [completedArtifactAssistant()],
    });
    const feedbackGroup = screen.getByRole('group', { name: 'Rate this response' });
    const footer = document.querySelector('.assistant-footer');

    expect(feedbackGroup.textContent).not.toContain('Rate this response');
    expect(footer?.contains(feedbackGroup)).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Helpful' }));
    expect(onAssistantFeedback).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'assistant-1' }),
      { rating: 'positive' },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Needs improvement' }));
    expect(onAssistantFeedback).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'assistant-1' }),
      { rating: 'negative' },
    );
    expect(document.querySelector('.assistant-feedback-burst')).toBeTruthy();
  });

  it('shows feedback after completed artifact edits without newly produced files', () => {
    renderChatPane({
      messages: [completedEditAssistant()],
    });

    expect(screen.getByRole('group', { name: 'Rate this response' })).toBeTruthy();
  });

  it('shows feedback after completed live artifact updates', () => {
    renderChatPane({
      messages: [completedLiveArtifactAssistant()],
    });

    expect(screen.getByRole('group', { name: 'Rate this response' })).toBeTruthy();
  });

  it('keeps every artifact turn feedback control visible and independent', () => {
    const { onAssistantFeedback } = renderChatPane({
      messages: [
        completedArtifactAssistant({ id: 'assistant-1' }),
        {
          id: 'user-1',
          role: 'user',
          content: 'Make another version',
          createdAt: 1_700_000_004_000,
        },
        completedArtifactAssistant({ id: 'assistant-2', createdAt: 1_700_000_005_000 }),
      ],
    });

    const groups = screen.getAllByRole('group', { name: 'Rate this response' });
    expect(groups).toHaveLength(2);

    fireEvent.click(within(groups[0]!).getByRole('button', { name: 'Helpful' }));
    expect(onAssistantFeedback).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'assistant-1' }),
      { rating: 'positive' },
    );

    fireEvent.click(within(groups[1]!).getByRole('button', { name: 'Needs improvement' }));
    expect(onAssistantFeedback).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'assistant-2' }),
      { rating: 'negative' },
    );
  });

  it('shows the persisted feedback state without saved copy', () => {
    renderChatPane({
      messages: [
        completedArtifactAssistant({
          feedback: {
            rating: 'negative',
            createdAt: 1_700_000_004_000,
            updatedAt: 1_700_000_004_000,
          },
        }),
      ],
    });

    expect(screen.queryByText('Feedback saved')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Needs improvement' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      screen.getByRole('button', { name: 'Helpful' }).getAttribute('aria-pressed'),
    ).toBe('false');
  });

  it('clicking an already selected feedback rating clears it', () => {
    const { onAssistantFeedback } = renderChatPane({
      messages: [
        completedArtifactAssistant({
          feedback: {
            rating: 'positive',
            createdAt: 1_700_000_004_000,
            updatedAt: 1_700_000_004_000,
          },
        }),
      ],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Helpful' }));
    expect(onAssistantFeedback).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'assistant-1' }),
      null,
    );
  });

  it('collects preset and custom reasons after a rating is selected', () => {
    const { onAssistantFeedback } = renderChatPane({
      messages: [completedArtifactAssistant()],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Helpful' }));
    expect(screen.getByText('What influenced your rating?')).toBeTruthy();
    expect(screen.getByText('😊')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Understood my request'));
    fireEvent.click(screen.getByLabelText('Other'));
    fireEvent.change(screen.getByPlaceholderText('Add a short note...'), {
      target: { value: 'The layout is ready to present.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save feedback' }));

    expect(onAssistantFeedback).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'assistant-1' }),
      expect.objectContaining({
        rating: 'positive',
        reasonCodes: ['matched_request', 'other'],
        customReason: 'The layout is ready to present.',
        reasonsSubmittedAt: expect.any(Number),
      }),
    );
    expect(screen.queryByText('What influenced your rating?')).toBeNull();
  });

  it('adds design-system feedback reasons only when a design system is active', () => {
    const { unmount } = renderChatPane({
      messages: [completedArtifactAssistant()],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Helpful' }));
    expect(screen.queryByLabelText('Followed the document style')).toBeNull();
    unmount();

    const { onAssistantFeedback } = renderChatPane({
      messages: [completedArtifactAssistant()],
      hasActiveDesignSystem: true,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Helpful' }));
    fireEvent.click(screen.getByLabelText('Followed the document style'));
    fireEvent.click(screen.getByRole('button', { name: 'Save feedback' }));

    expect(onAssistantFeedback).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'assistant-1' }),
      expect.objectContaining({
        rating: 'positive',
        reasonCodes: ['followed_design_system'],
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Needs improvement' }));
    expect(screen.getByLabelText('Did not follow the document style')).toBeTruthy();
  });

  it('clears custom reason when Other is deselected', () => {
    const { onAssistantFeedback } = renderChatPane({
      messages: [completedArtifactAssistant()],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Helpful' }));
    fireEvent.click(screen.getByLabelText('Other'));
    fireEvent.change(screen.getByPlaceholderText('Add a short note...'), {
      target: { value: 'This note should not be submitted.' },
    });
    fireEvent.click(screen.getByLabelText('Other'));
    expect(screen.queryByPlaceholderText('Add a short note...')).toBeNull();

    fireEvent.click(screen.getByLabelText('Understood my request'));
    fireEvent.click(screen.getByRole('button', { name: 'Save feedback' }));

    expect(onAssistantFeedback).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'assistant-1' }),
      expect.objectContaining({
        rating: 'positive',
        reasonCodes: ['matched_request'],
        customReason: undefined,
        reasonsSubmittedAt: expect.any(Number),
      }),
    );
  });

  it('uses a sad marker for negative feedback reasons', () => {
    renderChatPane({
      messages: [completedArtifactAssistant()],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Needs improvement' }));

    expect(screen.getByText('What influenced your rating?')).toBeTruthy();
    expect(screen.getByText('😔')).toBeTruthy();
  });

  it('scrolls the feedback reasons panel into view after selecting a rating', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    renderChatPane({
      messages: [completedArtifactAssistant()],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Needs improvement' }));

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' });
  });

  it('does not ask for feedback while the assistant is still running', () => {
    renderChatPane({
      streaming: true,
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          createdAt: 1_700_000_000_000,
          startedAt: 1_700_000_000_000,
          runStatus: 'running',
          producedFiles: [
            {
              name: 'index.html',
              size: 1024,
              mtime: 1_700_000_003_000,
              kind: 'html',
              mime: 'text/html',
            },
          ],
        },
      ],
    });

    expect(screen.queryByRole('group', { name: 'Rate this response' })).toBeNull();
  });

  it('collects feedback on a failed assistant turn', () => {
    renderChatPane({
      messages: [
        completedAssistant({
          content: '',
          runStatus: 'failed',
          events: [{ kind: 'status', label: 'error', detail: 'boom-401' }],
        }),
      ],
    });

    expect(screen.getByRole('group', { name: 'Rate this response' })).toBeTruthy();
  });

  it('collects feedback on a canceled assistant turn', () => {
    renderChatPane({
      messages: [
        completedAssistant({
          content: 'Partial answer',
          runStatus: 'canceled',
        }),
      ],
    });

    expect(screen.getByRole('group', { name: 'Rate this response' })).toBeTruthy();
  });

  it('does not ask for feedback on a queued turn that has not started', () => {
    renderChatPane({
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          createdAt: 1_700_000_000_000,
          runStatus: 'queued',
        },
      ],
    });

    expect(screen.queryByRole('group', { name: 'Rate this response' })).toBeNull();
  });

  it('asks for a real experience response after five completed turns', async () => {
    renderChatPane({
      messages: Array.from({ length: 5 }, (_, index) => completedAssistant({
        id: `community-assistant-${index + 1}`,
        createdAt: 1_700_000_000_000 + index,
      })),
    });

    const dialog = await screen.findByRole('dialog', {
      name: 'How has MonoField been working for you?',
    });
    expect(within(dialog).getByText(
      'Is it working well, or is there something you would like us to improve?',
    )).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'It works well' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Share feedback' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Share feedback' }));
    await waitFor(() => {
      expect(externalMocks.openExternalUrl).toHaveBeenCalledWith(
        'https://github.com/jhy0285/monofield/issues/new',
      );
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks the same direct experience question in Korean without exposing trigger mechanics', async () => {
    renderChatPane({
      locale: 'ko',
      messages: Array.from({ length: 5 }, (_, index) => completedAssistant({
        id: `korean-community-assistant-${index + 1}`,
        createdAt: 1_700_000_050_000 + index,
      })),
    });

    const dialog = await screen.findByRole('dialog', {
      name: 'MonoField를 사용해 보니 어떠셨나요?',
    });
    expect(within(dialog).getByText(
      '잘 쓰고 계신가요? 불편하거나 바뀌었으면 하는 점이 있다면 알려주세요.',
    )).toBeTruthy();
    expect(within(dialog).queryByText(/몇 번의 작업|이 기기에만/)).toBeNull();
    expect(within(dialog).getByRole('button', { name: '잘 쓰고 있어요' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: '개선점 보내기' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: '닫기' })).toBeTruthy();
  });

  it('turns a positive experience response into an explicit optional Star request', async () => {
    renderChatPane({
      messages: Array.from({ length: 5 }, (_, index) => completedAssistant({
        id: `positive-community-assistant-${index + 1}`,
        createdAt: 1_700_000_100_000 + index,
      })),
    });

    fireEvent.click(await screen.findByRole('button', { name: 'It works well' }));
    const starDialog = screen.getByRole('dialog', {
      name: 'We will keep making MonoField better',
    });
    fireEvent.click(within(starDialog).getByRole('button', { name: 'Star MonoField' }));

    await waitFor(() => {
      expect(externalMocks.openExternalUrl).toHaveBeenCalledWith(
        'https://github.com/jhy0285/monofield',
      );
    });
  });
});
