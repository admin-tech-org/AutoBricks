"""AutoBricks 模板驗證器 — 檢查 JSON 結構與部分 Bricks 設定。

Agent 產品依 web-page-to-bricks skill 檢查 template.json，並另行驗證正常匯入與實際頁面。
只用標準函式庫。檢查層次：

  1. 信封：{id, name, parent, children, settings}（component 實例以 cid 識別、放寬 name）
  2. id：格式 ^[a-z0-9]{6}$、唯一；警告不含數字（匯入 id 全域字串替換的踩雷防護）
  3. 圖：parent/children 互相一致、無懸空引用、無環、皆可從根到達
  4. element name、settings 與 pageSettings 欄位：對照 --live-schema 指定的原始碼掃描結果，
     由呼叫端指定當次任務的 tmp/measurements/bricks-schema.json；未指定就略過相關檢查。
     掃描包含可辨識的父類別欄位，但不執行 PHP；動態組裝、條件與覆寫仍需配合 theme 與實測判讀。
  5. 固定形狀檢查（基於 1.12.x 經驗，不隨 live schema 切換；版本筆記見使用者專案的 bricks-import.md）：
     _boxShadow 必須 object、_gradient 必須 object、_background 不可是字串、
     _cssCustom 含 %root% 直接判 error（1.12.x 實證不替換）、font-family 帶逗號警告、
     image 同時固定 _width 與 _height 警告（變形）、selectors 為 2.x 特性警告
  6. code 元素：executeCode 開了但無任何 code 內容判 error、
     code/javascriptCode/cssCode 含 %root% 判 error、javascriptCode 內含 <script> 標籤警告、
     外部載入（script src / import()）與 document.write 警告，需確認來源及實際執行結果、
     有 javascriptCode 但 executeCode 未開警告（前台不執行）、
     每顆可執行 code 元素都發警告供逐一審核（渲染對照必實測有跑）
  7. 空設定的單一子元素容器：提醒依版型、選擇器與互動判斷用途，不限制巢狀深度

用法：
  uv run --no-project python src/validate_template.py <template.json> [--live-schema FILE] [--strict] [--json]

exit code：0 = PASS（--strict 時警告也算 fail）、1 = 有 error、2 = 用法/讀檔錯誤
"""

import argparse
import json
import os
import re
import sys

# Windows 主控台預設 cp950 會把 zh-TW 輸出弄成亂碼／UnicodeEncodeError——強制 UTF-8
sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

ID_RE = re.compile(r"^[a-z0-9]{6}$")
MISSING = object()
GENERIC_FONTS = {
    "serif",
    "sans-serif",
    "monospace",
    "cursive",
    "fantasy",
    "system-ui",
    "ui-serif",
    "ui-sans-serif",
    "ui-monospace",
    "ui-rounded",
}


def load_elements(path):
    """回傳 (elements, global_classes, page_settings)。接受三種輸入：
    裸元素陣列、{"content": [...]}、或完整 template export（含 id/title/.../content）。"""
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, list):
        return data, [], MISSING
    if isinstance(data, dict):
        content = data.get("content")
        if isinstance(content, list):
            gc = data.get("globalClasses")
            if not isinstance(gc, list):
                gc = data.get("global_classes")  # Bricks UI 匯入/匯出的官方鍵名（蛇形；1.12.5 templates.php）
            return content, gc if isinstance(gc, list) else [], data.get("pageSettings", MISSING)
        raise ValueError('JSON 是物件但沒有 "content" 陣列')
    raise ValueError("JSON 頂層必須是陣列或含 content 的物件")


def load_live_schema(path):
    """載入從使用者 theme 原始碼掃描的元素、頁面設定與欄位清單。"""
    if not path or not os.path.isfile(path):
        return None
    try:
        with open(path, encoding="utf-8") as source:
            d = json.load(source)
        els = d.get("elements", {})
        base = set(els.get("__base__", {}).get("controls", []))
        page = d.get("page_settings")
        page_controls = page.get("controls") if isinstance(page, dict) else None
        return {
            "version": d.get("bricks_version", "?"),
            "names": {k for k in els if k != "__base__"},
            "controls": {k: set(v.get("controls", [])) | base for k, v in els.items() if k != "__base__"},
            "page_controls": set(page_controls) if isinstance(page_controls, list) else None,
        }
    except (OSError, json.JSONDecodeError, AttributeError, TypeError):
        return None


