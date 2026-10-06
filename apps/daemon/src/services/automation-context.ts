import type { AutomationCompressionReport, AutomationTokenCompressionMode } from '@open-design/contracts';

/** Reduce adjacent duplicate prose only. Distinct facts and code are never truncated. */
export function compactAutomationContext(
  body: string,
  mode: AutomationTokenCompressionMode,
  packetId: string,
): { body: string; report: AutomationCompressionReport } {
  const beforeTokens = Math.ceil(body.length / 4);
  let compacted = body;
  if (mode !== 'off' && body.length > (mode === 'aggressive' ? 1_600 : 3_200)) {
    let fence: string | null = null;
    compacted = body.split(/(\r?\n)/).map((line) => {
      const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
      if (marker) {
        if (!fence) fence = marker;
        else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
        return line;
      }
      if (fence || line.includes('`') || /^\s*(?:[#>|]|[-*+]\s|\d+\.\s|\t| {4})/.test(line)) return line;
      const sentences = line.split(/(?<=[.!?。！？])(?=\s)/u);
      // Collapse an exactly repeated paragraph pattern (e.g. A B A B).
      const meaningful = sentences.filter((sentence) => sentence.trim());
      for (let period = 1; period <= meaningful.length / 2; period += 1) {
        if (meaningful.length % period !== 0) continue;
        if (meaningful.every((sentence, index) => sentence.trim() === meaningful[index % period]?.trim())) {
          return meaningful.slice(0, period).join('');
        }
      }
      let previous: string | null = null;
      return sentences.filter((sentence) => {
        const normalized = sentence.trim();
        if (normalized && normalized === previous) return false;
        previous = normalized;
        return true;
      }).join('');
    }).join('');
  }
  const applied = compacted.length < body.length;
  return {
    body: compacted,
    report: {
      mode,
      status: applied ? 'applied' : 'skipped',
      beforeTokens,
      afterTokens: Math.ceil(compacted.length / 4),
      summary: applied
        ? 'Removed adjacent duplicate prose sentences; retained distinct facts, constraints and fenced code. Token counts are character-based estimates.'
        : 'Retained the complete context; no safe duplicate reduction was available. Token counts are character-based estimates.',
      preservedSourcePacketId: packetId,
    },
  };
}
