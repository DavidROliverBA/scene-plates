// Refuses specs that would draw badly. Returns a list of plain-English problems;
// an empty list means the scene is safe to render.

import { tokens as T } from './tokens';
import { EDGE_KINDS, NODE_KINDS, type CameraSpec, type Spec, type View } from './spec';
import { edgeId, type Box, type LEdge } from './layout';
import { compile, frameBox } from './scene';

type Rect = [number, number, number, number];
const EPS = 0.02;
const inRange = (v: number, [lo, hi]: number[]) => v >= lo && v <= hi;
const rectsOverlap = (a: Rect, b: Rect) => a[0] < b[2] - EPS && b[0] < a[2] - EPS && a[1] < b[3] - EPS && b[1] < a[3] - EPS;
const foot = (b: Box): Rect => [b.x0, b.y0, b.x1, b.y1];

type Seg = { x0: number; y0: number; x1: number; y1: number; horiz: boolean };
const segs = (e: LEdge): Seg[] =>
  e.pts.slice(1).map((p, i) => {
    const q = e.pts[i];
    return { x0: Math.min(p[0], q[0]), x1: Math.max(p[0], q[0]), y0: Math.min(p[1], q[1]), y1: Math.max(p[1], q[1]), horiz: Math.abs(p[1] - q[1]) < 1e-6 };
  });
const segHitsRect = (s: Seg, r: Rect) => s.x0 < r[2] - EPS && s.x1 > r[0] + EPS && s.y0 < r[3] - EPS && s.y1 > r[1] + EPS;

// 'cross' when two segments cut through each other, 'touch' when they share a
// stretch or meet at a T, null when they are clear of each other.
function meet(a: Seg, b: Seg): 'cross' | 'touch' | null {
  if (a.horiz === b.horiz) {
    const same = a.horiz ? Math.abs(a.y0 - b.y0) < EPS : Math.abs(a.x0 - b.x0) < EPS;
    if (!same) return null;
    const lap = a.horiz ? Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) : Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    return lap > EPS ? 'touch' : null;
  }
  const [h, v] = a.horiz ? [a, b] : [b, a];
  if (v.x0 < h.x0 - EPS || v.x0 > h.x1 + EPS || h.y0 < v.y0 - EPS || h.y0 > v.y1 + EPS) return null;
  const insideH = v.x0 > h.x0 + EPS && v.x0 < h.x1 - EPS, insideV = h.y0 > v.y0 + EPS && h.y0 < v.y1 - EPS;
  if (insideH && insideV) return 'cross';
  return insideH || insideV ? 'touch' : null; // corner to corner is fine
}

