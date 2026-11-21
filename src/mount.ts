// Browser runtime: puts a scene on the page and moves it step by step.
// Bundled into dist/scene-plates.min.js, which defines <scene-plate> and a
// global ScenePlates.

import type { Spec, View } from './spec';
import { tokens as T, type ThemeName } from './tokens';
import { compile } from './scene';
import { renderFrame } from './render';
import { validate } from './validate';

export interface MountOpts { theme?: ThemeName | 'auto'; bare?: boolean; keys?: boolean; view?: View }
export interface Controller {
  readonly step: number;
  readonly stepCount: number;
  next(): boolean; // false when already on the last step, so a deck can move on
  prev(): boolean;
  go(i: number): boolean;
  restart(atEnd?: boolean): void; // replay the entrance; atEnd jumps to the last step
  destroy(): void;
}

export function mount(el: HTMLElement, spec: Spec, opts: MountOpts = {}): Controller {
  const errs = validate(spec, opts.view);
  if (errs.length) {
    const pre = document.createElement('pre');
    pre.style.cssText = 'white-space:pre-wrap;font:13px ui-monospace,Menlo,monospace;color:#D6002A;border:1px dashed #D6002A;padding:12px;margin:0';
    pre.textContent = `This scene has ${errs.length} problem${errs.length > 1 ? 's' : ''}:\n` + errs.map((m) => '- ' + m).join('\n');
    el.replaceChildren(pre);
    return { step: 0, stepCount: 0, next: () => false, prev: () => false, go: () => false, restart() {}, destroy() {} };
  }
  const scene = compile(spec, opts.view), last = scene.states.length - 1;
  const still = matchMedia('(prefers-reduced-motion: reduce)'), dark = matchMedia('(prefers-color-scheme: dark)');
  let step = 0, from = -1, t0 = performance.now(), raf = 0, onScreen = true, entered = false;

  const theme = (): ThemeName => {
    if (opts.theme && opts.theme !== 'auto') return opts.theme;
    const set = el.closest<HTMLElement>('[data-theme]')?.dataset.theme;
    return set === 'dark' || set === 'light' ? set : dark.matches ? 'dark' : 'light';
  };
  const draw = (now: number) => {
    const reduced = still.matches;
    const progress = reduced ? 1 : Math.min(1, (now - t0) / T.motion.step);
    el.innerHTML = renderFrame(scene, { step, from, progress, time: now, theme: theme(), reducedMotion: reduced, bare: opts.bare });
    const moving = progress < 1 || (!reduced && onScreen && scene.states[step].pulse.size > 0);
    raf = moving ? requestAnimationFrame(draw) : 0;
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(draw); };
  const go = (i: number) => {
    i = Math.max(0, Math.min(last, i));
    if (i === step) return false;
    from = step; step = i; t0 = performance.now();
    kick();
    el.dispatchEvent(new CustomEvent('sceneplate:step', { bubbles: true, detail: { step, stepCount: last + 1 } }));
    return true;
  };
  const restart = (atEnd = false) => { step = atEnd ? last : 0; from = atEnd ? last : -1; t0 = performance.now(); kick(); };

  // Play the entrance when the scene first comes into view, and stop the pulse
  // loop while it is off screen.
  const io = new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    if (onScreen && !entered) { entered = true; restart(); } else if (onScreen) kick();
  });
  io.observe(el);

  const onKey = (e: KeyboardEvent) => {
    const fwd = e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown', back = e.key === 'ArrowLeft' || e.key === 'PageUp';
    if ((fwd && go(step + 1)) || (back && go(step - 1))) { e.preventDefault(); e.stopPropagation(); }
  };
  const onClick = (e: MouseEvent) => { if (go(step + 1)) e.stopPropagation(); };
  if (opts.keys !== false) { el.addEventListener('keydown', onKey); el.addEventListener('click', onClick); }
  dark.addEventListener('change', kick);
  still.addEventListener('change', kick);
  draw(t0);

  return {
    get step() { return step; },
    get stepCount() { return last + 1; },
    next: () => go(step + 1), prev: () => go(step - 1), go, restart,
    destroy() { cancelAnimationFrame(raf); io.disconnect(); el.removeEventListener('keydown', onKey); el.removeEventListener('click', onClick); dark.removeEventListener('change', kick); still.removeEventListener('change', kick); },
  };
}

// <scene-plate src="flow.json"></scene-plate>, or with the JSON inline in a
// <script type="application/json"> child.
if (typeof customElements !== 'undefined' && !customElements.get('scene-plate')) {
  class ScenePlate extends HTMLElement {
    ctl?: Controller;
    async connectedCallback() {
      if (this.ctl) return;
      let spec: Spec;
      try {
        const src = this.getAttribute('src');
        spec = src ? await (await fetch(src)).json() : JSON.parse(this.querySelector('script[type="application/json"]')!.textContent!);
      } catch (e) {
        this.textContent = `scene-plate: could not read the spec (${(e as Error).message})`;
        return;
      }
      if (!this.hasAttribute('tabindex')) this.tabIndex = 0;
      this.ctl = mount(this, spec, { theme: (this.getAttribute('theme') as ThemeName) ?? 'auto', bare: this.hasAttribute('bare'), view: (this.getAttribute('view') as View) ?? undefined });
    }
    disconnectedCallback() { this.ctl?.destroy(); this.ctl = undefined; }
    get step() { return this.ctl?.step ?? 0; }
    get stepCount() { return this.ctl?.stepCount ?? 0; }
    next() { return this.ctl?.next() ?? false; }
    prev() { return this.ctl?.prev() ?? false; }
    go(i: number) { return this.ctl?.go(i) ?? false; }
    restart(atEnd?: boolean) { this.ctl?.restart(atEnd); }
  }
  customElements.define('scene-plate', ScenePlate);
}

(globalThis as any).ScenePlates = { mount, validate, compile, renderFrame, tokens: T };
