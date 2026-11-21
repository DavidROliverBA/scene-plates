// One frame of a scene as an SVG string. Pure: the same inputs always give the
// same string, in a browser or on the command line.

import { tokens as T, type ThemeName } from './tokens';
import { textArea, type Box, type LCallout, type LEdge, type LGroup, type LNode, type Vec3 } from './layout';
import { alphas, calloutBox, lens, targetPoint, type Scene, type StepState } from './scene';
import { iconImage, iconPath } from './icons';

export interface FrameOpts {
  step?: number; // which step to show
  from?: number; // the step we are moving from (-1 is the empty scene); default step - 1
  progress?: number; // 0..1 through the move; default 1
  time?: number; // ms, drives the pulse dots
  theme?: ThemeName;
  reducedMotion?: boolean;
  bare?: boolean; // no background, for slides that supply their own
  edgeAlpha?: number; // fades all lines and callouts, used while switching view
}

const f = (n: number) => String(Math.round(n * 10) / 10);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerpBox = (a: Box, b: Box, t: number): Box => ({
  x0: lerp(a.x0, b.x0, t), x1: lerp(a.x1, b.x1, t), y0: lerp(a.y0, b.y0, t), y1: lerp(a.y1, b.y1, t), z0: lerp(a.z0, b.z0, t), z1: lerp(a.z1, b.z1, t),
});

export function mix(a: string, b: string, t: number): string {
  const h = (s: string) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
  const [x, y] = [h(a), h(b)];
  return '#' + x.map((v, i) => Math.round(lerp(v, y[i], t)).toString(16).padStart(2, '0')).join('');
}

