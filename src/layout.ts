// Turns a spec into geometry: boxes for nodes and plates, routed lines for edges.
// Pure and deterministic; no camera here.

import { tokens as T } from './tokens';
import type { CalloutSpec, EdgeKind, EdgeSpec, GroupSpec, NodeKind, NodeSpec, Spec, View } from './spec';

export type Vec3 = [number, number, number];
export interface Box { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }
// "plane" is what gets drawn and checked together: the layer in the 3D view, one shared plane when flat.
export interface LNode { id: string; spec: NodeSpec; kind: NodeKind; layer: number; plane: number; box: Box }
export interface LGroup { id: string; spec: GroupSpec; layer: number; plane: number; box: Box; nodes: string[]; groups: string[]; depth: number }
export interface EdgeLabel { at: Vec3; anchor: 'start' | 'middle' | 'end'; rect: [number, number, number, number] | null }
export interface LEdge {
  id: string; spec: EdgeSpec; kind: EdgeKind; riser: boolean; layer: number; plane: number;
  pts: Vec3[]; label?: EdgeLabel; problem?: string;
  shape: RouteShape;
}
// straight: one segment. L: one bend. Z: two bends, in one side and out the
// opposite. U: two bends, out and back the same way round an obstacle. riser: between layers.
export type RouteShape = 'straight' | 'L' | 'Z' | 'U' | 'riser';
export interface LCallout { id: string; spec: CalloutSpec; anchor: Vec3; side: 'up' | 'down' | 'left' | 'right' }
// Where one line branches off, or joins, another: drawn as a dot so a join is never mistaken for a crossing.
export interface LJunction { at: Vec3; plane: number; edges: [string, string] }
export interface Model {
  callouts: LCallout[];
  junctions: LJunction[];
  nodes: LNode[]; byId: Map<string, LNode>; groups: LGroup[]; edges: LEdge[];
  bounds: Box; planes: number[]; flat: boolean; view: View;
}

// Where the words go on a node's top face, and how much room they have.
export function textArea(n: LNode): { cx: number; room: number; iconAt: [number, number] | null } {
  const b = n.box, round = n.spec.shape === 'cylinder' ? 0.08 : 0, I = T.icon;
  if (!n.spec.icon) return { cx: (b.x0 + b.x1) / 2, room: (b.x1 - b.x0 - 0.24) * (round ? 0.9 : 1), iconAt: null };
  const left = b.x0 + I.inset + round, from = left + I.size + I.gap, to = b.x1 - 0.12 - round;
  return { cx: (from + to) / 2, room: to - from, iconAt: [left, (b.y0 + b.y1) / 2 - I.size / 2] };
}

export const edgeId = (e: EdgeSpec) => e.id ?? `${e.from}>${e.to}`;
const mid = (a: number, b: number) => (a + b) / 2;

function nodeBox(n: NodeSpec): Box {
  const [w, d] = n.size ?? [2, 1];
  const z0 = (n.layer ?? 0) * T.layerGap;
  return { x0: n.at[0], x1: n.at[0] + w, y0: n.at[1], y1: n.at[1] + d, z0, z1: z0 + T.slab };
}

type P2 = [number, number];

