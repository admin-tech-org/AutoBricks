"""AutoBricks 離線 CSS 普查器 — 解析 Phase 1 落檔的 stylesheet「全文」，抽宣告層行為證據。

定位：behavior.js 的 @keyframes/hover 普查走 CSSOM（document.styleSheets），
跨網域 stylesheet 受 CORS 限制讀不到（程式碼裡 try/catch 直接跳過）——原站 CSS 放
CDN 時，hover 規則與 keyframes 會整包漏掉。本腳本解析 clone Phase 1 抓回本機的
CSS 檔（data/<id>/source/css/）——檔案已離線，沒有同源限制——結果與 behavior.js
互補合併。只用標準函式庫；括號走訪＋regex 的「普查級」解析（取證用，不是 CSS 引擎）。

抽五類證據：
  1. keyframes      — @keyframes 名稱＋內文（入場/marquee 動畫的設計意圖）
  2. hoverRules     — selector 含 :hover 的規則（computed 讀不到的 hover 意圖；含 CSS nesting 的 &:hover）
  3. animRules      — 宣告 animation/transition 的規則（誰會動、怎麼動）
  4. mediaQueries   — @media 查詢＋命中規則數；breakpointHints 彙整「width 類特徵」的 px
                      （min-width/max-width/range 語法——min-height 的 px 不會混進來）
  5. fontFaces      — @font-face 的 font-family（字體資產盤點）
  6. imports        — @import 引用的 CSS URL（本檔解析不到其內容——快照階段要把它們
                      也抓回同目錄、重跑本普查，直到 imports 清空）

用法：
  uv run python skills/clone/parse_css.py <css檔或目錄>... [-o tmp/css-census.json]
給 -o 時寫完整 JSON 並在 stdout 印摘要；不給則直接印 JSON。
"""

import argparse
import json
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

CAPS = {"keyframes": 80, "hoverRules": 300, "animRules": 300, "fontFaces": 60}
ANIM_RE = re.compile(r"(?:^|[;{\s])(?:-webkit-)?(?:animation|transition)(?:-[a-z-]+)?\s*:", re.I)
# 斷點線索只認 width 類特徵——min-height 之類的 px 混進來會誤導 RWD 分析
BP_RE = re.compile(
    r"(?:min-width|max-width)\s*:\s*(\d+(?:\.\d+)?)px"
    r"|(\d+(?:\.\d+)?)px\s*(?:<=|<|>=|>)\s*width"
    r"|width\s*(?:<=|<|>=|>)\s*(\d+(?:\.\d+)?)px",
    re.I,
)
IMPORT_RE = re.compile(r"""url\(\s*['"]?([^'")]+)|@import\s+['"]([^'"]+)""", re.I)
GROUP_AT = ("@media", "@supports", "@layer", "@container")  # 有 body、內含規則的條件群組


def squash(s):
    return re.sub(r"\s+", " ", s).strip()


def strip_comments(css):
    return re.sub(r"/\*.*?\*/", " ", css, flags=re.S)


def scan_to(css, i, stops):
    """從 i 掃到第一個「不在字串內」的 stops 字元；找不到回傳 len。"""
    n = len(css)
    in_str = ""
    while i < n:
        c = css[i]
        if in_str:
            if c == "\\":
                i += 1
            elif c == in_str:
                in_str = ""
        elif c in "'\"":
            in_str = c
        elif c in stops:
            return i
        i += 1
    return n


def match_brace(css, i):
    """i 指向 '{'；回傳對應 '}' 的索引（處理巢狀與字串內的大括號，如 content:"{"）。"""
    n = len(css)
    depth = 0
    in_str = ""
    while i < n:
        c = css[i]
        if in_str:
            if c == "\\":
                i += 1
            elif c == in_str:
                in_str = ""
        elif c in "'\"":
            in_str = c
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return n


def push(out, kind, rec):
    """去重（不分檔案）＋上限保護（防 token 爆量；截斷記在 capped 供回報）。"""
    key = json.dumps(
        [kind, rec.get("selector"), rec.get("name"), rec.get("family"), rec.get("css")], ensure_ascii=False
    )
    if key in out["_seen"]:
        return
    out["_seen"].add(key)
    if len(out[kind]) >= CAPS[kind]:
        out["_capped"].add(kind)
        return
    out[kind].append(rec)


