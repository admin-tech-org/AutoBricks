/**
 * JSON Validator (ARCHITECTURE §17 + README "Validation").
 *
 * Last gate before the user imports the template into Bricks Builder — this
 * validator is deliberately paranoid. Rules implemented:
 *
 *  errors  (structural — import would break or lie):
 *   - input parseable (object or JSON string)
 *   - "content" key exists and is an array
 *   - every element is an object with id (non-empty string), name (string),
 *     parent (string | 0), children (array of strings)
 *   - element name is in the ALLOWED_ELEMENTS whitelist
 *   - ids unique
 *   - every non-0 parent id exists
 *   - every child id exists
 *   - no parent-child cycles (including self-parenting / self-childing)
 *   - settings deep-scan: no undefined and no non-finite numbers (NaN/Infinity)
 *
 *  warnings (consistency / cosmetic — importable but suspicious):
 *   - child listed in children[] but child.parent points elsewhere
 *   - element has a non-0 parent that does not list it back in children[]
 *   - duplicate ids inside a children[] array / child claimed by two parents
 *   - null values inside settings
 *   - settings missing or empty content array
 */

import { ALLOWED_ELEMENTS, type JsonValidationResult } from "@bricks-cdp/ir";

const ALLOWED = new Set<string>(ALLOWED_ELEMENTS);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Deep-scan a settings value for undefined / null / non-finite numbers. */
function scanSettings(
  value: unknown,
  path: string,
  errors: string[],
  warnings: string[],
  seen: Set<unknown>
): void {
  if (value === undefined) {
    errors.push(`settings contain undefined at ${path}`);
    return;
  }
  if (value === null) {
    warnings.push(`settings contain null at ${path}`);
    return;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    errors.push(`settings contain non-finite number (NaN/Infinity) at ${path}`);
    return;
  }
  if (typeof value === "function") {
    errors.push(`settings contain a function (not JSON-serializable) at ${path}`);
    return;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      errors.push(`settings contain a circular reference at ${path}`);
      return;
    }
    seen.add(value);
    value.forEach((v, i) => scanSettings(v, `${path}[${i}]`, errors, warnings, seen));
    seen.delete(value);
    return;
  }
  if (isRecord(value)) {
    if (seen.has(value)) {
      errors.push(`settings contain a circular reference at ${path}`);
      return;
    }
    seen.add(value);
    // Object.keys() misses keys explicitly set to undefined only if deleted;
    // keys present with value undefined ARE enumerated — exactly what we want.
    for (const key of Object.keys(value)) {
      scanSettings(value[key], `${path}.${key}`, errors, warnings, seen);
    }
    seen.delete(value);
  }
}

/**
 * Validate a Bricks template (parsed object or raw JSON string) against every
 * §17 / README rule. Returns { valid, errors, warnings }.
 */
