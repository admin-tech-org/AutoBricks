---
name: check-schema-version
description: 檢查 AutoBricks 交付包的 schema 版本與實際結構，並在使用者要求升級時依已記錄的 migration 轉換副本。目前只支援 output_schema，不負責網站重建或遠端推送。
---

# check-schema-version

Agent 產品檢查使用者指定的交付目錄或 ZIP，說明版本、缺漏及可用的升級路徑。檢查不修改原始包；使用者要求升級時，Agent 產品才產生轉換副本。

## 找到版本定義

Agent 產品從當次 `SKILL.md` 的絕對路徑向上尋找同時含 `pyproject.toml` 與 `docker/push-template.php` 的 AutoBricks 根目錄，以 `<PLUGIN_ROOT>` 代稱。工作專案以 `<PROJECT_ROOT>` 代稱，不能將檢查產物寫入 plugin 快取。

| Schema | 本技能支援的目前版本 | 包內版本檔 | 定義與 migration 紀錄 |
| --- | --- | --- | --- |
| `output_schema` | `<PLUGIN_ROOT>/output_schema_version` | 交付根目錄的 `output_schema_version` | [references/output-schema.md](references/output-schema.md) |

目前只處理 `output_schema`。其他 schema 日後有實際定義時再新增，不推定其他檔案也適用相同版本號。

## 檢查與升級原則

- Agent 產品先讀取對應參考文件，再比較包內版本與本技能支援的版本。`output_schema_version` 使用 UTF-8，第一行為 `version:1` 這類格式，數字是正整數，其餘內容描述該版結構。
- Agent 產品檢查實際檔案、`page-manifest.json` 對應、模板與 Snippets 識別是否符合宣告版本。版本相同仍可能缺檔，不能只比版本號就宣告通過。
- 缺少版本檔的舊包屬於「未標版」。Agent 產品列出實際結構及差異，不直接當成版本 1，也不只補上版本檔就宣告完成升級。
- 包內版本較新、識別互相矛盾或缺少 migration 路徑時，Agent 產品說明缺少的定義與可確認的範圍，不猜測改名、刪檔或降版。
- 有完整升級路徑時，Agent 產品在副本依序套用每段 migration，保留頁面與片段的穩定識別。轉換後檢查路徑、引用及受影響的匯入／執行結果，通過後才寫入目標版本檔。格式升級不能覆蓋設計師的內容修改。
- Agent 產品沿用當次 `data/YYYYMMDD-HHMMSS-agent_product-task_name/`，沒有當次目錄時依任務開始時間建立。原始 ZIP、解壓檢查及轉換中間檔放在 `tmp/`，升級成品與檢查報告放在 `output/`。ZIP 解壓不得寫出指定目錄，原始交付檔案需保留。

Agent 產品回報檢查對象、來源／目標版本、結構與識別檢查結果、已執行的 migration、未解決項目及產物位置。僅檢查時不重新打包，也不操作遠端 WP。

## 維護版本

維護者改變交付結構或欄位約定時，更新根目錄 `output_schema_version`、產出技能，以及本技能的 migration 紀錄。每段紀錄使用 `1 → 2` 這類標題，寫明新增、改名、刪除或合併的內容、資料如何保留與驗證，並列出目標版本的完整結構。單純修改技能措辭不需升版。

維護者保留舊版定義與 migration 紀錄，並同步 `skills/` 與 `.agents/skills/`。目前只有版本 1，沒有尚未發生的升級紀錄。
