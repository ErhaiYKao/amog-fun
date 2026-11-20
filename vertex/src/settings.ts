// Settings and best times, kept in localStorage under amog.fun's shared-origin convention.
const KEY = 'amog.vertex.v1';

export type Quality = 'low' | 'medium' | 'high';

export interface Save {
  v: 1;
  sens: number;       // multiplier on the base look speed (input.ts)
  fov: number;
  volume: number;
  quality: Quality;
  invertY: boolean;
  autoSprint: boolean;
  hints: boolean;
  fullscreen: boolean;
  bestRun: number | null;        // Tower Run, seconds
  bestSplits: number[];
  bestPractice: number | null;
  summits: number;
}

const DEFAULTS: Save = {
  v: 1, sens: 1, fov: 100, volume: 0.7, quality: 'medium', invertY: false, autoSprint: false, hints: true, fullscreen: true,
  bestRun: null, bestSplits: [], bestPractice: null, summits: 0,
};

export function loadSave(): Save {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw), v: 1 };
  } catch { /* private mode, corrupt save: fall through to defaults */ }
  return { ...DEFAULTS };
}

export function storeSave(s: Save): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage full or blocked: play on without saving */ }
}

export function formatTime(t: number): string {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}
