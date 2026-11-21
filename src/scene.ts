// Camera maths, the state of the scene at each step, and the fixed fit to the frame.

import { tokens as T } from './tokens';
import type { Spec, View } from './spec';
import { buildModel, type Box, type LCallout, type Model, type Vec3 } from './layout';

export interface Cam { yaw: number; pitch: number; zoom: number; persp: number; target: string[] | null }
export interface StepState {
  visible: Set<string>; // node ids, plus held edges that have been shown
  focus: Set<string> | null;
  pulse: Set<string>;
  callout: Set<string>;
  cam: Cam;
  caption: string;
}
export interface Scene {
  spec: Spec; model: Model; states: StepState[]; showTitle: boolean; view: View;
  fit: { scale: number; anchor: Vec3; anchorScreen: [number, number]; centre: [number, number] };
}

// Parallel projection. x runs right and away, y runs right and towards the viewer, z is up.
export function view(yawDeg: number, pitchDeg: number) {
  return view_(yawDeg, pitchDeg);
}
function view_(yawDeg: number, pitchDeg: number) {
  const t = (yawDeg * Math.PI) / 180, p = (pitchDeg * Math.PI) / 180;
  const ct = Math.cos(t), st = Math.sin(t), sp = Math.sin(p), cp = Math.cos(p);
  return {
    st, ct, cot: cp / sp,
    ux: [ct, -st * sp] as [number, number],
    uy: [st, ct * sp] as [number, number],
    p: ([x, y, z]: Vec3): [number, number] => [x * ct + y * st, (-x * st + y * ct) * sp - z * cp],
    far: ([x, y, z]: Vec3) => -(-x * st + y * ct) * cp - z * sp, // bigger is further away
  };
}

// A camera looking at an anchor point. r() gives a point's place relative to the
// anchor, in grid units on screen; k() is how much perspective shrinks or grows
// things at that point (always 1 with no perspective).
export function lens(cam: { yaw: number; pitch: number; persp: number }, anchor: Vec3) {
  const v = view_(cam.yaw, cam.pitch), pa = v.p(anchor), fa = v.far(anchor);
  const k = (p: Vec3) => 1 / Math.max(0.3, 1 + cam.persp * (v.far(p) - fa));
  const r = (p: Vec3): [number, number] => { const q = v.p(p), s = k(p); return [(q[0] - pa[0]) * s, (q[1] - pa[1]) * s]; };
  return { v, k, r };
}

export const corners = (b: Box): Vec3[] =>
  [b.x0, b.x1].flatMap((x) => [b.y0, b.y1].flatMap((y) => [b.z0, b.z1].map((z) => [x, y, z] as Vec3)));
export const centre = (b: Box): Vec3 => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2];

export function targetPoint(model: Model, ids: string[]): Vec3 | null {
  const boxes = ids.flatMap((id) => {
    const n = model.byId.get(id);
    if (n) return [n.box];
    const g = model.groups.find((x) => x.id === id);
    return g ? [g.box] : [];
  });
  if (!boxes.length) return null;
  const pts = boxes.flatMap(corners);
  const span = (i: 0 | 1 | 2) => (Math.min(...pts.map((p) => p[i])) + Math.max(...pts.map((p) => p[i]))) / 2;
  return [span(0), span(1), span(2)];
}

// Only the 3d view lets the spec turn and tilt the camera; iso and flat are fixed by definition.
const fixed = (view: View) => (view === 'flat' ? { yaw: 0, pitch: 90 } : view === 'iso' ? T.isometric : null);
function baseCam(spec: Spec, view: View): Cam {
  const f = fixed(view);
  return {
    yaw: f?.yaw ?? spec.camera?.yaw ?? T.camera.yaw, pitch: f?.pitch ?? spec.camera?.pitch ?? T.camera.pitch,
    zoom: spec.camera?.zoom ?? T.camera.zoom, persp: f ? 0 : T.camera.persp, target: spec.camera?.target ?? null,
  };
}

export function buildStates(spec: Spec, model: Model): StepState[] {
  const groupNodes = new Map(model.groups.map((g) => [g.id, g.nodes]));
  const expand = (ids: string[] = []) => ids.flatMap((id) => groupNodes.get(id) ?? [id]);
  const steps = spec.steps ?? [];
  if (!steps.length) {
    return [{
      visible: new Set([...model.nodes.map((n) => n.id), ...model.edges.map((e) => e.id)]),
      focus: null, pulse: new Set(), callout: new Set(model.callouts.map((c) => c.id)), cam: baseCam(spec, model.view), caption: '',
    }];
  }
  const out: StepState[] = [];
  const visible = new Set<string>();
  let cam = baseCam(spec, model.view);
  const f = fixed(model.view);
  for (const s of steps) {
    for (const id of expand(s.show)) visible.add(id);
    for (const id of expand(s.hide)) visible.delete(id);
    if (s.camera) {
      cam = {
        // Fixed views ignore turning and tilting; zoom and target still apply.
        ...cam, yaw: f?.yaw ?? s.camera.yaw ?? cam.yaw, pitch: f?.pitch ?? s.camera.pitch ?? cam.pitch, zoom: s.camera.zoom ?? cam.zoom,
        target: s.camera.target === undefined ? cam.target : s.camera.target,
      };
    }
    out.push({
      visible: new Set(visible), focus: s.focus ? new Set(expand(s.focus)) : null,
      pulse: new Set(s.pulse ?? []), callout: new Set(s.callout ?? []), cam, caption: s.caption ?? '',
    });
  }
  return out;
}

