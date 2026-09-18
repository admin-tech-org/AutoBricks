import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class TemplateValidationTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.element = {"id": "abc123", "name": "div", "parent": 0, "children": [], "settings": {}}

    def validate(self, content, *, schema=None, as_json=True, **extra):
        source = self.root / "template.json"
        source.write_text(json.dumps({"content": content, **extra}), encoding="utf-8")
        command = [sys.executable, str(ROOT / "src/validate_template.py"), str(source)]
        if as_json:
            command.append("--json")
        if schema is not None:
            file = self.root / "schema.json"
            file.write_text(json.dumps(schema), encoding="utf-8")
            command.extend(["--live-schema", str(file)])
        result = subprocess.run(command, capture_output=True, encoding="utf-8")
        self.assertEqual(result.stderr, "", result.stderr)
        return result.returncode, json.loads(result.stdout) if as_json else result.stdout

    def test_malformed_element_fields_report_errors_without_crashing(self):
        for key, values in {
            "id": [None, 1, [], {}],
            "name": [None, "", 1, []],
            "parent": [False, [], {}, "missing"],
            "settings": [None, False, 1, "invalid", [1]],
            "children": [None, False, 1, "invalid", [None], [[]], [{}]],
        }.items():
            for value in values:
                with self.subTest(key=key, value=value):
                    code, result = self.validate([{**self.element, key: value}])
                    self.assertEqual(code, 1, result)
                    self.assertFalse(result["valid"])
                    self.assertTrue(result["errors"])

    def test_invalid_parent_children_and_class_references_do_not_interrupt_diagnostics(self):
        child = {**self.element, "id": "abc456", "parent": "abc123"}
        code, result = self.validate([{**self.element, "children": 7}, child])
        self.assertEqual(code, 1, result)
        for extra in [
            {"globalClasses": [{"id": {}, "name": "invalid"}]},
            {"content_settings": {"_cssGlobalClasses": [{}]}},
        ]:
            element = {**self.element, "settings": extra.pop("content_settings", {})}
            code, result = self.validate([element], **extra)
            self.assertEqual(code, 1, result)

    def test_bricks_empty_settings_and_component_without_name_still_work(self):
        for element in [
            {**self.element, "settings": []},
            {k: v for k, v in {**self.element, "cid": "component123"}.items() if k != "name"},
        ]:
            code, result = self.validate([element])
            self.assertEqual(code, 0, result)

    def test_layout_containers_and_deep_trees_are_not_rejected_by_shape(self):
        elements = []
        for index in range(40):
            elements.append({
                "id": f"a{index:05d}", "name": "div",
                "parent": f"a{index - 1:05d}" if index else 0,
                "children": [f"a{index + 1:05d}"] if index < 39 else [],
                "settings": {"_display": "flex", "_alignItems": "center"},
            })
        code, result = self.validate(elements)
        self.assertEqual(code, 0, result)
        self.assertEqual(result["warnings"], [])

    def test_common_and_element_settings_use_candidate_schema_including_breakpoints(self):
        schema = {"bricks_version": "test", "elements": {
            "__base__": {"controls": ["_width"]}, "div": {"controls": ["tag"]},
        }}
        code, result = self.validate([{**self.element, "settings": {
            "_width:mobile_portrait": "100%", "tag": "main", "_widht": "100%", "unknown": 1,
        }}], schema=schema)
        self.assertEqual(code, 0, result)
        self.assertEqual(len(result["warnings"]), 2)
        self.assertTrue(any("_widht" in warning for warning in result["warnings"]))
        self.assertTrue(any("unknown" in warning for warning in result["warnings"]))
        self.assertEqual(result["live_schema_version"], "test")

    def test_text_and_json_report_skipped_schema_even_without_page_settings(self):
        code, result = self.validate([self.element])
        self.assertEqual(code, 0, result)
        self.assertIsNone(result["live_schema_version"])
        self.assertTrue(result["notes"])
        _, text = self.validate([self.element], as_json=False)
        for note in result["notes"]:
            self.assertIn(note, text)


if __name__ == "__main__":
    unittest.main()
