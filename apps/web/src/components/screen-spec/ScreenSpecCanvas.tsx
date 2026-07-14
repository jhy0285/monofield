'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type {
  ScreenSpecCallout,
  ScreenSpecCalloutRelation,
  ScreenSpecPosition,
  ScreenSpecScreen,
} from '@open-design/contracts';
import { useT } from '../../i18n';
import { projectRawUrl } from '../../providers/registry';
import { CANVAS_HEIGHT_RANGE, type VisualSettingsPatch } from './editor-model';
import styles from './ScreenSpecEditor.module.css';

/**
 * The screen image with draggable numbered markers and relation lines.
 * Marker positions are normalized to the image's letterboxed "coordinate
 * box" inside the frame (0..1 both axes), matching what the HTML preview
 * and PPTX renderer consume — dragging never bakes in pixel coordinates.
 */

interface CanvasBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CanvasPoint {
  x: number;
  y: number;
}

const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

interface Props {
  projectId: string;
  screen: ScreenSpecScreen;
  selectedCalloutNo: number | null;
  onAddCallout: (position: ScreenSpecPosition) => void;
  onImageUpload: (imageDataUrl: string) => void;
  onMoveCallout: (no: number, position: ScreenSpecPosition) => void;
  onSelectCallout: (no: number) => void;
  onUpdateVisualSettings: (patch: VisualSettingsPatch) => void;
}

export function ScreenSpecCanvas({
  projectId,
  screen,
  selectedCalloutNo,
  onAddCallout,
  onImageUpload,
  onMoveCallout,
  onSelectCallout,
  onUpdateVisualSettings,
}: Props) {
  const t = useT();
  const frameRef = useRef<HTMLDivElement | null>(null);
  const lastAutoFitImageRef = useRef<string | null>(null);
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | undefined>();
  const [draggingCalloutNo, setDraggingCalloutNo] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState('');

  const imageSrc = screen.imageDataUrl
    ? screen.imageDataUrl
    : screen.imageRef
      ? projectRawUrl(projectId, screen.imageRef)
      : null;

  const coordinateBox = useMemo(
    () => calculateCoordinateBox(frameSize.width, frameSize.height, imageSrc ? imageSize : undefined),
    [frameSize.height, frameSize.width, imageSize, imageSrc],
  );

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const updateFrameSize = () => {
      const rect = frame.getBoundingClientRect();
      setFrameSize({ width: rect.width, height: rect.height });
    };
    const resizeObserver = new ResizeObserver(updateFrameSize);
    resizeObserver.observe(frame);
    updateFrameSize();
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    if (draggingCalloutNo === null) return;
    const handlePointerMove = (event: PointerEvent) => {
      onMoveCallout(
        draggingCalloutNo,
        normalizedPositionFromClientPoint(frameRef.current, coordinateBox, event.clientX, event.clientY),
      );
    };
    const handlePointerUp = () => setDraggingCalloutNo(null);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [coordinateBox, draggingCalloutNo, onMoveCallout]);

  function handleCanvasClick(event: React.MouseEvent<HTMLDivElement>) {
    if (!imageSrc) return;
    if ((event.target as HTMLElement).closest(`.${styles.marker}`)) return;
    if (!isPointInsideCoordinateBox(frameRef.current, coordinateBox, event)) return;
    onAddCallout(
      normalizedPositionFromClientPoint(frameRef.current, coordinateBox, event.clientX, event.clientY),
    );
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      setUploadError(t('screenSpec.imageTypeError'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setUploadError('');
        setImageSize(undefined);
        lastAutoFitImageRef.current = null;
        onImageUpload(reader.result);
      }
    };
    reader.onerror = () => setUploadError(t('screenSpec.imageReadError'));
    reader.readAsDataURL(file);
  }

  function fitCanvasHeightToImage(size = imageSize): void {
    if (!size || size.width <= 0 || size.height <= 0) return;
    const frameWidth = frameRef.current?.getBoundingClientRect().width || frameSize.width;
    if (frameWidth <= 0) return;
    onUpdateVisualSettings({
      canvasHeightPx: Math.min(
        CANVAS_HEIGHT_RANGE.max,
        Math.max(CANVAS_HEIGHT_RANGE.min, Math.round((frameWidth * size.height) / size.width)),
      ),
    });
  }

  const markerSize = screen.visualSettings.markerSizePx;

  return (
    <div className={styles.canvasSection}>
      <div className={styles.canvasToolbar}>
        <label className={styles.uploadButton}>
          {t('screenSpec.uploadImage')}
          <input
            accept="image/png,image/jpeg,image/webp"
            data-testid="screen-spec-image-upload"
            onChange={handleFileChange}
            type="file"
          />
        </label>
        <label className={styles.heightControl}>
          <span>{t('screenSpec.previewHeight')}</span>
          <input
            max={CANVAS_HEIGHT_RANGE.max}
            min={CANVAS_HEIGHT_RANGE.min}
            onChange={(event) =>
              onUpdateVisualSettings({ canvasHeightPx: Number(event.currentTarget.value) })
            }
            type="range"
            value={screen.visualSettings.canvasHeightPx}
          />
          <output>{screen.visualSettings.canvasHeightPx}px</output>
        </label>
        <button
          className={styles.smallButton}
          disabled={!imageSize}
          onClick={() => fitCanvasHeightToImage()}
          type="button"
        >
          {t('screenSpec.fitImageRatio')}
        </button>
      </div>

      {uploadError && <p className={styles.uploadError}>{uploadError}</p>}

      <div
        className={styles.canvasFrame}
        onClick={handleCanvasClick}
        ref={frameRef}
        style={{ '--ss-canvas-height': `${screen.visualSettings.canvasHeightPx}px` } as CSSProperties}
      >
        {imageSrc ? (
          <img
            alt={screen.screenName}
            className={styles.canvasImage}
            onLoad={(event) => {
              const nextImageSize = {
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              };
              setImageSize(nextImageSize);
              if (lastAutoFitImageRef.current !== imageSrc) {
                lastAutoFitImageRef.current = imageSrc;
                fitCanvasHeightToImage(nextImageSize);
              }
            }}
            src={imageSrc}
          />
        ) : (
          <div className={styles.emptyImage}>
            <span>{t('screenSpec.emptyImageTitle')}</span>
            <strong>{screen.screenName || screen.id}</strong>
            <small>{t('screenSpec.emptyImageHint')}</small>
          </div>
        )}

        <RelationLayer
          callouts={screen.callouts}
          coordinateBox={coordinateBox}
          frameSize={frameSize}
          lineWidth={screen.visualSettings.relationLineWidthPx}
          markerSize={markerSize}
          relations={screen.calloutRelations}
        />

        {screen.callouts.map((callout) => (
          <button
            aria-label={t('screenSpec.markerAria', { no: callout.no, label: callout.label })}
            className={`${styles.marker} ${selectedCalloutNo === callout.no ? styles.markerSelected : ''}`}
            key={callout.no}
            onClick={(event) => {
              event.stopPropagation();
              onSelectCallout(callout.no);
            }}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.setPointerCapture(event.pointerId);
              onSelectCallout(callout.no);
              setDraggingCalloutNo(callout.no);
            }}
            style={{
              left: coordinateBox.x + coordinateBox.width * callout.position.x,
              top: coordinateBox.y + coordinateBox.height * callout.position.y,
              width: markerSize,
              height: markerSize,
              marginLeft: -markerSize / 2,
              marginTop: -markerSize / 2,
              fontSize: Math.max(10, Math.round(markerSize * 0.5)),
            }}
            type="button"
          >
            {callout.no}
          </button>
        ))}
      </div>
    </div>
  );
}

