import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from src.extract_bricks_schema import extract_page_settings


ROOT = Path(__file__).resolve().parents[1]


class PageSettingsTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.element = {"id": "abc123", "name": "div", "parent": 0, "children": [], "settings": {}}
        self.schema = {
            "bricks_version": "test",
            "elements": {"div": {"controls": []}},
            "page_settings": {"controls": ["headerDisabled", "footerDisabled", "bodyClasses"]},
        }

    def validate(self, template, schema=None, strict=False):
        source = self.root / "template.json"
        source.write_text(json.dumps(template), encoding="utf-8")
        command = [sys.executable, str(ROOT / "src/validate_template.py"), str(source), "--json"]
        if schema is not None:
            file = self.root / "schema.json"
            file.write_text(json.dumps(schema), encoding="utf-8")
            command.extend(["--live-schema", str(file)])
        if strict:
            command.append("--strict")
        result = subprocess.run(command, capture_output=True, encoding="utf-8", check=False)
        return result.returncode, json.loads(result.stdout)

    def test_installed_page_controls_include_parent_and_exclude_comments(self):
        (self.root / "base.php").write_text(
            "<?php\nnamespace Bricks;\nabstract class Settings_Base { "
            "function controls() { $this->controls['bodyClasses'] = []; } }", encoding="utf-8"
        )
        (self.root / "settings-page.php").write_text(
            "<?php\nnamespace Bricks;\nclass Settings_Page extends Settings_Base {\n"
            "function controls() {\n// $this->controls['obsolete'] = [];\n"
            "$this->controls['versionSpecificFlag'] = []; } }", encoding="utf-8"
        )
        page, warnings = extract_page_settings(self.root)
        self.assertEqual(warnings, [])
        self.assertEqual(page["controls"], ["bodyClasses", "versionSpecificFlag"])
        self.schema["page_settings"] = page
        code, result = self.validate(
            {"content": [self.element], "pageSettings": {"versionSpecificFlag": True}}, self.schema, strict=True
        )
        self.assertEqual(code, 0, result)

    def test_missing_page_source_reports_unavailable_schema(self):
        page, warnings = extract_page_settings(self.root)
        self.assertIsNone(page)
        self.assertTrue(warnings)

    def test_correct_settings_pass_and_wrong_names_warn(self):
        valid = {"content": [self.element], "pageSettings": {"headerDisabled": True, "footerDisabled": True}}
        code, result = self.validate(valid, self.schema, strict=True)
        self.assertEqual(code, 0, result)
        wrong = {"content": [self.element], "pageSettings": {"disableHeader": True, "disableFooter": True}}
        code, result = self.validate(wrong, self.schema)
        self.assertEqual(code, 0)  # Static candidates are incomplete; unknown keys are warnings.
        self.assertEqual(result["errors"], [])
        self.assertEqual(len(result["warnings"]), 2)
        self.assertTrue(any("disableHeader" in w for w in result["warnings"]))
        self.assertTrue(any("disableFooter" in w for w in result["warnings"]))
        code, _ = self.validate(wrong, self.schema, strict=True)
        self.assertEqual(code, 1)

    def test_old_or_missing_schema_does_not_silently_validate_page_fields(self):
        template = {"content": [self.element], "pageSettings": {"bodyClasses": "example"}}
        old_schema = {k: v for k, v in self.schema.items() if k != "page_settings"}
        for schema in [None, old_schema]:
            with self.subTest(schema=schema):
                code, result = self.validate(template, schema)
                self.assertEqual(code, 0)
                self.assertEqual(len(result["warnings"]), 1)
                self.assertIn("pageSettings", result["warnings"][0])

    def test_invalid_page_settings_shape_fails(self):
        for settings in [None, False, "invalid", ["invalid"]]:
            with self.subTest(settings=settings):
                code, result = self.validate({"content": [self.element], "pageSettings": settings}, self.schema)
                self.assertEqual(code, 1)
                self.assertTrue(result["errors"])

    def test_omitted_and_empty_settings_and_raw_element_array_remain_supported(self):
        for template in [
            [self.element],
            {"content": [self.element]},
            {"content": [self.element], "pageSettings": {}},
            {"content": [self.element], "pageSettings": []},
        ]:
            with self.subTest(template=template):
                code, result = self.validate(template, self.schema, strict=True)
                self.assertEqual(code, 0, result)


if __name__ == "__main__":
    unittest.main()
