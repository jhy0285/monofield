import type { ProjectFile, ProjectMetadata } from '../../types';

/**
 * Whether opening a project should pre-select the best design artifact in the
 * Design Files preview column.
 *
 * Only a folder imported as a design workspace qualifies. A development
 * workspace is a code folder that can hold several independent projects, so the
 * newest HTML or image across all of them is an arbitrary file from a module
 * the user may not be working on; the preview there stays an explicit choice.
 */
export function shouldAutoPreviewDesignArtifacts(
  metadata: Pick<ProjectMetadata, 'importedFrom' | 'workMode'> | null | undefined,
): boolean {
  return metadata?.importedFrom === 'folder' && metadata.workMode !== 'development';
}

export function listDesignArtifactCandidates(
  files: ProjectFile[],
  preferredName?: string | null,
): ProjectFile[] {
  return files
    .map((file) => ({ file, rank: designPreviewRank(file, preferredName) }))
    .filter((candidate) => Number.isFinite(candidate.rank))
    .sort(
      (a, b) =>
        a.rank - b.rank
        || b.file.mtime - a.file.mtime
        || a.file.name.localeCompare(b.file.name),
    )
    .map((candidate) => candidate.file);
}

export function selectInitialDesignPreviewFile(
  files: ProjectFile[],
  preferredName?: string | null,
): ProjectFile | null {
  return listDesignArtifactCandidates(files, preferredName)[0] ?? null;
}

function designPreviewRank(file: ProjectFile, preferredName?: string | null): number {
  if (isProcessArtifactFileName(file.name)) return Number.POSITIVE_INFINITY;
  if (preferredName && file.name === preferredName) return 0;
  if (file.kind === 'html') return 10 + htmlPreviewNameRank(file.name);
  if (file.kind === 'image') return 30 + visualAssetNameRank(file.name);
  if (file.kind === 'sketch') return 40;
  if (file.kind === 'video') return 50;
  if (file.kind === 'pdf') return 60;
  if (file.kind === 'presentation') return 70;
  if (file.kind === 'document') return 80;
  return Number.POSITIVE_INFINITY;
}

function htmlPreviewNameRank(name: string): number {
  const base = fileBaseName(name).toLowerCase();
  if (/^index\.html?$/u.test(base)) return 0;
  if (/\b(home|landing|main|app|preview|showcase|styleguide)\b/u.test(base)) return 1;
  return 2;
}

function visualAssetNameRank(name: string): number {
  const base = fileBaseName(name).toLowerCase();
  if (/\b(hero|cover|preview|mockup|screen|screenshot|design)\b/u.test(base)) return 0;
  if (/\b(icon|logo|sprite|favicon)\b/u.test(base)) return 2;
  return 1;
}

function isProcessArtifactFileName(name: string): boolean {
  const base = fileBaseName(name).toLowerCase();
  return (
    base === 'critique.json'
    || base.endsWith('.log')
    || base.endsWith('.meta.json')
    || base.endsWith('.artifact.json')
    || base.endsWith('.map')
  );
}

function fileBaseName(name: string): string {
  return name.split('/').pop() ?? name;
}
