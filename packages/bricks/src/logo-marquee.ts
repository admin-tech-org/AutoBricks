/**
 * Logo-strip marquee (跑馬燈 / continuous slider).
 *
 * A "trusted by" logo strip in the reference sites scrolls horizontally forever.
 * That is an INFINITE keyframe loop (`translateX(0 -> -50%)`), which no native
 * Bricks per-element setting can express — Bricks Interactions / `_transform`
 * do one-shot transitions, not an endless loop. So THIS one block uses a small
 * `@keyframes` stylesheet via the element's `_cssCustom` (which Bricks emits
 * verbatim and which travels with a normal template import — no code-execution
 * gate). Everything else in the template stays native.
 *
 * Detection: a flex container whose direct children are ALL media-only logo
 * cards (>= 4 of them) — a pure logo strip. A footer row that merely contains
 * one logo among link columns is NOT matched.
 *
 * Rewrite: the container becomes an `overflow:hidden` viewport holding a single
 * `.cdp-marquee-track`; the original logo cards move into the track and are
 * duplicated once (fresh ids) so `translateX(-50%)` produces a seamless loop.
 */

import type { BricksElement } from "@bricks-cdp/ir";
import type { IdFactory } from "./create-element";

/** Names that make a card "not media-only" (i.e. real content, not a logo tile). */
const NON_MEDIA_NAMES = new Set(["heading", "text-basic", "text", "button"]);

/** Row/grid settings that must not survive on the viewport (they fight the marquee). */
const GRID_KEYS = ["_flexWrap", "_columnGap", "_rowGap", "_justifyContent", "_alignItems", "_width"];

/**
 * Self-contained marquee stylesheet (global `.cdp-*` selectors, one @keyframes).
 * Fades at both edges, pauses on hover, and collapses to a static centered wrap
 * when the visitor prefers reduced motion.
 */
const MARQUEE_CSS = [
  ".cdp-marquee{display:block !important;overflow:hidden;width:100%;",
  "-webkit-mask-image:linear-gradient(90deg,transparent 0,#000 6%,#000 94%,transparent 100%);",
  "mask-image:linear-gradient(90deg,transparent 0,#000 6%,#000 94%,transparent 100%);}",
  ".cdp-marquee-track{display:flex !important;flex-wrap:nowrap !important;width:max-content !important;max-width:none !important;",
  "align-items:center;gap:clamp(48px,7vw,112px);animation:cdp-marquee-scroll 40s linear infinite;will-change:transform;}",
  ".cdp-marquee:hover .cdp-marquee-track{animation-play-state:paused;}",
  ".cdp-marquee-track>*{flex:0 0 auto !important;width:auto !important;max-width:none !important;",
  "margin:0 !important;padding:0 !important;background:none !important;border:none !important;box-shadow:none !important;}",
  ".cdp-marquee-track img{max-width:none !important;object-fit:contain;}",
  "@keyframes cdp-marquee-scroll{from{transform:translateX(0)}to{transform:translateX(-50%)}}",
  "@media (prefers-reduced-motion:reduce){.cdp-marquee-track{animation:none;flex-wrap:wrap !important;justify-content:center;}",
  ".cdp-marquee{-webkit-mask-image:none;mask-image:none;}}",
].join("");

function classesOf(e: BricksElement): Set<string> {
  return typeof e.settings._cssClasses === "string"
    ? new Set((e.settings._cssClasses as string).split(/\s+/).filter(Boolean))
    : new Set<string>();
}

/** Deep-clone a subtree into `out` with fresh ids, parented under `newParent`. */
function cloneSubtree(
  id: string,
  newParent: string,
  byId: Map<string, BricksElement>,
  ids: IdFactory,
  out: BricksElement[]
): string {
  const orig = byId.get(id);
  if (!orig) return id;
  const clone: BricksElement = {
    id: ids.next(orig.name),
    name: orig.name,
    parent: newParent,
    children: [],
    settings: JSON.parse(JSON.stringify(orig.settings)) as Record<string, unknown>,
  };
  byId.set(clone.id, clone);
  out.push(clone);
  for (const cid of orig.children) clone.children.push(cloneSubtree(cid, clone.id, byId, ids, out));
  return clone.id;
}

/**
 * Turn every pure logo strip in the flat content into an infinite marquee.
 * Mutates `content` in place (appends the track + duplicated logo subtrees).
 */
export function applyLogoMarquee(content: BricksElement[], ids: IdFactory): void {
  const byId = new Map(content.map((e) => [e.id, e]));

  const descendants = (e: BricksElement): BricksElement[] => {
    const out: BricksElement[] = [];
    const stack = [...e.children];
    while (stack.length) {
      const el = byId.get(stack.pop() as string);
      if (!el) continue;
      out.push(el);
      stack.push(...el.children);
    }
    return out;
  };

  const isLogoCard = (e: BricksElement): boolean => {
    if (!classesOf(e).has("cdp-card")) return false;
    const names = descendants(e).map((k) => k.name);
    return names.includes("image") && !names.some((n) => NON_MEDIA_NAMES.has(n));
  };

  // Snapshot targets BEFORE mutating (a pure logo strip: >=4 children, all logos).
  const targets = content.filter(
    (e) =>
      e.children.length >= 4 &&
      e.children.every((cid) => {
        const c = byId.get(cid);
        return !!c && isLogoCard(c);
      })
  );

  for (const row of targets) {
    const originalChildIds = [...row.children];

    const track: BricksElement = {
      id: ids.next("block"),
      name: "block",
      parent: row.id,
      children: [],
      settings: { _cssClasses: "cdp-marquee-track", _direction: "row" },
    };
    byId.set(track.id, track);

    // Move the real logo cards into the track.
    for (const cid of originalChildIds) {
      const c = byId.get(cid);
      if (c) c.parent = track.id;
    }

    // Duplicate the logo set once for a seamless -50% loop.
    const clones: BricksElement[] = [];
    const dupIds = originalChildIds.map((cid) => cloneSubtree(cid, track.id, byId, ids, clones));
    track.children = [...originalChildIds, ...dupIds];

    // The row becomes the clipping viewport carrying the marquee stylesheet.
    row.children = [track.id];
    const existing = typeof row.settings._cssClasses === "string" ? (row.settings._cssClasses as string) : "";
    row.settings._cssClasses = `${existing} cdp-marquee`.trim();
    row.settings._cssCustom = MARQUEE_CSS;
    for (const k of GRID_KEYS) delete row.settings[k];

    content.push(track, ...clones);
  }
}
