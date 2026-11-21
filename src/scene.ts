// Camera maths, the state of the scene at each step, and the fixed fit to the frame.

import { tokens as T } from './tokens';
import type { Spec } from './spec';
import { buildModel, type Box, type Model, type Vec3 } from './layout';

export interface Cam { yaw: number; pitch: number; zoom: number; target: string[] | null }
export interface StepState {
  visible: Set<string>; // node ids, plus held edges that have been shown
  focus: Set<string> | null;
  pulse: Set<string>;
  cam: Cam;
  caption: string;
}
export interface Scene {
  spec: Spec; model: Model; states: StepState[];
  fit: { scale: number; anchor: Vec3; anchorScreen: [number, number]; centre: [number, number] };
}

// Parallel projection. x runs right and away, y runs right and towards the viewer, z is up.
export function view(yawDeg: number, pitchDeg: number) {
  const t = (yawDeg * Math.PI) / 180, p = (pitchDeg * Math.PI) / 180;
  const ct = Math.cos(t), st = Math.sin(t), sp = Math.sin(p), cp = Math.cos(p);
  return {
    st,
    ux: [ct, -st * sp] as [number, number],
    uy: [st, ct * sp] as [number, number],
    p: ([x, y, z]: Vec3): [number, number] => [x * ct + y * st, (-x * st + y * ct) * sp - z * cp],
    far: ([x, y, z]: Vec3) => -(-x * st + y * ct) * cp - z * sp, // bigger is further away
  };
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

function baseCam(spec: Spec): Cam {
  return {
    yaw: spec.camera?.yaw ?? T.camera.yaw, pitch: spec.camera?.pitch ?? T.camera.pitch,
    zoom: spec.camera?.zoom ?? T.camera.zoom, target: spec.camera?.target ?? null,
  };
}

export function buildStates(spec: Spec, model: Model): StepState[] {
  const groupNodes = new Map(model.groups.map((g) => [g.id, g.nodes]));
  const expand = (ids: string[] = []) => ids.flatMap((id) => groupNodes.get(id) ?? [id]);
  const steps = spec.steps ?? [];
  if (!steps.length) {
    return [{
      visible: new Set([...model.nodes.map((n) => n.id), ...model.edges.map((e) => e.id)]),
      focus: null, pulse: new Set(), cam: baseCam(spec), caption: '',
    }];
  }
  const out: StepState[] = [];
  const visible = new Set<string>();
  let cam = baseCam(spec);
  for (const s of steps) {
    for (const id of expand(s.show)) visible.add(id);
    for (const id of expand(s.hide)) visible.delete(id);
    if (s.camera) {
      cam = {
        yaw: s.camera.yaw ?? cam.yaw, pitch: s.camera.pitch ?? cam.pitch, zoom: s.camera.zoom ?? cam.zoom,
        target: s.camera.target === undefined ? cam.target : s.camera.target,
      };
    }
    out.push({
      visible: new Set(visible), focus: s.focus ? new Set(expand(s.focus)) : null,
      pulse: new Set(s.pulse ?? []), cam, caption: s.caption ?? '',
    });
  }
  return out;
}

export function compile(spec: Spec): Scene {
  const model = buildModel(spec);
  const states = buildStates(spec, model);
  // Fit the whole scene once, at the base camera. The scale never changes after
  // that except by an explicit zoom, so nothing "breathes" as the camera turns.
  const cam = baseCam(spec), v = view(cam.yaw, cam.pitch), F = T.frame;
  const pts = corners(model.bounds).map(v.p);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const bw = Math.max(Math.max(...xs) - Math.min(...xs), 0.001), bh = Math.max(Math.max(...ys) - Math.min(...ys), 0.001);
  const availW = F.w - 2 * F.marginX, availH = F.h - F.marginTop - F.captionBand;
  const scale = Math.min(availW / bw, availH / bh, T.maxScale);
  const mid: [number, number] = [F.w / 2, F.marginTop + availH / 2];
  const anchor = centre(model.bounds), pa = v.p(anchor);
  const c2: [number, number] = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  return {
    spec, model, states,
    fit: { scale, anchor, centre: mid, anchorScreen: [mid[0] - scale * (c2[0] - pa[0]), mid[1] - scale * (c2[1] - pa[1])] },
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
