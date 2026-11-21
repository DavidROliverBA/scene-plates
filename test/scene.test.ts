import { expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Spec } from '../src/spec';
import { compile } from '../src/scene';
import { renderFrame } from '../src/render';
import { validate } from '../src/validate';

const dir = join(import.meta.dir, '..', 'examples');
const examples = readdirSync(dir).filter((f) => f.endsWith('.json'));
const load = async (f: string): Promise<Spec> => Bun.file(join(dir, f)).json();
const base = (): Spec => ({
  title: 't', description: 'Two boxes joined by one arrow, for tests.',
  nodes: [{ id: 'a', label: 'A', at: [0, 0] }, { id: 'b', label: 'B', at: [3, 0] }],
  edges: [{ from: 'a', to: 'b' }],
});
const has = (errs: string[], text: string) => errs.some((e) => e.includes(text));

test('examples exist', () => expect(examples.length).toBeGreaterThan(0));

for (const f of examples) {
  test(`${f} validates and every step renders the same way twice`, async () => {
    const spec = await load(f);
    await loadIcons(spec, join(dir, f));
    expect(validate(spec)).toEqual([]);
    const scene = compile(spec);
    for (let i = 0; i < scene.states.length; i++) {
      for (const theme of ['light', 'dark'] as const) {
        const svg = renderFrame(scene, { step: i, theme });
        expect(svg).toBe(renderFrame(compile(spec), { step: i, theme }));
        expect(svg).not.toContain('NaN');
        expect(svg.startsWith('<svg')).toBe(true);
      }
      expect(renderFrame(scene, { step: i, from: i - 1, progress: 0.4, time: 500 })).not.toContain('NaN');
    }
  });
}

test('a clean spec passes', () => expect(validate(base())).toEqual([]));

test('overlapping nodes are refused', () => {
  const s = base(); s.nodes[1].at = [1, 0];
  expect(has(validate(s), 'overlap')).toBe(true);
});
test('a label too long for its node is refused', () => {
  const s = base(); s.nodes[0].label = 'A VERY LONG LABEL INDEED';
  expect(has(validate(s), 'too long')).toBe(true);
});
test('an edge through another node is refused', () => {
  const s = base(); s.nodes.push({ id: 'c', label: 'C', at: [6, 0] }); s.edges = [{ from: 'a', to: 'c' }];
  expect(has(validate(s), 'runs through node "b"')).toBe(true);
});
test('crossing edges are refused', () => {
  const s = base();
  s.nodes[1].at = [6, 0];
  s.nodes.push({ id: 'c', label: 'C', at: [3, -2] }, { id: 'd', label: 'D', at: [3, 2] });
  s.edges = [{ from: 'a', to: 'b' }, { from: 'c', to: 'd' }];
  expect(has(validate(s), 'cross')).toBe(true);
});
test('a there-and-back pair must be offset', () => {
  const s = base(); s.edges!.push({ from: 'b', to: 'a' });
  expect(has(validate(s), 'on top of each other')).toBe(true);
  s.edges = [{ from: 'a', to: 'b', offset: -0.2 }, { from: 'b', to: 'a', offset: 0.2 }];
  expect(validate(s)).toEqual([]);
});
test('a loop without a stated cap is refused', () => {
  const s = base(); s.edges = [{ from: 'b', to: 'a', kind: 'loop' }];
  expect(has(validate(s), 'cap')).toBe(true);
});
test('layers can only be joined where one node sits above the other', () => {
  const s = base(); s.nodes[1].layer = 1;
  expect(has(validate(s), 'one above the other')).toBe(true);
  s.nodes[1].at = [0, 0];
  expect(validate(s)).toEqual([]);
});
test('a camera angle that makes labels unreadable is refused', () => {
  const s = base(); s.camera = { yaw: 120 };
  expect(has(validate(s), 'yaw')).toBe(true);
});
test('pulsing an edge that is not on screen is refused', () => {
  const s = base(); s.steps = [{ show: ['a'], pulse: ['a>b'] }, { show: ['b'] }];
  expect(has(validate(s), 'not on screen yet')).toBe(true);
});
test('unknown moves and unknown kinds are refused', () => {
  const s = base() as any; s.steps = [{ show: ['a', 'b'], spin: true }]; s.nodes[0].kind = 'purple';
  const errs = validate(s);
  expect(has(errs, 'is not a move')).toBe(true);
  expect(has(errs, 'kind "purple"')).toBe(true);
});
test('a scene too big to read is refused', () => {
  const s = base(); s.nodes[1].at = [40, 0];
  expect(has(validate(s), 'too big')).toBe(true);
});
test('steps add up: show stays, focus and pulse last one step', () => {
  const s = base(); s.steps = [{ show: ['a'] }, { show: ['b'], focus: ['b'], pulse: ['a>b'] }, {}];
  const { states } = compile(s);
  expect([...states[2].visible].sort()).toEqual(['a', 'b']);
  expect(states[1].focus?.has('b')).toBe(true);
  expect(states[2].focus).toBeNull();
  expect(states[2].pulse.size).toBe(0);
});