export function renderFrame(scene: Scene, o: FrameOpts = {}): string {
  const th = T.themes[o.theme ?? 'light'];
  const { model, states, fit } = scene;
  const step = clamp(o.step ?? 0, 0, states.length - 1);
  const from = o.from ?? step - 1;
  const cur = states[step];
  const prev: StepState | null = from >= 0 && from < states.length ? states[from] : null;
  const e = o.reducedMotion ? 1 : ease(clamp(o.progress ?? 1, 0, 1));
  const lineAlpha = o.edgeAlpha ?? 1;

  // Camera: blend angle, zoom, the point we look at and where it sits on screen.
  const c0 = (prev ?? cur).cam, c1 = cur.cam;
  const S = fit.scale * lerp(c0.zoom, c1.zoom, e);
  const look = (c: typeof c0) => {
    const t = c.target ? targetPoint(model, c.target) : null;
    return t ? { a: t, s: fit.centre } : { a: fit.anchor, s: fit.anchorScreen };
  };
  const [l0, l1] = [look(c0), look(c1)];
  const A: Vec3 = [0, 1, 2].map((i) => lerp(l0.a[i], l1.a[i], e)) as Vec3;
  const AS = [lerp(l0.s[0], l1.s[0], e), lerp(l0.s[1], l1.s[1], e)];
  const L = lens({ yaw: lerp(c0.yaw, c1.yaw, e), pitch: lerp(c0.pitch, c1.pitch, e), persp: lerp(c0.persp, c1.persp, e) }, A), v = L.v;
  const P = (p: Vec3): [number, number] => {
    const r = L.r(p);
    return [AS[0] + S * r[0], AS[1] + S * r[1]];
  };
  const poly = (pts: Vec3[]) => pts.map((p) => P(p).map(f).join(',')).join(' ');
  const pts2 = (pts: [number, number][]) => pts.map((p) => p.map(f).join(',')).join(' ');

  // Things lying flat on a horizontal face. "scale" is local units per world unit.
  // With perspective this is the flat-face fit at that one point, which is close
  // enough over the width of a label.
  const faceMatrix = (at: Vec3, scale: number) => {
    const [x, y] = P(at), k = (S * L.k(at)) / scale;
    return [v.ux[0] * k, v.ux[1] * k, v.uy[0] * k, v.uy[1] * k, x, y].map((n) => n.toFixed(4)).join(' ');
  };
  const flat = (at: Vec3, text: string, size: number, fill: string, anchor: string, extra = '', alpha = 1) =>
    alpha < 0.02 ? '' : `<text transform="matrix(${faceMatrix(at, 100)})" font-size="${f(size * 100)}" text-anchor="${anchor}" fill="${fill}"${alpha < 0.98 ? ` opacity="${alpha.toFixed(2)}"` : ''}${extra}>${esc(text)}</text>`;
  // Level of detail: how readable words would be at this point, 0 (leave them out) to 1.
  const local = (at: Vec3) => (S * L.k(at)) / T.minScale;
  const fine = (at: Vec3) => clamp((local(at) - T.lod.subFrom) / (1 - T.lod.subFrom), 0, 1); // sub-labels, line labels
  const bold = (at: Vec3) => clamp((local(at) - T.lod.labelFrom) / (T.lod.labelTo - T.lod.labelFrom), 0, 1); // node labels

  const a0 = alphas(scene, prev), a1 = alphas(scene, cur);
  const out: string[] = [];
  const open = (a: number) => (a < 0.995 ? `<g opacity="${a.toFixed(2)}">` : '<g>');

  const sideX = (b: Box) => (v.st > 0.001 ? b.x0 : v.st < -0.001 ? b.x1 : null);
  const faces = (b: Box, top: string, front: string, side: string, stroke: string, topOpacity = 1, sw = 0) => {
    const sx = sideX(b);
    let s = '';
    if (sx !== null) s += `<polygon points="${poly([[sx, b.y0, b.z1], [sx, b.y1, b.z1], [sx, b.y1, b.z0], [sx, b.y0, b.z0]])}" fill="${side}"/>`;
    s += `<polygon points="${poly([[b.x0, b.y1, b.z1], [b.x1, b.y1, b.z1], [b.x1, b.y1, b.z0], [b.x0, b.y1, b.z0]])}" fill="${front}"/>`;
    s += `<polygon points="${poly([[b.x0, b.y0, b.z1], [b.x1, b.y0, b.z1], [b.x1, b.y1, b.z1], [b.x0, b.y1, b.z1]])}" fill="${top}"${topOpacity < 1 ? ` fill-opacity="${topOpacity}"` : ''} stroke="${stroke}"${sw ? ` stroke-width="${sw}"` : ''}/>`;
    return s;
  };

  // A cylinder: the footprint's ellipse pushed up through the node's height.
  const cylinder = (b: Box, top: string, wall: string, band: string, stroke: string, sw: number) => {
    const N = 44, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, rx = (b.x1 - b.x0) / 2, ry = (b.y1 - b.y0) / 2;
    const ring = (z: number) => Array.from({ length: N }, (_, i) => { const t = (i / N) * Math.PI * 2; return P([cx + rx * Math.cos(t), cy + ry * Math.sin(t), z]); });
    const up = ring(b.z1), down = ring(b.z0);
    let iL = 0, iR = 0;
    up.forEach((p, i) => { if (p[0] < up[iL][0]) iL = i; if (p[0] > up[iR][0]) iR = i; });
    let s = `<polygon points="${pts2(down)}" fill="${wall}"/><polygon points="${pts2([up[iL], up[iR], down[iR], down[iL]])}" fill="${wall}"/>`;
    if (Math.abs(down[0][1] - up[0][1]) > 5) {
      // One ring round the visible half of the wall, the usual sign for a data store.
      const mid = ring(b.z0 + (b.z1 - b.z0) * 0.5), arc: [number, number][] = [];
      for (let i = iL; ; i = (i + 1) % N) { arc.push(mid[i]); if (i === iR) break; }
      const other: [number, number][] = [];
      for (let i = iR; ; i = (i + 1) % N) { other.push(mid[i]); if (i === iL) break; }
      const lower = (q: [number, number][]) => q.reduce((m, p) => Math.max(m, p[1]), -Infinity);
      s += `<polyline points="${pts2(lower(arc) >= lower(other) ? arc : other)}" fill="none" stroke="${band}" stroke-width="1.4"/>`;
    }
    return s + `<polygon points="${pts2(up)}" fill="${top}" stroke="${stroke}"${sw ? ` stroke-width="${sw}"` : ''}/>`;
  };

  const drawGroup = (g: LGroup) => {
    const a = lerp(a0.group(g.id), a1.group(g.id), e);
    if (a < 0.01) return;
    const b = g.box;
    let s = open(a) + faces(b, th.plate, th.plateStroke, mix(th.plateStroke, th.shade, 0.25), th.plateStroke, 0.62);
    if (g.spec.label) {
      // Seen from far off, the area name grows (as far as its plate allows) so the map still reads.
      const at: Vec3 = [b.x0 + 0.2, b.y1 - 0.17, b.z1], want = Math.min(T.lod.plateLabelMax, T.lod.plateLabelPx / (S * L.k(at)));
      const size = Math.max(T.text.plate, Math.min(want, (b.x1 - b.x0 - 0.4) / (g.spec.label.length * (T.charWidth + T.plateSpacing / T.text.plate))));
      s += flat(at, g.spec.label, size, size > T.text.plate * 1.05 ? th.ink : th.muted, 'start', ` letter-spacing="${f((T.plateSpacing / T.text.plate) * size * 100)}"`);
    }
    out.push(s + '</g>');
  };

  const drawNode = (n: LNode) => {
    const [p, q] = [a0.node(n.id), a1.node(n.id)];
    const a = lerp(p, q, e);
    if (a < 0.01) return;
    const dz = p === 0 ? (1 - e) * T.motion.drop : q === 0 ? e * T.motion.drop * 0.5 : 0; // drops in, lifts out
    const b = { ...n.box, z0: n.box.z0 + dz, z1: n.box.z1 + dz };
    const col = th.kind[n.kind], tint = mix(th.surface, col, th.tint), sw = model.flat ? T.stroke.flatNode : 0;
    let s = open(a) + (n.spec.shape === 'cylinder'
      ? cylinder(b, tint, col, mix(col, th.surface, 0.45), col, sw)
      : faces(b, tint, col, mix(col, th.shade, 0.3), col, 1, sw));
    const area = textArea({ ...n, box: b }), cy = (b.y0 + b.y1) / 2, LS = T.text.label, mid: Vec3 = [area.cx, cy, b.z1];
    if (area.iconAt && n.spec.icon) {
      const at: Vec3 = [area.iconAt[0], area.iconAt[1], b.z1], I = T.icon;
      const d = iconPath(n.spec.icon), img = iconImage(n.spec.icon);
      // Local units: a 24-wide box for built-in glyphs, 64 for a pack image.
      if (d) s += `<path d="${d}" transform="matrix(${faceMatrix(at, 24 / I.size)})" fill="none" stroke="${col}" stroke-width="${I.stroke}" stroke-linecap="round"/>`;
      else if (img) s += `<image href="${img}" width="64" height="64" transform="matrix(${faceMatrix(at, 64 / I.size)})"/>`;
    }
    if (n.spec.sub) {
      s += flat([area.cx, cy - 0.03, b.z1], n.spec.label, LS, col, 'middle', ' font-weight="700"', bold(mid));
      s += flat([area.cx, cy + 0.2, b.z1], n.spec.sub, T.text.sub, th.muted, 'middle', '', fine(mid));
    } else {
      s += flat([area.cx, cy + LS * 0.35, b.z1], n.spec.label, LS, col, 'middle', ' font-weight="700"', bold(mid));
    }
    out.push(s + '</g>');
  };

  const along = (pts: Vec3[], t: number): Vec3 => {
    const lens = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1], p[2] - pts[i][2]));
    let d = t * lens.reduce((x, y) => x + y, 0);
    for (let i = 0; i < lens.length; i++) {
      if (d <= lens[i] || i === lens.length - 1) {
        const u = lens[i] ? clamp(d / lens[i], 0, 1) : 0;
        return [0, 1, 2].map((j) => lerp(pts[i][j], pts[i + 1][j], u)) as Vec3;
      }
      d -= lens[i];
    }
    return pts[0];
  };

  const drawEdge = (ed: LEdge) => {
    const [p, q] = [a0.edge(ed.id), a1.edge(ed.id)];
    const a = lerp(p, q, e) * lineAlpha;
    if (a < 0.01) return;
    const col = th.kind[ed.kind === 'flow' ? 'process' : ed.kind === 'pass' ? 'success' : ed.kind];
    const pulsing = cur.pulse.has(ed.id) && q > 0;
    const width = ed.kind === 'quiet' ? T.stroke.quiet : pulsing ? lerp(T.stroke.edge, T.stroke.pulse, prev?.pulse.has(ed.id) ? 1 : e) : T.stroke.edge;
    const dash = ed.kind === 'fail' ? T.dash.fail : ed.kind === 'quiet' ? T.dash.quiet : null;
    let pts = ed.pts, head = '';
    if (ed.riser) {
      // The arrowhead sits half-way and points along the line as it appears on screen.
      const m = P(along(pts, 0.5)), [s0, s1] = [P(pts[0]), P(pts[1])], sl = Math.hypot(s1[0] - s0[0], s1[1] - s0[1]) || 1;
      const dx = (s1[0] - s0[0]) / sl, dy = (s1[1] - s0[1]) / sl;
      head = `<polygon points="${pts2([[m[0] + dx * 8, m[1] + dy * 8], [m[0] - dx * 5 - dy * 6, m[1] - dy * 5 + dx * 6], [m[0] - dx * 5 + dy * 6, m[1] - dy * 5 - dx * 6]])}" fill="${col}"/>`;
    } else {
      const n = pts.length, [t, u] = [pts[n - 1], pts[n - 2]];
      const len = Math.hypot(t[0] - u[0], t[1] - u[1]) || 1;
      const d = [(t[0] - u[0]) / len, (t[1] - u[1]) / len], { length: L, half: Hf } = T.arrow;
      // A box hides the floor just behind it, so a line arriving from behind stops
      // where it meets the box on screen; otherwise its arrowhead would be lost.
      const facing = d[1] > 0.5 ? v.ct : d[0] < -0.5 ? Math.max(v.st, 0) : d[0] > 0.5 ? Math.max(-v.st, 0) : 0;
      const back = Math.min(T.slab * v.cot * facing, Math.max(0, len - L - 0.1));
      const tip: Vec3 = [t[0] - d[0] * back, t[1] - d[1] * back, t[2]];
      const base: Vec3 = [tip[0] - d[0] * L, tip[1] - d[1] * L, t[2]];
      head = `<polygon points="${poly([tip, [base[0] - d[1] * Hf, base[1] + d[0] * Hf, t[2]], [base[0] + d[1] * Hf, base[1] - d[0] * Hf, t[2]]])}" fill="${col}"/>`;
      pts = [...pts.slice(0, -1), base];
    }
    const scr = pts.map(P);
    let draw = '';
    if (p === 0 && !dash && e < 1) {
      // A new edge draws itself from source to target.
      const total = scr.slice(1).reduce((s, pt, i) => s + Math.hypot(pt[0] - scr[i][0], pt[1] - scr[i][1]), 0);
      draw = ` stroke-dasharray="${f(total * e)} ${f(total + 1)}"`;
      head = `<g opacity="${(e * e).toFixed(2)}">${head}</g>`;
    }
    let s = open(p === 0 && draw ? q * lineAlpha : a);
    s += `<polyline points="${pts2(scr)}" fill="none" stroke="${col}" stroke-width="${f(width)}" stroke-linejoin="round" stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : draw}/>${head}`;
    if (ed.label && ed.spec.label) {
      const lc = ed.kind === 'flow' ? th.muted : col, la = fine(ed.label.at);
      if (la < 0.02) { /* too small to read: leave the words out */ } else if (ed.riser) {
        const m = P(ed.label.at), dx = ed.label.anchor === 'end' ? -14 : 14;
        s += `<text x="${f(m[0] + dx)}" y="${f(m[1] + 4)}" font-size="${f(T.text.edge * S * L.k(ed.label.at))}" text-anchor="${ed.label.anchor}" fill="${lc}" stroke="${th.bg}" stroke-width="3.5" paint-order="stroke" opacity="${la.toFixed(2)}">${esc(ed.spec.label)}</text>`;
      } else {
        s += flat(ed.label.at, ed.spec.label, T.text.edge, lc, ed.label.anchor, '', la);
      }
    }
    if (pulsing && !(p === 0 && e < 1)) { // wait until a new edge has finished drawing
      const t = o.reducedMotion ? 0.5 : (((o.time ?? 0) / T.motion.pulse) % 1 + 1) % 1;
      const [x, y] = P(along(ed.pts, t));
      s += `<circle cx="${f(x)}" cy="${f(y)}" r="11" fill="${col}" opacity="0.22"/><circle cx="${f(x)}" cy="${f(y)}" r="5.5" fill="${col}" stroke="${th.surface}" stroke-width="1.5"/>`;
    }
    out.push(s + '</g>');
  };

  const drawCallout = (c: LCallout) => {
    const on = (s: StepState | null) => (s && s.callout.has(c.id) ? 1 : 0);
    const [p, q] = [on(prev), on(cur)];
    const a = lerp(p, q, e) * lineAlpha;
    if (a < 0.01) return;
    const K = T.callout, at = P(c.anchor), box = calloutBox(c, at), col = th.kind.loop;
    const slide = p === 0 ? (1 - e) * 10 : 0; // settles into place
    let s = `<g opacity="${a.toFixed(2)}" transform="translate(0 ${f(c.side === 'down' ? slide : -slide)})">`;
    s += `<line x1="${f(at[0])}" y1="${f(at[1])}" x2="${f(box.end[0])}" y2="${f(box.end[1])}" stroke="${col}" stroke-width="1.6"/><circle cx="${f(at[0])}" cy="${f(at[1])}" r="4" fill="${col}"/>`;
    s += `<rect x="${f(box.x)}" y="${f(box.y)}" width="${f(box.w)}" height="${f(box.h)}" rx="6" fill="${mix(th.surface, col, 0.14)}" stroke="${col}" stroke-width="1.4"/>`;
    box.lines.forEach((line, i) => {
      s += `<text x="${f(box.x + K.padX)}" y="${f(box.y + K.padY + K.lineHeight * (i + 0.74))}" font-family="${T.font.caption}" font-size="${K.size}" fill="${th.ink}">${esc(line)}</text>`;
    });
    out.push(s + '</g>');
  };

  // Painter's order: lowest layer first; within a layer plates, floor lines,
  // lines coming up from below, then nodes from far to near.
  const far = (b: Box) => v.far([(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, b.z0]);
  for (const plane of model.planes) {
    model.groups.filter((g) => g.plane === plane).sort((x, y) => y.depth - x.depth || far(y.box) - far(x.box)).forEach(drawGroup);
    model.edges.filter((x) => x.plane === plane && !x.riser).forEach(drawEdge);
    for (const q of model.junctions.filter((x) => x.plane === plane)) {
      const a = Math.min(...q.edges.map((id) => lerp(a0.edge(id), a1.edge(id), e))) * lineAlpha;
      if (a < 0.05) continue;
      const [x, y] = P(q.at), ed = model.edges.find((x) => x.id === q.edges[0])!;
      const col = th.kind[ed.kind === 'flow' ? 'process' : ed.kind === 'pass' ? 'success' : ed.kind];
      out.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(clamp(S * L.k(q.at) * T.junction, 2, 5))}" fill="${col}" opacity="${a.toFixed(2)}"/>`);
    }
    model.edges.filter((x) => x.plane === plane && x.riser).forEach(drawEdge);
    model.nodes.filter((n) => n.plane === plane).sort((x, y) => far(y.box) - far(x.box)).forEach(drawNode);
  }
  const scenery = out.join('');
  out.length = 0;
  model.callouts.forEach(drawCallout); // drawn after the bands below, so a callout near the top is never hidden

  const F = T.frame;
  let hud = '';
  if (!o.bare) {
    // When the camera moves in, the scene runs past the edges of the frame. Soft
    // bands keep it from running under the title and the caption.
    const top = scene.showTitle && scene.spec.title ? (scene.spec.subtitle ? T.title.bandSub : T.title.band) - 8 : 0, low = F.h - F.captionBand + 16, fade = 26;
    const grad = (id: string, from: number, to: number) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${th.bg}" stop-opacity="${from}"/><stop offset="1" stop-color="${th.bg}" stop-opacity="${to}"/></linearGradient>`;
    hud += `<defs>${grad('sp-fade-up', 1, 0)}${grad('sp-fade-down', 0, 1)}</defs>`;
    if (top) hud += `<rect width="${F.w}" height="${top}" fill="${th.bg}"/><rect y="${top}" width="${F.w}" height="${fade}" fill="url(#sp-fade-up)"/>`;
    hud += `<rect y="${low - fade}" width="${F.w}" height="${fade}" fill="url(#sp-fade-down)"/><rect y="${low}" width="${F.w}" height="${F.h - low}" fill="${th.bg}"/>`;
  }
  hud += out.join('');
  if (scene.showTitle && scene.spec.title) {
    hud += `<text x="${F.marginX}" y="${T.title.y}" font-family="${T.font.caption}" font-size="${T.title.size}" font-weight="650" fill="${th.ink}">${esc(scene.spec.title)}</text>`;
    if (scene.spec.subtitle) hud += `<text x="${F.marginX}" y="${T.title.subY}" font-family="${T.font.caption}" font-size="${T.title.subSize}" fill="${th.muted}">${esc(scene.spec.subtitle)}</text>`;
  }
  if (cur.caption) {
    const a = prev && prev.caption === cur.caption ? 1 : e;
    hud += `<text x="${F.w / 2}" y="${F.h - 58}" text-anchor="middle" font-family="${T.font.caption}" font-size="${T.caption.size}" fill="${th.ink}" opacity="${a.toFixed(2)}">${esc(cur.caption)}</text>`;
  }
  if (states.length > 1) {
    const x0 = F.w / 2 - ((states.length - 1) * 16) / 2;
    hud += states.map((_, i) => `<circle cx="${f(x0 + i * 16)}" cy="${F.h - 26}" r="${i === step ? 4.5 : 3.5}" fill="${i === step ? th.ink : th.muted}" opacity="${i === step ? 1 : 0.4}"/>`).join('');
  }

  const label = [scene.spec.description, cur.caption].filter(Boolean).join(' Now showing: ');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${F.w} ${F.h}" role="img" aria-label="${esc(label)}" font-family="${T.font.label}" stroke-linejoin="round" stroke-width="${T.stroke.face}" style="display:block;width:100%;height:auto">` +
    (o.bare ? '' : `<rect width="${F.w}" height="${F.h}" fill="${th.bg}"/>`) +
    scenery + hud + '</svg>'
  );
}

