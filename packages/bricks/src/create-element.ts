/**
 * Bricks element factory + id generation.
 *
 * Every generation run creates its own IdFactory so id uniqueness is scoped
 * per run (deterministic "readable" ids for tests/debugging, or Bricks-style
 * random 6-char ids for production-looking templates).
 */

import type { AllowedElementName, BricksElement } from "@bricks-cdp/ir";

export type IdStyle = "readable" | "bricks";

const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const ALNUM = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Lowercase slug: keeps [a-z0-9], collapses everything else into "_". */
export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");
  return slug || "el";
}

/**
 * Id generator with a per-run uniqueness scope.
 *
 * - "readable": slug based on the hint ("sec_hero", "col_left", "hdg", ...).
 *   First use of a base slug returns it as-is; subsequent uses get a counter
 *   suffix ("hdg", "hdg_2", "hdg_3", ...).
 * - "bricks": random 6-char [a-z0-9] id whose first char is a letter,
 *   matching the ids Bricks Builder itself generates.
 */
export class IdFactory {
  readonly style: IdStyle;
  private readonly used = new Set<string>();
  private readonly counters = new Map<string, number>();

  // Default is "bricks": Bricks Builder's template import regenerates ids via a
  // GLOBAL string replacement over the whole template, so any id that is a
  // substring of an element name corrupts it (id "ico" inside name "icon" →
  // "d15b1dn"). Fixed-length random ids with a guaranteed digit can never be a
  // substring of the pure-alpha element names. Use "readable" for debugging only.
  constructor(style: IdStyle = "bricks") {
    this.style = style;
  }

  next(hint?: string): string {
    const id = this.style === "bricks" ? this.nextBricks() : this.nextReadable(hint);
    this.used.add(id);
    return id;
  }

  private nextReadable(hint?: string): string {
    const base = slugify(hint || "el");
    let count = this.counters.get(base) ?? 0;
    let id = base;
    do {
      count += 1;
      id = count === 1 ? base : `${base}_${count}`;
    } while (this.used.has(id));
    this.counters.set(base, count);
    return id;
  }

  private nextBricks(): string {
    // Random by design; uniqueness is still enforced within this run.
    // At least one digit is forced so the id can never be a substring of a
    // pure-alphabetic element name (see constructor comment).
    let id: string;
    do {
      let s = LETTERS[Math.floor(Math.random() * LETTERS.length)];
      for (let i = 1; i < 6; i++) {
        s += ALNUM[Math.floor(Math.random() * ALNUM.length)];
      }
      id = s;
    } while (this.used.has(id) || !/[0-9]/.test(id));
    return id;
  }
}

/**
 * Create a flat BricksElement with a freshly generated id.
 * `children` starts empty — the flattener wires child ids afterwards.
 */
export function createElement(
  name: AllowedElementName,
  parent: string | 0,
  settings: Record<string, unknown>,
  ids: IdFactory,
  idHint?: string
): BricksElement {
  return {
    id: ids.next(idHint ?? name),
    name,
    parent,
    children: [],
    settings,
  };
}
