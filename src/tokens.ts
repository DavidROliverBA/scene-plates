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
  frame: { w: 1280, h: 720, marginX: 70, marginTop: 44, captionBand: 108 },
  // The title sits inside the frame, top left; the scene is fitted underneath it.
  title: { size: 30, y: 54, subSize: 17, subY: 82, band: 78, bandSub: 104, maxChars: 60, subMaxChars: 110 },
  // Callouts are flat boxes that face the viewer, joined to their target by a line.
  callout: { size: 16, lineHeight: 22, padX: 14, padY: 10, wrap: 28, charWidth: 7.9, gap: 60, maxChars: 110 },

  // World units. One unit is one grid square.
  slab: 0.3, // node thickness
  plate: 0.07, // group plate thickness
  platePad: { side: 0.45, back: 0.45, front: 0.62 },
  layerGap: 2.4, // vertical distance between layers
  bandGap: 1.3, // gap between layers when the scene is drawn flat
  arrow: { length: 0.24, half: 0.1 },
  junction: 0.055, // radius of the dot where lines branch or join, in grid units
  icon: { size: 0.46, inset: 0.15, gap: 0.1, stroke: 1.7 }, // icon square on a node's top face
  riserLabel: 0.42, // how far above the lower node a between-layers label sits

  // Text sizes in world units, so text scales with the scene.
  text: { label: 0.2, sub: 0.135, edge: 0.14, plate: 0.15 },
  charWidth: 0.6, // monospace advance, as a fraction of font size
  plateSpacing: 0.06, // extra space between the letters of a plate label
  minScale: 56, // px per unit; below this labels (11px on a 1280 frame, 17px on full HD) are too small for a slide
  maxScale: 125,
  // Level of detail, as fractions of minScale. A big scene seen whole shows its
  // boxes, icons and enlarged area names; words appear as the camera moves in.
  lod: { subFrom: 0.68, labelFrom: 0.5, labelTo: 0.72, plateLabelPx: 13, plateLabelMax: 0.4 },

  font: {
    label: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
    caption: "system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif",
  },
  caption: { size: 25, maxChars: 84 },

  stroke: { edge: 2.4, pulse: 3.6, quiet: 1.5, face: 1, flatNode: 2 },
  dash: { fail: '8 6', quiet: '2 5' },

  // Default camera, and the range in which labels stay readable.
  // persp is 1 / camera distance in grid units: 0 is no perspective, bigger is stronger.
  isometric: { yaw: 45, pitch: 35.264 }, // the one true isometric angle
  camera: { yaw: 0, pitch: 38, zoom: 1, persp: 0.03, yawRange: [-45, 45], pitchRange: [25, 70], zoomRange: [0.6, 4] },

  // Motion. Every move uses these and only these.
  motion: { step: 750, drop: 0.7, pulse: 1700, dim: 0.2, morph: 1400 },

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
