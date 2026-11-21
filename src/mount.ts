// Browser runtime: puts a scene on the page and moves it step by step.
// Bundled into dist/scene-plates.min.js, which defines <scene-plate> and a
// global ScenePlates.

import { VIEWS, type Spec, type View } from './spec';
import { tokens as T, type ThemeName } from './tokens';
import { compile, type Scene } from './scene';
import { renderFrame, renderMorph } from './render';
import { validate } from './validate';
import { ICON_TYPES, isInlineIcon, registerIcons, type IconPack } from './icons';

export interface MountOpts {
  theme?: ThemeName | 'auto';
  bare?: boolean;
  keys?: boolean;
  view?: View;
  title?: boolean; // false leaves the title out, for slides with their own heading
  toggle?: boolean; // show a control that switches between 3D, isometric and flat
}
export interface Controller {
  readonly step: number;
  readonly stepCount: number;
  readonly view: View;
  next(): boolean; // false when already on the last step, so a deck can move on
  prev(): boolean;
  go(i: number): boolean;
  restart(atEnd?: boolean): void; // replay the entrance; atEnd jumps to the last step
  setView(v: View): boolean; // false when the scene cannot be drawn that way
  toggleView(): boolean; // moves to the next view the scene can be drawn in
  destroy(): void;
}

const NAMES: Record<View, string> = { '3d': '3D', iso: 'Isometric', flat: 'Flat' };

export function mount(el: HTMLElement, spec: Spec, opts: MountOpts = {}): Controller {
  const showTitle = opts.title !== false;
  let view: View = opts.view ?? spec.view ?? '3d';
  const errs = validate(spec, view);
  if (errs.length) {
    const pre = document.createElement('pre');
    pre.style.cssText = 'white-space:pre-wrap;font:13px ui-monospace,Menlo,monospace;color:#D6002A;border:1px dashed #D6002A;padding:12px;margin:0';
    pre.textContent = `This scene has ${errs.length} problem${errs.length > 1 ? 's' : ''}:\n` + errs.map((m) => '- ' + m).join('\n');
    el.replaceChildren(pre);
    return { step: 0, stepCount: 0, view, next: () => false, prev: () => false, go: () => false, restart() {}, setView: () => false, toggleView: () => false, destroy() {} };
  }
  // One compiled scene per view; the others are built the first time they are asked for.
  const scenes: Partial<Record<View, Scene | null>> = { [view]: compile(spec, view, showTitle) };
  const sceneFor = (v: View): Scene | null => {
    if (scenes[v] === undefined) scenes[v] = validate(spec, v).length ? null : compile(spec, v, showTitle);
    return scenes[v] ?? null;
  };
  const scene = () => scenes[view]!;
  const last = scene().states.length - 1;
  const still = matchMedia('(prefers-reduced-motion: reduce)'), dark = matchMedia('(prefers-color-scheme: dark)');
  let step = 0, from = -1, t0 = performance.now(), raf = 0, onScreen = true, entered = false;
  let morph: { from: View; t0: number } | null = null;

  const stage = document.createElement('div');
  el.replaceChildren(stage);
  let bar: HTMLDivElement | null = null;
  const usable = () => VIEWS.filter((v) => sceneFor(v));
  const nextView = (): View => { const u = usable(); return u[(u.indexOf(view) + 1) % u.length]; };

  const theme = (): ThemeName => {
    if (opts.theme && opts.theme !== 'auto') return opts.theme;
    const set = el.closest<HTMLElement>('[data-theme]')?.dataset.theme;
    return set === 'dark' || set === 'light' ? set : dark.matches ? 'dark' : 'light';
  };
  const dress = () => {
    if (!bar) return;
    const th = T.themes[theme()];
    bar.style.cssText = `position:absolute;top:2.2%;right:1.6%;display:flex;border-radius:999px;overflow:hidden;border:1px solid ${th.plateStroke};background:${th.surface}`;
    for (const b of bar.querySelectorAll('button')) {
      const on = b.dataset.view === view;
      b.setAttribute('aria-pressed', String(on));
      b.style.cssText = `font:500 12px ${T.font.caption};padding:5px 11px;border:0;cursor:pointer;background:${on ? th.ink : 'transparent'};color:${on ? th.bg : th.muted}`;
    }
  };
  const draw = (now: number) => {
    const reduced = still.matches, base = { step, theme: theme(), reducedMotion: reduced, bare: opts.bare, time: now };
    if (morph) {
      const m = reduced ? 1 : Math.min(1, (now - morph.t0) / T.motion.morph);
      stage.innerHTML = renderMorph(scenes[morph.from]!, scene(), m, base);
      if (m >= 1) morph = null;
      raf = requestAnimationFrame(draw);
      return;
    }
    const progress = reduced ? 1 : Math.min(1, (now - t0) / T.motion.step);
    stage.innerHTML = renderFrame(scene(), { ...base, from, progress });
    const moving = progress < 1 || (!reduced && onScreen && scene().states[step].pulse.size > 0);
    raf = moving ? requestAnimationFrame(draw) : 0;
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(draw); };
  const go = (i: number) => {
    i = Math.max(0, Math.min(last, i));
    if (i === step) return false;
    morph = null;
    from = step; step = i; t0 = performance.now();
    kick();
    el.dispatchEvent(new CustomEvent('sceneplate:step', { bubbles: true, detail: { step, stepCount: last + 1 } }));
    return true;
  };
  const restart = (atEnd = false) => { morph = null; step = atEnd ? last : 0; from = atEnd ? last : -1; t0 = performance.now(); kick(); };
  const setView = (v: View) => {
    if (v === view) return true;
    if (!sceneFor(v)) return false;
    morph = { from: view, t0: performance.now() };
    view = v; from = step; t0 = 0; // the step itself is already settled
    dress();
    kick();
    el.dispatchEvent(new CustomEvent('sceneplate:view', { bubbles: true, detail: { view } }));
    return true;
  };

  if (opts.toggle && usable().length > 1) {
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    bar = document.createElement('div');
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', 'View (F switches)');
    for (const v of usable()) {
      const b = document.createElement('button');
      b.type = 'button'; b.dataset.view = v; b.textContent = NAMES[v];
      b.addEventListener('click', (e) => { e.stopPropagation(); setView(v); });
      // Space and Enter press the button; they must not also advance the scene. Arrows pass through.
      b.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') e.stopPropagation(); });
      bar.append(b);
    }
    el.append(bar);
    dress();
  }

  // Play the entrance when the scene first comes into view, and stop the pulse
  // loop while it is off screen.
  const io = new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    if (onScreen && !entered) { entered = true; restart(); } else if (onScreen) kick();
  });
  io.observe(el);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'f' || e.key === 'F') { if (usable().length > 1 && setView(nextView())) { e.preventDefault(); e.stopPropagation(); } return; }
    const fwd = e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown', back = e.key === 'ArrowLeft' || e.key === 'PageUp';
    if ((fwd && go(step + 1)) || (back && go(step - 1))) { e.preventDefault(); e.stopPropagation(); }
  };
  const onClick = (e: MouseEvent) => { if (go(step + 1)) e.stopPropagation(); };
  const repaint = () => { dress(); kick(); };
  if (opts.keys !== false) { el.addEventListener('keydown', onKey); el.addEventListener('click', onClick); }
  dark.addEventListener('change', repaint);
  still.addEventListener('change', kick);
  draw(t0);

  return {
    get step() { return step; },
    get stepCount() { return last + 1; },
    get view() { return view; },
    next: () => go(step + 1), prev: () => go(step - 1), go, restart, setView,
    toggleView: () => usable().length > 1 && setView(nextView()),
    destroy() { cancelAnimationFrame(raf); io.disconnect(); el.removeEventListener('keydown', onKey); el.removeEventListener('click', onClick); dark.removeEventListener('change', repaint); still.removeEventListener('change', kick); },
  };
}

