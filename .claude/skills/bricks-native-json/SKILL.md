---
name: bricks-native-json
description: >-
  Produce VALID Bricks Builder 1.12.5 element settings JSON and pixel-accurate
  sizing. Use whenever generating, mapping, or debugging Bricks element
  `settings` (gradients, box-shadow, borders, background images, fonts, colors)
  or reproducing a captured site's exact dimensions. Corrects the h2b 2.x docs,
  which are WRONG for Bricks 1.12.x (verified against theme source).
---

# Bricks native JSON (1.12.5 verified)

Bricks stores each element flat: `{id,name,parent,children,settings,label}`.
Root sections use `parent:0`. Children ordered by the `children[]` array.

**These setting shapes were verified against Bricks 1.12.5 theme source and
differ from the html2bricks (h2b) 2.x reference. Trust these, not h2b, for 1.12.x.**

## Setting shapes that bite

### Gradient — a SEPARATE `_gradient` key (not inside `_background`)
```json
"_gradient": {
  "applyTo": "background",
  "gradientType": "linear",
  "angle": "135",
  "colors": [
    { "color": { "hex": "#ff5a1f" }, "stop": "0" },
    { "color": { "hex": "#7a2f8a" }, "stop": "40" }
  ]
}
```
The theme appends `%` to stops and `deg` to angle. Do NOT put a CSS
`linear-gradient(...)` string into `_background`.

### Box-shadow — an OBJECT, not the h2b array
```json
"_boxShadow": {
  "values": { "offsetX": "0", "offsetY": "14", "blur": "44", "spread": "0" },
  "color": { "rgb": "rgba(0, 0, 0, 0.42)" },
  "inset": false
}
```
Renders as `box-shadow: 0 14px 44px 0 rgba(0,0,0,.42)` (offsetX `0` emits unitless).
Hover variant: key `"_boxShadow:hover"` with the same shape.

### Border — width/radius are per-side objects
```json
"_border": {
  "width": { "top": "1", "right": "1", "bottom": "1", "left": "1" },
  "style": "solid",
  "color": { "rgb": "rgba(255, 255, 255, 0.09)" },
  "radius": { "top": "18", "right": "18", "bottom": "18", "left": "18" }
}
```

### Background image — `image` object + top-level size/position/repeat
```json
"_background": {
  "image": { "url": "https://…/x.png", "external": true },
  "size": "cover", "position": "center center", "repeat": "no-repeat"
}
```

### Font-family — MUST split family + fallback (common silent bug)
Bricks quotes `"$font_value"` as ONE font name. `"font-family":"degular, sans-serif"`
becomes the literal font `"degular, sans-serif"` → browser can't find it → falls back
to serif. Split the generic keyword into a separate `fallback` key:
```json
"_typography": { "font-family": "degular", "fallback": "sans-serif" }
```
`GENERIC_FAMILIES = {serif, sans-serif, monospace, cursive, fantasy, system-ui, ui-*}`.

### Color — keep `{rgb}` when alpha < 1 (else translucency is lost)
`toBricksColor(raw)`: opaque → `{hex:"#rrggbb"}`; alpha<1 → `{rgb:"rgba(...)"}`.
Converting a translucent rgba to hex drops the alpha and a soft shadow becomes
solid `#000000`. `alpha<=0` → omit the key entirely.

## Exact pixel dimensions (fidelity)

Capture already records a real box `{x,y,width,height}` for every node
(`layout.json.boxes[dom_N]`) and exact computed `style` (fontSize, lineHeight,
letterSpacing, padding, margin). Apply them — don't approximate:

- **Spacing**: emit exact px, do NOT snap to a 4px grid (round only). Snapping
  is what makes spacing drift from the source.
- **Images**: pin `_width = "<box.width>px"`. Do NOT also set a fixed `_height`
  — a fixed height distorts when `max-width:100%` caps the width in a narrow
  container. Instead lock the SOURCE aspect ratio so height tracks width:
  `aspect-ratio:<w>/<h>;height:auto` (see the `bricks-css-motion` skill for why
  this must be id-scoped CSS, not `%root%`).
- **Result**: object is its exact source size on desktop and shrinks
  proportionally (undistorted) when its container is narrower.
- **Caveat**: the whole page renders in the WP/Bricks container width (~1100px)
  vs the source's 1440px, so overall layout still scales; per-object sizes match.

## Import-safe ids
Bricks Templates Import regenerates ids by a GLOBAL string-replace over the whole
template. Short "readable" ids that are substrings of element names (e.g. `ico`
in `icon`) get corrupted → "元件 X 不存在" ("element X does not exist"). Use
6-char random ids that always contain a digit (idStyle "bricks"). A template-kit
zip must contain exactly ONE `.json` (Bricks treats each `.json` = 1 template).

## Security at the spawn/write sink
Any caller-supplied value that reaches a shell (`spawn(..., {shell:true})`) or an
eval is an injection vector — e.g. an AI `--model` name. Validate at the sink
with a strict charset (`/^[A-Za-z0-9._-]+$/`) AND at the API/CLI boundary (400).
Tested payloads that MUST be blocked: `sonnet & calc.exe`, `` `whoami` ``, `;rm -rf /`.
