---
name: bricks-wp-testing
description: >-
  Write, regenerate, and visually verify Bricks Builder templates on a local
  Docker WordPress. Use when pushing generated Bricks JSON onto a WP page,
  re-running only the cheap generate stage, driving Chrome via CDP/Playwright, or
  debugging why a pushed page renders wrong. Covers the docker/php write path,
  MSYS path mangling, fast-regen, and screenshot verification gotchas.
---

# Bricks on local WordPress — write & verify

Target setup: Docker `wordpress-docker-wordpress-1` at `localhost:8080`, Bricks
1.12.5. Demo page `?page_id=88`. Never log into WP by typing credentials in the
browser (prohibited) — write directly via PHP under the container.

## Write Bricks content to a page (PHP under the container)
Postmeta keys: `_bricks_page_content_2` (the content array),
`_bricks_page_settings` (page settings incl. `customCss`), `_bricks_editor_mode`.
Writing REQUIRES an admin current-user + `wp_slash`, or WP sanitizes/silently drops it:
```php
require '/var/www/html/wp-load.php';
$admins = get_users(['role'=>'administrator','number'=>1,'fields'=>'ID']);
if ($admins) wp_set_current_user((int)$admins[0]);           // else the write is dropped
$json = json_decode(file_get_contents('/tmp/template.json'), true);
update_post_meta(88, '_bricks_page_content_2', wp_slash($json['content']));
update_post_meta(88, '_bricks_editor_mode', 'bricks');
```
Run it:
```bash
docker cp storage/templates/<job>/template.json wordpress-docker-wordpress-1:/tmp/template.json
docker cp push.php wordpress-docker-wordpress-1:/tmp/push.php
MSYS_NO_PATHCONV=1 docker exec wordpress-docker-wordpress-1 php /tmp/push.php
```
**MSYS_NO_PATHCONV=1 is required** — Git Bash otherwise rewrites `/tmp/push.php`
into a Windows path (`C:/Program Files/Git/tmp/...`) and php can't find it.

Because element `_cssCustom` is self-contained, you can prove CSS travels with the
template alone: write only `content` and REMOVE `_bricks_page_settings.customCss`
— the page stays styled.

## Fast regen (don't re-run AI vision)
After a mapper change in `packages/bricks`, regenerate ONLY the generate stage from
the cached, already-vision-refined `page-ir.json` — do NOT re-run `--vision ai`
(≈57s and non-deterministic, and it would overwrite the vision colors/gradients):
```bash
node -e "const {generateBricksJson}=require('./packages/bricks/dist/generate-json.js');
const ir=require('./storage/ir/<job>/page-ir.json'); const fs=require('fs');
fs.writeFileSync('./storage/templates/<job>/template.json',
  JSON.stringify(generateBricksJson(ir,{idStyle:'bricks',sourceUrl:ir.url}),null,2));"
```
Then docker cp + php push. Rebuild first if you changed TS (`npx tsc -b`).

## Chrome CDP (extension doesn't connect on this machine — use Playwright MCP)
```bash
"C:/Program Files/Google/Chrome/Application/chrome.exe" --remote-debugging-port=9222 \
  --user-data-dir="<proj>/.browser/.chrome_cdp" --no-first-run <url>
curl http://127.0.0.1:9222/json/version    # verify it's up
```
CDP drops mid-session sometimes — relaunch and re-verify. `.browser/` is huge
(~215MB) and machine-local — keep it gitignored.

## Verify a pushed page (Playwright `browser_evaluate`)
- **Reload after every push** — element ids change each regen (idStyle "bricks").
- **Screenshot white/blank frames are a paint-timing glitch, not a bug**: the
  first `take_screenshot` after a scroll often times out at 5s ("fonts loaded")
  and a retry can still catch an unpainted frame — retry again, or verify via
  computed styles instead of pixels.
- **Trigger scroll-entrance before judging visibility**: scroll the element into
  view and wait ~1s; only then is `_interactions` fadeIn settled (opacity 1).
- Prefer measuring truth over eyeballing: read `getComputedStyle`, element boxes,
  `data-interactions`, animation angle over two samples to prove motion, etc.

## Verify structured output survived
When something renders empty/wrong, first read the actual data
(`storage/templates/<job>/template.json`, the pushed page HTML via `curl`), don't
assume. Grep the served HTML for the expected scoped rule (`#brxe-…{…}`), for
leaked markers (`%root%`, private `__…` keys), and for enqueued assets
(`animate.min.css`, `bricks.min.js`).
