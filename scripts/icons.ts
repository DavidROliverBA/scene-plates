#!/usr/bin/env bun
// Builds an icon pack from any folder or zip of pictures.
//
//   bun scripts/icons.ts ~/Downloads/some-icons --prefix acme
//   bun scripts/icons.ts ~/Downloads/some-icons.zip --prefix acme -o icons/acme.json
//
// It takes SVG, PNG, JPEG, WebP and GIF files. Each icon is named after its
// file: "Cloud Storage.svg" becomes "acme:cloud-storage". Packs are written to
// icons/, which is git-ignored: check a set's licence before you share a pack
// or a deck made with it.

import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join, relative, dirname } from 'node:path';
import { $ } from 'bun';
import { ICON_TYPES } from '../src/icons';
import { iconFromFile } from '../src/files';

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const prefix = opt('--prefix'), outArg = opt('-o'), source = args[0];
if (!source || !prefix || !/^[a-z0-9][a-z0-9-]*$/.test(prefix)) {
  console.error('Usage: bun scripts/icons.ts <folder or zip> --prefix <name> [-o icons/<name>.json]\nThe prefix is lowercase letters, digits and hyphens, such as "acme".');
  process.exit(1);
}
const out = outArg ?? join(import.meta.dir, '..', 'icons', `${prefix}.json`);

let root = source, temp = '';
if (statSync(source).isFile()) {
  temp = mkdtempSync(join(tmpdir(), 'icons-'));
  await $`unzip -q -o ${source} -d ${temp}`.quiet();
  root = temp;
}
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
  d.name.startsWith('.') || d.name === '__MACOSX' ? [] : d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]);
const slug = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();

const pack: Record<string, string> = {}, left: string[] = [];
let other = 0;
// SVG first: when a set ships the same icon as SVG and PNG, the SVG is sharper and smaller.
const files = walk(root).sort((a, b) => Number(extname(b).toLowerCase() === '.svg') - Number(extname(a).toLowerCase() === '.svg') || a.localeCompare(b));
for (const file of files) {
  const ext = extname(file).slice(1).toLowerCase(), rel = relative(root, file);
  if (!ICON_TYPES[ext]) { other++; continue; }
  let value: string;
  try { value = iconFromFile(file); } catch (e) { left.push(`${rel}: ${(e as Error).message}`); continue; }
  // Same file name in two folders: the second takes its folder's name too.
  const stem = slug(basename(file, extname(file)));
  let name = `${prefix}:${stem}`;
  if (pack[name] && pack[name] !== value) name = `${prefix}:${slug(basename(dirname(file)))}-${stem}`;
  if (pack[name]) { if (pack[name] !== value) left.push(`${rel}: another icon is already named ${name}`); continue; }
  pack[name] = value;
}
if (temp) rmSync(temp, { recursive: true });

const names = Object.keys(pack);
if (!names.length) { console.error(`No SVG, PNG, JPEG, WebP or GIF files found in ${source}.`); process.exit(1); }
mkdirSync(dirname(out), { recursive: true });
await Bun.write(out, JSON.stringify(pack));
const tint = names.filter((n) => /currentColor/i.test(pack[n]) && !pack[n].startsWith('data:')).length;
console.log(`wrote ${out}: ${names.length} icons, ${Math.round(JSON.stringify(pack).length / 1024)} KB`);
console.log(`  ${tint} take the node's colour (SVG using currentColor); ${names.length - tint} keep their own colours`);
if (other) console.log(`  ${other} other files ignored`);
if (left.length) console.log(`  ${left.length} left out:\n` + left.slice(0, 20).map((m) => '    - ' + m).join('\n') + (left.length > 20 ? `\n    ... and ${left.length - 20} more` : ''));
console.log(`Use them as "icon": "${names[0]}". First few: ${names.slice(0, 6).join(', ')}`);
