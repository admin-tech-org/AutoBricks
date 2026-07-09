<?php
require '/var/www/html/wp-load.php';
foreach ([88, 89] as $id) {
  $p = get_post($id);
  if (!$p) { echo "post $id: DOES NOT EXIST\n"; continue; }
  echo "post $id: type={$p->post_type} status={$p->post_status} title=\"{$p->post_title}\"\n";
  $mode = get_post_meta($id, '_bricks_editor_mode', true);
  $content = get_post_meta($id, '_bricks_page_content_2', true);
  $n = is_array($content) ? count($content) : 0;
  echo "         editor_mode=" . var_export($mode, true) . " bricks_elements=$n\n";
}
// next auto-increment id hint
global $wpdb;
$max = (int) $wpdb->get_var("SELECT MAX(ID) FROM {$wpdb->posts}");
echo "max post ID currently: $max\n";
$auto = $wpdb->get_var("SELECT AUTO_INCREMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '{$wpdb->posts}'");
echo "posts AUTO_INCREMENT: $auto\n";
