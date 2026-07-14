import type {
  ScreenSpecCallout,
  ScreenSpecCalloutRelation,
  ScreenSpecDocument,
  ScreenSpecPosition,
  ScreenSpecScreen,
  ScreenSpecVisualSettings,
} from '@open-design/contracts';

/**
 * Pure edit operations over the screen-spec contract types. Ported from
 * Screen Spec Studio (wireFrame repo, src/domain/screenSpecEditor.ts) and
 * adapted to the multi-screen ScreenSpecDocument: every operation returns a
 * new document so React state stays immutable and the JSON file remains the
 * single source of truth.
 */

export type ScreenMetadataPatch = Partial<
  Pick<
    ScreenSpecScreen,
    | 'id'
    | 'pageTitle'
    | 'screenName'
    | 'screenPath'
    | 'overview'
    | 'companyName'
    | 'author'
    | 'date'
    | 'version'
  >
>;

export type VisualSettingsPatch = Partial<ScreenSpecVisualSettings>;

export const MARKER_SIZE_RANGE = { min: 18, max: 56 } as const;
export const LINE_WIDTH_RANGE = { min: 1, max: 10 } as const;
export const CANVAS_HEIGHT_RANGE = { min: 360, max: 820 } as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function normalizePosition(position: ScreenSpecPosition): ScreenSpecPosition {
  return { x: clamp01(position.x), y: clamp01(position.y) };
}

export function updateScreenAt(
  doc: ScreenSpecDocument,
  index: number,
  update: (screen: ScreenSpecScreen) => ScreenSpecScreen,
): ScreenSpecDocument {
  return {
    ...doc,
    screens: doc.screens.map((screen, i) => (i === index ? update(screen) : screen)),
  };
}

export function addScreen(doc: ScreenSpecDocument): ScreenSpecDocument {
  const existingIds = new Set(doc.screens.map((s) => s.id));
  let n = doc.screens.length + 1;
  while (existingIds.has(`SCR-${String(n).padStart(3, '0')}`)) n += 1;
  const id = `SCR-${String(n).padStart(3, '0')}`;
  const template = doc.screens[doc.screens.length - 1];
  const screen: ScreenSpecScreen = {
    id,
    pageTitle: '',
    screenName: '',
    screenPath: '',
    overview: '',
    levels: template ? [...template.levels] : [''],
    companyName: template?.companyName ?? '',
    author: template?.author ?? '',
    date: template?.date ?? '',
    version: template?.version ?? '',
    callouts: [],
    calloutRelations: [],
    visualSettings: template
      ? { ...template.visualSettings }
      : { markerSizePx: 24, relationLineWidthPx: 2, canvasHeightPx: 520 },
    checkpoints: [],
  };
  return { ...doc, screens: [...doc.screens, screen] };
}

export function deleteScreen(doc: ScreenSpecDocument, index: number): ScreenSpecDocument {
  return { ...doc, screens: doc.screens.filter((_s, i) => i !== index) };
}

export function updateScreenMetadata(
  screen: ScreenSpecScreen,
  patch: ScreenMetadataPatch,
): ScreenSpecScreen {
  return { ...screen, ...patch };
}

export function updateVisualSettings(
  screen: ScreenSpecScreen,
  patch: VisualSettingsPatch,
): ScreenSpecScreen {
  const current = screen.visualSettings;
  return {
    ...screen,
    visualSettings: {
      markerSizePx:
        patch.markerSizePx === undefined
          ? current.markerSizePx
          : clamp(patch.markerSizePx, MARKER_SIZE_RANGE.min, MARKER_SIZE_RANGE.max),
      relationLineWidthPx:
        patch.relationLineWidthPx === undefined
          ? current.relationLineWidthPx
          : clamp(patch.relationLineWidthPx, LINE_WIDTH_RANGE.min, LINE_WIDTH_RANGE.max),
      canvasHeightPx:
        patch.canvasHeightPx === undefined
          ? current.canvasHeightPx
          : clamp(patch.canvasHeightPx, CANVAS_HEIGHT_RANGE.min, CANVAS_HEIGHT_RANGE.max),
    },
  };
}

export function addLevel(screen: ScreenSpecScreen): ScreenSpecScreen {
  return { ...screen, levels: [...screen.levels, ''] };
}

export function updateLevel(screen: ScreenSpecScreen, index: number, value: string): ScreenSpecScreen {
  return {
    ...screen,
    levels: screen.levels.map((level, i) => (i === index ? value : level)),
  };
}

export function deleteLevel(screen: ScreenSpecScreen, index: number): ScreenSpecScreen {
  return { ...screen, levels: screen.levels.filter((_l, i) => i !== index) };
}

export function addCalloutAtPosition(
  screen: ScreenSpecScreen,
  position: ScreenSpecPosition,
  defaultLabel: string,
): ScreenSpecScreen {
  const nextNo = screen.callouts.length + 1;
  const callout: ScreenSpecCallout = {
    no: nextNo,
    label: defaultLabel,
    description: '',
    position: normalizePosition(position),
  };
  return { ...screen, callouts: [...screen.callouts, callout] };
}

