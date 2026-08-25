const CREDENTIAL_URL = /(\b(?:jdbc:)?(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis):\/\/[^:\s/@]+:)[^@\s/]+(@)/gi;
const QUOTED_CREDENTIAL = /((?:["'])?(?:password|passwd|pwd|client[_-]?secret|private[_-]?key|access[_-]?token|refresh[_-]?token|api[_-]?key|secret)(?:["'])?\s*[:=]\s*)(["'])(.*?)\2/gi;
const UNQUOTED_CREDENTIAL = /(\b(?:password|passwd|pwd|client[_-]?secret|private[_-]?key|access[_-]?token|refresh[_-]?token|api[_-]?key|secret)\b\s*[:=]\s*)([^\s,;#}\r\n]+)/gi;

function isEnvironmentReference(value: string): boolean {
  return /^\s*(?:\$\{|\{\{|env\()/i.test(value);
}

/**
 * Masks credential-shaped values before agent-authored prose or tool output
 * reaches the screen or clipboard. This deliberately targets explicit secret
 * labels and credential URLs; ordinary code, hashes, ports, and prose remain
 * untouched. Environment references stay visible because they are names, not
 * secret values.
 */
export function redactSensitiveText(value: string): string {
  if (!value) return value;
  return value
    .replace(/Bearer\s+[A-Za-z0-9_\-.+/=]+/gi, 'Bearer [REDACTED]')
    .replace(/(x-api-key|api-key|x-goog-api-key)\s*[:=]\s*[^\s,;"']+/gi, '$1: [REDACTED]')
    .replace(/([?&](?:key|api_key|api-key)=)[^&#\s]+/gi, '$1[REDACTED]')
    .replace(CREDENTIAL_URL, '$1[REDACTED]$2')
    .replace(
      QUOTED_CREDENTIAL,
      (_match, prefix: string, quote: string, secret: string) =>
        isEnvironmentReference(secret)
          ? `${prefix}${quote}${secret}${quote}`
          : `${prefix}${quote}[REDACTED]${quote}`,
    )
    .replace(
      UNQUOTED_CREDENTIAL,
      (_match, prefix: string, secret: string) =>
        isEnvironmentReference(secret) ? `${prefix}${secret}` : `${prefix}[REDACTED]`,
    );
}