// Switching between two drawings of one spec. Between 3d and iso only the
// camera moves. To or from flat the layout changes too, so lines fade out, the
// boxes and the camera move across, then the other drawing's lines fade in.
export function renderMorph(a: Scene, b: Scene, t: number, o: FrameOpts = {}): string {
  const settled = { ...o, progress: 1, from: undefined };
  if (o.reducedMotion) return renderFrame(t < 0.5 ? a : b, settled);
  const sameLayout = !a.model.flat && !b.model.flat;
  if (t <= 0) return renderFrame(a, { ...settled, edgeAlpha: 1 });
  if (t >= 1) return renderFrame(b, { ...settled, edgeAlpha: 1 });
  if (!sameLayout && t <= 0.22) return renderFrame(a, { ...settled, edgeAlpha: 1 - t / 0.22 });
  if (!sameLayout && t >= 0.78) return renderFrame(b, { ...settled, edgeAlpha: clamp((t - 0.78) / 0.22, 0, 1) });
  const m = sameLayout ? ease(t) : ease((t - 0.22) / 0.56), ref = a.model.flat ? b : a; // draw order comes from a model with layers
  const v3 = (p: Vec3, q: Vec3): Vec3 => [lerp(p[0], q[0], m), lerp(p[1], q[1], m), lerp(p[2], q[2], m)];
  const v2 = (p: [number, number], q: [number, number]): [number, number] => [lerp(p[0], q[0], m), lerp(p[1], q[1], m)];
  const between: Scene = {
    ...a,
    model: {
      ...ref.model, flat: false, ...(sameLayout ? {} : { edges: [], callouts: [], junctions: [] }),
      nodes: ref.model.nodes.map((n) => ({ ...n, box: lerpBox(a.model.byId.get(n.id)!.box, b.model.byId.get(n.id)!.box, m) })),
      groups: ref.model.groups.map((g) => ({ ...g, box: lerpBox(a.model.groups.find((x) => x.id === g.id)!.box, b.model.groups.find((x) => x.id === g.id)!.box, m) })),
    },
    states: a.states.map((s, i) => ({ ...s, cam: { ...s.cam, yaw: lerp(s.cam.yaw, b.states[i].cam.yaw, m), pitch: lerp(s.cam.pitch, b.states[i].cam.pitch, m), persp: lerp(s.cam.persp, b.states[i].cam.persp, m) } })),
    fit: {
      scale: lerp(a.fit.scale, b.fit.scale, m), anchor: v3(a.fit.anchor, b.fit.anchor),
      anchorScreen: v2(a.fit.anchorScreen, b.fit.anchorScreen), centre: v2(a.fit.centre, b.fit.centre),
    },
  };
  between.model.byId = new Map(between.model.nodes.map((n) => [n.id, n]));
  return renderFrame(between, settled);
}
