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
