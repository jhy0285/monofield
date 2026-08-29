export const STORED_BYOK_API_KEY = '__MONOFIELD_STORED_API_KEY__';
export const STORED_AGENT_CLI_CREDENTIAL = '__MONOFIELD_STORED_CLI_CREDENTIAL__';

export function isStoredByokApiKey(value: unknown): value is typeof STORED_BYOK_API_KEY {
  return value === STORED_BYOK_API_KEY;
}

export function isStoredAgentCliCredential(
  value: unknown,
): value is typeof STORED_AGENT_CLI_CREDENTIAL {
  return value === STORED_AGENT_CLI_CREDENTIAL;
}

export interface PublicByokCredential {
  configured: boolean;
  apiKeyTail: string;
}

export interface PublicByokCredentialsResponse {
  credentials: Record<string, PublicByokCredential>;
}

export interface SaveByokCredentialsRequest {
  /**
   * A raw value replaces the stored key, an empty value clears it, and the
   * sentinel preserves the existing encrypted value.
   */
  credentials: Record<string, string>;
}