test('plates nest, and the outer plate sits under the inner one', () => {
  const s = base();
  s.groups = [{ id: 'inner', label: 'IN', contains: ['a'] }, { id: 'outer', label: 'OUT', contains: ['inner', 'b'] }];
  expect(validate(s)).toEqual([]);
  const { model } = compile(s), g = (id: string) => model.groups.find((x) => x.id === id)!;
  expect(g('outer').nodes.sort()).toEqual(['a', 'b']);
  expect(g('outer').box.z1).toBeLessThan(g('inner').box.z1);
  expect(g('outer').box.x0).toBeLessThan(g('inner').box.x0);
});
test('a group cannot contain itself, and nothing has two parents', () => {
  const s = base();
  s.groups = [{ id: 'g1', contains: ['g2'] }, { id: 'g2', contains: ['g1', 'a'] }];
  expect(has(validate(s), 'containing itself')).toBe(true);
  s.groups = [{ id: 'g1', contains: ['a'] }, { id: 'g2', contains: ['a', 'b'] }];
  expect(has(validate(s), 'more than one group')).toBe(true);
});
test('flat view lays layers out as bands and joins them on the page', () => {
  const s = base(); s.nodes[1] = { id: 'b', label: 'B', at: [0, 0], layer: 1 };
  expect(validate(s, 'flat')).toEqual([]);
  const { model, states } = compile(s, 'flat');
  const [a, b] = [model.byId.get('a')!, model.byId.get('b')!];
  expect(b.box.y1).toBeLessThan(a.box.y0); // the upper layer is drawn above the lower one
  expect(model.edges[0].riser).toBe(false);
  expect(states[0].cam.pitch).toBe(90);
});
test('a row channel moves with its layer when drawn flat', async () => {
  const spec = await load('02-flow-complex.json');
  expect(validate(spec, 'flat')).toEqual([]);
});
test('the flat, isometric and 3D AWS examples are the same scene', async () => {
  const [flat, iso, d3] = [await load('05-aws-events-flat.json'), await load('06-aws-events-iso.json'), await load('07-aws-events-3d.json')];
  const same = (x: Spec) => ({ ...x, view: 0, title: 0, subtitle: 0 });
  expect(same(flat)).toEqual(same(iso) as any);
  expect(same(d3)).toEqual(same(iso) as any);
  expect([flat.view, iso.view, d3.view]).toEqual(['flat', 'iso', '3d']);
  for (const v of ['3d', 'iso', 'flat'] as const) expect(validate(iso, v)).toEqual([]);
});
test('a camera move that runs off the frame is refused', () => {
  const s = base();
  s.nodes.push({ id: 'c', label: 'C', at: [6, 0] }, { id: 'd', label: 'D', at: [9, 0] }, { id: 'e', label: 'E', at: [12, 0] });
  s.steps = [{ show: ['a', 'b', 'c', 'd', 'e'] }, { camera: { yaw: 45, pitch: 70 } }];
  const errs = validate(s);
  // Either the scale shrinks to fit every angle, or the move is refused; it must never clip silently.
  const scene = compile(s);
  expect(errs.length === 0 ? scene.fit.scale < 125 : true).toBe(true);
});

