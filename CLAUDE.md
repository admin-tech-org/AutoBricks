# CLAUDE.md — project guide

**Bricks CDP Visual Generator**: URL → CDP/Playwright capture (screenshot + DOM +
computed CSS + layout boxes) → Page IR → importable **Bricks Builder JSON**.

**Stack: Node.js ≥ 18 + TypeScript (npm workspaces, `tsc -b`). NOT Python** — there
is no `uv`/`pyproject.toml`/`requirements.txt` and none is needed.

## Commands
```bash
npm run build                       # tsc -b + dashboard
npm run generate -- --url <url>     # CLI pipeline (add --vision ai for pixel-fidelity)
npm run generate -- --job <id>      # re-analyze a captured job (no re-capture)
npm run api                         # API + dashboard on :4000
```
Fixture for smoke tests: `test-fixtures/landing.html` (file:// URL). Output → `storage/` (gitignored).

## Layout
```text
packages/  ir · capture · analyzer · bricks · export · validation
apps/      api · dashboard          workers/  pipeline stages
```
**Contract types live in `packages/ir/src/types.ts`** — change cross-package shapes there first.

## Conventions & gotchas that bite (read before editing the bricks mapper)
- **idStyle `"bricks"`** (6-char random w/ a digit) is default — "readable" ids get
  corrupted by Bricks' import id-remapping. A kit `.zip` must hold exactly ONE `.json`.
- **Fast regen**: after a `packages/bricks` change, regenerate ONLY the generate
  stage from the cached `storage/ir/<job>/page-ir.json` — do NOT re-run `--vision ai`
  (~57s, non-deterministic, overwrites vision colors). See the `bricks-wp-testing` skill.
- **Bricks 1.12.5 setting shapes differ from the h2b docs** (verified vs theme source):
  `_gradient` is a separate key; `_boxShadow` is an OBJECT; font-family must split into
  `{font-family, fallback}`; keep `{rgb}` for alpha<1. See the `bricks-native-json` skill.
- **`_cssCustom` is emitted VERBATIM and does NOT substitute `%root%`** — use the real
  `#brxe-<id>` (only known post-flatten). It travels with the template, no gate needed.
  See the `bricks-css-motion` skill.
- **Exact px**: images pin `_width` + an id-scoped `aspect-ratio` (never a fixed height —
  it distorts); spacing is exact (no 4px snapping).
- **WordPress writes** go through `docker exec … php` with `wp_set_current_user(admin)` +
  `wp_slash()` — never browser login. Prefix docker php with `MSYS_NO_PATHCONV=1`.

## Reference
- Detailed, portable Bricks know-how: user skills `bricks-native-json`,
  `bricks-css-motion`, `bricks-wp-testing` (invoke with `/<name>`).
- Docs: `GETTING-STARTED.md`, `ARCHITECTURE-bricks-cdp-visual-generator.md`.