export function validate(spec: Spec, view?: View): string[] {
  const errs: string[] = [];
  const bad = (m: string) => { errs.push(m); };

  // --- Structure ---------------------------------------------------------
  if (!spec || typeof spec !== 'object') return ['The spec must be a JSON object.'];
  if (!spec.title) bad('Add a "title".');
  if (!spec.description || spec.description.length < 20) bad('Add a "description" of at least 20 characters saying what the diagram shows; screen readers read it out.');
  if (!Array.isArray(spec.nodes) || !spec.nodes.length) return [...errs, 'Add at least one node.'];

  const ids = new Set<string>();
  const claim = (id: string, what: string) => {
    if (!id || !/^[A-Za-z][\w-]*$/.test(id)) bad(`${what} id "${id}" must start with a letter and use only letters, digits, - and _.`);
    else if (ids.has(id)) bad(`Id "${id}" is used more than once.`);
    ids.add(id);
  };
  const nodeIds = new Set<string>(), layerOf = new Map<string, number>();
  for (const n of spec.nodes) {
    claim(n.id, 'Node');
    nodeIds.add(n.id);
    layerOf.set(n.id, n.layer ?? 0);
    if (!n.label) bad(`Node "${n.id}" needs a label.`);
    if (!Array.isArray(n.at) || n.at.length !== 2 || n.at.some((v) => typeof v !== 'number')) bad(`Node "${n.id}" needs "at": [column, row].`);
    if (n.size && (n.size.length !== 2 || n.size.some((v) => typeof v !== 'number' || v < 1))) bad(`Node "${n.id}" size must be [width, depth], each at least 1.`);
    if (n.kind && !NODE_KINDS.includes(n.kind)) bad(`Node "${n.id}" has kind "${n.kind}"; use one of ${NODE_KINDS.join(', ')}.`);
    if (n.layer !== undefined && (!Number.isInteger(n.layer) || n.layer < 0)) bad(`Node "${n.id}" layer must be a whole number, 0 or more.`);
  }
  if (spec.view && spec.view !== 'iso' && spec.view !== 'flat') bad(`"view" must be "iso" or "flat".`);
  const groupIds = new Set((spec.groups ?? []).map((g) => g.id)), parent = new Map<string, string>();
  for (const g of spec.groups ?? []) {
    claim(g.id, 'Group');
    if (!g.contains?.length) { bad(`Group "${g.id}" contains nothing.`); continue; }
    for (const id of g.contains) {
      if (!nodeIds.has(id) && !groupIds.has(id)) bad(`Group "${g.id}" contains "${id}", which is not a node or group.`);
      else if (parent.has(id)) bad(`"${id}" is in more than one group ("${parent.get(id)}" and "${g.id}").`);
      parent.set(id, g.id);
    }
  }
  for (const g of spec.groups ?? []) {
    const seen = new Set([g.id]);
    for (let p = parent.get(g.id); p; p = parent.get(p)) {
      if (seen.has(p)) { bad(`Group "${g.id}" ends up containing itself.`); break; }
      seen.add(p);
    }
  }
  const edgeIds = new Set<string>();
  for (const e of spec.edges ?? []) {
    const id = edgeId(e);
    if (e.id) claim(e.id, 'Edge');
    else if (ids.has(id)) bad(`There are two edges "${id}"; give one an "id".`);
    else ids.add(id);
    edgeIds.add(id);
    for (const end of [e.from, e.to]) if (!nodeIds.has(end)) bad(`Edge "${id}" points at "${end}", which is not a node.`);
    if (e.from === e.to) bad(`Edge "${id}" joins a node to itself.`);
    if (e.kind && !EDGE_KINDS.includes(e.kind)) bad(`Edge "${id}" has kind "${e.kind}"; use one of ${EDGE_KINDS.join(', ')}.`);
    if (e.kind === 'loop' && !e.label) bad(`Loop edge "${id}" needs a label that states its cap, such as "max 3 tries".`);
    if (e.via && !['x', 'y', 'xy', 'yx'].includes(e.via)) bad(`Edge "${id}" via must be x, y, xy or yx.`);
  }
  const checkCam = (c: CameraSpec | undefined, where: string) => {
    if (!c) return;
    if (c.yaw !== undefined && !inRange(c.yaw, T.camera.yawRange)) bad(`${where}: yaw ${c.yaw} is outside ${T.camera.yawRange.join(' to ')}; labels stop being readable.`);
    if (c.pitch !== undefined && !inRange(c.pitch, T.camera.pitchRange)) bad(`${where}: pitch ${c.pitch} is outside ${T.camera.pitchRange.join(' to ')}.`);
    if (c.zoom !== undefined && !inRange(c.zoom, T.camera.zoomRange)) bad(`${where}: zoom ${c.zoom} is outside ${T.camera.zoomRange.join(' to ')}.`);
    for (const id of c.target ?? []) if (!nodeIds.has(id) && !groupIds.has(id)) bad(`${where}: camera target "${id}" is not a node or group.`);
  };
  checkCam(spec.camera, 'Camera');
  const known = ['caption', 'show', 'hide', 'focus', 'pulse', 'camera'];
  (spec.steps ?? []).forEach((s, i) => {
    const where = `Step ${i + 1}`;
    for (const key of Object.keys(s)) if (!known.includes(key)) bad(`${where}: "${key}" is not a move. The moves are ${known.join(', ')}.`);
    if (s.caption && s.caption.length > T.caption.maxChars) bad(`${where}: caption is ${s.caption.length} characters; keep it to ${T.caption.maxChars}.`);
    for (const id of [...(s.show ?? []), ...(s.hide ?? [])]) if (!ids.has(id)) bad(`${where}: "${id}" is not a node, group or edge.`);
    for (const id of s.focus ?? []) if (!ids.has(id)) bad(`${where}: focus "${id}" is not a node, group or edge.`);
    for (const id of s.pulse ?? []) if (!edgeIds.has(id)) bad(`${where}: pulse "${id}" is not an edge. Edge ids look like "from>to".`);
    checkCam(s.camera, where);
  });
  if (errs.length) return errs;

  // --- Geometry ----------------------------------------------------------
  const scene = compile(spec, view), { model } = scene;

  if (scene.fit.scale < T.minScale) {
    bad(`The scene is too big for one slide: labels would be about ${Math.round(scene.fit.scale * T.text.label)}px on a 1280px frame. Split it into two scenes or move nodes closer.`);
  }
  for (const n of model.nodes) {
    const room = n.box.x1 - n.box.x0 - 0.24;
    const fits = (text: string, size: number) => text.length * T.charWidth * size <= room;
    if (!fits(n.spec.label, T.text.label)) bad(`Label "${n.spec.label}" is too long for node "${n.id}" (${Math.floor(room / (T.charWidth * T.text.label))} characters fit). Shorten it or widen the node.`);
    if (n.spec.sub && !fits(n.spec.sub, T.text.sub)) bad(`Sub-label "${n.spec.sub}" is too long for node "${n.id}" (${Math.floor(room / (T.charWidth * T.text.sub))} characters fit).`);
  }
  for (let i = 0; i < model.nodes.length; i++) {
    for (let j = i + 1; j < model.nodes.length; j++) {
      const [a, b] = [model.nodes[i], model.nodes[j]];
      if (a.plane === b.plane && rectsOverlap(foot(a.box), foot(b.box))) bad(`Nodes "${a.id}" and "${b.id}" overlap.`);
    }
  }
  for (let i = 0; i < model.groups.length; i++) {
    const g = model.groups[i];
    if (new Set(g.nodes.map((id) => model.byId.get(id)!.layer)).size > 1) bad(`Group "${g.id}" spans more than one layer; a group is one plate on one layer.`);
    const room = g.box.x1 - g.box.x0 - 0.4, per = T.charWidth * T.text.plate + T.plateSpacing;
    if (g.spec.label && g.spec.label.length * per > room) bad(`Label "${g.spec.label}" is too long for the plate of group "${g.id}" (${Math.floor(room / per)} characters fit).`);
    for (let j = i + 1; j < model.groups.length; j++) {
      const b = model.groups[j];
      if (g.plane !== b.plane || g.groups.includes(b.id) || b.groups.includes(g.id)) continue;
      if (rectsOverlap(foot(g.box), foot(b.box))) bad(`Group plates "${g.id}" and "${b.id}" overlap; move their nodes apart, or put one inside the other.`);
    }
    for (const n of model.nodes) {
      if (n.plane === g.plane && !g.nodes.includes(n.id) && rectsOverlap(foot(n.box), foot(g.box))) bad(`Node "${n.id}" sits on the plate of group "${g.id}" without being in it.`);
    }
  }

  const flat = model.edges.filter((e) => !e.riser);
  for (const e of model.edges) if (e.problem) bad(`Edge "${e.id}": ${e.problem}.`);
  for (const e of flat) {
    if (e.problem) continue;
    for (const n of model.nodes) {
      if (n.plane !== e.plane || n.id === e.spec.from || n.id === e.spec.to) continue;
      if (segs(e).some((s) => segHitsRect(s, foot(n.box)))) bad(`Edge "${e.id}" runs through node "${n.id}". Change "via" or "channel", or move the node.`);
    }
    for (const end of [e.spec.from, e.spec.to]) {
      const r = foot(model.byId.get(end)!.box);
      if (segs(e).some((s) => segHitsRect(s, r))) bad(`Edge "${e.id}" runs back through its own node "${end}". Change "via" or "channel".`);
    }
  }
  for (let i = 0; i < flat.length; i++) {
    for (let j = i + 1; j < flat.length; j++) {
      const [a, b] = [flat[i], flat[j]];
      if (a.plane !== b.plane || a.problem || b.problem) continue;
      const shared = [a.spec.from, a.spec.to].some((n) => n === b.spec.from || n === b.spec.to);
      let worst: 'cross' | 'touch' | null = null;
      for (const s of segs(a)) for (const t of segs(b)) {
        const m = meet(s, t);
        if (m === 'cross' || (m === 'touch' && !worst)) worst = m;
      }
      if (worst === 'cross') bad(`Edges "${a.id}" and "${b.id}" cross. Re-route one with "via" or "channel".`);
      else if (worst === 'touch' && !shared) bad(`Edges "${a.id}" and "${b.id}" run along each other or meet. Give one a different "channel" or an "offset".`);
      else if (worst === 'touch' && a.spec.from === b.spec.to && a.spec.to === b.spec.from) bad(`Edges "${a.id}" and "${b.id}" lie on top of each other. Give each an "offset", such as 0.2 and -0.2.`);
    }
  }
  const labels = flat.filter((e) => e.label?.rect && !e.problem);
  for (const e of labels) {
    const r = e.label!.rect!;
    for (const n of model.nodes) if (n.plane === e.plane && rectsOverlap(r, foot(n.box))) bad(`The label of edge "${e.id}" overlaps node "${n.id}". Shorten it, set "flip": true, or move the nodes apart.`);
    for (const o of flat) if (o !== e && o.plane === e.plane && segs(o).some((s) => segHitsRect(s, r))) bad(`The label of edge "${e.id}" sits on edge "${o.id}". Set "flip": true or re-route.`);
    for (const o of labels) if (o !== e && o.id > e.id && o.plane === e.plane && rectsOverlap(r, o.label!.rect!)) bad(`The labels of edges "${e.id}" and "${o.id}" overlap.`);
  }

  // A camera move must not push the scene out of the frame (zooming in on a target is deliberate).
  scene.states.forEach((st, i) => {
    if (st.cam.target || st.cam.zoom > 1.001) return;
    const [l, t, r, b] = frameBox(scene, st.cam), F = T.frame;
    if (l < 8 || t < 4 || r > F.w - 8 || b > F.h - F.captionBand + 34) bad(`Step ${i + 1}: at yaw ${st.cam.yaw}, pitch ${st.cam.pitch} the scene runs off the frame. Use a smaller camera move.`);
  });

  // --- Steps, checked against what is on screen at that moment ------------
  if (spec.steps?.length) {
    if (!scene.states[0].visible.size) bad('Step 1 shows nothing. Start with a "show".');
    scene.states.forEach((st, i) => {
      const where = `Step ${i + 1}`;
      const edgeOn = (id: string) => {
        const e = model.edges.find((x) => x.id === id);
        return !!e && st.visible.has(e.spec.from) && st.visible.has(e.spec.to) && (!e.spec.hold || st.visible.has(id));
      };
      for (const id of st.pulse) if (!edgeOn(id)) bad(`${where}: pulses edge "${id}", which is not on screen yet. Show both its nodes first${model.edges.find((x) => x.id === id)?.spec.hold ? ' and show the edge itself, because it has "hold"' : ''}.`);
      for (const id of st.focus ?? []) if (!(model.byId.has(id) ? st.visible.has(id) : edgeOn(id))) bad(`${where}: focuses "${id}", which is not on screen yet.`);
    });
    const never = model.nodes.filter((n) => !scene.states.some((s) => s.visible.has(n.id)));
    if (never.length) bad(`Never shown in any step: ${never.map((n) => n.id).join(', ')}. Show them or remove them.`);
  }
  return errs;
}