// Route between two boxes on the same layer, as right-angled segments on the floor.
function routePlan(a: Box, b: Box, e: EdgeSpec): { pts: P2[]; problem?: string } {
  const off = e.offset ?? 0;
  const acx = mid(a.x0, a.x1), acy = mid(a.y0, a.y1), bcx = mid(b.x0, b.x1), bcy = mid(b.y0, b.y1);
  const xLo = Math.max(a.x0, b.x0), xHi = Math.min(a.x1, b.x1);
  const yLo = Math.max(a.y0, b.y0), yHi = Math.min(a.y1, b.y1);
  const shareX = xHi - xLo > 0.2, shareY = yHi - yLo > 0.2;
  if (shareX && shareY) return { pts: [[acx, acy], [bcx, bcy]], problem: 'the two nodes overlap' };

  if (!e.via) {
    if (shareX) {
      const x = mid(xLo, xHi) + off;
      return { pts: b.y0 >= a.y1 ? [[x, a.y1], [x, b.y0]] : [[x, a.y0], [x, b.y1]] };
    }
    if (shareY) {
      const y = mid(yLo, yHi) + off;
      return { pts: b.x0 >= a.x1 ? [[a.x1, y], [b.x0, y]] : [[a.x0, y], [b.x1, y]] };
    }
  }
  const via = e.via ?? 'x';
  const right = bcx >= acx, down = bcy >= acy;
  const ax = right ? a.x1 : a.x0, bxIn = right ? b.x0 : b.x1;
  const ay = down ? a.y1 : a.y0, byIn = down ? b.y0 : b.y1;

  if (via === 'x') {
    if (shareX) {
      // Same column: go round the side in a U.
      const ch = e.channel ?? Math.max(a.x1, b.x1) + 0.7;
      const sa = ch >= acx ? a.x1 : a.x0, sb = ch >= bcx ? b.x1 : b.x0;
      return { pts: [[sa, acy + off], [ch, acy + off], [ch, bcy + off], [sb, bcy + off]] };
    }
    const ch = e.channel ?? mid(ax, bxIn);
    return { pts: [[ax, acy + off], [ch, acy + off], [ch, bcy + off], [bxIn, bcy + off]] };
  }
  if (via === 'y') {
    if (shareY) {
      // Same row: go round the front or back in a U.
      const ch = e.channel ?? Math.max(a.y1, b.y1) + 0.7;
      const sa = ch >= acy ? a.y1 : a.y0, sb = ch >= bcy ? b.y1 : b.y0;
      return { pts: [[acx + off, sa], [acx + off, ch], [bcx + off, ch], [bcx + off, sb]] };
    }
    const ch = e.channel ?? mid(ay, byIn);
    return { pts: [[acx + off, ay], [acx + off, ch], [bcx + off, ch], [bcx + off, byIn]] };
  }
  if (via === 'xy') {
    if (shareX || shareY) return { pts: [[acx, acy], [bcx, bcy]], problem: 'via "xy" needs the nodes on different rows and columns' };
    return { pts: [[ax, acy + off], [bcx + off, acy + off], [bcx + off, byIn]] };
  }
  if (shareX || shareY) return { pts: [[acx, acy], [bcx, bcy]], problem: 'via "yx" needs the nodes on different rows and columns' };
  return { pts: [[acx + off, ay], [acx + off, bcy + off], [bxIn, bcy + off]] };
}

function shapeOf(pts: P2[]): RouteShape {
  if (pts.length <= 2) return 'straight';
  if (pts.length === 3) return 'L';
  const n = pts.length, first = [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]], last = [pts[n - 1][0] - pts[n - 2][0], pts[n - 1][1] - pts[n - 2][1]];
  return first[0] * last[0] + first[1] * last[1] > 0 ? 'Z' : 'U';
}

function planLabel(pts: P2[], z: number, e: EdgeSpec): EdgeLabel | undefined {
  if (!e.label) return undefined;
  let best = 0, bestLen = -1;
  for (let i = 0; i < pts.length - 1; i++) {
    const len = Math.abs(pts[i + 1][0] - pts[i][0]) + Math.abs(pts[i + 1][1] - pts[i][1]);
    if (len > bestLen + 1e-6) { bestLen = len; best = i; }
  }
  const [p, q] = [pts[best], pts[best + 1]];
  const size = T.text.edge, w = e.label.length * T.charWidth * size;
  const mx = mid(p[0], q[0]), my = mid(p[1], q[1]);
  if (Math.abs(q[0] - p[0]) >= Math.abs(q[1] - p[1])) {
    const base = e.flip ? my + 0.1 + size : my - 0.14; // above the line by default
    return { at: [mx, base, z], anchor: 'middle', rect: [mx - w / 2, base - size, mx + w / 2, base] };
  }
  const base = my + size * 0.35;
  return e.flip
    ? { at: [mx - 0.13, base, z], anchor: 'end', rect: [mx - 0.13 - w, base - size, mx - 0.13, base] }
    : { at: [mx + 0.13, base, z], anchor: 'start', rect: [mx + 0.13, base - size, mx + 0.13 + w, base] };
}

