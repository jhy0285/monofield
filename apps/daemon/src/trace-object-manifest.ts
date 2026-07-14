import type {
  ArtifactManifestEntry,
  ArtifactSummary,
  AttachmentManifestEntry,
  InputTextSnapshotManifestEntry,
  ObjectManifestCompleteness,
} from './langfuse-trace.js';

type ObjectClass = 'attachment' | 'artifact' | 'input_text_snapshot';
type TraceObjectManifestEntry =
  | AttachmentManifestEntry
  | ArtifactManifestEntry
  | InputTextSnapshotManifestEntry;

export interface TraceObjectUploadManifests {
  attachmentManifest?: AttachmentManifestEntry[];
  artifactManifest?: ArtifactManifestEntry[];
  inputTextSnapshotManifest?: InputTextSnapshotManifestEntry[];
  completeness: ObjectManifestCompleteness;
}

export interface TraceObjectSource {
  objectClass: ObjectClass;
  id: string;
  filename: string;
  mime: string;
  type?: string;
  body?: Buffer;
  sizeBytes?: number;
  reason?: string;
  source: string;
  truncated?: boolean;
}

export interface BuildTraceObjectManifestsOptions {
  installationId: string | null;
  projectId: string;
  runId: string;
  projectsRoot: string;
  projectMetadata?: Record<string, unknown> | null;
  attachmentPaths?: string[];
  artifacts?: TraceArtifactObjectSource[];
  prompt: string;
  prefs: {
    metrics?: boolean;
    content?: boolean;
    artifactManifest?: boolean;
  };
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  uploadMode?: 'manifest-only' | 'upload';
}

export interface TraceArtifactObjectSource {
  summary: ArtifactSummary;
  sourcePath?: string;
}

export function disabledTraceObjectManifestEntry(): TraceObjectManifestEntry | null {
  return null;
}

export async function buildTraceObjectManifests(
  opts: BuildTraceObjectManifestsOptions,
): Promise<TraceObjectUploadManifests | undefined> {
  void opts;
  return undefined;
}
