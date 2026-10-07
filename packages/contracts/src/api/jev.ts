/** System One decisions. JEV is hosted; local compatible models are separate backends. */
export type DecisionJson = null | boolean | number | string | DecisionJson[] | { [key: string]: DecisionJson };
export type JevQuestion =
  | { type: 'choice'; instructions?: DecisionJson; criteria: Record<string, DecisionJson> }
  | { type: 'score'; instructions?: DecisionJson; criteria: DecisionJson[] }
  | { type: 'noul'; instructions?: DecisionJson; criteria?: { true: DecisionJson; false: DecisionJson } | null };
export interface JevRequest {
  model: string;
  state: string | DecisionJson[] | { [key: string]: DecisionJson };
  questions: Record<string, JevQuestion>;
}
export type JevAnswer =
  | { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> }
  | { type: 'score'; score: number; confidence: number; probabilities: Record<string, number>; legend: Record<string, DecisionJson> }
  | { type: 'noul'; noul: number };
export interface JevResponse {
  model: string;
  answers: Record<string, JevAnswer>;
  usage: { input_tokens: number; output_tokens: number };
}
export interface JevConfig {
  backend: 'typesafe' | 'local';
  /** Only used for explicitly selected local, loopback servers. */
  localBaseUrl: string;
  model: string;
}
export interface JevStatus {
  config: JevConfig;
  credentialSource: 'stored' | 'environment' | 'none';
  apiKeyTail: string;
  ready: boolean;
}
export interface JevModelsResponse {
  models: Array<{ name: string; description: string }>;
  source: 'provider' | 'local-health';
}
export interface JevEvaluation {
  backend: JevConfig['backend'];
  requestedModel: string;
  elapsedMs: number;
  result: JevResponse;
}
export type JevErrorCode = 'INVALID_REQUEST' | 'AUTH_REQUIRED' | 'AUTH_REJECTED' | 'RATE_LIMITED' | 'UNAVAILABLE' | 'TIMEOUT' | 'INVALID_RESPONSE';

/** A decision aid only: it never grants permissions or silently routes coding requests. */
export function buildJevTriageRequest(state: string, model: string): JevRequest {
  return { state, model, questions: {
    kind: { type: 'choice', instructions: 'What type of software development request is this?', criteria: {
      bug: 'Fix an existing defect or failure', feature: 'Add or change functionality', question: 'Explain or investigate without implementing a change',
    } },
    risk: { type: 'score', instructions: 'How consequential would an incorrect implementation be?', criteria: [
      'Low: presentation or documentation with easy rollback', 'Medium: application behavior or persistent data', 'High: security, credentials, destructive operations or production deployment',
    ] },
    clarification: { type: 'noul', instructions: 'Does this request lack essential information needed to implement it correctly?' },
  } };
}
