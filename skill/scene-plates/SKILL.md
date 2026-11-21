---
name: scene-plates
description: Create animated 3D diagrams for HTML slide decks and pages from a small JSON spec — layered architecture views, request flows, agent loops, pipelines and step-by-step reveals with camera moves. Use whenever the user asks for an animated diagram, a 3D diagram, an isometric or layered architecture view, a diagram that "builds" step by step, or a diagram for an HTML presentation. You write only the spec; the scene-plates runtime draws it, so every diagram shares the same colours, fonts and motion. Use a flat SVG flow diagram instead when the output is a static document.
---

# Scene plates

You write a JSON spec. The runtime draws and animates it. **Never write SVG,
three.js, CSS animation or colours by hand for these diagrams** — look and feel
lives in `src/tokens.ts` and nowhere else.

The repo is at `$SCENE_PLATES_HOME` (default `~/Developer/scene-plates`). Call
the tool as `bun $SCENE_PLATES_HOME/src/cli.ts`, shortened to `sp` below.

## Workflow

1. Decide the story first: one sentence per step, 3 to 7 steps. If you cannot
   say what a step adds, drop it.
2. Write `diagrams/<name>.json` next to the deck. The spec is the source; the
   HTML is build output.
3. `sp check diagrams/<name>.json` — fix every problem it reports. Its
   messages say what to change. Do not work round it.
4. `sp svg diagrams/<name>.json --all -o out/` and look at the stills
   (`rsvg-convert -w 1280 x.svg -o x.png`, then read the PNG). Check each step
   reads on its own.
5. Deliver: `sp html diagrams/*.json -o deck.html` for a standalone deck, or
   embed in an existing page (below).

## The spec

```json
{
  "title": "A request through the gateway",
  "description": "One or two sentences saying what the diagram shows. Read out by screen readers.",
  "nodes": [
    { "id": "client", "label": "CLIENT", "sub": "web or phone", "at": [0, 0], "layer": 1 },
    { "id": "gateway", "label": "GATEWAY", "sub": "checks the token", "kind": "gate", "at": [3.4, 0], "layer": 1 },
    { "id": "db", "label": "DATABASE", "kind": "success", "at": [3.4, 0], "layer": 0 }
  ],
  "groups": [{ "id": "app", "label": "APPLICATION", "contains": ["client", "gateway"] }],
  "edges": [
    { "from": "client", "to": "gateway", "label": "request" },
    { "from": "gateway", "to": "db", "label": "read" }
  ],
  "steps": [
    { "caption": "Every request starts at the client.", "show": ["client"] },
    { "caption": "The gateway checks it.", "show": ["gateway"], "pulse": ["client>gateway"] },
    { "caption": "Then it reads from the layer below.", "show": ["db"], "focus": ["gateway", "db"], "pulse": ["gateway>db"], "camera": { "pitch": 32 } }
  ]
}
```

**Grid.** `at` is `[column, row]` of a node's back-left corner. Columns run
left to right, rows run from the back towards the viewer. Nodes are 2 wide and
1 deep unless `size` says otherwise. Leave 1.4 between neighbours (columns 0,
3.4, 6.8, 10.2), more if the edge between them has a long label. `layer` 0 is
the bottom; higher layers float above.

**Node kinds — colour carries meaning, never decoration.**

| kind | colour | means |
|---|---|---|
| `process` (default) | navy | a normal step in the main flow |
| `gate` | teal | a check, decision or validation |
| `fail` | red | fail-closed, rejected, fallback. Nothing else is ever red |
| `success` | green | approved, committed, source of truth |
| `quiet` | grey | supporting parts: caches, logs, telemetry |

