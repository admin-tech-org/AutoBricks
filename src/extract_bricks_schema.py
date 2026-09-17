"""從使用者已安裝的 Bricks theme 原始碼抽取元素、頁面設定與候選欄位，不假設特定版本。

原理：每個 element 是一個 PHP class（includes/elements/*.php），
掃描 `$this->controls['key']` 的直接賦值，沿 PHP class 繼承關係合併父類別欄位，
把「element 名 → 候選 settings key 清單」及 includes/settings/settings-page.php 的頁面欄位抽成 JSON，
供 web-page-to-bricks skill 查欄位存在性、供 validate_template.py --live-schema 做逐鍵檢查。
這是靜態掃描，不執行 PHP。動態組裝、條件判斷、方法覆寫或移除欄位仍需查原始碼與實測。

用法：
  uv run --no-project python src/extract_bricks_schema.py [--theme-dir DIR] --out FILE

預設 theme-dir 為 cwd 的 .autobricks/docker/wp/wp-content/themes/bricks，
其他 WP 環境以 --theme-dir 指定，不從 plugin 安裝包尋找 theme。
Agent 產品以 --out 指定當次任務的 data/YYYYMMDD-HHMMSS-agent_product-task_name/tmp/measurements/bricks-schema.json。
只用標準函式庫。
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path

NAME_RE = re.compile(r"public\s+\$name\s*=\s*['\"]([a-z0-9-]+)['\"]")
CONTROL_RE = re.compile(r"\$this->controls\[\s*['\"]([A-Za-z0-9_:-]+)['\"]\s*\]\s*=")
VERSION_RE = re.compile(r"^Version:\s*([\d.]+)", re.M)
CLASS_RE = re.compile(
    r"^\s*(?:abstract\s+|final\s+)?class\s+(\w+)(?:\s+extends\s+([\\\w]+))?", re.M
)
NAMESPACE_RE = re.compile(r"^\s*namespace\s+([\\\w]+)\s*[;{]", re.M)
# Preserve quoted strings (including URLs) while excluding commented-out declarations.
PHP_TOKEN_RE = re.compile(r"'(?:(?:\\.)|[^'\\])*'|\"(?:(?:\\.)|[^\"\\])*\"|/\*.*?\*/|//[^\n]*|\#[^\n]*", re.S)


def extract_elements(element_dir):
    """Collect static control candidates, including transitive parents in this directory."""
    elements, classes, warnings = {}, {}, []
    for file in sorted(Path(element_dir).glob("*.php")):
        source = file.read_text(encoding="utf-8", errors="replace")
        source = PHP_TOKEN_RE.sub(
            lambda m: "\n" * m[0].count("\n") if m[0].startswith(("//", "/*", "#")) else m[0], source
        )
        name_match = NAME_RE.search(source)
        name = "__base__" if file.name == "base.php" else name_match[1] if name_match else file.stem
        controls = set(CONTROL_RE.findall(source))
        elements[name] = {"file": file.name, "controls": sorted(controls)}
        declarations = list(CLASS_RE.finditer(source))
        if len(declarations) != 1:
            warnings.append(f"{file.name}: 無法辨識單一 PHP class，僅保留直接掃描的欄位")
            continue
        declaration = declarations[0]
        namespace_match = NAMESPACE_RE.search(source)
        namespace = namespace_match[1] if namespace_match else ""

        def qualify(class_name):
            if class_name.startswith("\\"):
                return class_name.lstrip("\\").lower()
            return (namespace + "\\" + class_name if namespace else class_name).lower()

        class_name = qualify(declaration[1])
        parent = qualify(declaration[2]) if declaration[2] else None
        if class_name in classes:
            raise ValueError(f"重複的 PHP class: {class_name}")
        classes[class_name] = {"name": name, "parent": parent, "controls": controls}

    resolved = {}

    def inherited_controls(class_name, visiting=()):
        if class_name in visiting:
            raise ValueError(f"PHP class 繼承循環: {' -> '.join((*visiting, class_name))}")
        if class_name in resolved:
            return resolved[class_name]
        info = classes[class_name]
        controls = info["controls"].copy()
        parent = info["parent"]
        if parent in classes:
            controls.update(inherited_controls(parent, (*visiting, class_name)))
        elif parent:
            warnings.append(f"{class_name}: 找不到父類別 {parent}，繼承欄位可能不完整")
        resolved[class_name] = controls
        return controls

    for class_name, info in classes.items():
        elements[info["name"]]["controls"] = sorted(inherited_controls(class_name))
    return elements, warnings


def candidates():
    return [
        os.path.join(os.getcwd(), ".autobricks", "docker", "wp", "wp-content", "themes", "bricks"),
    ]


def extract_page_settings(settings_dir):
    """Use the installed theme's declarations, not a version-specific key allowlist."""
    if not (Path(settings_dir) / "settings-page.php").is_file():
        return None, ["找不到 includes/settings/settings-page.php，略過頁面設定欄位掃描"]
    settings, warnings = extract_elements(settings_dir)
    page = next((entry for entry in settings.values() if entry["file"] == "settings-page.php"), None)
    return page, warnings


def main():
    ap = argparse.ArgumentParser(description="從 Bricks theme 原始碼抽取 element/settings schema")
    ap.add_argument("--theme-dir", default=None, help="Bricks theme 目錄（含 style.css 與 includes/elements/）")
    ap.add_argument("--out", required=True, help="輸出檔案路徑，使用當次任務的 tmp/measurements/bricks-schema.json")
    args = ap.parse_args()

    theme = args.theme_dir
    if not theme:
        theme = next((c for c in candidates() if os.path.isdir(os.path.join(c, "includes", "elements"))), None)
    if not theme or not os.path.isdir(os.path.join(theme, "includes", "elements")):
        print("[x] 找不到 Bricks theme 目錄（用 --theme-dir 指定）", file=sys.stderr)
        sys.exit(2)

    version = "?"
    css = os.path.join(theme, "style.css")
    if os.path.isfile(css):
        m = VERSION_RE.search(open(css, encoding="utf-8", errors="replace").read())
        if m:
            version = m.group(1)

    eldir = os.path.join(theme, "includes", "elements")
    elements, warnings = extract_elements(eldir)
    page_settings, page_warnings = extract_page_settings(Path(theme) / "includes/settings")
    warnings.extend(page_warnings)

    out = {
        "bricks_version": version,
        "extracted_from": os.path.abspath(theme),
        "element_count": len([k for k in elements if k != "__base__"]),
        "elements": elements,
        "page_settings": page_settings,
        "warnings": warnings,
    }
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    json.dump(out, open(args.out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"[ok] Bricks {version}：{out['element_count']} 個 element → {args.out}")
    for warning in warnings:
        print(f"[!] {warning}", file=sys.stderr)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    main()
