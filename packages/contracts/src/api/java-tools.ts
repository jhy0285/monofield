export type JavaPosition = { line: number; character: number };
export interface JavaToolsStartRequest {
  file: string;
  javaHome?: string;
  /** Explicitly allow Maven's import to resolve dependencies over the network. */
  resolveDependencies?: boolean;
}
export type JavaRange = { start: JavaPosition; end: JavaPosition };
export type JavaTextEdit = { range: JavaRange; newText: string };
export interface JavaLocation {
  path: string;
  range: JavaRange;
}
export interface JavaDiagnostic {
  range: JavaRange;
  message: string;
  severity: number;
}
export interface JavaToolsStatus {
  state: "stopped" | "starting" | "ready" | "error";
  installed: boolean;
  version: string;
  projectPath: string;
  message: string | null;
  diagnostics: JavaDiagnostic[];
  pid: number | null;
  /** Previously enabled in this daemon; an explicit semantic request can resume it. */
  resumeAvailable?: boolean;
}
export interface JavaCompletion {
  label: string;
  detail: string;
  edit: JavaTextEdit;
  additionalEdits?: JavaTextEdit[];
}
export interface JavaRenamePlan {
  id: string;
  expiresAt: string;
  files: Array<{ path: string; sha256: string; before: string; after: string }>;
}
export type JavaSemanticResult = {
  version: number;
  completions?: JavaCompletion[];
  locations?: JavaLocation[];
  rename?: JavaRenamePlan;
  hover?: string;
};
export interface JavaDebugState {
  state: "stopped" | "connecting" | "running" | "paused" | "error";
  port: number | null;
  frames: Array<{
    index: number;
    method: string;
    source: string;
    line: number | null;
    path?: string;
  }>;
  locals: Array<{ name: string; value: string }>;
  output: string;
  message: string | null;
}
