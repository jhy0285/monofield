import type { ParsedUnit } from './model.js';

/** New syntax analyzers implement this boundary; no project-supplied executable plugin is loaded. */
export interface OntologyAnalyzer {
  id: string;
  extensions: readonly string[];
  parse(path: string, source: string, sha256: string): Promise<ParsedUnit>;
}
export const ontologyAnalyzers: readonly OntologyAnalyzer[] = [
  { id: 'java', extensions: ['.java'], parse: async (path, source, sha256) => (await import('./java.js')).parseJava(path, source, sha256) },
  { id: 'vue', extensions: ['.vue'], parse: async (path, source, sha256) => (await import('./vue.js')).parseVue(path, source, sha256) },
  { id: 'typescript', extensions: ['.ts', '.tsx', '.mts', '.cts'], parse: async (path, source, sha256) => (await import('./javascript.js')).parseJavascript(path, source, sha256, { typescript: true }) },
  { id: 'javascript', extensions: ['.js', '.jsx', '.mjs', '.cjs'], parse: async (path, source, sha256) => (await import('./javascript.js')).parseJavascript(path, source, sha256, { typescript: false }) },
];
export function analyzerFor(name: string): OntologyAnalyzer | null {
  const extension = name.match(/\.[^.\/]+$/)?.[0]?.toLowerCase();
  return ontologyAnalyzers.find(analyzer => extension && analyzer.extensions.includes(extension)) ?? null;
}
