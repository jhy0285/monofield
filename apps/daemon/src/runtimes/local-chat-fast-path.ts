const GREETING_ONLY_PHRASES = new Set([
  '안녕',
  '안뇽',
  '안녕하세요',
  '하이',
  '헬로',
  'hi',
  'hello',
  'hey',
  'hiya',
  'good morning',
  'good afternoon',
  'good evening',
  'こんにちは',
  'こんばんは',
  'おはよう',
  'おはようございます',
  '你好',
  '您好',
]);

const CAPABILITY_ONLY_PHRASES = new Set([
  '뭐해',
  '뭐 해',
  '뭐 하고 있어',
  '무엇을 할 수 있어',
  '무엇을 도와줄 수 있어',
  'what are you doing',
  'what can you do',
  '何ができる',
  '你能做什么',
]);

const STATUS_ONLY_PHRASES = new Set([
  '지금 추론',
  '지금 추론 중이야',
  '추론 중이야',
  '지금 생각 중이야',
  '생각 중이야',
  '지금 뭐해',
  '지금 뭐 해',
  '뭐 하는 중이야',
  'are you reasoning',
  'are you thinking',
  'what are you working on',
  '今考えてる',
  '你在思考吗',
]);

function normalizeGreetingCandidate(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase()
    .replace(/^[\s\p{P}\p{S}]+/gu, '')
    .replace(/[\s\p{P}\p{S}]+$/gu, '')
    .replace(/\s+/g, ' ');
}

/**
 * Resolve tiny standalone turns that do not need model reasoning or project
 * context. This is deliberately conservative: a phrase that contains an
 * actual task never qualifies.
 */
export function resolveLocalGreetingResponse(
  prompt: unknown,
  locale: unknown,
): string | null {
  const normalized = normalizeGreetingCandidate(prompt);
  if (!normalized || normalized.length > 32) {
    return null;
  }

  const language = typeof locale === 'string'
    ? locale.trim().toLocaleLowerCase()
    : '';
  const capabilityQuestion = CAPABILITY_ONLY_PHRASES.has(normalized);
  const statusQuestion = STATUS_ONLY_PHRASES.has(normalized);
  if (
    !capabilityQuestion
    && !statusQuestion
    && !GREETING_ONLY_PHRASES.has(normalized)
  ) return null;
  if (language.startsWith('ko') || /[가-힣]/u.test(normalized)) {
    if (statusQuestion) {
      return '현재 처리 중인 모델 작업은 없어요. 실제 작업을 요청하면 필요한 경우에만 모델을 호출합니다.';
    }
    if (capabilityQuestion) {
      return '지금 바로 도와드릴 수 있어요. 코드 수정·빌드·브라우저 검증이나 문서/디자인 제작을 요청해 주세요.';
    }
    return '안녕하세요! 무엇을 도와드릴까요?';
  }
  if (language.startsWith('ja') || /[ぁ-んァ-ン]/u.test(normalized)) {
    if (statusQuestion) {
      return '現在処理中のモデル作業はありません。実際の作業を依頼した場合にのみ、必要に応じてモデルを呼び出します。';
    }
    if (capabilityQuestion) {
      return 'コード修正、ビルド、ブラウザ検証、ドキュメントやデザイン制作をすぐにお手伝いできます。';
    }
    return 'こんにちは！何をお手伝いしましょうか？';
  }
  if (language.startsWith('zh') || /[\u3400-\u9fff]/u.test(normalized)) {
    if (statusQuestion) {
      return '当前没有正在处理的模型任务。提交实际任务后，仅在必要时调用模型。';
    }
    if (capabilityQuestion) {
      return '我可以立即帮助修改代码、构建、浏览器验证，以及制作文档或设计。';
    }
    return '你好！有什么可以帮你？';
  }
  if (statusQuestion) {
    return 'No model task is running right now. A model is called only when an actual task needs it.';
  }
  if (capabilityQuestion) {
    return 'I can help right away with code changes, builds, browser verification, and document or design work.';
  }
  return 'Hello! How can I help?';
}

export function canUseLocalGreetingFastPath(input: {
  prompt: unknown;
  locale?: unknown;
  imagePaths?: readonly unknown[] | null;
  attachments?: readonly unknown[] | null;
  commentAttachments?: readonly unknown[] | null;
  skillIds?: readonly unknown[] | null;
  appliedPluginSnapshotId?: unknown;
  research?: { enabled?: unknown } | null;
  browserVerification?: unknown;
}): string | null {
  if (
    (Array.isArray(input.imagePaths) && input.imagePaths.length > 0)
    || (Array.isArray(input.attachments) && input.attachments.length > 0)
    || (Array.isArray(input.commentAttachments) && input.commentAttachments.length > 0)
    || (Array.isArray(input.skillIds) && input.skillIds.length > 0)
    || (typeof input.appliedPluginSnapshotId === 'string'
      && input.appliedPluginSnapshotId.trim().length > 0)
    || input.research?.enabled === true
    || input.browserVerification != null
  ) {
    return null;
  }
  return resolveLocalGreetingResponse(input.prompt, input.locale);
}
