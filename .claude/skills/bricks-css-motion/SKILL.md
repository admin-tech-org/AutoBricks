---
name: bricks-css-motion
description: >-
  Add CSS and dynamic effects to Bricks Builder templates: how Bricks loads CSS,
  native hover/transition/scroll-entrance, infinite logo marquees, glowing
  animated gradient-border cards, and the verbatim-`_cssCustom` / `%root%` /
  CSS-specificity gotchas. Use when a generated Bricks page looks flat or is
  "missing animations/CSS", or when reproducing a rich source block's motion.
---

# Bricks CSS & motion (1.12.5 verified)

## How Bricks loads CSS (3 mechanisms)
1. **Page/global settings `customCss`** (`_bricks_page_settings.customCss`) → inlined
   into `<head>`. No gate.
2. **Element `_cssCustom`** → emitted **VERBATIM** into page CSS (`Helpers::parse_css`
   only balance-checks braces). Global selectors work; travels WITH a normal
   template import; **no code-execution gate**. h2b's "`_cssCustom` doesn't work"
   is WRONG for 1.12.x — it works and is self-contained.
3. **`code` element `cssCode`/`javascriptCode`** → only renders when `executeCode`
   is enabled (needs Bricks > Settings > Code Execution + `unfiltered_html` cap).

`@keyframes`, `@property`, `@media`, `conic-gradient`, `mask` all survive verbatim
output (braces stay balanced). Prefer native settings for editability; use
`_cssCustom` only for effects natives can't express (keyframe loops, ::before, masks).

## CRITICAL gotcha: `%root%` is NOT substituted
Bricks outputs `_cssCustom` verbatim — it does **not** replace `%root%` with the
element selector on the frontend. `%root%{…}` ships literally as an invalid
selector and does nothing. Use the element's REAL id: `#brxe-<id>{…}`.
Because ids only exist after the plan is flattened, any id-scoped `_cssCustom`
must be written in a **post-flatten pass**, not while building the plan tree.
(If you clone elements — e.g. marquee duplication — run the id-scoping pass AFTER
the clone so each clone gets its OWN `#brxe-<cloneid>` rule.)

## CSS specificity in Bricks output (why "!important" was needed)
- Bricks emits per-element rules as `#brxe-<id>{…}` (id selector, wins over classes).
- Bricks `frontend.min.css` has `.brxe-block{width:100%}` and a default
  `max-width:100%`. A same-specificity class rule of yours LOSES on source order
  (frontend.min.css loads after inline `_cssCustom`). Use `!important` to beat it.
- Order of strength: `!important` > `#brxe-id` > `.your-class`.

## Native motion (editable in builder — prefer these)
- Hover: `_transform:hover` `{translateY:"-6px"}`, `_boxShadow:hover`, `_border:hover`,
  plus `_cssTransition:"all .45s cubic-bezier(.22,1,.36,1)"`.
- Button hover glow: `_boxShadow:hover` tinted with the theme primary color.
- **Scroll entrance** = `_interactions` (NOT the deprecated `_animation` control):
  ```json
  "_interactions":[{"id":"<6char>","trigger":"enterView","action":"startAnimation",
    "target":"self","animationType":"fadeInUp","runOnce":true}]
  ```
  Renders `data-interactions="…"`; Bricks auto-enqueues `animate.min.css` +
  `bricks.min.js`. **Safe degradation**: Bricks hides pre-entry via a JS-ADDED
  attribute + CSS `:not(.brx-animated)[data-interaction-hidden-on-load]{opacity:0}`,
  and `.brx-animated{animation-fill-mode:both}` holds the end state. So with JS off,
  elements are simply visible. **Timing note**: reading `opacity:0` on an element
  that is out-of-view or mid-animation is a RACE, not a bug — scroll it into view,
  wait ~1s, then it settles to opacity 1.

## Infinite logo marquee (跑馬燈)
A continuous scroll is a keyframe loop — no native setting expresses it. Rebuild
the strip: `overflow:hidden` viewport → one `flex-nowrap` track → **DUPLICATE the
items once** (fresh ids) → animate `translateX(0 → -50%)` (2 identical copies make
the loop seamless). Detect a pure logo strip as a container whose children are ALL
media-only logo cards (>=4); do NOT match a footer row that merely contains a logo.
```css
.cdp-marquee{display:block!important;overflow:hidden;width:100%;
  -webkit-mask-image:linear-gradient(90deg,transparent,#000 6%,#000 94%,transparent);mask-image:…;}
.cdp-marquee-track{display:flex!important;flex-wrap:nowrap!important;
  width:max-content!important;max-width:none!important;      /* BOTH needed — beats .brxe-block{width:100%} + max-width:100% */
  align-items:center;gap:clamp(48px,7vw,112px);animation:cdp-marquee-scroll 40s linear infinite;}
.cdp-marquee:hover .cdp-marquee-track{animation-play-state:paused;}
@keyframes cdp-marquee-scroll{from{transform:translateX(0)}to{transform:translateX(-50%)}}
@media (prefers-reduced-motion:reduce){.cdp-marquee-track{animation:none;flex-wrap:wrap!important;}}
```
Size the logos to their MEASURED px (e.g. 140×63), not an arbitrary height.

## Glowing animated gradient-border card (feature block)
Reproduce a rich "feature card" (measured from the source): native
`_border` hairline + `_background` translucent + `_padding` + `_border:hover`
(editable), and a scoped `_cssCustom` for the parts natives can't do:
```css
#brxe-ID{position:relative;isolation:isolate;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);}
#brxe-ID>*{position:relative;z-index:1;}
#brxe-ID::before{content:"";position:absolute;inset:0;border-radius:inherit;padding:1px;
  background:conic-gradient(from var(--cdp-ang,120deg),rgba(255,108,55,.85),rgba(179,135,245,.55) 25%,transparent 45%,transparent 62%,rgba(255,108,55,.75));
  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;
  pointer-events:none;z-index:2;opacity:.5;transition:opacity .5s;animation:cdp-glow-spin 9s linear infinite;}
#brxe-ID:hover::before{opacity:1;}
@property --cdp-ang{syntax:"<angle>";inherits:false;initial-value:120deg;}   /* smooth conic rotation; degrades to static */
@keyframes cdp-glow-spin{to{--cdp-ang:480deg;}}
```
**GATE to avoid over-applying**: only treat a split as a glow card when it has a
heading + media AND is NOT a hero (heroes are full-bleed, not cards). Over-applying
(e.g. to a plain 2-col hero) measurably drops the visual-diff score.

## Reproduce, don't guess
When a block is "missing rich CSS", INSPECT the live source's computed styles
(incl. `getComputedStyle(el,'::before')`, border sides, `backdrop-filter`,
animation-name, absolutely-positioned glow layers) and reproduce the measured
values — don't invent an effect. The verified Postman card = 1px
`rgba(179,135,245,.5)` border, radius 10, bg `rgba(9,7,13,.5)` + `backdrop-blur:10px`,
hover-reveal gradient glow overlay.
