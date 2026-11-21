#!/usr/bin/env bun
// Turns a scene into an animated GIF: bun scripts/gif.ts spec.json out.gif [--theme dark] [--width 960]
// Needs rsvg-convert and ffmpeg on the PATH (brew install librsvg ffmpeg).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';
import { compile } from '../src/scene';
import { renderFrame } from '../src/render';
import { validate } from '../src/validate';
import { tokens as T, type ThemeName } from '../src/tokens';

const args = process.argv.slice(2);
const opt = (name: string, d: string) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : d; };
const theme = opt('--theme', 'light') as ThemeName, width = opt('--width', '960');
const view = (opt('--view', '') || undefined) as 'iso' | 'flat' | undefined;
const [specPath, outPath] = args;
if (!specPath || !outPath) { console.error('Usage: bun scripts/gif.ts spec.json out.gif [--theme dark] [--width 960]'); process.exit(1); }

const spec = await Bun.file(specPath).json();
const errs = validate(spec, view);
if (errs.length) { console.error(errs.map((e) => '- ' + e).join('\n')); process.exit(1); }

const scene = compile(spec, view), fps = 15, hold = 1900, dir = mkdtempSync(join(tmpdir(), 'scene-plates-'));
let n = 0;
for (let step = 0; step < scene.states.length; step++) {
  for (let t = 0; t < T.motion.step + hold; t += 1000 / fps) {
    const svg = renderFrame(scene, { step, from: step - 1, progress: Math.min(1, t / T.motion.step), time: t, theme });
    const stem = join(dir, String(n++).padStart(5, '0'));
    await Bun.write(stem + '.svg', svg);
    await $`rsvg-convert -w ${width} ${stem}.svg -o ${stem}.png`.quiet();
  }
}
const filter = 'split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=none';
await $`ffmpeg -y -loglevel error -framerate ${fps} -i ${dir}/%05d.png -vf ${filter} ${outPath}`;
rmSync(dir, { recursive: true });
console.log(`wrote ${outPath} (${n} frames)`);
