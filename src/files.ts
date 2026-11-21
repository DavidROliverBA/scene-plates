// Reading icons from disk, for the command line. Not part of the browser bundle.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join } from 'node:path';
import type { Spec } from './spec';
import { ICON_TYPES, builtinIcons, hasIcon, iconProblem, iconSource, isInlineIcon, registerIcons } from './icons';

export const MAX_ICON_BYTES = 512 * 1024;

// Tidy an SVG so it draws at any size: no scripts or comments, and a viewBox.
export function cleanSvg(svg: string): string {
  let s = svg.replace(/^\uFEFF/, '').replace(/<\?xml[\s\S]*?\?>/g, '').replace(/<!DOCTYPE[\s\S]*?>/gi, '').replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '').replace(/>\s+</g, '><').trim();
  const open = s.match(/<svg\b[^>]*>/i)?.[0] ?? '';
  if (open && !/viewBox\s*=/i.test(open)) {
    const num = (k: string) => parseFloat(open.match(new RegExp(`\\s${k}\\s*=\\s*["']([\\d.]+)`, 'i'))?.[1] ?? '');
    const w = num('width'), h = num('height');
    if (w > 0 && h > 0) s = s.replace(open, open.replace(/<svg\b/i, `<svg viewBox="0 0 ${w} ${h}"`));
  }
  if (open && !/xmlns\s*=/i.test(open)) s = s.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  return s;
}

// One file as an icon value: SVG text, or a data URI for a picture.
export function iconFromBytes(bytes: Uint8Array, name: string): string {
  const ext = extname(name).slice(1).toLowerCase(), type = ICON_TYPES[ext];
  if (!type) throw new Error(`".${ext}" is not a format it can draw; use SVG, PNG, JPEG, WebP or GIF`);
  if (bytes.length > MAX_ICON_BYTES) throw new Error(`it is ${Math.round(bytes.length / 1024)} KB; icons over ${MAX_ICON_BYTES / 1024} KB make decks slow, so shrink it first`);
  if (ext === 'svg') {
    const svg = cleanSvg(new TextDecoder().decode(bytes));
    if (iconProblem(svg)) throw new Error('it has no <svg> element');
    return svg;
  }
  return `data:${type};base64,${Buffer.from(bytes).toString('base64')}`;
}
export const iconFromFile = (path: string) => iconFromBytes(readFileSync(path), path);

// Make a spec ready to draw: load any pack its icon names point at, and read
// the files its own "icons" name, so the spec carries the artwork itself.
const owners = new Map<string, { value: string; spec: string }>();
export async function loadIcons(spec: Spec, specPath: string): Promise<void> {
  const own = spec.icons;
  if (own && typeof own === 'object' && !Array.isArray(own)) {
    for (const [name, v] of Object.entries(own)) {
      if (typeof v !== 'string' || builtinIcons().includes(name)) continue; // the checker reports these
      let value = v;
      if (!isInlineIcon(v) && !/^data:/i.test(v)) {
        try {
          if (/^https?:\/\//i.test(v)) {
            const res = await fetch(v);
            if (!res.ok) throw new Error(`the server answered ${res.status}`);
            value = iconFromBytes(new Uint8Array(await res.arrayBuffer()), new URL(v).pathname);
          } else value = iconFromFile(isAbsolute(v) ? v : join(dirname(specPath), v));
        } catch (e) {
          throw new Error(`${specPath}: icon "${name}" (${v}) could not be used: ${(e as Error).message.replace(/^ENOENT.*/, 'no such file')}.`);
        }
      }
      const seen = owners.get(name);
      if (seen && seen.value !== value && seen.spec !== specPath) throw new Error(`${specPath}: icon "${name}" is a different picture in ${seen.spec}. Scenes drawn together share icon names, so rename one.`);
      owners.set(name, { value, spec: specPath });
      own[name] = value;
    }
    registerIcons(Object.fromEntries(Object.entries(own).filter(([, v]) => isInlineIcon(v))));
  }
  // "aws:lambda" loads icons/aws.json from beside the spec, from here, or from the repo.
  for (const n of spec.nodes ?? []) {
    const prefix = typeof n.icon === 'string' && n.icon.includes(':') && !hasIcon(n.icon) ? n.icon.split(':')[0] : null;
    const found = prefix && [join(dirname(specPath), 'icons', `${prefix}.json`), join('icons', `${prefix}.json`), join(import.meta.dir, '..', 'icons', `${prefix}.json`)].find((p) => existsSync(p));
    if (found) registerIcons(JSON.parse(readFileSync(found, 'utf8')));
  }
}

// The pack icons a set of scenes use, so a deck carries only those.
export function usedPackIcons(specs: Spec[]): Record<string, string> {
  const used: Record<string, string> = {};
  for (const s of specs) for (const n of s.nodes) if (n.icon && !(s.icons && n.icon in s.icons) && iconSource(n.icon)) used[n.icon] = iconSource(n.icon)!;
  return used;
}
