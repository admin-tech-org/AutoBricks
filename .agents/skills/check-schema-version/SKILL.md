---
name: check-schema-version
description: 檢查 AutoBricks 交付包的 schema 版本與實際結構，並在使用者要求升級時依 migration 轉換副本。目前只支援 output_schema。
---

# check-schema-version

Agent 產品檢查使用者指定的交付目錄或 ZIP。預設只檢查，使用者要求升級時才轉換副本，不操作遠端 WP。

Agent 產品從當次技能的絕對路徑向上尋找同時含 `pyproject.toml` 與 `docker/push-template.php` 的 AutoBricks 根目錄，以 `<PLUGIN_ROOT>` 代稱。`<PROJECT_ROOT>` 是使用者指定的工作專案，未指定時使用當前對話的工作專案，不以 plugin 目錄推定。

| Schema | 目前版本定義 | 包內版本檔 | 歷史結構與 migration |
| --- | --- | --- | --- |
| `output_schema` | `<PLUGIN_ROOT>/output_schema_version` | 交付根目錄的 `output_schema_version` | [references/output-schema.md](references/output-schema.md) |

## 檢查與轉換

- Agent 產品讀取版本檔第一行的 `version:數字`，再查閱對應版本與需要經過的 migration 段落，不必讀取無關版本。
- Agent 產品核對實際目錄與檔案是否符合該版結構，不只比版本號。交付目錄或 ZIP 根目錄對應結構圖的 `output/` 內容，不要求包內包含 `data/`、`tmp/` 或 ZIP 自身。缺少版本檔時回報「未標版」；遇到不支援的版本或缺少升級路徑時，列出差異，不猜測轉換方式。
- 升級時，Agent 產品保留原始包，在副本依 migration 調整結構及受影響的引用，保留網站內容。確認目標結構與引用正確後，才附上對應版本檔。不能只換版本號就視為完成升級。
- 檢查與轉換的中間檔放在 `<PROJECT_ROOT>/data/YYYYMMDD-HHMMSS-agent_product-task_name/tmp/`，升級成品與報告放在同次任務的 `output/`。續作沿用目錄，新任務採開始時的本機時間，產品名與英文任務名用小寫及底線。ZIP 解壓不得寫出指定目錄，產物不寫入 plugin 快取。

Agent 產品回報來源／目標版本、檢查結果、實際變更與尚未解決的差異。僅檢查時不重新打包。

## 維護紀錄

維護者在參考文件以 `v1` 列出初版完整結構，於檔案與資料夾旁簡註用途。後續每段使用 `v1 → v2` 這類標題，只列變更的部分，再附目標版本的完整結構與用途註解，不重述操作流程。

結構改版時，維護者同步根目錄版本檔、產出技能與兩套技能文件。未來版本有實際變更時才新增紀錄，單純改寫說明不升版。