**Icons and shapes.** `"icon"` puts a small icon on the node: `user`, `globe`,
`server`, `database`, `storage`, `function`, `queue`, `gateway`, `shield`,
`lock`, `cloud`, `bolt`, `search`, `gear`, `balance`, `document`, `mail`,
`clock`, `check`, `stop`, `container`, `cart`, `card`, `code`. An icon takes
room, so give those nodes `"size": [2.6, 1]` and space columns 4 apart (0, 4,
8, 12). `"shape": "cylinder"` is for databases and stores. **Other icons.** Any SVG, PNG, JPEG, WebP or GIF works. For a few, add
`"icons": { "logo": "art/logo.svg" }` to the spec (a path beside the spec, a
web address, or the SVG text itself) and use `"icon": "logo"`. For a whole
set, `bun $SCENE_PLATES_HOME/scripts/icons.ts <folder or zip> --prefix acme`
then `"icon": "acme:name"`. An SVG drawn in `currentColor` takes the node's
colour; other pictures keep theirs. Never invent artwork for a real product's
logo; use the user's file or a built-in icon. If an icon pack has
been imported, its icons are named with a prefix: `"aws:lambda"`, `"aws:s3"`,
`"aws:dynamodb"`. Only use `aws:` names when `icons/aws.json` exists in
`$SCENE_PLATES_HOME`; otherwise use the built-in ones.

**Edge kinds.** `flow` (default, navy), `pass` (green), `fail` (red, dashed),
`loop` (amber; **must** have a label stating its cap, such as "max 3 tries"),
`quiet` (grey, dotted). An edge's id is `"from>to"` unless you give it an `id`.

**Routing.** Edges are right-angled and route themselves. Steer with `via`
(`x`, `y`, `xy`, `yx`: which way to leave the source), `channel` (the column
or row of the middle stretch) and `offset` (shift sideways; give a
there-and-back pair `0.2` and `-0.2`). A loop back along a row is
`"via": "y", "channel": <row in front of the nodes>`. Nodes on different layers
can only be joined when one sits above the other. `"flip": true` moves a label
to the other side of its line. `"hold": true` keeps an edge hidden until a
step shows it by id.

**Routing is not automatic.** A line is straight when its boxes line up,
otherwise a Z that turns half-way across the gap. You steer it; the checker
refuses crossings, lines through boxes, and unrelated lines that touch. So:
place boxes in the order work flows; give two unrelated lines turning in the
same gap different `channel` values (0.3 apart); lines sharing a box may share
a stem. If a line cannot avoid crossing, reorder boxes, drop the lesser line,
or say it in a callout. Never draw lines to services everything uses (logs,
access control, keys); group them on a plate labelled as such. Run
`sp routes x.json` to see every line's shape and turning points.

**Groups** draw a plate under their nodes. All nodes of a group are on one
layer. A group may contain other groups, so plates nest: a VPC plate holding a
public-subnet plate and a private-subnet plate. Leave 2 between nodes whose
plates are neighbours (columns 3.6 and 7.6), so the plates do not touch.

**View.** One spec draws three ways: `"view": "3d"` (default: perspective, straight on;
steps may tilt and zoom the camera), `"iso"` (true isometric: fixed camera, no
perspective; camera yaw and pitch in steps are ignored) or `"flat"` (from
above; layers become bands). Use 3d for presenting and for layers, iso for the
classic architecture-diagram look, flat for documents and simple flows. Wide
rows shrink in iso, and many layers shrink in flat. Check all three with
`sp check x.json --view iso` and `--view flat` if the deck will offer the
view switcher.

**Cloud diagrams.** Put the service name in `label` (`LAMBDA`, `S3`, `AURORA`)
and what it does there in `sub`. Use plates for region, VPC and subnets. Use
layers for edge, network and data, with **one row of nodes per layer** when
there are three layers. Colour still follows the kinds above, not the vendor's
icon colours.

## Steps: the only seven moves