export function moveCallout(
  screen: ScreenSpecScreen,
  no: number,
  position: ScreenSpecPosition,
): ScreenSpecScreen {
  return {
    ...screen,
    callouts: screen.callouts.map((callout) =>
      callout.no === no ? { ...callout, position: normalizePosition(position) } : callout,
    ),
  };
}

export function updateCallout(
  screen: ScreenSpecScreen,
  no: number,
  patch: Pick<ScreenSpecCallout, 'label' | 'description'>,
): ScreenSpecScreen {
  return {
    ...screen,
    callouts: screen.callouts.map((callout) =>
      callout.no === no ? { ...callout, ...patch } : callout,
    ),
  };
}

export function deleteCallout(screen: ScreenSpecScreen, no: number): ScreenSpecScreen {
  return {
    ...screen,
    callouts: renumberCallouts(screen.callouts.filter((callout) => callout.no !== no)),
    calloutRelations: renumberRelationsAfterCalloutDeletion(screen.calloutRelations, no),
  };
}

export function addCalloutRelation(screen: ScreenSpecScreen): ScreenSpecScreen {
  const nextRelation = findNextAvailableRelation(screen);
  if (!nextRelation) return screen;
  return { ...screen, calloutRelations: [...screen.calloutRelations, nextRelation] };
}

export function updateCalloutRelation(
  screen: ScreenSpecScreen,
  index: number,
  patch: Partial<ScreenSpecCalloutRelation>,
): ScreenSpecScreen {
  return {
    ...screen,
    calloutRelations: screen.calloutRelations.map((relation, i) =>
      i === index ? normalizeRelationPatch(screen, relation, patch) : relation,
    ),
  };
}

export function deleteCalloutRelation(screen: ScreenSpecScreen, index: number): ScreenSpecScreen {
  return {
    ...screen,
    calloutRelations: screen.calloutRelations.filter((_r, i) => i !== index),
  };
}

export function addCheckpoint(screen: ScreenSpecScreen, text: string): ScreenSpecScreen {
  const checkpoint = text.trim();
  if (!checkpoint) return screen;
  return { ...screen, checkpoints: [...screen.checkpoints, checkpoint] };
}

export function updateCheckpoint(
  screen: ScreenSpecScreen,
  index: number,
  text: string,
): ScreenSpecScreen {
  return {
    ...screen,
    checkpoints: screen.checkpoints.map((cp, i) => (i === index ? text : cp)),
  };
}

export function deleteCheckpoint(screen: ScreenSpecScreen, index: number): ScreenSpecScreen {
  return { ...screen, checkpoints: screen.checkpoints.filter((_cp, i) => i !== index) };
}

export function updateScreenImage(screen: ScreenSpecScreen, imageDataUrl: string): ScreenSpecScreen {
  // A fresh upload replaces any project-relative reference too, so exactly
  // one image source stays live at a time.
  return { ...screen, imageDataUrl, imageRef: undefined };
}

function renumberCallouts(callouts: ScreenSpecCallout[]): ScreenSpecCallout[] {
  return callouts.map((callout, index) => ({ ...callout, no: index + 1 }));
}

function normalizeRelationPatch(
  screen: ScreenSpecScreen,
  relation: ScreenSpecCalloutRelation,
  patch: Partial<ScreenSpecCalloutRelation>,
): ScreenSpecCalloutRelation {
  const nextRelation = { ...relation, ...patch };
  const calloutNumbers = new Set(screen.callouts.map((callout) => callout.no));
  if (!calloutNumbers.has(nextRelation.fromNo)) nextRelation.fromNo = relation.fromNo;
  if (!calloutNumbers.has(nextRelation.toNo)) nextRelation.toNo = relation.toNo;
  if (nextRelation.fromNo === nextRelation.toNo) nextRelation.toNo = relation.toNo;
  return nextRelation;
}

function renumberRelationsAfterCalloutDeletion(
  relations: ScreenSpecCalloutRelation[],
  deletedNo: number,
): ScreenSpecCalloutRelation[] {
  return relations.flatMap((relation) => {
    if (relation.fromNo === deletedNo || relation.toNo === deletedNo) return [];
    return [
      {
        ...relation,
        fromNo: relation.fromNo > deletedNo ? relation.fromNo - 1 : relation.fromNo,
        toNo: relation.toNo > deletedNo ? relation.toNo - 1 : relation.toNo,
      },
    ];
  });
}

function findNextAvailableRelation(screen: ScreenSpecScreen): ScreenSpecCalloutRelation | null {
  const existing = new Set(
    screen.calloutRelations.map((relation) => `${relation.fromNo}->${relation.toNo}`),
  );
  for (const from of screen.callouts) {
    for (const to of screen.callouts) {
      if (from.no === to.no) continue;
      if (existing.has(`${from.no}->${to.no}`)) continue;
      return { fromNo: from.no, toNo: to.no, label: '', lineMode: 'orthogonal' };
    }
  }
  return null;
}
