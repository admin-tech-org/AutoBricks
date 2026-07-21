"""AutoBricks 驗證 gate — 檢查 Bricks Builder 模板 JSON 是否可安全匯入 Bricks。

replica skill 產出 template.json 後必須跑本腳本並修到 PASS 才交付。
只用標準函式庫。檢查層次：

  1. 信封：{id, name, parent, children, settings}（component 實例以 cid 識別、放寬 name）
  2. id：格式 ^[a-z0-9]{6}$、唯一；警告不含數字（匯入 id 全域字串替換的踩雷防護）
  3. 圖：parent/children 互相一致、無懸空引用、無環、皆可從根到達
  4. element name 與 settings 欄位：對照 data/bricks-schema-live.json
     （extract_bricks_schema.py 從使用者 theme 原始碼抽出、版本自動對齊——含逐鍵檢查）；
     沒有 live schema 就跳過 element name 檢查（先跑 extract_bricks_schema.py 生成）
  5. 已知形狀（實機驗證於 1.12.x；經驗明細在使用者專案的 bricks-gotchas.local.md）：
     _boxShadow 必須 object、_gradient 必須 object、_background 不可是字串、
     _cssCustom 含 %root% 直接判 error（1.12.x 實證不替換）、font-family 帶逗號警告、
     image 同時固定 _width 與 _height 警告（變形）、selectors 為 2.x 特性警告
  6. code 元素（動態階梯第 4 層＝自訂 JS）：executeCode 開了但無任何 code 內容判 error、
     code/javascriptCode/cssCode 含 %root% 判 error、javascriptCode 內含 <script> 標籤警告、
     外部載入（script src / import()）與 document.write 警告（JS 鐵則：vanilla 自包含）、
     有 javascriptCode 但 executeCode 未開警告（前台不執行）、
     每顆可執行 code 元素都發警告供逐一審核（渲染對照必實測有跑）

用法：
  uv run python src/validate_template.py <template.json> [--schema-dir DIR] [--strict] [--json]

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
    """回傳 (elements, global_classes)。接受三種輸入：
    裸元素陣列、{"content": [...]}、或完整 template export（含 id/title/.../content）。"""
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, list):
        return data, []
    if isinstance(data, dict):
        content = data.get("content")
        if isinstance(content, list):
            gc = data.get("globalClasses")
            if not isinstance(gc, list):
                gc = data.get("global_classes")  # Bricks UI 匯入/匯出的官方鍵名（蛇形；1.12.5 templates.php）
            return content, gc if isinstance(gc, list) else []
        raise ValueError('JSON 是物件但沒有 "content" 陣列')
    raise ValueError("JSON 頂層必須是陣列或含 content 的物件")


def load_live_schema(path):
    """src/extract_bricks_schema.py 的輸出：從使用者 theme 原始碼抽取的 schema（比官方 2.3 更權威）。"""
    if not path or not os.path.isfile(path):
        return None
    try:
        d = json.load(open(path, encoding="utf-8"))
        els = d.get("elements", {})
        base = set(els.get("__base__", {}).get("controls", []))
        return {
            "version": d.get("bricks_version", "?"),
            "names": {k for k in els if k != "__base__"},
            "controls": {k: set(v.get("controls", [])) | base for k, v in els.items() if k != "__base__"},
        }
    except (OSError, json.JSONDecodeError, AttributeError):
        return None


def check(elements, schema_names, global_classes=None, live=None):
    errors, warnings = [], []
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
        if not ID_RE.match(str(cid)):
            errors.append(f"[globalClasses {i}] id {cid!r} 不符 ^[a-z0-9]{{6}}$")
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
            if not ID_RE.match(eid):
                err(i, el, f"id {eid!r} 不符 ^[a-z0-9]{{6}}$")
            elif not any(c.isdigit() for c in eid):
                warn(i, el, f"id {eid!r} 不含數字——匯入 id 重編（全域字串替換）可能撞壞，建議至少含 1 個數字")
            if eid in by_id:
                err(i, el, f"id {eid!r} 重複")
            by_id[eid] = el
        elif eid is not None:
            err(i, el, f"id 必須是字串，得到 {type(eid).__name__}")

        settings = el.get("settings")
        if isinstance(settings, list) and not settings:
            settings = {}  # Bricks 把空 settings 存成 []（PHP 空陣列）——視同空物件放行
        if settings is not None and not isinstance(settings, dict):
            err(i, el, "settings 必須是物件（或 Bricks 的空陣列 []）")
        children = el.get("children")
        if children is not None and not isinstance(children, list):
            err(i, el, "children 必須是陣列")

        # ---- 4. element name 對 schema --------------------------------
        name = el.get("name")
        if name and schema_names is not None and name not in schema_names:
            err(i, el, f"element name {name!r} 不在 Bricks {live['version']} 原始碼（live schema）（不存在的元素或拼錯）")
        if live and name in live["controls"] and isinstance(settings, dict):
            ctrls = live["controls"][name]
            for skey in settings:
                base_key = skey.split(":", 1)[0]
                if not base_key.startswith("_") and base_key not in ctrls:
                    warn(i, el, f"設定鍵 {base_key!r} 不在 {name} 的 controls 裡（theme 原始碼查無此欄位）")

        if "selectors" in el:
            warn(i, el, "selectors 是 Bricks 2.0+ 特性，1.12.x 不支援（會被忽略）")

        refs = (settings or {}).get("_cssGlobalClasses") if isinstance(settings, dict) else None
        if refs is not None:
            if not isinstance(refs, list):
                err(i, el, "_cssGlobalClasses 必須是 class id 陣列")
            else:
                for cid in refs:
                    if cid not in class_ids:
                        err(i, el, f"_cssGlobalClasses 引用不存在的 class {cid!r}（template 的 globalClasses 沒有它）")

        # ---- 5. 已知形狀（1.12.x 實證）----------------------------------------
        if isinstance(settings, dict):
            for skey, sval in settings.items():
                base = skey.split(":", 1)[0]
                if base == "_boxShadow" and not isinstance(sval, dict):
                    err(i, el, f"{skey} 必須是 OBJECT（h2b 的陣列寫法是錯的；1.12.x 實證）")
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

            # ---- 6. code 元素（動態階梯第 4 層：自訂 JS）---------------------
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
                            i, el, "javascriptCode 含外部載入或 document.write——JS 階梯鐵則：vanilla、自包含、不動全域"
                        )
                if exec_on and has_body:
                    warn(
                        i,
                        el,
                        "可執行 code 元素（動態階梯第 4 層）——確認階梯 1–3 表達不了才用；渲染對照必實測 JS 有跑（Bricks code execution／簽章可能擋）",
                    )

    # ---- 3. 圖完整性 ----------------------------------------------------
    def is_root(p):
        return p in (0, "0", None)

    for i, el in enumerate(elements):
        if not isinstance(el, dict):
            continue
        parent = el.get("parent")
        if not is_root(parent):
            if not isinstance(parent, str) or parent not in by_id:
                err(i, el, f"parent {parent!r} 不存在")
            else:
                pchildren = by_id[parent].get("children") or []
                if el.get("id") not in pchildren:
                    err(i, el, f"parent {parent!r} 的 children 沒有列出本元素（雙向不一致）")
        for cid_ in el.get("children") or []:
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

    # ---- 6. 編輯性（結構極簡鐵律的 tripwire：好編輯 > 一切）---------------
    wrap_types = {"container", "block", "div"}
    for i, el in enumerate(elements):
        if not isinstance(el, dict):
            continue
        if el.get("name") in wrap_types and len(el.get("children") or []) == 1:
            settings = el.get("settings") or {}
            visual = {k.split(":", 1)[0] for k in settings} - {"_display", "tag", "_justifyContent", "_alignItems"}
            if not visual:
                warn(i, el, "單一子元素的純 wrapper（無自身樣式）——塌掉它，設計部才好編輯")

    if not errors and by_id:
        depth_of = {}

        def depth(eid):
            if eid not in depth_of:
                p = by_id[eid].get("parent")
                depth_of[eid] = 1 if p in (0, "0", None) else depth(p) + 1
            return depth_of[eid]

        maxd = max(depth(e) for e in by_id)
        if maxd > 5:
            deepest = [e for e in by_id if depth_of[e] == maxd][:5]
            warnings.append(f"最大巢狀深度 {maxd} 層（>5）——結構過深難編輯，回頭壓平（最深：{', '.join(deepest)}）")

    return errors, warnings


def main():
    ap = argparse.ArgumentParser(description="Bricks 模板 JSON 驗證 gate")
    ap.add_argument("template", help="template.json 路徑（裸陣列或含 content 的物件皆可）")
    ap.add_argument(
        "--live-schema",
        default=os.path.join("data", "bricks-schema-live.json"),
        help="extract_bricks_schema.py 的輸出（存在時優先於官方 schema）",
    )
    ap.add_argument("--strict", action="store_true", help="警告也視為失敗")
    ap.add_argument("--json", action="store_true", dest="as_json", help="機器可讀輸出")
    args = ap.parse_args()

    try:
        elements, global_classes = load_elements(args.template)
    except (OSError, ValueError, json.JSONDecodeError) as e:
        print(f"[x] 讀取失敗: {e}", file=sys.stderr)
        sys.exit(2)

    live = load_live_schema(args.live_schema)
    schema_names = None  # element name 名冊由 live schema 提供（check 內設定）
    errors, warnings = check(elements, schema_names, global_classes, live)
    ok = not errors and not (args.strict and warnings)

    if args.as_json:
        print(
            json.dumps(
                {"valid": ok, "elements": len(elements), "errors": errors, "warnings": warnings},
                ensure_ascii=False,
                indent=2,
            )
        )
    else:
        print(
            f"elements: {len(elements)}  global classes: {len(global_classes)}"
            + (f"  [live schema: Bricks {live['version']}]" if live else "")
        )
        if live is None:
            print("[!] 沒有 live schema（data/bricks-schema-live.json）—— 跳過 element name 檢查；先跑 src/extract_bricks_schema.py 生成")
        for msg in errors:
            print(f"[error] {msg}")
        for msg in warnings:
            print(f"[warn]  {msg}")
        print("PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
