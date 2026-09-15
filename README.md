# AutoBricks

AutoBricks 提供共用的網頁重建規則與工具，供 Agent 產品將使用者指定的參考網頁重建成可匯入、可編輯的 WordPress Bricks JSON。

「Agent 產品」指 Claude Code、Codex 等可使用工具執行任務的 AI 助理軟體；「使用者」指提出需求、指定參考網頁並接收成品的人。

Agent 產品先在瀏覽器檢視原站的內容、版型、RWD、互動與動畫，再依網站特性選擇重建方法：

- **量測原站**：取得元素尺寸、位置、字型、間距，以及不同螢幕寬度和互動狀態下的變化，作為重建依據。
- **轉換內容與版型**：將原站文字、圖片及容器結構轉為 Bricks 元素與設定，產生模板 JSON；原站 CSS 和專案既有工具可按需重用，例如 `browser.mjs` 的 CDP 截圖與量測功能、`validate_template.py` 的 JSON 驗證功能。
- **驗證成品**：檢查 JSON 元素欄位、ID 與父子引用；將模板正常匯入 Bricks 後，在相同螢幕寬度下比對 WP 預覽與原站的內容、排版、RWD、互動與動畫，並核對圖片實際使用的素材。

Agent 產品交付可供使用者在 Bricks 修改文字、圖片與排版的成品。

## 使用 Claude Code

### 開發階段：直接載入本機 plugin 測試

使用者在 AutoBricks 專案根目錄的終端機執行：

```powershell
claude --plugin-dir .
```