def check_page_settings(settings, live):
    if settings is MISSING or settings == []:
        return [], []
    if not isinstance(settings, dict):
        return ["[pageSettings] 必須是物件（或 Bricks 的空陣列 []）"], []
    if not settings:
        return [], []
    controls = live.get("page_controls") if live else None
    if controls is None:
        return [], ["[pageSettings] 缺少頁面欄位 schema，略過欄位存在性檢查；請重新擷取當前 theme 的 schema 或查閱原始碼"]
    warnings = []
    for key in settings:
        if key.split(":", 1)[0] not in controls:
            warnings.append(
                f"[pageSettings] 設定鍵 {key!r} 不在 Bricks {live['version']} 的候選頁面欄位中；"
                "靜態掃描可能不完整，需核對 theme 原始碼與實際生效結果"
            )
    return [], warnings


def check(elements, schema_names, global_classes=None, live=None, page_settings=MISSING):
    errors, warnings = check_page_settings(page_settings, live)
    global_classes = global_classes or []
    if live:  # element name 名冊全部來自 live schema
        schema_names = live["names"]

    # ---- 0. Global Classes（樣式元件）---------------------------------
    class_ids = set()
    for i, c in enumerate(global_classes):
        if not isinstance(c, dict) or "id" not in c or "name" not in c:
            errors.append(f"[globalClasses {i}] 缺 id 或 name")
            continue
        cid = c["id"]
        if not isinstance(cid, str) or not ID_RE.fullmatch(cid):
            errors.append(f"[globalClasses {i}] id {cid!r} 不符 ^[a-z0-9]{{6}}$")
            continue
        if cid in class_ids:
            errors.append(f"[globalClasses {i}] id {cid!r} 重複")
        class_ids.add(cid)
        cs = c.get("settings")
        if cs is not None and not isinstance(cs, dict) and cs != []:
            errors.append(f"[globalClasses {i}] settings 必須是物件")

    def err(i, el, msg):
        errors.append(f"[{i}] id={el.get('id', '?')} name={el.get('name', '?')}: {msg}")

    def warn(i, el, msg):
        warnings.append(f"[{i}] id={el.get('id', '?')} name={el.get('name', '?')}: {msg}")

    # ---- 1+2. 信封與 id ------------------------------------------------
    by_id = {}
    for i, el in enumerate(elements):
        if not isinstance(el, dict):
            errors.append(f"[{i}] 元素不是物件")
            continue
        is_component = "cid" in el
        for key in ("id", "parent", "children", "settings"):
            if key not in el:
                err(i, el, f"缺必要欄位 {key!r}")
        if not is_component and "name" not in el:
            err(i, el, "缺必要欄位 'name'（非 component 實例）")

        eid = el.get("id")
        if isinstance(eid, str):
            if not ID_RE.fullmatch(eid):
                err(i, el, f"id {eid!r} 不符 ^[a-z0-9]{{6}}$")
            elif not any(c.isdigit() for c in eid):
                warn(i, el, f"id {eid!r} 不含數字——匯入 id 重編（全域字串替換）可能撞壞，建議至少含 1 個數字")
            if eid in by_id:
                err(i, el, f"id {eid!r} 重複")
            by_id[eid] = el
        else:
            err(i, el, f"id 必須是字串，得到 {type(eid).__name__}")

        settings = el.get("settings")
        if isinstance(settings, list) and not settings:
            settings = {}  # Bricks 把空 settings 存成 []（PHP 空陣列）——視同空物件放行
        if not isinstance(settings, dict):
            err(i, el, "settings 必須是物件（或 Bricks 的空陣列 []）")
        children = el.get("children")
        if not isinstance(children, list):
            err(i, el, "children 必須是陣列")

        # ---- 4. element name 對 schema --------------------------------
        name = el.get("name")
        if not (is_component and name is None) and (not isinstance(name, str) or not name):
            err(i, el, "name 必須是非空字串（component 實例可省略）")
        if isinstance(name, str) and schema_names is not None and name not in schema_names:
            err(i, el, f"element name {name!r} 不在 schema 的元素清單中（不存在的元素或拼錯）")
        if live and isinstance(name, str) and name in live["controls"] and isinstance(settings, dict):
            ctrls = live["controls"][name]
            for skey in settings:
                base_key = skey.split(":", 1)[0]
                if base_key not in ctrls:
                    warn(i, el, f"設定鍵 {base_key!r} 不在 {name} 的候選欄位中；靜態掃描可能不完整，需核對 theme 原始碼與實際生效結果")

        if "selectors" in el:
            warn(i, el, "selectors 是 Bricks 2.0+ 特性，1.12.x 不支援（會被忽略）")

        refs = (settings or {}).get("_cssGlobalClasses") if isinstance(settings, dict) else None
        if refs is not None:
            if not isinstance(refs, list):
                err(i, el, "_cssGlobalClasses 必須是 class id 陣列")
            else:
                for cid in refs:
                    if not isinstance(cid, str) or cid not in class_ids:
                        err(i, el, f"_cssGlobalClasses 引用不存在的 class {cid!r}（template 的 globalClasses 沒有它）")

        # ---- 5. 已知形狀（1.12.x 實證）----------------------------------------
        if isinstance(settings, dict):
            for skey, sval in settings.items():
                base = skey.split(":", 1)[0]
                if base == "_boxShadow" and not isinstance(sval, dict):
                    err(i, el, f"{skey} 必須是 OBJECT，不能使用陣列（1.12.x 實證）")
                if base == "_gradient" and not isinstance(sval, dict):
                    err(i, el, f"{skey} 必須是 object（獨立 _gradient key，勿塞 CSS 字串）")
                if base == "_background":
                    if isinstance(sval, str):
                        err(i, el, "_background 不可是字串（漸層走獨立 _gradient；背景圖走 image object）")
                    elif isinstance(sval, dict) and "linear-gradient" in json.dumps(sval):
                        warn(i, el, "_background 內出現 linear-gradient 字串——漸層應走獨立 _gradient key")
                if base == "_cssCustom" and isinstance(sval, str) and "%root%" in sval:
                    err(i, el, "_cssCustom 含 %root% —— 1.12.x 實證不會替換，會輸出無效 selector；改用真實 #brxe-<id>")
                if base == "_typography" and isinstance(sval, dict):
                    fam = sval.get("font-family", "")
                    if isinstance(fam, str) and "," in fam:
                        warn(i, el, f"font-family {fam!r} 帶逗號——Bricks 會整串當一個字型名；generic 應拆到 'fallback'")
                    elif isinstance(fam, str) and fam.strip().lower() in GENERIC_FONTS:
                        warn(i, el, f"font-family 只有 generic {fam!r}——確認是否漏了主字族")
            if el.get("name") == "image" and "_width" in settings and "_height" in settings:
                warn(i, el, "image 同時固定 _width 與 _height——窄容器會變形；高度改用 id-scoped aspect-ratio")

            # ---- 6. code 元素內容與執行檢查 -------------------------------
            if el.get("name") == "code":
                exec_on = bool(settings.get("executeCode"))
                has_body = any(
                    isinstance(settings.get(k), str) and settings.get(k).strip()
                    for k in ("code", "javascriptCode", "cssCode")
                )
                if exec_on and not has_body:
                    err(i, el, "executeCode 開了但 code/javascriptCode/cssCode 全空——空殼 code 元素")
                for ck in ("code", "cssCode"):
                    cv = settings.get(ck)
                    if isinstance(cv, str) and "%root%" in cv:
                        err(i, el, f"{ck} 含 %root% —— 不會被替換，改用真實 #brxe-<id>")
                js = settings.get("javascriptCode")
                if isinstance(js, str) and js.strip():
                    if not exec_on:
                        warn(i, el, "有 javascriptCode 但 executeCode 未開——前台不會執行")
                    if "%root%" in js:
                        err(i, el, "javascriptCode 含 %root% —— 不會被替換；selector 改用真實 #brxe-<id>")
                    if "<script" in js.lower():
                        warn(i, el, "javascriptCode 內含 <script> 標籤——此欄位要純 JS（markup 放 code 欄位）")
                    if re.search(r"<script[^>]*\bsrc\s*=|\bimport\s*\(|document\.write", js):
                        warn(
                            i, el, "javascriptCode 含外部載入或 document.write——確認資源來源、載入順序與頁面影響，並實測執行結果"
                        )
                if exec_on and has_body:
                    warn(
                        i,
                        el,
                        "可執行 code 元素——需實測 JS 與互動效果，並依目標版本確認 Bricks code execution 設定與簽章",
                    )

    # ---- 3. 圖完整性 ----------------------------------------------------
    def is_root(p):
        return p is None or (type(p) is int and p == 0) or (isinstance(p, str) and p == "0")

    for i, el in enumerate(elements):
        if not isinstance(el, dict):
            continue
        parent = el.get("parent")
        if not is_root(parent):
            if not isinstance(parent, str) or parent not in by_id:
                err(i, el, f"parent {parent!r} 不存在")
            else:
                pchildren = by_id[parent].get("children")
                if isinstance(pchildren, list) and el.get("id") not in pchildren:
                    err(i, el, f"parent {parent!r} 的 children 沒有列出本元素（雙向不一致）")
        children = el.get("children")
        if not isinstance(children, list):
            continue
        for cid_ in children:
            if not isinstance(cid_, str):
                err(i, el, f"children 成員必須是 id 字串，得到 {type(cid_).__name__}")
                continue
            if cid_ not in by_id:
                err(i, el, f"children 引用不存在的 id {cid_!r}")
            else:
                cparent = by_id[cid_].get("parent")
                if cparent != el.get("id"):
                    err(i, el, f"child {cid_!r} 的 parent 是 {cparent!r}，雙向不一致")

    # 環／可達性（僅在圖大致健全時檢查，避免重複報錯）
    if not errors:
        roots = [el["id"] for el in elements if isinstance(el, dict) and is_root(el.get("parent"))]
        if elements and not roots:
            errors.append("沒有任何根元素（parent=0）")
        seen = set()
        stack = list(roots)
        while stack:
            nid = stack.pop()
            if nid in seen:
                continue
            seen.add(nid)
            stack.extend(by_id[nid].get("children") or [])
        unreachable = [eid for eid in by_id if eid not in seen]
        if unreachable:
            errors.append(f"{len(unreachable)} 個元素無法從根到達（孤島或環）：{', '.join(unreachable[:8])}")

    # ---- 7. 容器用途提示，不以層數或子元素數量決定是否刪除 ----------------
    wrap_types = {"container", "block", "div"}
    for i, el in enumerate(elements):
        if not isinstance(el, dict):
            continue
        children = el.get("children")
        name = el.get("name")
        if (isinstance(name, str) and name in wrap_types
                and isinstance(children, list) and len(children) == 1
                and el.get("settings") in ({}, [])):
            warn(i, el, "空設定的單一子元素容器；請依版型、選擇器與互動判斷是否需要保留")

    return errors, warnings


