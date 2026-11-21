#!/usr/bin/env bun
// scene-plates check <spec.json>...
// scene-plates svg <spec.json> [--step N | --all] [--theme light|dark] [-o file-or-folder]
// scene-plates html <spec.json>... -o deck.html

import { mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { Spec, View } from './spec';
import type { ThemeName } from './tokens';
import { compile } from './scene';
import { renderFrame } from './render';
import { validate } from './validate';

const [cmd, ...rest] = process.argv.slice(2);
const flags: Record<string, string | true> = {};
const files: string[] = [];
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (a === '--all') flags.all = true;
  else if (a === '-o' || a === '--step' || a === '--theme' || a === '--view') flags[a.replace(/^-+/, '')] = rest[++i];
  else files.push(a);
}

const view = flags.view as View | undefined;
if (view && view !== 'iso' && view !== 'flat') fail('--view must be iso or flat');

async function load(path: string): Promise<Spec> {
  let spec: Spec;
  try { spec = await Bun.file(path).json(); } catch (e) { fail(`${path}: not readable JSON (${(e as Error).message})`); }
  const errs = validate(spec!, view);
  if (errs.length) fail(`${path}: ${errs.length} problem${errs.length > 1 ? 's' : ''}\n` + errs.map((m) => `  - ${m}`).join('\n'));
  return spec!;
}
function fail(msg: string): never { console.error(msg); process.exit(1); }
const usage = () => fail('Usage:\n  scene-plates check <spec.json>...\n  scene-plates svg <spec.json> [--step N | --all] [--theme light|dark] [--view iso|flat] [-o file-or-folder]\n  scene-plates html <spec.json>... -o deck.html');

if (!cmd || !files.length) usage();

if (cmd === 'check') {
  for (const p of files) { const s = await load(p); console.log(`ok  ${p}  (${s.nodes.length} nodes, ${(s.steps ?? []).length || 1} steps, ${view ?? s.view ?? 'iso'})`); }
} else if (cmd === 'svg') {
  const spec = await load(files[0]), scene = compile(spec, view);
  const theme = (flags.theme as ThemeName) ?? 'light';
  if (flags.all) {
    const dir = (flags.o as string) ?? 'out';
    mkdirSync(dir, { recursive: true });
    const stem = basename(files[0]).replace(/\.json$/, '');
    for (let i = 0; i < scene.states.length; i++) await Bun.write(join(dir, `${stem}-${String(i + 1).padStart(2, '0')}.svg`), renderFrame(scene, { step: i, theme, reducedMotion: true }));
    console.log(`wrote ${scene.states.length} stills to ${dir}/`);
  } else {
    const step = flags.step ? Number(flags.step) - 1 : scene.states.length - 1;
    const svg = renderFrame(scene, { step, theme, reducedMotion: true });
    if (flags.o) { mkdirSync(dirname(flags.o as string), { recursive: true }); await Bun.write(flags.o as string, svg); } else console.log(svg);
  }
} else if (cmd === 'html') {
  if (!flags.o) usage();
  const specs = await Promise.all(files.map(load));
  const built = await Bun.build({ entrypoints: [join(import.meta.dir, 'mount.ts')], format: 'iife', minify: true });
  if (!built.success) fail(built.logs.join('\n'));
  const js = (await built.outputs[0].text()).replace(/<\/script/gi, '<\\/script');
  const safe = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const slides = specs.map((s, i) =>
    `<section class="slide"${i ? '' : ' data-on'}><h1>${safe(s.title)}</h1><scene-plate${view ? ` view="${view}"` : ''}><script type="application/json">${JSON.stringify(s).replace(/</g, '\\u003c')}</script></scene-plate></section>`).join('\n');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safe(specs.length === 1 ? specs[0].title : 'Scene plates')}</title>
<style>
:root{--bg:#F5F7FA;--ink:#14202E;--muted:#4A5A6A}
@media (prefers-color-scheme:dark){:root{--bg:#0D1520;--ink:#E8EEF5;--muted:#9AA9B8}}
*{box-sizing:border-box}html,body{margin:0;height:100%;background:var(--bg);color:var(--ink);font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
.slide{display:none;height:100%;flex-direction:column;align-items:center;justify-content:center;padding:16px}
.slide[data-on]{display:flex}
h1{font-size:clamp(18px,3vw,34px);font-weight:650;margin:0 0 8px;text-align:center}
scene-plate{display:block;width:min(100%,calc((100vh - 110px)*16/9));cursor:pointer;outline:none}
.hint{position:fixed;left:0;right:0;bottom:6px;text-align:center;font-size:12px;color:var(--muted)}
@media print{.slide{display:flex;height:auto;break-after:page}.hint{display:none}}
</style></head><body>
${slides}
<div class="hint">Right arrow, space or click: next step. Left arrow: back.</div>
<script>${js}</script>
<script>
(function(){
  var slides=[].slice.call(document.querySelectorAll('.slide')),at=0;
  function plate(){return slides[at].querySelector('scene-plate')}
  function show(i,end){if(i<0||i>=slides.length)return;slides[at].removeAttribute('data-on');at=i;slides[at].setAttribute('data-on','');var p=plate();if(p&&p.restart)p.restart(end)}
  function next(){var p=plate();if(!(p&&p.next()))show(at+1,false)}
  function prev(){var p=plate();if(!(p&&p.prev()))show(at-1,true)}
  document.addEventListener('keydown',function(e){
    if(e.key==='ArrowRight'||e.key===' '||e.key==='PageDown'){e.preventDefault();next()}
    else if(e.key==='ArrowLeft'||e.key==='PageUp'){e.preventDefault();prev()}
  });
  document.addEventListener('click',next);
})();
</script>
</body></html>
`;
  await Bun.write(flags.o as string, html);
  console.log(`wrote ${flags.o} (${specs.length} scene${specs.length > 1 ? 's' : ''}, ${Math.round(html.length / 1024)} KB, no outside files)`);
} else usage();