export function compile(spec: Spec, view?: View, showTitle = true): Scene {
  const model = buildModel(spec, view);
  const states = buildStates(spec, model);
  // Fit the whole scene once. The scale never changes after that except by an
  // explicit zoom, so nothing "breathes" as the camera turns.
  const cam = baseCam(spec, model.view), F = T.frame;
  const top = showTitle && spec.title ? (spec.subtitle ? T.title.bandSub : T.title.band) : F.marginTop;
  const availW = F.w - 2 * F.marginX, availH = F.h - top - F.captionBand;
  const anchor = centre(model.bounds);
  const box = (c: Cam) => {
    const q = corners(model.bounds).map(lens(c, anchor).r), x = q.map((p) => p[0]), y = q.map((p) => p[1]);
    return { x0: Math.min(...x), x1: Math.max(...x), y0: Math.min(...y), y1: Math.max(...y) };
  };
  // The scale that still fits at every camera angle the steps use.
  const scale = Math.min(T.maxScale, ...[cam, ...states.map((s) => s.cam)].map((c) => { const b = box(c); return Math.min(availW / Math.max(b.x1 - b.x0, 0.001), availH / Math.max(b.y1 - b.y0, 0.001)); }));
  const mid: [number, number] = [F.w / 2, top + availH / 2], b0 = box(cam);
  return {
    spec, model, states, showTitle, view: model.view,
    fit: { scale, anchor, centre: mid, anchorScreen: [mid[0] - scale * (b0.x0 + b0.x1) / 2, mid[1] - scale * (b0.y0 + b0.y1) / 2] },
  };
}

// How solid each thing is in a given state: 0 hidden, dim when out of focus, 1 shown.
export function alphas(scene: Scene, s: StepState | null) {
  const { model } = scene, dim = T.motion.dim;
  const node = (id: string) => (!s || !s.visible.has(id) ? 0 : s.focus && !s.focus.has(id) ? dim : 1);
  const edge = (id: string) => {
    const e = model.edges.find((x) => x.id === id)!;
    if (!s || !s.visible.has(e.spec.from) || !s.visible.has(e.spec.to)) return 0;
    if (e.spec.hold && !s.visible.has(id)) return 0;
    if (!s.focus) return 1;
    return s.focus.has(id) || s.pulse.has(id) || (s.focus.has(e.spec.from) && s.focus.has(e.spec.to)) ? 1 : dim;
  };
  const group = (id: string) => {
    const g = model.groups.find((x) => x.id === id)!;
    if (!s || !g.nodes.some((n) => s.visible.has(n))) return 0;
    return s.focus && !g.nodes.some((n) => s.focus!.has(n)) ? dim : 1;
  };
  return { node, edge, group };
}

// Where the whole scene lands on screen for a camera with no target: [left, top, right, bottom].
export function frameBox(scene: Scene, cam: Cam): [number, number, number, number] {
  const L = lens(cam, scene.fit.anchor), S = scene.fit.scale * cam.zoom, AS = scene.fit.anchorScreen;
  const q = corners(scene.model.bounds).map((c) => { const r = L.r(c); return [AS[0] + S * r[0], AS[1] + S * r[1]]; });
  return [Math.min(...q.map((p) => p[0])), Math.min(...q.map((p) => p[1])), Math.max(...q.map((p) => p[0])), Math.max(...q.map((p) => p[1]))];
}

// World point to frame pixels for a settled camera.
export function projector(scene: Scene, cam: Cam) {
  const t = cam.target ? targetPoint(scene.model, cam.target) : null;
  const L = lens(cam, t ?? scene.fit.anchor), AS = t ? scene.fit.centre : scene.fit.anchorScreen, S = scene.fit.scale * cam.zoom;
  const P = (p: Vec3): [number, number] => { const r = L.r(p); return [AS[0] + S * r[0], AS[1] + S * r[1]]; };
  // scaleAt: pixels per grid unit at that point, which decides whether its words can be read.
  return Object.assign(P, { scaleAt: (p: Vec3) => S * L.k(p) });
}

export function wrapText(text: string, max: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && (line + ' ' + word).length > max) { lines.push(line); line = word; } else line = line ? line + ' ' + word : word;
  }
  if (line) lines.push(line);
  return lines;
}

// A callout's box in frame pixels, given where its anchor lands: the box, its lines, and where the joining line ends.
export function calloutBox(c: LCallout, a: [number, number]) {
  const K = T.callout, lines = wrapText(c.spec.text, K.wrap), gap = c.spec.gap ?? K.gap;
  const w = Math.max(...lines.map((l) => l.length), 4) * K.charWidth + 2 * K.padX, h = lines.length * K.lineHeight + 2 * K.padY;
  const F = T.frame, edge = 14;
  const slide = (v: number, size: number, max: number) => Math.min(Math.max(v, edge), Math.max(edge, max - edge - size));
  // A box above or below its target slides sideways to stay in the frame; its line still meets the target.
  const x = c.side === 'left' ? a[0] - gap - w : c.side === 'right' ? a[0] + gap : slide(a[0] - w / 2, w, F.w);
  const y = c.side === 'up' ? a[1] - gap - h : c.side === 'down' ? a[1] + gap : a[1] - h / 2;
  const meet = Math.min(Math.max(a[0], x + 14), x + w - 14);
  const end: [number, number] = c.side === 'up' ? [meet, y + h] : c.side === 'down' ? [meet, y] : c.side === 'left' ? [x + w, a[1]] : [x, a[1]];
  return { x, y, w, h, lines, end };
}
