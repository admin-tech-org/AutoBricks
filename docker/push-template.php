<?php
/**
 * 把 Bricks template JSON 寫進 WordPress 頁面（於容器內執行；clone skill 主迴圈會呼叫）。
 *
 * 用法（host 端）：
 *   MSYS_NO_PATHCONV=1 docker cp template.json autobricks-wp:/tmp/template.json
 *   MSYS_NO_PATHCONV=1 docker cp push-template.php autobricks-wp:/tmp/
 *   MSYS_NO_PATHCONV=1 docker exec -e TEMPLATE=/tmp/template.json \
 *       [-e PAGE_ID=89] [-e TITLE="My Page"] autobricks-wp php /tmp/push-template.php
 *
 * 不給 PAGE_ID → 建全新 published page（絕不覆寫既有頁）；給了才覆寫該頁。
 * 關鍵（勿省）：wp_set_current_user(admin) 否則 WP 靜默丟棄寫入；內容必 wp_slash。
 */
require '/var/www/html/wp-load.php';

$admins = get_users(['role' => 'administrator', 'number' => 1, 'fields' => 'ID']);
if (!$admins) { fwrite(STDERR, "NO ADMIN USER\n"); exit(1); }
wp_set_current_user((int) $admins[0]);

$path = getenv('TEMPLATE') ?: '/tmp/template.json';
$tpl  = json_decode((string) file_get_contents($path), true);
if (!$tpl || empty($tpl['content']) || !is_array($tpl['content'])) {
  fwrite(STDERR, "BAD TEMPLATE JSON: $path\n"); exit(1);
}

$title   = getenv('TITLE') ?: ('AutoBricks ' . date('Y-m-d H:i'));
$page_id = getenv('PAGE_ID');

if ($page_id) {
  $page_id = (int) $page_id;
  if (!get_post($page_id)) { fwrite(STDERR, "post $page_id missing\n"); exit(1); }
  set_post_type($page_id, 'page'); // 目標貼文若是 bricks_template，轉成普通頁
  wp_update_post(['ID' => $page_id, 'post_type' => 'page', 'post_status' => 'publish', 'post_title' => $title]);
  delete_post_meta($page_id, '_bricks_template_type');
} else {
  $page_id = wp_insert_post([
    'post_type'    => 'page',
    'post_status'  => 'publish',
    'post_title'   => $title,
    'post_content' => '',
  ], true);
  if (is_wp_error($page_id)) { fwrite(STDERR, 'insert failed: ' . $page_id->get_error_message() . "\n"); exit(1); }
}

update_post_meta($page_id, '_bricks_page_content_2', wp_slash($tpl['content']));
update_post_meta($page_id, '_bricks_editor_mode', 'bricks');

// template 頂層 globalClasses（樣式元件）→ 合併寫入全站 option（以 id 去重、後者覆蓋）
// 鍵名相容：globalClasses（本 plugin 慣用駝峰）與 global_classes（Bricks UI 匯入/匯出的官方蛇形）
$gcs = !empty($tpl['globalClasses']) ? $tpl['globalClasses'] : ($tpl['global_classes'] ?? null);
if (!empty($gcs) && is_array($gcs)) {
  $existing = get_option('bricks_global_classes', []);
  if (!is_array($existing)) $existing = [];
  $by_id = [];
  foreach ($existing as $c) { if (isset($c['id'])) $by_id[$c['id']] = $c; }
  foreach ($gcs as $c) { if (isset($c['id'])) $by_id[$c['id']] = $c; }
  update_option('bricks_global_classes', array_values($by_id));
  echo 'global classes merged: ' . count($gcs) . "\n";
}

if (!empty($tpl['customCss'])) {
  $settings = get_post_meta($page_id, '_bricks_page_settings', true);
  if (!is_array($settings)) $settings = [];
  $settings['customCss'] = $tpl['customCss'];
  update_post_meta($page_id, '_bricks_page_settings', wp_slash($settings));
}

// 可執行 code 元素（clone skill 動態階梯第 4 層）點名：Bricks 有 code execution 權限與
// 程式碼簽章機制（版本相關）——前台 JS 沒跑時，從這份名單開始查，勿當作推送成功＝會動。
$exec_ids = [];
foreach ($tpl['content'] as $el) {
  if (($el['name'] ?? '') === 'code' && !empty($el['settings']['executeCode'])) $exec_ids[] = $el['id'] ?? '?';
}
if ($exec_ids) {
  echo 'NOTICE: executable code elements: ' . implode(', ', $exec_ids)
     . " —— 前台若沒執行，檢查 Bricks code execution 設定與簽章（查 theme 原始碼定案）\n";
}

$content = get_post_meta($page_id, '_bricks_page_content_2', true);
$n       = is_array($content) ? count($content) : 0;
echo "PAGE_ID: $page_id\n";
echo "elements written: $n\n";
echo 'permalink: ' . get_permalink($page_id) . "\n";
echo "OK\n";