| move | lasts | does |
|---|---|---|
| `show` | until hidden | nodes drop in; a group id shows all its nodes; edges appear once both ends are shown |
| `hide` | — | removes them again |
| `focus` | this step | everything else dims |
| `pulse` | this step | a dot travels along these edges |
| `camera` | until changed | `pitch` (25 to 70, default 38), `zoom` (up to 4), `yaw` (-45 to 45, default 0), `target` (ids to centre on, `null` to reset). Yaw and pitch apply in the 3d view only |
| `callout` | this step | shows these callout ids (see below) |
| `caption` | this step | one sentence under the scene, 84 characters at most |

With no `steps`, the whole scene shows at once.

**Titles.** `title` (60 characters at most) and optional `subtitle` are drawn
at the top left of the frame.

**Callouts** explain what a label cannot. Define them once, show them per step:

```json
"callouts": [{ "id": "why", "text": "The limit is a rule, so no person is needed.", "on": "limit", "side": "up" }]
```

`on` is a node or group; `side` is `up` (default), `down`, `left` or `right`;
`gap` is the distance in pixels (default 60). Keep text under 110 characters.
One callout per step is plenty. If the checker says it covers a box or leaves
the frame, change `side` or `gap`.

## Big scenes (more than about ten nodes)

A scene too big to read whole is allowed if it is a **tour**: every node must
be large enough to read in at least one step. Seen whole, the runtime hides
small words and enlarges group labels, so the first step works as a map.

- Lay it out as rows of areas on one layer: columns 4 apart, rows 2.8 apart,
  every node in a group, one group per run of neighbours in a row.
- Join neighbours only (left, right, or straight up and down). For the rare
  longer line use `"via": "y"` with a `channel` in the gap between two rows,
  and an `offset` so it does not share a path with a line already there.
- Step 1 shows everything. Then one step per area or pair of areas:
  `"camera": { "target": [ids], "zoom": Z }` with `focus` or `pulse` on what
  the caption is about. Finish with `{ "target": null, "zoom": 1 }`.
- If the checker says "Never large enough to read", it lists the nodes and
  the zoom to use. Add a stop or widen a target.
- Keep group labels short (one word); callouts short and above an empty cell.

## Rules

- Labels are UPPERCASE and short (about 14 characters on a default node);
  `sub` is lowercase and says what the thing does. Captions are full sentences.
- One idea per step. Reveal in the order the story is told, not the order the
  system was built.
- Use `focus` plus `pulse` to point at the thing the caption is about.
- Move the camera only when it shows something new, such as a lower layer.
  Two or three camera moves per scene is plenty. End on the whole picture.
  The camera looks straight on. Leave `yaw` alone unless the user asks for
  an angled look. The checker refuses a move that would run off the frame.
- Zoom in on one part with `"camera": { "target": ["group-id"], "zoom": 1.3 }`
  and return with `{ "target": null, "zoom": 1 }`.
- About 10 nodes and 3 layers fit one slide. Past that, split the scene or
  make it a tour (see Big scenes).
- Red means fail-closed and nothing else.

## Embedding in an existing deck or page

```html
<script src="scene-plates.min.js"></script>
<scene-plate src="diagrams/request-flow.json"></scene-plate>
```

Or put the JSON inline in a `<script type="application/json">` child, which
works from `file://` with no server. Attributes: `toggle` (a control and the F key to switch between 3D, isometric and flat), `notitle`, `icons="pack.json"`, `view="3d|iso|flat"`, `theme="light|dark"` (default
follows the page's `data-theme`, then the system), `bare` (no background). The
element has `next()`, `prev()`, `go(i)`, `restart()`, `setView(v)`, `toggleView()`, `step` and `stepCount`;
`next()` returns `false` on the last step so the deck can move to its next
slide. Arrow keys and clicks work when the scene has focus. Reduced-motion
settings are honoured, and printing gives the current still.

For reveal.js and similar: call `plate.next()` from the deck's key handler
first, and let the deck advance only when it returns `false`.

## Other outputs

- Stills for PDF or documents: `sp svg spec.json --all -o out/`.
- Animated GIF for articles: `bun $SCENE_PLATES_HOME/scripts/gif.ts spec.json out.gif`.
