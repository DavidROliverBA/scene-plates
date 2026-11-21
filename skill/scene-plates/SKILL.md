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
    { "caption": "Then it reads from the layer below.", "show": ["db"], "focus": ["gateway", "db"], "pulse": ["gateway>db"], "camera": { "yaw": 32 } }
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

**Groups** draw a plate under their nodes. All nodes of a group are on one layer.

## Steps: the only six moves

| move | lasts | does |
|---|---|---|
| `show` | until hidden | nodes drop in; a group id shows all its nodes; edges appear once both ends are shown |
| `hide` | — | removes them again |
| `focus` | this step | everything else dims |
| `pulse` | this step | a dot travels along these edges |
| `camera` | until changed | `yaw` (-45 to 45), `pitch` (25 to 70), `zoom`, `target` (ids to centre on, `null` to reset) |
| `caption` | this step | one sentence under the scene, 84 characters at most |

With no `steps`, the whole scene shows at once.

## Rules

- Labels are UPPERCASE and short (about 14 characters on a default node);
  `sub` is lowercase and says what the thing does. Captions are full sentences.
- One idea per step. Reveal in the order the story is told, not the order the
  system was built.
- Use `focus` plus `pulse` to point at the thing the caption is about.
- Move the camera only when it shows something new, such as a lower layer.
  Two or three camera moves per scene is plenty. End on the whole picture.
- At most about 9 nodes and 3 layers per scene. The checker refuses scenes
  whose labels would be too small; split them into two scenes.
- Red means fail-closed and nothing else.

## Embedding in an existing deck or page

```html
<script src="scene-plates.min.js"></script>
<scene-plate src="diagrams/request-flow.json"></scene-plate>
```

Or put the JSON inline in a `<script type="application/json">` child, which
works from `file://` with no server. Attributes: `theme="light|dark"` (default
follows the page's `data-theme`, then the system), `bare` (no background). The
element has `next()`, `prev()`, `go(i)`, `restart()`, `step` and `stepCount`;
`next()` returns `false` on the last step so the deck can move to its next
slide. Arrow keys and clicks work when the scene has focus. Reduced-motion
settings are honoured, and printing gives the current still.

For reveal.js and similar: call `plate.next()` from the deck's key handler
first, and let the deck advance only when it returns `false`.

## Other outputs

- Stills for PDF or documents: `sp svg spec.json --all -o out/`.
- Animated GIF for articles: `bun $SCENE_PLATES_HOME/scripts/gif.ts spec.json out.gif`.