export function buildModel(spec: Spec, view: View = spec.view ?? '3d'): Model {
  const flat = view === 'flat';
  const nodes: LNode[] = spec.nodes.map((n) => ({
    id: n.id, spec: n, kind: n.kind ?? 'process', layer: n.layer ?? 0, plane: flat ? 0 : n.layer ?? 0, box: nodeBox(n),
  }));
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Plates. A group may contain other groups; the outer plate sits just below the inner one.
  const gspec = new Map((spec.groups ?? []).map((g) => [g.id, g]));
  const done = new Map<string, LGroup | null>();
  const resolve = (id: string, trail: Set<string>): LGroup | null => {
    if (done.has(id)) return done.get(id)!;
    const g = gspec.get(id);
    if (!g || trail.has(id)) return null;
    trail.add(id);
    const boxes: Box[] = [], ns: string[] = [], gs: string[] = [];
    let depth = 0, layer = -1;
    for (const c of g.contains ?? []) {
      const n = byId.get(c);
      if (n) { boxes.push(n.box); ns.push(n.id); if (layer < 0) layer = n.layer; continue; }
      const sub = resolve(c, trail);
      if (sub) { boxes.push(sub.box); ns.push(...sub.nodes); gs.push(sub.id, ...sub.groups); depth = Math.max(depth, sub.depth + 1); if (layer < 0) layer = sub.layer; }
    }
    trail.delete(id);
    let out: LGroup | null = null;
    if (boxes.length) {
      const pad = T.platePad, z1 = layer * T.layerGap - depth * T.plate;
      out = {
        id, spec: g, layer, plane: flat ? 0 : layer, nodes: ns, groups: gs, depth,
        box: {
          x0: Math.min(...boxes.map((b) => b.x0)) - pad.side, x1: Math.max(...boxes.map((b) => b.x1)) + pad.side,
          y0: Math.min(...boxes.map((b) => b.y0)) - pad.back, y1: Math.max(...boxes.map((b) => b.y1)) + pad.front,
          z0: z1 - T.plate, z1,
        },
      };
    }
    done.set(id, out);
    return out;
  };
  const groups = [...gspec.keys()].map((id) => resolve(id, new Set())).filter((g): g is LGroup => !!g);

  const shifts = new Map<number, number>(); // how far each layer moved when laid out flat
  if (flat) {
    // Seen from above, layers cannot stack, so each becomes a band: top layer at the top.
    const layerIds = [...new Set(nodes.map((n) => n.layer))].sort((p, q) => q - p);
    let cursor = 0;
    for (const L of layerIds) {
      const boxes = [...nodes.filter((n) => n.layer === L).map((n) => n.box), ...groups.filter((g) => g.layer === L).map((g) => g.box)];
      const shift = cursor - Math.min(...boxes.map((b) => b.y0));
      cursor = Math.max(...boxes.map((b) => b.y1)) + shift + T.bandGap;
      for (const b of boxes) { b.y0 += shift; b.y1 += shift; }
      shifts.set(L, shift);
    }
    for (const n of nodes) { n.box.z0 = 0; n.box.z1 = T.slab; }
    for (const g of groups) { g.box.z1 = -g.depth * T.plate; g.box.z0 = g.box.z1 - T.plate; }
  }

  const edges: LEdge[] = [];
  for (const e of spec.edges ?? []) {
    const a = byId.get(e.from), b = byId.get(e.to);
    if (!a || !b) continue;
    const base = { id: edgeId(e), spec: e, kind: e.kind ?? ('flow' as EdgeKind) };
    const xLo = Math.max(a.box.x0, b.box.x0), xHi = Math.min(a.box.x1, b.box.x1);
    if (a.layer !== b.layer && !flat) {
      // Between layers: one vertical line where the two footprints overlap.
      const yLo = Math.max(a.box.y0, b.box.y0), yHi = Math.min(a.box.y1, b.box.y1);
      const ok = xHi - xLo > 0.2 && yHi - yLo > 0.2;
      const x = (ok ? mid(xLo, xHi) : mid(a.box.x0, a.box.x1)) + (e.offset ?? 0);
      // Near the back edge, so the line does not land on the lower node's label.
      const y = ok ? yLo + 0.14 : mid(a.box.y0, a.box.y1);
      const up = b.layer > a.layer;
      const pts: Vec3[] = [[x, y, up ? a.box.z1 : a.box.z0], [x, y, up ? b.box.z0 : b.box.z1]];
      const top = Math.max(a.layer, b.layer);
      edges.push({
        ...base, riser: true, shape: 'riser', layer: top, plane: top, pts,
        // Just above the lower node, clear of the upper layer's plate and its name.
        label: e.label ? { at: [x, y, Math.min(pts[0][2], pts[1][2]) + T.riserLabel], anchor: e.flip ? 'start' : 'end', rect: null } : undefined,
        problem: ok ? undefined : 'nodes on different layers must sit one above the other to be joined',
      });
      continue;
    }
    // On one plane. When flat, a line between bands leaves by the top or bottom unless told otherwise.
    const between = a.layer !== b.layer && !e.via && xHi - xLo <= 0.2;
    const z = a.box.z0 + 0.005;
    const via = between ? 'y' : e.via;
    // A row channel is written in the layer's own rows, so it moves with the layer.
    const channel = e.channel !== undefined && via === 'y' ? e.channel + (shifts.get(a.layer) ?? 0) : e.channel;
    const r = routePlan(a.box, b.box, { ...e, via, channel });
    edges.push({
      ...base, riser: false, shape: shapeOf(r.pts), layer: a.layer, plane: flat ? 0 : a.layer, pts: r.pts.map(([x, y]) => [x, y, z] as Vec3),
      label: planLabel(r.pts, z, e), problem: r.problem,
    });
  }

  const all = [...nodes.map((n) => n.box), ...groups.map((g) => g.box)];
  const pick = (f: (b: Box) => number, m: (...v: number[]) => number) => (all.length ? m(...all.map(f)) : 0);
  const bounds: Box = {
    x0: pick((b) => b.x0, Math.min), x1: pick((b) => b.x1, Math.max),
    y0: pick((b) => b.y0, Math.min), y1: pick((b) => b.y1, Math.max),
    z0: pick((b) => b.z0, Math.min), z1: pick((b) => b.z1, Math.max),
  };
  const planes = [...new Set(nodes.map((n) => n.plane))].sort((p, q) => p - q);
  const callouts: LCallout[] = [];
  for (const c of spec.callouts ?? []) {
    const b = byId.get(c.on)?.box ?? groups.find((g) => g.id === c.on)?.box;
    if (!b) continue;
    const side = c.side ?? 'up', cx = mid(b.x0, b.x1), cy = mid(b.y0, b.y1);
    const anchor: Vec3 = side === 'up' ? [cx, b.y0, b.z1] : side === 'down' ? [cx, b.y1, b.z0] : side === 'left' ? [b.x0, cy, b.z1] : [b.x1, cy, b.z1];
    callouts.push({ id: c.id, spec: c, anchor, side });
  }
  const junctions: LJunction[] = [];
  const flatEdges = edges.filter((e) => !e.riser && !e.problem), near = (p: number, q: number) => Math.abs(p - q) < 0.02;
  for (let i = 0; i < flatEdges.length; i++) for (let j = 0; j < flatEdges.length; j++) {
    const [a, b] = [flatEdges[i], flatEdges[j]];
    if (i === j || a.plane !== b.plane) continue;
    // An end or a bend of line a that lands part-way along a segment of line b.
    for (const p of a.pts) for (let k = 0; k < b.pts.length - 1; k++) {
      const [s, t] = [b.pts[k], b.pts[k + 1]];
      const along = near(s[1], t[1]) && near(p[1], s[1]) && p[0] > Math.min(s[0], t[0]) + 0.03 && p[0] < Math.max(s[0], t[0]) - 0.03;
      const up = near(s[0], t[0]) && near(p[0], s[0]) && p[1] > Math.min(s[1], t[1]) + 0.03 && p[1] < Math.max(s[1], t[1]) - 0.03;
      const atBox = [a.spec.from, a.spec.to].some((id) => { const n = byId.get(id)!.box; return p[0] > n.x0 - 0.02 && p[0] < n.x1 + 0.02 && p[1] > n.y0 - 0.02 && p[1] < n.y1 + 0.02; });
      if ((along || up) && !atBox && !junctions.some((q) => near(q.at[0], p[0]) && near(q.at[1], p[1]) && q.plane === a.plane)) junctions.push({ at: p, plane: a.plane, edges: [a.id, b.id] });
    }
  }
  return { nodes, byId, groups, edges, bounds, planes, flat, view, callouts, junctions };
}
