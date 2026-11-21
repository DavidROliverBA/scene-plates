// The single source of look and feel. Every scene reads this file and nothing
// else decides a colour, a font, a size or a timing. Change the brand here.

export type ThemeName = 'light' | 'dark';

export interface Theme {
  bg: string;
  surface: string; // what top faces are tinted from
  ink: string;
  muted: string;
  plate: string;
  plateStroke: string;
  shade: string; // side faces are mixed towards this
  tint: number; // how much kind colour goes into a top face
  kind: { process: string; gate: string; fail: string; success: string; quiet: string; loop: string };
}

export const tokens = {
  frame: { w: 1280, h: 720, marginX: 70, marginTop: 44, captionBand: 118 },

  // World units. One unit is one grid square.
  slab: 0.3, // node thickness
  plate: 0.07, // group plate thickness
  platePad: { side: 0.45, back: 0.45, front: 0.62 },
  layerGap: 2.4, // vertical distance between layers
  bandGap: 1.3, // gap between layers when the scene is drawn flat
  arrow: { length: 0.24, half: 0.1 },
  riserLabel: 0.42, // how far above the lower node a between-layers label sits

  // Text sizes in world units, so text scales with the scene.
  text: { label: 0.2, sub: 0.135, edge: 0.14, plate: 0.15 },
  charWidth: 0.6, // monospace advance, as a fraction of font size
  plateSpacing: 0.06, // extra space between the letters of a plate label
  minScale: 64, // px per unit; below this labels are too small to read on a slide
  maxScale: 125,

  font: {
    label: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
    caption: "system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif",
  },
  caption: { size: 25, maxChars: 84 },

  stroke: { edge: 2.4, pulse: 3.6, quiet: 1.5, face: 1, flatNode: 2 },
  dash: { fail: '8 6', quiet: '2 5' },

  // Default camera, and the range in which labels stay readable.
  camera: { yaw: 22, pitch: 38, zoom: 1, yawRange: [-45, 45], pitchRange: [25, 70], zoomRange: [0.6, 2.2] },

  // Motion. Every move uses these and only these.
  motion: { step: 750, drop: 0.7, pulse: 1700, dim: 0.2 },

  themes: {
    light: {
      bg: '#F5F7FA', surface: '#FFFFFF', ink: '#14202E', muted: '#4A5A6A',
      plate: '#DDE6EF', plateStroke: '#AEBDCC', shade: '#000000', tint: 0.1,
      kind: { process: '#0B2E59', gate: '#0E7C86', fail: '#D6002A', success: '#1E6B3A', quiet: '#4A5A6A', loop: '#B9750B' },
    },
    dark: {
      bg: '#0D1520', surface: '#121C2A', ink: '#E8EEF5', muted: '#9AA9B8',
      plate: '#1B2838', plateStroke: '#3A4D63', shade: '#0D1520', tint: 0.24,
      kind: { process: '#5B9BE6', gate: '#35BFC9', fail: '#FF5470', success: '#4FC586', quiet: '#8A9AAA', loop: '#E3A23B' },
    },
  } satisfies Record<ThemeName, Theme>,
};
