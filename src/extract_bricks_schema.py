"""從 Bricks theme「原始碼」抽取真 schema（Bricks 沒有隨版本的官方 schema 文件——
直接從使用者裝的 theme 現抽，版本自動對齊，不假設特定版本）。

原理：每個 element 是一個 PHP class（includes/elements/*.php），
`$this->controls['key']` 的定義就是該 element 的 settings schema——
掃描原始碼把「element 名 → 可用 settings key 清單」抽成 JSON，
供 clone skill 查欄位存在性、供 validate_template.py --live-schema 做逐鍵檢查。

用法：
  uv run python src/extract_bricks_schema.py [--theme-dir DIR] [--out FILE]

預設 theme-dir 依序嘗試：<plugin>/docker/wp/wp-content/themes/bricks、
cwd 下同路徑。輸出預設 cwd 的 data/bricks-schema-live.json（使用者專案，gitignore 內）。
只用標準函式庫。
"""

import argparse
import json
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

NAME_RE = re.compile(r"public\s+\$name\s*=\s*['\"]([a-z0-9-]+)['\"]")
CONTROL_RE = re.compile(r"\$this->controls\[\s*['\"]([A-Za-z0-9_:-]+)['\"]\s*\]\s*=")
VERSION_RE = re.compile(r"^Version:\s*([\d.]+)", re.M)


def candidates():
    here = os.path.dirname(os.path.abspath(__file__))
    return [
        os.path.join(here, "..", "docker", "wp", "wp-content", "themes", "bricks"),
        os.path.join(os.getcwd(), "docker", "wp", "wp-content", "themes", "bricks"),
    ]


def main():
    ap = argparse.ArgumentParser(description="從 Bricks theme 原始碼抽取 element/settings schema")
    ap.add_argument("--theme-dir", default=None, help="Bricks theme 目錄（含 style.css 與 includes/elements/）")
    ap.add_argument("--out", default=os.path.join("data", "bricks-schema-live.json"))
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
    elements = {}
    for fn in sorted(os.listdir(eldir)):
        if not fn.endswith(".php"):
            continue
        src = open(os.path.join(eldir, fn), encoding="utf-8", errors="replace").read()
        nm = NAME_RE.search(src)
        name = nm.group(1) if nm else fn[:-4]
        controls = sorted(set(CONTROL_RE.findall(src)))
        if fn == "base.php":  # 共通基底：所有 element 都繼承這些 key
            elements["__base__"] = {"file": fn, "controls": controls}
        else:
            elements[name] = {"file": fn, "controls": controls}

    out = {
        "bricks_version": version,
        "extracted_from": os.path.abspath(theme),
        "element_count": len([k for k in elements if k != "__base__"]),
        "elements": elements,
    }
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    json.dump(out, open(args.out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"[ok] Bricks {version}：{out['element_count']} 個 element → {args.out}")


if __name__ == "__main__":
    main()