`--plugin-dir .` 要求 Claude Code 直接載入目前目錄的 plugin，供使用者測試尚未發佈的修改。Claude Code 讀取 `.claude-plugin/plugin.json` 識別 AutoBricks，並從 `skills/` 取得技能。使用者不必先透過 marketplace 安裝。[Claude Code 官方說明](https://code.claude.com/docs/en/plugins#test-your-plugins-locally)

Claude Code 啟動後，使用者在 **Claude Code 對話框**輸入：

| 使用者要執行的工作 | 對話指令 | Claude Code 讀取的說明 |
|---|---|---|
| 重建指定網頁 | `/autobricks:web-to-bricks <參考網頁網址>` | [網頁重建 skill](skills/web-to-bricks/SKILL.md) |
| 檢查或安裝本機測試環境 | `/autobricks:setup` | [環境設定 skill](skills/setup/SKILL.md) |

### 發行階段：將技能與工具提供為可安裝的 plugin

維護者將技能、工具與 plugin 定義提交並推送至 GitHub 後，使用者可在 **Claude Code 對話框**依序執行以下指令，安裝已發佈的版本：

```text
/plugin marketplace add admin-tech-org/AutoBricks
/plugin install autobricks@autobricks
```

安裝完成後，使用者仍以 `/autobricks:web-to-bricks` 或 `/autobricks:setup` 呼叫技能；Claude Code 此時讀取的是安裝副本。

## 使用 Codex

### 開發階段：直接修改與測試專案 skill

使用者將 AutoBricks clone 到本機後，可以直接修改專案中的 skill 與工具，並用 Codex 測試尚未提交的內容，無需先安裝 plugin。

注意：Codex 的專案 skill 放在 `.agents/skills/`，不是 `.codex/`；`.codex/` 主要存放 Codex 設定，例如 `config.toml`。Python 工具可放在 `src/`，由 skill 說明工具位置與使用方式。

使用者進入 AutoBricks 專案根目錄，在終端機執行：

```powershell
codex -C .
```

`-C .` 將目前目錄設為工作目錄。Codex 會探索專案的 `.agents/skills/`；使用者在 **Codex 對話框**指定要測試的技能與目標網頁：

```text
請讀取目前專案的 .agents/skills/web-to-bricks/SKILL.md，依該技能重建 <參考網頁網址>，保留 RWD。
```

Codex 依指定的 [SKILL.md](.agents/skills/web-to-bricks/SKILL.md) 讀取重建規則，並按需執行同一份專案中的工具。使用者也可透過 `/skills` 選取本機技能；需要檢查或安裝環境時，指定 [.agents/skills/setup/SKILL.md](.agents/skills/setup/SKILL.md)。[Codex 本機 skill 載入規則](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills)

本專案目前在 `.codex/config.toml` 停用已安裝的 `autobricks@autobricks` plugin，讓開發時只使用專案內的技能。先前安裝的快照仍保留。

### 發行階段：將技能與工具提供為可安裝的 plugin

維護者準備發行時，將 skill、工具與 plugin 定義一起提交並推送至 GitHub，提供使用者可安裝的分支或 tag。AutoBricks 的專案根目錄就是 plugin 根目錄，因此原有檔案可以直接用於發行。

`.codex-plugin/plugin.json` 定義 plugin 資訊；其中的 `"skills": "./.agents/skills/"` 告訴 Codex，技能位於 plugin 根目錄下的 `.agents/skills/`。Codex 安裝時會將技能與工具複製到使用者目錄的 `.codex/plugins/cache/`，供後續使用。[官方 plugin 包裝說明](https://developers.openai.com/plugins/build/plugins)

使用者依 [Codex 安裝與專案啟用說明](doc/codex-plugin.md) 安裝發行版本，在需要重建網頁的工作專案啟用 plugin，重新啟動 Codex，再於 **Codex 對話框**輸入：

| 使用者要執行的工作 | 對話指令 |
|---|---|
| 重建指定網頁 | `$autobricks:web-to-bricks <參考網頁網址>` |
| 檢查或安裝本機測試環境 | `$autobricks:setup` |

使用安裝版本時，Codex 讀取快取中的 skill，並執行安裝副本中的工具。維護者後續修改原始專案後，使用者需更新 plugin 安裝內容才能取得變更。Python 套件與 Docker 測試環境另由 setup 技能協助設定。

## 共用規則與模型比較

在本專案工作時，Codex 讀取 [AGENTS.md](AGENTS.md) 作為專案規則；Claude Code 讀取 [CLAUDE.md](CLAUDE.md)，再透過其中的 `@AGENTS.md` 引用同一份規則。

兩種 Agent 產品使用同名、同內容的技能：`web-to-bricks` 負責網頁重建；`setup` 在使用者明確要求時檢查或安裝環境。維護者在 `skills/` 與 `.agents/skills/` 各保留一份，修改後同步技能與參考文件。

Agent 產品從載入的 `SKILL.md` 位置向上辨識 AutoBricks 根目錄，再尋找共用工具。技能不依賴 Agent 產品專用的環境變數，也不修改 Agent 產品的工具權限設定。Agent 產品可執行共用 Node 工具直接連線 Chrome CDP，並使用所用產品的圖片檢視工具查看截圖。

使用者選擇模型與推理強度；Agent 產品依原站的內容、版型與動態行為決定量測方法、重建步驟，以及是否需要分工。AutoBricks 的共用規則不綁定特定模型或固定分工流程。

使用者比較模型時，應在本專案開啟各 Agent 產品的新對話，使用相同版本的重建規則，並提供相同的參考網址與重建範圍。Agent 產品記錄首版時間、完整驗證時間、可編輯程度和剩餘差異，供使用者比較成果。

環境使用 [uv](https://docs.astral.sh/uv/)、Chrome CDP、Docker WordPress 與已授權的 Bricks theme；本機預覽網址是 `http://localhost:8080`。安裝細節見 [Docker 說明](docker/README.md) 與 [教學](doc/tutorial.md)。

## 工具與產物

- `src/validate_template.py`：Agent 產品執行 `uv run python src/validate_template.py <template.json>`，檢查模板元素欄位與引用關係。
- `src/extract_bricks_schema.py`：需要時從已安裝的 Bricks theme 查欄位。
- `.codex/tools/browser.mjs`：可重用的 CDP 小工具，Node 22+；用法見 [.codex/README.md](.codex/README.md)。
- `docker/`：測試環境與推送工具；`templates/`：Chrome 啟動範本。
- `data/<run>/`：各次 JSON、素材、量測和截圖；`.browser/`：瀏覽器 profile。執行產物、登入資料與商業 theme 不納入 Git。

Agent 產品應依目標環境已安裝的 Bricks 版本與實際渲染確認元素設定；版本相關經驗按需查 [匯入備忘](skills/web-to-bricks/references/bricks-import.md)，不能直接套用至其他版本。

## 方法草稿

[網頁觀察、轉換與驗收方法](doc/web-reconstruction-method.md) 說明 CDP 操作、截圖分析、RWD、動畫、Bricks 轉換及驗收時的判斷方式，供使用者檢閱與比較 Agent 產品。本文尚未併入 skill；實作時仍依當站情況選擇合適方法。

## 實驗紀錄與還原點

- [Cyberpunk 重建](doc/codex-cyberpunk-experiment.md)
- [牛耳心境莊園重建](doc/codex-newer-art-experiment.md)
- [既有流程效能分析](doc/performance-review-20260914.md)
- `d68bd9b`：同步前完整現況，包含舊 Claude skill、工人定義與 Codex 實驗成果。
- [舊流程設計理由](doc/replica-rationale.md) 僅供查歷史，不是現行執行規則。

## 使用範圍

用於使用者自有網站、已授權的客戶網站、內部重建或學習用途。