def main():
    ap = argparse.ArgumentParser(description="Bricks 模板 JSON 驗證 gate")
    ap.add_argument("template", help="template.json 路徑（裸陣列或含 content 的物件皆可）")
    ap.add_argument(
        "--live-schema",
        default=None,
        help="當次 extract_bricks_schema.py 的輸出，用於核對元素與頁面設定欄位；未指定則略過",
    )
    ap.add_argument("--strict", action="store_true", help="警告也視為失敗")
    ap.add_argument("--json", action="store_true", dest="as_json", help="機器可讀輸出")
    args = ap.parse_args()

    try:
        elements, global_classes, page_settings = load_elements(args.template)
    except (OSError, ValueError, json.JSONDecodeError) as e:
        print(f"[x] 讀取失敗: {e}", file=sys.stderr)
        sys.exit(2)

    live = load_live_schema(args.live_schema)
    schema_names = None  # element name 名冊由 live schema 提供（check 內設定）
    errors, warnings = check(elements, schema_names, global_classes, live, page_settings)
    ok = not errors and not (args.strict and warnings)
    notes = ["候選欄位檢查來自靜態掃描，不代表所有設定已實際生效；仍需正常匯入與渲染驗收"] if live else [
        "未載入 live schema，略過元素名稱與設定欄位檢查；以 --live-schema 指定當次 schema 檔案"
    ]

    if args.as_json:
        print(
            json.dumps(
                {"valid": ok, "elements": len(elements), "errors": errors, "warnings": warnings,
                 "live_schema_version": live["version"] if live else None, "notes": notes},
                ensure_ascii=False,
                indent=2,
            )
        )
    else:
        print(
            f"elements: {len(elements)}  global classes: {len(global_classes)}"
            + (f"  [live schema: Bricks {live['version']}]" if live else "")
        )
        for note in notes:
            print(f"[info] {note}")
        for msg in errors:
            print(f"[error] {msg}")
        for msg in warnings:
            print(f"[warn]  {msg}")
        print("PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
