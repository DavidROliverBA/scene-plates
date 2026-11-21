// Icons for nodes. The built-in set is line glyphs drawn for this project, in
// a 24 x 24 box, tinted with the node's colour. Extra packs (such as one
// imported from the AWS Architecture Icons package) are registered at run time
// and are drawn as they come, in their own colours.

export type IconPack = Record<string, string>; // name -> full <svg> text

const builtin: Record<string, string> = {
  user: 'M12 4a4 4 0 1 0 0 8a4 4 0 0 0 0-8z M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7',
  globe: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z M3 12h18 M12 3c-3.2 3-3.2 15 0 18 M12 3c3.2 3 3.2 15 0 18',
  server: 'M4 4h16v6H4z M4 14h16v6H4z M7.5 7h.01 M7.5 17h.01',
  database: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6 M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  storage: 'M4 5h16l-2 15H6L4 5z M5 10h14',
  function: 'M6 20l6-12 M8 4h2.5l7 16H20',
  queue: 'M3 7h4v10H3z M10 7h4v10h-4z M17 7h4v10h-4z',
  gateway: 'M4 21V8l8-5 8 5v13 M9 21v-7h6v7',
  shield: 'M12 3l8 3v6c0 4.5-3.3 7.7-8 9-4.7-1.3-8-4.5-8-9V6l8-3z M9 12l2 2 4-4',
  lock: 'M6 11h12v9H6z M8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  cloud: 'M7 18a4 4 0 0 1-.5-8A5.5 5.5 0 0 1 17 9.5 4.3 4.3 0 0 1 17.5 18H7z',
  bolt: 'M13 3L5 13h6l-1 8 8-10h-6l1-8z',
  search: 'M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 0 0 0-13z M15.5 15.5L20 20',
  gear: 'M12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6z M12 3v3 M12 18v3 M3 12h3 M18 12h3 M5.6 5.6l2.1 2.1 M16.3 16.3l2.1 2.1 M5.6 18.4l2.1-2.1 M16.3 7.7l2.1-2.1',
  balance: 'M12 4v5 M12 9l-7 6 M12 9l7 6 M12 9v6 M3 15h4v4H3z M10 15h4v4h-4z M17 15h4v4h-4z',
  document: 'M6 3h8l4 4v14H6z M14 3v4h4 M9 12h6 M9 16h6',
  mail: 'M3 6h18v12H3z M3 7l9 6 9-6',
  clock: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z M12 7v5l3 2',
  check: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z M8 12l3 3 5-6',
  stop: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z M9 9l6 6 M15 9l-6 6',
  container: 'M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z M4 7.5l8 4.5 8-4.5 M12 12v9',
  cart: 'M3 4h3l2.5 11h9L20 7H7 M9 19.5h.01 M17 19.5h.01',
  card: 'M3 6h18v12H3z M3 10h18 M6 15h4',
  code: 'M8 7l-5 5 5 5 M16 7l5 5-5 5 M13.5 5l-3 14',
};

const packs = new Map<string, string>(); // name -> data URI
const sources = new Map<string, string>(); // name -> original svg text

export const builtinIcons = () => Object.keys(builtin);

// Add icons from a pack. Names usually carry a prefix, such as "aws:lambda".
export function registerIcons(pack: IconPack): void {
  for (const [name, svg] of Object.entries(pack ?? {})) {
    if (typeof svg !== 'string' || !/<svg[\s>]/i.test(svg)) continue;
    sources.set(name, svg);
    packs.set(name, 'data:image/svg+xml,' + encodeURIComponent(svg).replace(/'/g, '%27'));
  }
}

export const iconPath = (name: string): string | undefined => builtin[name];
export const iconImage = (name: string): string | undefined => packs.get(name);
export const iconSource = (name: string): string | undefined => sources.get(name);
export const hasIcon = (name: string) => name in builtin || packs.has(name);
export const packCount = () => packs.size;
