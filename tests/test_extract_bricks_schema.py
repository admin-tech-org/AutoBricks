import tempfile
import unittest
from pathlib import Path

from src.extract_bricks_schema import extract_elements


class SchemaInheritanceTests(unittest.TestCase):
    def extract(self, files):
        with tempfile.TemporaryDirectory() as directory:
            for name, source in files.items():
                Path(directory, name).write_text("<?php\n" + source, encoding="utf-8")
            return extract_elements(directory)

    def test_transitive_controls_follow_class_names_not_filenames(self):
        elements, warnings = self.extract({
            "base.php": """
                namespace Bricks;
                abstract class Element {
                    public function defaults() { $this->controls['_width'] = []; }
                }
            """,
            "z-layout.php": """
                namespace Bricks;
                class Layout extends Element {
                    public $name = 'container';
                    public function set_controls() { $this->controls['_display'] = []; }
                }
            """,
            "a-wrapper.php": r"""
                namespace Bricks;
                class Wrapper extends \Bricks\Layout { public $name = 'wrapper'; }
            """,
            "b-leaf.php": """
                namespace Bricks;
                final class Leaf extends wrapper {
                    public $name = 'div';
                    public function extras() { $this->controls['tag'] = []; }
                }
            """,
            "image.php": """
                namespace Bricks;
                class Image extends Element {
                    public $name = 'image';
                    public function set_controls() { $this->controls['image'] = []; }
                }
            """,
        })
        self.assertEqual(warnings, [])
        self.assertEqual(elements["div"]["controls"], ["_display", "_width", "tag"])
        self.assertEqual(elements["wrapper"]["controls"], ["_display", "_width"])
        self.assertEqual(elements["container"]["controls"], ["_display", "_width"])
        self.assertEqual(elements["image"]["controls"], ["_width", "image"])

    def test_commented_declarations_do_not_add_controls_or_parents(self):
        elements, warnings = self.extract({"card.php": """
            /* class Old extends Missing { public $name = 'old'; } */
            class Card {
                public $name = 'card';
                public function set_controls() {
                    // $this->controls['disabled'] = [];
                    $this->controls['image'] = ['url' => 'https://example.com/a#b'];
                    /* $this->controls['retired'] = []; */
                    $this->controls['title'] = [];
                }
            }
        """})
        self.assertEqual(warnings, [])
        self.assertEqual(elements["card"]["controls"], ["image", "title"])

    def test_missing_parent_preserves_own_controls_and_reports_limitation(self):
        elements, warnings = self.extract({"child.php": """
            class Child extends ExternalParent {
                public $name = 'child';
                public function set_controls() { $this->controls['text'] = []; }
            }
        """})
        self.assertEqual(elements["child"]["controls"], ["text"])
        self.assertEqual(len(warnings), 1)
        self.assertIn("externalparent", warnings[0])

    def test_cycle_fails_without_recursing_forever(self):
        with self.assertRaises(ValueError):
            self.extract({
                "a.php": "class A extends B {}",
                "b.php": "class B extends A {}",
            })


if __name__ == "__main__":
    unittest.main()