// --- icons, cylinders, titles, callouts, switching view ---------------------
import { existsSync } from 'node:fs';
import { renderMorph } from '../src/render';
import { registerIcons } from '../src/icons';

test('an icon narrows the label room, and an unknown icon is refused', () => {
  const s = base(); s.nodes[0].label = 'TWELVE CHARS'; s.nodes[0].icon = 'database';
  expect(has(validate(s), 'too long')).toBe(true);
  s.nodes[0].size = [2.6, 1]; s.nodes[1].at = [4, 0];
  expect(validate(s)).toEqual([]);
  expect(renderFrame(compile(s))).toContain('<path d="M4 6c0');
  s.nodes[0].icon = 'unicorn';
  expect(has(validate(s), 'does not exist')).toBe(true);
  s.nodes[0].icon = 'acme:thing';
  expect(has(validate(s), 'not loaded')).toBe(true);
});
test('a registered pack icon is drawn as an image', () => {
  registerIcons({ 'acme:thing': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#123456"/></svg>' });
  const s = base(); s.nodes[0].icon = 'acme:thing'; s.nodes[0].size = [2.6, 1]; s.nodes[1].at = [4, 0];
  expect(validate(s)).toEqual([]);
  expect(renderFrame(compile(s))).toContain('<image href="data:image/svg+xml,');
});
test('a cylinder draws a round top instead of a box', () => {
  const s = base(); s.nodes[0].shape = 'cylinder';
  expect(validate(s)).toEqual([]);
  const box = renderFrame(compile(base())), round = renderFrame(compile(s));
  expect(round.length).toBeGreaterThan(box.length + 500); // 44-point rings
  (s.nodes[0] as any).shape = 'star';
  expect(has(validate(s), 'box or cylinder')).toBe(true);
});
test('the title is drawn in the frame and can be left out', () => {
  const s = base(); s.title = 'A plain title'; s.subtitle = 'And a subtitle';
  expect(renderFrame(compile(s))).toContain('>A plain title</text>');
  expect(renderFrame(compile(s))).toContain('>And a subtitle</text>');
  expect(renderFrame(compile(s, undefined, false))).not.toContain('A plain title</text>');
  s.title = 'x'.repeat(80);
  expect(has(validate(s), 'title is 80')).toBe(true);
});
test('a callout shows for its step only, and bad callouts are refused', () => {
  const s = base();
  s.callouts = [{ id: 'note', text: 'Look at this box in particular.', on: 'a', side: 'up' }];
  s.steps = [{ show: ['a', 'b'], callout: ['note'] }, {}];
  expect(validate(s)).toEqual([]);
  const scene = compile(s);
  expect(renderFrame(scene, { step: 0 })).toContain('particular.');
  expect(renderFrame(scene, { step: 1 })).not.toContain('particular.');
  s.steps = [{ show: ['b'], callout: ['note'] }, { show: ['a'] }];
  expect(has(validate(s), 'not on screen yet')).toBe(true);
  s.steps = [{ show: ['a', 'b'], callout: ['note'] }];
  s.callouts[0].gap = 900;
  expect(has(validate(s), 'outside the frame')).toBe(true);
  s.callouts[0] = { id: 'note', text: 'Sits right on top of the other box.', on: 'a', side: 'right', gap: 40 };
  expect(has(validate(s), 'covers node "b"')).toBe(true);
});
test('switching view starts on one drawing, ends on the other, and never breaks between', async () => {
  const spec = await load('06-aws-events-iso.json');
  const [iso, flat] = [compile(spec, '3d'), compile(spec, 'flat')];
  expect(renderMorph(iso, flat, 0, { step: 5 })).toBe(renderFrame(iso, { step: 5, edgeAlpha: 1 }));
  expect(renderMorph(iso, flat, 1, { step: 5 })).toBe(renderFrame(flat, { step: 5, edgeAlpha: 1 }));
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const svg = renderMorph(iso, flat, t, { step: 5 });
    expect(svg).not.toContain('NaN');
    expect(svg).toContain('LAMBDA');
  }
  expect(renderMorph(flat, iso, 0.5, { step: 2 })).not.toContain('NaN');
});
test.skipIf(!existsSync(join(dir, '..', 'icons', 'aws.json')))('the AWS-icon example works when the pack has been imported', async () => {
  registerIcons(await Bun.file(join(dir, '..', 'icons', 'aws.json')).json());
  const spec: Spec = await Bun.file(join(dir, 'with-aws-icons', 'aws-simple.json')).json();
  expect(validate(spec)).toEqual([]);
  expect(renderFrame(compile(spec))).toContain('<image');
});

test('three views: 3d has perspective and a free camera, iso and flat are fixed', () => {
  const s = base(); s.camera = { yaw: 10, pitch: 50 }; s.steps = [{ show: ['a', 'b'] }, { camera: { yaw: 30, zoom: 1.2 } }];
  const cam = (v: '3d' | 'iso' | 'flat', i: number) => compile(s, v).states[i].cam;
  expect(cam('3d', 0)).toMatchObject({ yaw: 10, pitch: 50 });
  expect(cam('3d', 0).persp).toBeGreaterThan(0);
  expect(cam('3d', 1)).toMatchObject({ yaw: 30, zoom: 1.2 });
  expect(cam('iso', 1)).toMatchObject({ yaw: 45, pitch: 35.264, persp: 0, zoom: 1.2 });
  expect(cam('flat', 1)).toMatchObject({ yaw: 0, pitch: 90, persp: 0, zoom: 1.2 });
  expect(compile(s).view).toBe('3d'); // the default
  (s as any).view = 'sideways';
  expect(has(validate(s), 'must be one of')).toBe(true);
});
test('in the 3d view nearer boxes are drawn larger; in iso they are the same size', () => {
  const s = base(); s.nodes[1].at = [0, 4]; s.edges = [];
  const widths = (v: '3d' | 'iso') => [...renderFrame(compile(s, v)).matchAll(/font-size="20" text-anchor="middle"[^>]*>|matrix\(([-\d.]+) /g)].map((m) => Number(m[1])).filter((n) => !Number.isNaN(n));
  const iso = widths('iso'), d3 = widths('3d');
  expect(new Set(iso.map((n) => n.toFixed(3))).size).toBe(1);
  expect(new Set(d3.map((n) => n.toFixed(3))).size).toBeGreaterThan(1);
});
test('moving between 3d and iso keeps the lines on screen throughout', async () => {
  const spec = await load('07-aws-events-3d.json');
  const [d3, iso] = [compile(spec, '3d'), compile(spec, 'iso')];
  const mid = renderMorph(d3, iso, 0.5, { step: 5 });
  expect(mid).toContain('<polyline');
  expect(mid).not.toContain('NaN');
  expect(renderMorph(d3, iso, 1, { step: 5 })).toBe(renderFrame(iso, { step: 5, edgeAlpha: 1 }));
});

// --- big scenes: level of detail and guided tours ---------------------------
test('a big scene is refused whole, accepted as a tour, and names what a tour misses', async () => {
  const spec = await load('10-platform-50.json');
  expect(spec.nodes.length).toBe(50);
  for (const v of ['3d', 'iso', 'flat'] as const) expect(validate(spec, v)).toEqual([]);
  const whole = { ...spec, steps: [{ show: spec.nodes.map((n) => n.id) }], callouts: [] };
  expect(has(validate(whole), 'too big to read on one slide')).toBe(true);
  expect(has(validate(whole), 'tour it')).toBe(true);
  const short = { ...spec, steps: spec.steps!.slice(0, 3) }; // the map and only two stops
  const errs = validate(short);
  expect(has(errs, 'Never large enough to read')).toBe(true);
  expect(has(errs, 'pipeline')).toBe(true);
  expect(has(errs, 'cdn,')).toBe(false); // the stops it does have still count
});
test('seen whole, a big scene shows area names but not small words; up close it shows them', async () => {
  const scene = compile(await load('10-platform-50.json'));
  const far = renderFrame(scene, { step: 0 }), near = renderFrame(scene, { step: 6 });
  expect(far).toContain('>FINANCE</text>');
  expect(far).not.toContain('>money records</text>');
  expect(near).toContain('>LEDGER</text>');
  expect(near).toContain('>money records</text>');
});
test('a callout near the edge slides to stay inside the frame', () => {
  const s = base();
  s.callouts = [{ id: 'note', text: 'A fairly long note that makes a wide box.', on: 'b', side: 'down' }];
  s.steps = [{ show: ['a', 'b'], callout: ['note'], camera: { target: ['a'], zoom: 2.2 } }];
  const m = renderFrame(compile(s)).match(/<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)" height="[\d.]+" rx="6"/)!;
  const anchor = Number(renderFrame(compile(s)).match(/<circle cx="([\d.]+)" cy="[\d.]+" r="4"/)![1]);
  expect(Number(m[1]) + Number(m[2])).toBeLessThanOrEqual(1280 - 14 + 0.1);
  expect(anchor + Number(m[2]) / 2).toBeGreaterThan(1280 - 14); // it would have overflowed if centred
});

// --- line routing ------------------------------------------------------------
test('each line gets one of four shapes, and joins are marked', async () => {
  const { model } = compile(await load('11-aws-routing.json'));
  const shape = (id: string) => model.edges.find((e) => e.id === id)!.shape;
  expect(shape('users>cdn')).toBe('straight');
  expect(shape('dns>cdn')).toBe('L');
  expect(shape('waf>site')).toBe('Z');
  expect(shape('fn>bus')).toBe('U');
  expect(model.edges.length).toBe(29);
  // the three lines out of the firewall branch at one marked point
  expect(model.junctions.some((j) => Math.abs(j.at[0] - 11.3) < 0.01 && Math.abs(j.at[1] - 6.1) < 0.01)).toBe(true);
  expect(renderFrame(compile(await load('11-aws-routing.json')))).toContain('<circle');
});
test('lines a design might want are refused when they would cross or tangle', async () => {
  const spec = await load('11-aws-routing.json');
  const withEdge = (e: any) => validate({ ...spec, edges: [...spec.edges!, e] });
  expect(has(withEdge({ from: 'fn', to: 'cache', channel: 19.6 }), '"fn>bus" and "fn>cache" cross')).toBe(true);
  expect(has(withEdge({ from: 'flow', to: 'table', channel: 19.6 }), 'run along each other or meet')).toBe(true);
  expect(has(withEdge({ from: 'sns', to: 'queue', via: 'yx' }), 'runs through node')).toBe(true);
});

test('the 3d view looks straight on unless a spec turns it', () => {
  const s = base();
  expect(compile(s).states[0].cam.yaw).toBe(0);
  s.camera = { yaw: 22 };
  expect(compile(s).states[0].cam.yaw).toBe(22);
});
test('straight on, boxes either side of centre show the side that faces the middle', () => {
  const s = base();
  s.nodes = [{ id: 'a', label: 'A', at: [0, 0] }, { id: 'b', label: 'B', at: [12, 0] }];
  s.edges = []; s.steps = undefined;
  const svg = renderFrame(compile(s), { step: 0 });
  // top + front + one side for each of the two boxes
  expect(svg.match(/<polygon/g)!.length).toBe(6);
});
test('the tutorial specs pass in every view, and the broken one is refused', async () => {
  for (const f of ['1-two-boxes', '2-steps', '3-meaning', '4-photo-upload'])
    for (const v of ['3d', 'iso', 'flat'] as const) expect(validate(await load(`tutorial/${f}.json`), v)).toEqual([]);
  expect(validate(await load('tutorial/broken.json')).length).toBeGreaterThan(0);
});

// --- any icons --------------------------------------------------------------
import { iconImage, iconProblem } from '../src/icons';
import { cleanSvg, iconFromBytes, loadIcons } from '../src/files';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
test('an icon may be SVG text or a PNG, JPEG, WebP or GIF data URI, and nothing else', () => {
  expect(iconProblem('<svg viewBox="0 0 1 1"/>')).toBeNull();
  expect(iconProblem(PNG)).toBeNull();
  expect(iconProblem('data:image/webp;base64,AAAA')).toBeNull();
  expect(iconProblem('data:image/bmp;base64,AAAA')).toContain('SVG, PNG');
  expect(iconProblem('data:text/html,<svg>')).not.toBeNull();
  expect(iconProblem('hello')).not.toBeNull();
  expect(registerIcons({ 'acme:ok': PNG, 'acme:no': 'hello' })).toEqual(['acme:no: it is neither SVG text nor an image data URI']);
});
test('an SVG drawn in currentColor takes the node colour; other pictures keep their own', () => {
  registerIcons({ 'acme:line': '<svg viewBox="0 0 24 24" stroke="currentColor"><path d="M1 1h9"/></svg>', 'acme:pic': PNG });
  expect(decodeURIComponent(iconImage('acme:line', '#123456')!)).toContain('stroke="#123456"');
  expect(iconImage('acme:pic', '#123456')).toBe(PNG);
  const s = base(); s.nodes[0].icon = 'acme:line'; s.nodes[0].kind = 'gate'; s.nodes[0].size = [2.6, 1]; s.nodes[1].at = [4, 0];
  expect(validate(s)).toEqual([]);
  const drawn = renderFrame(compile(s), { step: 0 });
  expect(drawn).toContain('<image href="data:image/svg+xml');
  expect(drawn).not.toContain('currentColor');
});
test('a spec can carry its own icons, and a bad one is named', () => {
  const s = base(); s.nodes[0].size = [2.6, 1]; s.nodes[1].at = [4, 0]; s.nodes[0].icon = 'mine';
  s.icons = { mine: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg>' };
  expect(validate(s)).toEqual([]);
  expect(renderFrame(compile(s), { step: 0 })).toContain('<image href="data:image/svg+xml');
  s.icons = { mine: 'art/logo.bmp' };
  expect(has(validate(s), 'not a format it can draw')).toBe(true);
  s.icons = { database: PNG };
  expect(has(validate(s), 'built-in icon')).toBe(true);
  s.icons = { mine: 'art/unread.svg' }; s.nodes[0].icon = 'mine2'; s.icons.mine2 = 'art/unread.svg';
  expect(has(validate(s), 'has not been read')).toBe(true);
});
test('files become icons: SVG is tidied, pictures become data URIs, other formats are refused', () => {
  const svg = cleanSvg('<?xml version="1.0"?><!-- x --><svg width="48" height="32" onload="x()"><script>alert(1)</script><rect/></svg>');
  expect(svg).toContain('viewBox="0 0 48 32"');
  expect(svg).not.toMatch(/script|onload|<!--/);
  expect(iconFromBytes(new Uint8Array([1, 2, 3]), 'a.PNG')).toBe('data:image/png;base64,AQID');
  expect(() => iconFromBytes(new Uint8Array([1]), 'a.bmp')).toThrow('SVG, PNG');
  expect(() => iconFromBytes(new Uint8Array(600 * 1024), 'a.png')).toThrow('KB');
});
test('the own-icons example reads its files and passes in every view', async () => {
  const p = join(dir, '12-own-icons.json'), spec: Spec = await Bun.file(p).json();
  await loadIcons(spec, p);
  expect(spec.icons!.camera).toContain('<svg');
  expect(spec.icons!.album).toStartWith('data:image/png;base64,');
  for (const v of ['3d', 'iso', 'flat'] as const) expect(validate(spec, v)).toEqual([]);
  const missing: Spec = { ...spec, icons: { ...spec.icons, camera: 'art/nope.svg' } };
  expect(loadIcons(missing, p)).rejects.toThrow('no such file');
});