function RelationLayer({
  callouts,
  coordinateBox,
  frameSize,
  lineWidth,
  markerSize,
  relations,
}: {
  callouts: ScreenSpecCallout[];
  coordinateBox: CanvasBox;
  frameSize: { width: number; height: number };
  lineWidth: number;
  markerSize: number;
  relations: ScreenSpecCalloutRelation[];
}) {
  if (relations.length === 0 || frameSize.width <= 0 || frameSize.height <= 0) return null;

  return (
    <svg
      aria-hidden="true"
      className={styles.relationLayer}
      height={frameSize.height}
      viewBox={`0 0 ${frameSize.width} ${frameSize.height}`}
      width={frameSize.width}
    >
      {relations.map((relation, index) => {
        const fromCallout = callouts.find((c) => c.no === relation.fromNo);
        const toCallout = callouts.find((c) => c.no === relation.toNo);
        if (!fromCallout || !toCallout || fromCallout.no === toCallout.no) return null;

        const from = toCanvasPoint(fromCallout, coordinateBox);
        const to = toCanvasPoint(toCallout, coordinateBox);
        const relationPoints = buildRelationPoints(from, to, relation, markerSize / 2 + lineWidth);
        const pathData = buildRelationPath(relationPoints);
        const arrowPoints = buildArrowHeadPoints(relationPoints, Math.max(12, lineWidth * 2.4));

        return (
          <g key={`${relation.fromNo}-${relation.toNo}-${index}`}>
            <path className={styles.relationPath} d={pathData} strokeWidth={lineWidth} />
            {arrowPoints ? (
              <polygon
                className={styles.relationArrow}
                points={arrowPoints.map((p) => `${p.x},${p.y}`).join(' ')}
              />
            ) : null}
            {relation.label ? (
              <text className={styles.relationText} x={(from.x + to.x) / 2 + 8} y={(from.y + to.y) / 2 - 8}>
                {relation.label}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

function buildRelationPoints(
  from: CanvasPoint,
  to: CanvasPoint,
  relation: ScreenSpecCalloutRelation,
  endpointOffset: number,
): CanvasPoint[] {
  const points =
    (relation.lineMode ?? 'straight') === 'straight' ? [from, to] : buildOrthogonalPoints(from, to);
  return trimRelationPathEndpoints(points, endpointOffset);
}

function buildOrthogonalPoints(from: CanvasPoint, to: CanvasPoint): CanvasPoint[] {
  const middleY = (from.y + to.y) / 2;
  return [from, { x: from.x, y: middleY }, { x: to.x, y: middleY }, to];
}

function buildRelationPath(points: CanvasPoint[]): string {
  const [first, ...rest] = points;
  if (!first) return '';
  return [`M ${first.x} ${first.y}`, ...rest.map((p) => `L ${p.x} ${p.y}`)].join(' ');
}

function buildArrowHeadPoints(points: CanvasPoint[], size: number): CanvasPoint[] | null {
  const tip = points[points.length - 1];
  const previous = points[points.length - 2];
  if (!tip || !previous) return null;
  const distance = getDistance(previous, tip);
  if (distance <= 0) return null;
  const direction = { x: (tip.x - previous.x) / distance, y: (tip.y - previous.y) / distance };
  const perpendicular = { x: -direction.y, y: direction.x };
  const baseCenter = { x: tip.x - direction.x * size, y: tip.y - direction.y * size };
  const halfWidth = size * 0.55;
  return [
    tip,
    { x: baseCenter.x + perpendicular.x * halfWidth, y: baseCenter.y + perpendicular.y * halfWidth },
    { x: baseCenter.x - perpendicular.x * halfWidth, y: baseCenter.y - perpendicular.y * halfWidth },
  ];
}

function trimRelationPathEndpoints(points: CanvasPoint[], offset: number): CanvasPoint[] {
  const filtered = points.filter((point, index) => {
    const prev = points[index - 1];
    return !prev || getDistance(prev, point) > 0.1;
  });
  const first = filtered[0];
  const second = filtered[1];
  const last = filtered[filtered.length - 1];
  const beforeLast = filtered[filtered.length - 2];
  if (!first || !second || !last || !beforeLast) return filtered;
  return [
    movePointToward(first, second, offset),
    ...filtered.slice(1, -1),
    movePointToward(last, beforeLast, offset),
  ];
}

function movePointToward(point: CanvasPoint, target: CanvasPoint, offset: number): CanvasPoint {
  const distance = getDistance(point, target);
  if (distance <= 0) return point;
  const ratio = Math.min(offset, distance / 2) / distance;
  return { x: point.x + (target.x - point.x) * ratio, y: point.y + (target.y - point.y) * ratio };
}

function getDistance(first: CanvasPoint, second: CanvasPoint): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function toCanvasPoint(callout: ScreenSpecCallout, box: CanvasBox): CanvasPoint {
  return { x: box.x + box.width * callout.position.x, y: box.y + box.height * callout.position.y };
}

function calculateCoordinateBox(
  frameWidth: number,
  frameHeight: number,
  imageSize?: { width: number; height: number },
): CanvasBox {
  if (!imageSize || imageSize.width <= 0 || imageSize.height <= 0) {
    return { x: 0, y: 0, width: frameWidth, height: frameHeight };
  }
  const imageRatio = imageSize.width / imageSize.height;
  const frameRatio = frameWidth / frameHeight;
  if (imageRatio > frameRatio) {
    const height = frameWidth / imageRatio;
    return { x: 0, y: (frameHeight - height) / 2, width: frameWidth, height };
  }
  const width = frameHeight * imageRatio;
  return { x: (frameWidth - width) / 2, y: 0, width, height: frameHeight };
}

function normalizedPositionFromClientPoint(
  frame: HTMLDivElement | null,
  box: CanvasBox,
  clientX: number,
  clientY: number,
): ScreenSpecPosition {
  if (!frame || box.width <= 0 || box.height <= 0) return { x: 0, y: 0 };
  const rect = frame.getBoundingClientRect();
  const x = (clientX - rect.left - box.x) / box.width;
  const y = (clientY - rect.top - box.y) / box.height;
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
}

function isPointInsideCoordinateBox(
  frame: HTMLDivElement | null,
  box: CanvasBox,
  event: React.MouseEvent<HTMLDivElement>,
): boolean {
  if (!frame) return false;
  const rect = frame.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
}
