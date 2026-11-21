// One frame of a scene as an SVG string. Pure: the same inputs always give the
// same string, in a browser or on the command line.

import { tokens as T, type ThemeName } from './tokens';
import type { Box, LEdge, LGroup, LNode, Vec3 } from './layout';
import { alphas, targetPoint, view, type Scene, type StepState } from './scene';

export interface FrameOpts {
  step?: number; // which step to show
  from?: number; // the step we are moving from (-1 is the empty scene); default step - 1
  progress?: number; // 0..1 through the move; default 1
  time?: number; // ms, drives the pulse dots
  theme?: ThemeName;
  reducedMotion?: boolean;
  bare?: boolean; // no background, for slides that supply their own
}

const f = (n: number) => String(Math.round(n * 10) / 10);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

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

  // Camera: blend angle, zoom, the point we look at and where it sits on screen.
  const c0 = (prev ?? cur).cam, c1 = cur.cam;
  const v = view(lerp(c0.yaw, c1.yaw, e), lerp(c0.pitch, c1.pitch, e));
  const S = fit.scale * lerp(c0.zoom, c1.zoom, e);
  const look = (c: typeof c0) => {
    const t = c.target ? targetPoint(model, c.target) : null;
    return t ? { a: t, s: fit.centre } : { a: fit.anchor, s: fit.anchorScreen };
  };
  const [l0, l1] = [look(c0), look(c1)];
  const A: Vec3 = [0, 1, 2].map((i) => lerp(l0.a[i], l1.a[i], e)) as Vec3;
  const AS = [lerp(l0.s[0], l1.s[0], e), lerp(l0.s[1], l1.s[1], e)];
  const pa = v.p(A);
  const P = (p: Vec3): [number, number] => {
    const q = v.p(p);
    return [AS[0] + S * (q[0] - pa[0]), AS[1] + S * (q[1] - pa[1])];
  };
  const poly = (pts: Vec3[]) => pts.map((p) => P(p).map(f).join(',')).join(' ');

  // Text lying flat on a horizontal face: local 100 units = 1 world unit.
  const k = S / 100;
  const flat = (at: Vec3, text: string, size: number, fill: string, anchor: string, extra = '') => {
    const [x, y] = P(at);
    const m = [v.ux[0] * k, v.ux[1] * k, v.uy[0] * k, v.uy[1] * k, x, y].map((n) => n.toFixed(4)).join(' ');
    return `<text transform="matrix(${m})" font-size="${f(size * 100)}" text-anchor="${anchor}" fill="${fill}"${extra}>${esc(text)}</text>`;
  };

  const a0 = alphas(scene, prev), a1 = alphas(scene, cur);
  const out: string[] = [];
  const open = (a: number) => (a < 0.995 ? `<g opacity="${a.toFixed(2)}">` : '<g>');

  const sideX = (b: Box) => (v.st > 0.001 ? b.x0 : v.st < -0.001 ? b.x1 : null);
  const faces = (b: Box, top: string, front: string, side: string, stroke: string, topOpacity = 1) => {
    const sx = sideX(b);
    let s = '';
    if (sx !== null) s += `<polygon points="${poly([[sx, b.y0, b.z1], [sx, b.y1, b.z1], [sx, b.y1, b.z0], [sx, b.y0, b.z0]])}" fill="${side}"/>`;
    s += `<polygon points="${poly([[b.x0, b.y1, b.z1], [b.x1, b.y1, b.z1], [b.x1, b.y1, b.z0], [b.x0, b.y1, b.z0]])}" fill="${front}"/>`;
    s += `<polygon points="${poly([[b.x0, b.y0, b.z1], [b.x1, b.y0, b.z1], [b.x1, b.y1, b.z1], [b.x0, b.y1, b.z1]])}" fill="${top}"${topOpacity < 1 ? ` fill-opacity="${topOpacity}"` : ''} stroke="${stroke}"/>`;
    return s;
  };

  const drawGroup = (g: LGroup) => {
    const a = lerp(a0.group(g.id), a1.group(g.id), e);
    if (a < 0.01) return;
    const b = g.box;
    let s = open(a) + faces(b, th.plate, th.plateStroke, mix(th.plateStroke, th.shade, 0.25), th.plateStroke, 0.62);
    if (g.spec.label) s += flat([b.x0 + 0.2, b.y1 - 0.17, b.z1], g.spec.label, T.text.plate, th.muted, 'start', ' letter-spacing="6"');
    out.push(s + '</g>');
  };

  const drawNode = (n: LNode) => {
    const [p, q] = [a0.node(n.id), a1.node(n.id)];
    const a = lerp(p, q, e);
    if (a < 0.01) return;
    const dz = p === 0 ? (1 - e) * T.motion.drop : q === 0 ? e * T.motion.drop * 0.5 : 0; // drops in, lifts out
    const b = { ...n.box, z0: n.box.z0 + dz, z1: n.box.z1 + dz };
    const col = th.kind[n.kind];
    let s = open(a) + faces(b, mix(th.surface, col, th.tint), col, mix(col, th.shade, 0.3), col);
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, L = T.text.label;
    if (n.spec.sub) {
      s += flat([cx, cy - 0.03, b.z1], n.spec.label, L, col, 'middle', ' font-weight="700"');
      s += flat([cx, cy + 0.2, b.z1], n.spec.sub, T.text.sub, th.muted, 'middle');
    } else {
      s += flat([cx, cy + L * 0.35, b.z1], n.spec.label, L, col, 'middle', ' font-weight="700"');
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
    const a = lerp(p, q, e);
    if (a < 0.01) return;
    const col = th.kind[ed.kind === 'flow' ? 'process' : ed.kind === 'pass' ? 'success' : ed.kind];
    const pulsing = cur.pulse.has(ed.id) && q > 0;
    const width = ed.kind === 'quiet' ? T.stroke.quiet : pulsing ? lerp(T.stroke.edge, T.stroke.pulse, prev?.pulse.has(ed.id) ? 1 : e) : T.stroke.edge;
    const dash = ed.kind === 'fail' ? T.dash.fail : ed.kind === 'quiet' ? T.dash.quiet : null;
    let pts = ed.pts, head = '';
    if (ed.riser) {
      const m = P(along(pts, 0.5)), up = pts[1][2] > pts[0][2] ? -1 : 1;
      head = `<polygon points="${f(m[0])},${f(m[1] + up * 8)} ${f(m[0] - 6)},${f(m[1] - up * 5)} ${f(m[0] + 6)},${f(m[1] - up * 5)}" fill="${col}"/>`;
    } else {
      const n = pts.length, [t, u] = [pts[n - 1], pts[n - 2]];
      const len = Math.hypot(t[0] - u[0], t[1] - u[1]) || 1;
      const d = [(t[0] - u[0]) / len, (t[1] - u[1]) / len], { length: L, half: Hf } = T.arrow;
      const base: Vec3 = [t[0] - d[0] * L, t[1] - d[1] * L, t[2]];
      head = `<polygon points="${poly([t, [base[0] - d[1] * Hf, base[1] + d[0] * Hf, t[2]], [base[0] + d[1] * Hf, base[1] - d[0] * Hf, t[2]]])}" fill="${col}"/>`;
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
    let s = open(p === 0 && draw ? q : a);
    s += `<polyline points="${scr.map((pt) => pt.map(f).join(',')).join(' ')}" fill="none" stroke="${col}" stroke-width="${f(width)}" stroke-linejoin="round" stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : draw}/>${head}`;
    if (ed.label && ed.spec.label) {
      const lc = ed.kind === 'flow' ? th.muted : col;
      if (ed.riser) {
        const m = P(ed.label.at), dx = ed.label.anchor === 'end' ? -14 : 14;
        s += `<text x="${f(m[0] + dx)}" y="${f(m[1] + 4)}" font-size="${f(T.text.edge * S)}" text-anchor="${ed.label.anchor}" fill="${lc}">${esc(ed.spec.label)}</text>`;
      } else {
        s += flat(ed.label.at, ed.spec.label, T.text.edge, lc, ed.label.anchor);
      }
    }
    if (pulsing && !(p === 0 && e < 1)) { // wait until a new edge has finished drawing
      const t = o.reducedMotion ? 0.5 : (((o.time ?? 0) / T.motion.pulse) % 1 + 1) % 1;
      const [x, y] = P(along(ed.pts, t));
      s += `<circle cx="${f(x)}" cy="${f(y)}" r="11" fill="${col}" opacity="0.22"/><circle cx="${f(x)}" cy="${f(y)}" r="5.5" fill="${col}" stroke="${th.surface}" stroke-width="1.5"/>`;
    }
    out.push(s + '</g>');
  };

  // Painter's order: lowest layer first; within a layer plates, floor lines,
  // lines coming up from below, then nodes from far to near.
  const far = (b: Box) => v.far([(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, b.z0]);
  for (const layer of model.layers) {
    model.groups.filter((g) => g.layer === layer).sort((x, y) => far(y.box) - far(x.box)).forEach(drawGroup);
    model.edges.filter((x) => x.layer === layer && !x.riser).forEach(drawEdge);
    model.edges.filter((x) => x.layer === layer && x.riser).forEach(drawEdge);
    model.nodes.filter((n) => n.layer === layer).sort((x, y) => far(y.box) - far(x.box)).forEach(drawNode);
  }

  const F = T.frame;
  let hud = '';
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
    out.join('') + hud + '</svg>'
  );
}