def rule(prelude, body, ctx, out):
    low = prelude.lower()
    if low.startswith(GROUP_AT):
        if low.startswith("@media"):
            out["mediaQueries"].setdefault(squash(prelude[6:]), 0)
        walk(body, ctx + [squash(prelude)], out)
        return
    if low.startswith(("@keyframes", "@-webkit-keyframes")):
        push(out, "keyframes", {"name": prelude.split()[-1], "css": squash(body)[:500], "file": out["_file"]})
        return
    if low.startswith("@font-face"):
        m = re.search(r"font-family\s*:\s*([^;}]+)", body, re.I)
        if m:
            push(out, "fontFaces", {"family": m.group(1).strip().strip("'\" "), "file": out["_file"]})
        return
    if low.startswith("@"):
        return  # @page/@property… 與行為普查無關

    # 一般 style rule
    for c in ctx:
        if c.lower().startswith("@media"):
            q = squash(c[6:])
            out["mediaQueries"][q] = out["mediaQueries"].get(q, 0) + 1
    sel = squash(prelude)
    if sel.startswith("&"):  # CSS nesting：把父選擇器接回來，證據才可讀
        parent = next((squash(c) for c in reversed(ctx) if not c.startswith("@")), "")
        sel = (parent[:80] + sel[1:]) if parent else sel
    media = " AND ".join(squash(c[6:]) for c in ctx if c.lower().startswith("@media"))
    if ":hover" in sel:
        rec = {"selector": sel[:160], "css": squash(body)[:300], "file": out["_file"]}
        if media:
            rec["media"] = media
        push(out, "hoverRules", rec)
    if ANIM_RE.search(body):
        rec = {"selector": sel[:160], "css": squash(body)[:300], "file": out["_file"]}
        if media:
            rec["media"] = media
        push(out, "animRules", rec)
    if "{" in body:  # CSS nesting——遞迴抓 &:hover 這類巢狀規則
        walk(body, ctx + [prelude], out)


def walk(css, ctx, out):
    i, n = 0, len(css)
    while i < n:
        j = scan_to(css, i, "{;")
        prelude = css[i:j].strip()
        if j >= n:
            break
        if css[j] == ";":  # 宣告或無 body 的 at-rule
            if prelude.lower().startswith("@import"):  # @import 的內容本檔看不到——列出來讓快照階段補抓
                m = IMPORT_RE.search(prelude)
                if m:
                    out["imports"].add(m.group(1) or m.group(2))
            i = j + 1
            continue
        k = match_brace(css, j)
        body = css[j + 1 : k]
        if prelude:
            rule(prelude, body, ctx, out)
        i = k + 1


def main():
    ap = argparse.ArgumentParser(description="離線 CSS 普查：解析落檔 stylesheet 全文，補 CSSOM 的 CORS 盲區")
    ap.add_argument("paths", nargs="+", help=".css 檔或含 .css 的目錄（如 data/<id>/source/css）")
    ap.add_argument("-o", "--out", default=None, help="完整 JSON 輸出路徑（建議 tmp/css-census.json）")
    args = ap.parse_args()

    files = []
    for p in args.paths:
        if os.path.isdir(p):
            files += sorted(os.path.join(p, f) for f in os.listdir(p) if f.lower().endswith(".css"))
        elif os.path.isfile(p):
            files.append(p)
        else:
            print(f"[!] 找不到 {p}", file=sys.stderr)
    if not files:
        print("[x] 沒有任何 CSS 檔可解析", file=sys.stderr)
        sys.exit(2)

    out = {
        "keyframes": [],
        "hoverRules": [],
        "animRules": [],
        "fontFaces": [],
        "mediaQueries": {},
        "imports": set(),
        "_seen": set(),
        "_capped": set(),
        "_file": "",
    }
    meta = []
    for f in files:
        css = open(f, encoding="utf-8", errors="replace").read()
        meta.append({"file": os.path.basename(f), "bytes": len(css)})
        out["_file"] = os.path.basename(f)
        walk(strip_comments(css), [], out)

    hints = sorted({int(float(g)) for q in out["mediaQueries"] for m in BP_RE.finditer(q) for g in m.groups() if g})
    result = {
        "files": meta,
        "counts": {
            "keyframes": len(out["keyframes"]),
            "hoverRules": len(out["hoverRules"]),
            "animRules": len(out["animRules"]),
            "fontFaces": len(out["fontFaces"]),
            "mediaQueries": len(out["mediaQueries"]),
            "imports": len(out["imports"]),
        },
        "capped": sorted(out["_capped"]),
        "imports": sorted(out["imports"]),
        "breakpointHints": hints,
        "mediaQueries": [
            {"query": q, "rules": c} for q, c in sorted(out["mediaQueries"].items(), key=lambda kv: -kv[1])
        ],
        "keyframes": out["keyframes"],
        "hoverRules": out["hoverRules"],
        "animRules": out["animRules"],
        "fontFaces": out["fontFaces"],
    }
    text = json.dumps(result, ensure_ascii=False, indent=1)
    if args.out:
        os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
        open(args.out, "w", encoding="utf-8").write(text)
        c = result["counts"]
        print(
            f"[ok] {len(files)} 檔 → {args.out}｜keyframes {c['keyframes']}・hover {c['hoverRules']}"
            f"・anim {c['animRules']}・media {c['mediaQueries']}・font {c['fontFaces']}"
            + (f"｜已達上限截斷: {', '.join(result['capped'])}" if result["capped"] else "")
        )
        if hints:
            print(f"     斷點寬度線索(px): {hints}")
        if result["imports"]:
            print(f"[!] 有 {len(result['imports'])} 個 @import 未解析——把這些 CSS 也抓回同目錄後重跑：")
            for u in result["imports"][:10]:
                print(f"     {u}")
    else:
        print(text)


if __name__ == "__main__":
    main()
