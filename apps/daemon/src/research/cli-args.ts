export interface ResearchSubcommandArgs {
  sub: string | undefined;
  subArgs: string[];
}

export function splitResearchSubcommand(args: string[]): ResearchSubcommandArgs {
  const sub = args.find((a) => a && !a.startsWith('--'));
  if (!sub) return { sub: undefined, subArgs: args };

  const idx = args.indexOf(sub);
  return {
    sub,
    subArgs: [...args.slice(0, idx), ...args.slice(idx + 1)],
  };
}

export function researchSearchEndpoint(toolToken: unknown): string {
  return typeof toolToken === 'string' && toolToken.trim()
    ? '/api/tools/research/search'
    : '/api/research/search';
}

export function researchSearchHeaders(toolToken: unknown): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (typeof toolToken === 'string' && toolToken.trim()) {
    headers.authorization = `Bearer ${toolToken.trim()}`;
  }
  return headers;
}
