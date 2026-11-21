// Turns a spec into geometry: boxes for nodes and plates, routed lines for edges.
// Pure and deterministic; no camera here.

import { tokens as T } from './tokens';
import type { EdgeKind, EdgeSpec, GroupSpec, NodeKind, NodeSpec, Spec } from './spec';

export type Vec3 = [number, number, number];
export interface Box { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }
export interface LNode { id: string; spec: NodeSpec; kind: NodeKind; layer: number; box: Box }
export interface LGroup { id: string; spec: GroupSpec; layer: number; box: Box; nodes: string[] }
export interface EdgeLabel { at: Vec3; anchor: 'start' | 'middle' | 'end'; rect: [number, number, number, number] | null }
export interface LEdge {
  id: string; spec: EdgeSpec; kind: EdgeKind; riser: boolean; layer: number;
  pts: Vec3[]; label?: EdgeLabel; problem?: string;
}
export interface Model {
  nodes: LNode[]; byId: Map<string, LNode>; groups: LGroup[]; edges: LEdge[];
  bounds: Box; layers: number[];
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

export function buildModel(spec: Spec): Model {
  const nodes: LNode[] = spec.nodes.map((n) => ({
    id: n.id, spec: n, kind: n.kind ?? 'process', layer: n.layer ?? 0, box: nodeBox(n),
  }));
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const groups: LGroup[] = [];
  for (const g of spec.groups ?? []) {
    const inside = g.contains.map((id) => byId.get(id)).filter((n): n is LNode => !!n);
    if (!inside.length) continue;
    const layer = inside[0].layer, z = layer * T.layerGap, pad = T.platePad;
    groups.push({
      id: g.id, spec: g, layer, nodes: inside.map((n) => n.id),
      box: {
        x0: Math.min(...inside.map((n) => n.box.x0)) - pad.side, x1: Math.max(...inside.map((n) => n.box.x1)) + pad.side,
        y0: Math.min(...inside.map((n) => n.box.y0)) - pad.back, y1: Math.max(...inside.map((n) => n.box.y1)) + pad.front,
        z0: z - T.plate, z1: z,
      },
    });
  }

  const edges: LEdge[] = [];
  for (const e of spec.edges ?? []) {
    const a = byId.get(e.from), b = byId.get(e.to);
    if (!a || !b) continue;
    const base = { id: edgeId(e), spec: e, kind: e.kind ?? ('flow' as EdgeKind) };
    if (a.layer !== b.layer) {
      // Between layers: one vertical line where the two footprints overlap.
      const xLo = Math.max(a.box.x0, b.box.x0), xHi = Math.min(a.box.x1, b.box.x1);
      const yLo = Math.max(a.box.y0, b.box.y0), yHi = Math.min(a.box.y1, b.box.y1);
      const ok = xHi - xLo > 0.2 && yHi - yLo > 0.2;
      const x = (ok ? mid(xLo, xHi) : mid(a.box.x0, a.box.x1)) + (e.offset ?? 0);
      // Near the back edge, so the line does not land on the lower node's label.
      const y = ok ? yLo + 0.14 : mid(a.box.y0, a.box.y1);
      const up = b.layer > a.layer;
      const pts: Vec3[] = [[x, y, up ? a.box.z1 : a.box.z0], [x, y, up ? b.box.z0 : b.box.z1]];
      edges.push({
        ...base, riser: true, layer: Math.max(a.layer, b.layer), pts,
        label: e.label ? { at: [x, y, mid(pts[0][2], pts[1][2])], anchor: e.flip ? 'end' : 'start', rect: null } : undefined,
        problem: ok ? undefined : 'nodes on different layers must sit one above the other to be joined',
      });
      continue;
    }
    const z = a.box.z0 + 0.005;
    const r = routePlan(a.box, b.box, e);
    edges.push({
      ...base, riser: false, layer: a.layer, pts: r.pts.map(([x, y]) => [x, y, z] as Vec3),
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
  const layers = [...new Set(nodes.map((n) => n.layer))].sort((p, q) => p - q);
  return { nodes, byId, groups, edges, bounds, layers };
}
