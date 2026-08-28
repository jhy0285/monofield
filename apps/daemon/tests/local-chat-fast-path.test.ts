import { describe, expect, it } from 'vitest';

import {
  canUseLocalGreetingFastPath,
  resolveLocalGreetingResponse,
} from '../src/runtimes/local-chat-fast-path.js';

describe('local chat fast path', () => {
  it('answers a standalone Korean greeting without starting a model run', () => {
    expect(resolveLocalGreetingResponse('안뇽?', 'ko')).toBe(
      '안녕하세요! 무엇을 도와드릴까요?',
    );
  });

  it('does not intercept a greeting that also contains work', () => {
    expect(resolveLocalGreetingResponse('안녕, 이 파일 고쳐줘', 'ko')).toBeNull();
  });

  it('answers standalone capability small talk without spending a model turn', () => {
    expect(resolveLocalGreetingResponse('뭐해?', 'ko')).toContain('코드 수정');
    expect(resolveLocalGreetingResponse('what can you do?', 'en')).toContain('browser verification');
    expect(resolveLocalGreetingResponse('뭐해? application.yml 수정해줘', 'ko')).toBeNull();
  });

  it('answers standalone model status small talk without starting a CLI session', () => {
    expect(resolveLocalGreetingResponse('지금 추론', 'ko')).toContain(
      '처리 중인 모델 작업은 없어요',
    );
    expect(resolveLocalGreetingResponse('are you thinking?', 'en')).toContain(
      'No model task is running',
    );
    expect(resolveLocalGreetingResponse('지금 추론해서 이 코드 고쳐줘', 'ko')).toBeNull();
  });

  it('does not intercept a turn with explicit context', () => {
    expect(canUseLocalGreetingFastPath({
      prompt: '안녕',
      locale: 'ko',
      attachments: ['README.md'],
    })).toBeNull();
    expect(canUseLocalGreetingFastPath({
      prompt: 'hello',
      locale: 'en',
      research: { enabled: true },
    })).toBeNull();
  });

  it('localizes English and Japanese greetings', () => {
    expect(resolveLocalGreetingResponse('hello!', 'en')).toBe('Hello! How can I help?');
    expect(resolveLocalGreetingResponse('こんにちは', 'ja')).toBe(
      'こんにちは！何をお手伝いしましょうか？',
    );
  });
});