export function validateBricksJson(input: unknown): JsonValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const done = (): JsonValidationResult => ({ valid: errors.length === 0, errors, warnings });

  // 1. Parseable input --------------------------------------------------------
  let root: unknown = input;
  if (typeof input === "string") {
    try {
      root = JSON.parse(input);
    } catch (e) {
      errors.push(`input is not parseable JSON: ${e instanceof Error ? e.message : String(e)}`);
      return done();
    }
  }
  if (!isRecord(root)) {
    errors.push("input must be an object (or a JSON string encoding one)");
    return done();
  }

  // 2. content array ----------------------------------------------------------
  if (!("content" in root)) {
    errors.push('missing "content" key');
    return done();
  }
  const content = root.content;
  if (!Array.isArray(content)) {
    errors.push('"content" must be an array');
    return done();
  }
  if (content.length === 0) {
    warnings.push('"content" is an empty array — template has no elements');
    return done();
  }

  // 3. Per-element shape ------------------------------------------------------
  type El = { id: string; name: string; parent: string | 0; children: string[] };
  const elements: El[] = [];
  const byId = new Map<string, El>();

  content.forEach((raw, index) => {
    const at = `content[${index}]`;
    if (!isRecord(raw)) {
      errors.push(`${at} is not an object`);
      return;
    }

    const id = raw.id;
    if (typeof id !== "string" || id.length === 0) {
      errors.push(`${at} has missing/invalid "id" (expected non-empty string)`);
    }

    const name = raw.name;
    if (typeof name !== "string" || name.length === 0) {
      errors.push(`${at} has missing/invalid "name" (expected string)`);
    } else if (!ALLOWED.has(name)) {
      errors.push(`${at} has element name "${name}" not in ALLOWED_ELEMENTS whitelist`);
    }

    const parent = raw.parent;
    const parentOk = parent === 0 || (typeof parent === "string" && parent.length > 0);
    if (!parentOk) {
      errors.push(`${at} has missing/invalid "parent" (expected non-empty string or 0)`);
    }

    const children = raw.children;
    let childrenOk = Array.isArray(children);
    if (!Array.isArray(children)) {
      errors.push(`${at} has missing/invalid "children" (expected array of strings)`);
    } else {
      children.forEach((c, ci) => {
        if (typeof c !== "string" || c.length === 0) {
          errors.push(`${at}.children[${ci}] is not a non-empty string`);
          childrenOk = false;
        }
      });
    }

    // settings
    if (!("settings" in raw) || raw.settings === undefined) {
      warnings.push(`${at} has no "settings" object`);
    } else if (!isRecord(raw.settings)) {
      errors.push(`${at} has invalid "settings" (expected object)`);
    } else {
      scanSettings(raw.settings, `${at}.settings`, errors, warnings, new Set());
    }

    if (typeof id === "string" && id.length > 0 && parentOk && childrenOk) {
      const el: El = {
        id,
        name: typeof name === "string" ? name : "",
        parent: parent as string | 0,
        children: (children as string[]).slice(),
      };
      elements.push(el);
      // 4. unique ids
      if (byId.has(id)) {
        errors.push(`duplicate element id "${id}"`);
      } else {
        byId.set(id, el);
      }
    }
  });

  // 5. Reference integrity ----------------------------------------------------
  const claimedBy = new Map<string, string>(); // childId -> parent element id
  for (const el of elements) {
    if (el.parent !== 0 && !byId.has(el.parent)) {
      errors.push(`element "${el.id}" has parent "${el.parent}" which does not exist`);
    }

    const seenChildren = new Set<string>();
    for (const childId of el.children) {
      if (childId === el.id) {
        errors.push(`element "${el.id}" lists itself as its own child`);
        continue;
      }
      if (seenChildren.has(childId)) {
        warnings.push(`element "${el.id}" lists child "${childId}" more than once`);
        continue;
      }
      seenChildren.add(childId);

      const child = byId.get(childId);
      if (!child) {
        errors.push(`element "${el.id}" lists child "${childId}" which does not exist`);
        continue;
      }
      // back-reference consistency
      if (child.parent !== el.id) {
        warnings.push(
          `element "${el.id}" lists child "${childId}" but that child's parent is "${String(child.parent)}"`
        );
      }
      const otherParent = claimedBy.get(childId);
      if (otherParent !== undefined && otherParent !== el.id) {
        warnings.push(`child "${childId}" is claimed by both "${otherParent}" and "${el.id}"`);
      } else {
        claimedBy.set(childId, el.id);
      }
    }
  }

  // reverse back-reference: my parent should list me
  for (const el of elements) {
    if (el.parent === 0) continue;
    const parentEl = byId.get(el.parent);
    if (parentEl && !parentEl.children.includes(el.id)) {
      warnings.push(`element "${el.id}" has parent "${el.parent}" which does not list it in children`);
    }
  }

  // 6. No parent-child cycles (walk up with a visited set) ---------------------
  const acyclic = new Set<string>(); // memo of ids proven to reach a root
  for (const el of elements) {
    const visited = new Set<string>();
    let current: El | undefined = el;
    let cycle = false;
    while (current) {
      if (acyclic.has(current.id)) break;
      if (visited.has(current.id)) {
        cycle = true;
        break;
      }
      visited.add(current.id);
      if (current.parent === 0) break;
      current = byId.get(current.parent); // missing parent already errored above
    }
    if (cycle) {
      errors.push(`parent-child cycle detected involving element "${el.id}"`);
    } else {
      for (const id of visited) acyclic.add(id);
    }
  }

  return done();
}
