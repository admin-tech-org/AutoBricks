<?php
/**
 * Write generated Bricks content onto page id 89, repurposing the old
 * "Postman (CDP fixed)" bricks_template into a normal page.
 * Run under the WP container: php /tmp/push.php
 */
require '/var/www/html/wp-load.php';

$PAGE_ID = 89;

$admins = get_users(['role' => 'administrator', 'number' => 1, 'fields' => 'ID']);
if (!$admins) { fwrite(STDERR, "NO ADMIN USER\n"); exit(1); }
wp_set_current_user((int) $admins[0]);   // else WP sanitizes/drops the write

$tpl = json_decode(file_get_contents('/tmp/template.json'), true);
if (!$tpl || empty($tpl['content']) || !is_array($tpl['content'])) {
  fwrite(STDERR, "BAD TEMPLATE JSON\n"); exit(1);
}

$before = get_post($PAGE_ID);
if (!$before) { fwrite(STDERR, "post $PAGE_ID missing\n"); exit(1); }
echo "before: type={$before->post_type} title=\"{$before->post_title}\"\n";

// Repurpose the template post into a published page.
set_post_type($PAGE_ID, 'page');
wp_update_post([
  'ID'          => $PAGE_ID,
  'post_type'   => 'page',
  'post_status' => 'publish',
  'post_title'  => 'PChome 24h (CDP generated)',
]);

// Bricks content MUST be slashed or WP strips backslashes/quotes.
update_post_meta($PAGE_ID, '_bricks_page_content_2', wp_slash($tpl['content']));
update_post_meta($PAGE_ID, '_bricks_editor_mode', 'bricks');

// Page-level customCss (belt & suspenders; element _cssCustom already travels).
if (!empty($tpl['customCss'])) {
  $settings = get_post_meta($PAGE_ID, '_bricks_page_settings', true);
  if (!is_array($settings)) $settings = [];
  $settings['customCss'] = $tpl['customCss'];
  update_post_meta($PAGE_ID, '_bricks_page_settings', wp_slash($settings));
}

// Drop template-only meta so it behaves as a page, not a template.
delete_post_meta($PAGE_ID, '_bricks_template_type');

$after   = get_post($PAGE_ID);
$content = get_post_meta($PAGE_ID, '_bricks_page_content_2', true);
$n       = is_array($content) ? count($content) : 0;
echo "after:  type={$after->post_type} status={$after->post_status} title=\"{$after->post_title}\"\n";
echo "elements written: $n\n";
echo "editor_mode: " . get_post_meta($PAGE_ID, '_bricks_editor_mode', true) . "\n";
echo "permalink: " . get_permalink($PAGE_ID) . "\n";
echo "OK\n";
