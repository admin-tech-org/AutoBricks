<?php
/**
 * Phase 6 — publish the generated Bricks JSON onto a NEW WordPress page.
 * Creates a fresh published page (never overwrites an existing one) and writes
 * the Bricks content. Prints the new page id + permalink.
 * Run under the WP container: php /tmp/publish-new-page.php
 */
require '/var/www/html/wp-load.php';

$admins = get_users(['role' => 'administrator', 'number' => 1, 'fields' => 'ID']);
if (!$admins) { fwrite(STDERR, "NO ADMIN USER\n"); exit(1); }
wp_set_current_user((int) $admins[0]);   // else WP sanitizes/drops the write

$tpl = json_decode(file_get_contents('/tmp/template.json'), true);
if (!$tpl || empty($tpl['content']) || !is_array($tpl['content'])) {
  fwrite(STDERR, "BAD TEMPLATE JSON\n"); exit(1);
}

$page_id = wp_insert_post([
  'post_type'   => 'page',
  'post_status' => 'publish',
  'post_title'  => 'PChome 24h — Skill Pipeline',
  'post_content'=> '',
], true);
if (is_wp_error($page_id)) { fwrite(STDERR, "insert failed: " . $page_id->get_error_message() . "\n"); exit(1); }

// Bricks content MUST be slashed or WP strips backslashes/quotes.
update_post_meta($page_id, '_bricks_page_content_2', wp_slash($tpl['content']));
update_post_meta($page_id, '_bricks_editor_mode', 'bricks');

if (!empty($tpl['customCss'])) {
  $settings = ['customCss' => $tpl['customCss']];
  update_post_meta($page_id, '_bricks_page_settings', wp_slash($settings));
}

$content = get_post_meta($page_id, '_bricks_page_content_2', true);
$n       = is_array($content) ? count($content) : 0;
echo "NEW_PAGE_ID: $page_id\n";
echo "elements written: $n\n";
echo "editor_mode: " . get_post_meta($page_id, '_bricks_editor_mode', true) . "\n";
echo "permalink: " . get_permalink($page_id) . "\n";
echo "OK\n";
