import type { AlignOption, ViewKind } from '../common/netease';

export type DeviceLayout = 'wide' | 'stacked' | 'compact' | 'lyrics' | 'control';
export type UiStatus = 'idle' | 'loading' | 'success' | 'error';

export interface GridMetrics {
  cellWidth?: number;
  cellHeight?: number;
  margin?: number;
}

export interface UnitPixelSize {
  width: number;
  height: number;
}

export interface DeviceLayoutInput {
  width: number;
  height: number;
  viewKind: ViewKind;
}

export interface SetupStepState {
  color: 'default' | 'info' | 'success' | 'warning';
  icon: string;
  labelKey: 'manual' | 'working' | 'ready' | 'needsAction';
}

export interface LyricTextStyleInput {
  align?: AlignOption;
  x?: number;
  y?: number;
  color?: string;
  fontSize?: number;
}

const DEFAULT_CELL_WIDTH = 64;
const DEFAULT_CELL_HEIGHT = 64;
const DEFAULT_CELL_MARGIN = 0;
const DEFAULT_UNIT_SIZE: UnitPixelSize = { width: 64, height: 64 };

export function getDeviceLayout(input: DeviceLayoutInput): DeviceLayout {
  if (input.viewKind === 'lyrics') return 'lyrics';
  if (input.viewKind !== 'now-playing') return 'control';

  const width = Math.max(0, input.width);
  const height = Math.max(0, input.height);
  if (height <= 64 || width <= 72) return 'compact';
  if (width < height * 1.35) return 'stacked';
  return 'wide';
}

export function getSetupStepState(status: UiStatus): SetupStepState {
  switch (status) {
    case 'loading':
      return { color: 'info', icon: 'mdi-loading', labelKey: 'working' };
    case 'success':
      return { color: 'success', icon: 'mdi-check-circle', labelKey: 'ready' };
    case 'error':
      return { color: 'warning', icon: 'mdi-alert-circle', labelKey: 'needsAction' };
    default:
      return { color: 'default', icon: 'mdi-circle-outline', labelKey: 'manual' };
  }
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

export function getUnitPixelSize(unit: unknown, metrics: GridMetrics = {}): UnitPixelSize {
  const source = isRecord(unit) && isRecord(unit.geometry) ? unit.geometry : unit;
  const geometry = isRecord(source) ? source : {};
  const gridWidth = positiveNumber(geometry.width, 1);
  const gridHeight = positiveNumber(geometry.height, 1);
  const cellWidth = positiveNumber(metrics.cellWidth, DEFAULT_CELL_WIDTH);
  const cellHeight = positiveNumber(metrics.cellHeight, DEFAULT_CELL_HEIGHT);
  const margin = nonNegativeNumber(metrics.margin, DEFAULT_CELL_MARGIN);

  return {
    width: Math.round(gridWidth * cellWidth + Math.max(0, gridWidth - 1) * margin),
    height: Math.round(gridHeight * cellHeight + Math.max(0, gridHeight - 1) * margin)
  };
}

export function getLyricPositionLimits(size: Partial<UnitPixelSize> | null | undefined): { x: number; y: number } {
  return {
    x: Math.max(1, Math.round(positiveNumber(size?.width, DEFAULT_UNIT_SIZE.width))),
    y: Math.max(1, Math.round(positiveNumber(size?.height, DEFAULT_UNIT_SIZE.height)))
  };
}

export function getLyricTextStyle(input: LyricTextStyleInput): Record<string, string> {
  const align = normalizeAlign(input.align);
  const x = Math.round(nonNegativeNumber(input.x, 0));
  const y = Math.round(nonNegativeNumber(input.y, 0));
  const style: Record<string, string> = {
    color: input.color || '#ffffff',
    textAlign: align,
    bottom: `${y}px`,
    fontSize: `${Math.max(1, Math.round(positiveNumber(input.fontSize, 16)))}px`
  };

  if (align === 'left') {
    return { ...style, left: `${x}px`, right: '0px' };
  }
  if (align === 'center') {
    return { ...style, left: '0px', right: '0px', transform: `translateX(${x}px)` };
  }
  return { ...style, left: '0px', right: `${x}px` };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegativeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function normalizeAlign(value: unknown): AlignOption {
  return value === 'left' || value === 'center' || value === 'right' ? value : 'right';
}