// Read the pictures a spec's own "icons" point at, relative to the spec. One
// that cannot be read is left as it is, and the checker then names it.
async function fetchIcons(spec: Spec, base: string): Promise<void> {
  const own = spec.icons;
  if (!own || typeof own !== 'object') return;
  await Promise.all(Object.entries(own).map(async ([name, v]) => {
    if (typeof v !== 'string' || isInlineIcon(v) || /^data:/i.test(v)) return;
    try {
      const url = new URL(v, base), res = await fetch(url);
      if (!res.ok) return;
      const ext = url.pathname.split('.').pop()!.toLowerCase();
      if (ext === 'svg') { own[name] = await res.text(); return; }
      const bytes = new Uint8Array(await res.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
      if (ICON_TYPES[ext]) own[name] = `data:${ICON_TYPES[ext]};base64,${btoa(bin)}`;
    } catch { /* the checker reports it */ }
  }));
}

// A page can hand over icon packs before this script loads.
registerIcons((globalThis as any).ScenePlateIcons ?? {});

// <scene-plate src="flow.json"></scene-plate>, or with the JSON inline in a
// <script type="application/json"> child. Attributes: view, theme, bare,
// toggle, notitle, icons (the addresses of icon packs, with spaces between).
if (typeof customElements !== 'undefined' && !customElements.get('scene-plate')) {
  class ScenePlate extends HTMLElement {
    ctl?: Controller;
    async connectedCallback() {
      if (this.ctl) return;
      let spec: Spec;
      try {
        const src = this.getAttribute('src'), icons = this.getAttribute('icons');
        for (const pack of (icons ?? '').split(/\s+/).filter(Boolean)) registerIcons((await (await fetch(pack)).json()) as IconPack);
        spec = src ? await (await fetch(src)).json() : JSON.parse(this.querySelector('script[type="application/json"]')!.textContent!);
        await fetchIcons(spec, new URL(src ?? '', document.baseURI).href);
      } catch (e) {
        this.textContent = `scene-plate: could not read the spec (${(e as Error).message})`;
        return;
      }
      if (!this.hasAttribute('tabindex')) this.tabIndex = 0;
      this.ctl = mount(this, spec, {
        theme: (this.getAttribute('theme') as ThemeName) ?? 'auto', bare: this.hasAttribute('bare'),
        view: (this.getAttribute('view') as View) ?? undefined, toggle: this.hasAttribute('toggle'), title: !this.hasAttribute('notitle'),
      });
    }
    disconnectedCallback() { this.ctl?.destroy(); this.ctl = undefined; }
    get step() { return this.ctl?.step ?? 0; }
    get stepCount() { return this.ctl?.stepCount ?? 0; }
    get view() { return this.ctl?.view ?? '3d'; }
    next() { return this.ctl?.next() ?? false; }
    prev() { return this.ctl?.prev() ?? false; }
    go(i: number) { return this.ctl?.go(i) ?? false; }
    restart(atEnd?: boolean) { this.ctl?.restart(atEnd); }
    setView(v: View) { return this.ctl?.setView(v) ?? false; }
    toggleView() { return this.ctl?.toggleView() ?? false; }
  }
  customElements.define('scene-plate', ScenePlate);
}

(globalThis as any).ScenePlates = { mount, validate, compile, renderFrame, renderMorph, registerIcons, tokens: T };
