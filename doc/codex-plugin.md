# Codex plugin 安裝與專案範圍

本頁說明使用者如何安裝、啟用及更新 Codex 版 AutoBricks plugin。若使用者只要測試專案內的 skill 修改，可直接依 [README 的 Codex 操作步驟](../README.md#使用-codex) 執行，無需先安裝 plugin。

AutoBricks 專案根目錄同時包含 Claude Code 與 Codex 的 plugin 定義。兩種 Agent 產品各自讀取對應的定義，並使用專案中的共用工具、Docker 檔案與工作規則：

| 檔案 | 讀取者與用途 |
|---|---|
| `.claude-plugin/plugin.json` | Claude Code 讀取 plugin 名稱、版本等資訊 |
| `.codex-plugin/plugin.json` | Codex 讀取 plugin 資訊，並依 `skills` 欄位尋找安裝副本中的 `.agents/skills/` |
| `.claude-plugin/marketplace.json` | Claude Code 與 Codex 各自的安裝指令讀取這份清單，取得 plugin 來源 |
| `.codex/config.toml` | 使用者自行建立的本機專案設定，可控制已安裝 plugin 是否啟用；AutoBricks 不將此檔案納入 Git |

Codex 使用自身的 marketplace 指令下載與安裝，只是可以讀取既有 Claude marketplace 的清單格式。CLI 0.154.0 已實測相容。

`.agents/skills/` 本身是 Codex 支援的專案技能目錄，使用者可以直接在專案中測試。AutoBricks 在 plugin 定義中設定 `"skills": "./.agents/skills/"`，讓 Codex 安裝 plugin 後也能從安裝副本的同一路徑找到技能。安裝會複製 plugin 的技能、工具等檔案，不是只快取 skill 文字。

`skills/` 與 `.agents/skills/` 各提供相同的 `web-page-to-bricks` 與 `setup` 技能。維護者同步兩邊的完整內容與參考文件；Agent 產品從載入的 skill 路徑辨識 plugin 根目錄，技能不依賴 Agent 產品專用的環境變數。

## 只在指定專案啟用

安裝位置與生效範圍是兩件事：Codex 共用一份安裝快取，再由專案設定決定是否啟用。CLI 0.154.0 的 `plugin add` 沒有 `--scope project` 參數；使用者可在 `~/.codex/config.toml` 設定預設停用：

```toml
[plugins."autobricks@autobricks"]
enabled = false
```

使用者在需要啟用的專案 `.codex/config.toml` 設定：

```toml
[plugins."autobricks@autobricks"]
enabled = true
```

上述 `enabled = true` 是啟用安裝版本的範例。開發者要停用該專案的安裝版本、直接測試專案內的 `.agents/skills/` 時，可改成 `enabled = false`，不必解除安裝。

專案需被 Codex 信任，專案設定才會生效。重新安裝可能啟用使用者層的 plugin，更新後需確認該值。依據：[官方專案啟用範圍說明](https://developers.openai.com/plugins/build/plugins#enable-or-disable-a-plugin-for-a-repo)。

### 本機設定與 Git

Codex 的使用者預設值放在 `~/.codex/config.toml`，專案覆蓋值放在專案的 `.codex/config.toml`。目前官方設定層未列出類似 Claude Code `settings.local.json`、會在同一目錄自動載入的 `config.local.toml`。依據：[官方設定優先順序](https://learn.chatgpt.com/docs/config-file/config-basic#configuration-precedence)。

專案共用設定可以納入 Git；個人的模型偏好、權限或 plugin 啟用狀態則應留在本機。AutoBricks 將專案的 `.codex/config.toml` 加入 `.gitignore`，讓使用者自行設定這份工作目錄，而不將個人選擇隨 plugin 發行。Git 忽略檔案不影響 Codex 讀取該檔案；共用規則、技能、工具及 plugin 定義仍納入 Git。

## 安裝與重啟

發行者將目前檔案 commit 並 push 至 GitHub 後，使用者可指定已發佈的分支或 tag 安裝：

```powershell
codex plugin marketplace add admin-tech-org/AutoBricks --ref <已發佈的分支或tag>
codex plugin add autobricks@autobricks
```

安裝並設定啟用範圍後，使用者開啟新對話：

```powershell
codex -C "C:\Users\USER\Desktop\github\AutoBricks"
```

使用者在 Codex 對話框輸入 `$autobricks:web-page-to-bricks <參考網址>` 開始重建，或 `$autobricks:setup` 檢查環境。使用者可透過 `/plugins` 檢查安裝狀態。新對話會載入已啟用 plugin 的安裝副本；`-C` 只指定工作目錄，不負責載入本機 plugin 原始碼。已實測的 Codex CLI 0.154.0 不支援 `--plugin-dir`。

## 測試本機 plugin 封裝與更新

以下流程用於驗證完整 plugin 的安裝結果。使用者修改工作目錄中的 skill 後，重新啟動 Codex 並不會將修改同步到先前安裝的快照；使用者需先更新安裝來源與安裝副本。

本機 CLI 安裝會複製來源內容；實測不會依 `.gitignore` 排除檔案。此 repo 含有 `.autobricks/`、`.browser/` 或 `data/` 時，使用者應從乾淨 Git checkout 安裝，避免將執行資料帶入 plugin 快取。

使用者提交修改後，可建立乾淨的本機來源；以下目的目錄需尚不存在：

```powershell
git clone --local . "$env:TEMP/autobricks-codex-source"
codex plugin marketplace add "$env:TEMP/autobricks-codex-source"
codex plugin add autobricks@autobricks
```

使用者可執行 `codex plugin marketplace list` 查看目前登記的來源。

Agent 產品更新已安裝的本機 plugin 時，依 plugin-creator 的 cachebuster 流程更新 `.codex-plugin/plugin.json`，同步乾淨來源後再安裝。GitHub marketplace 更新則使用 `codex plugin marketplace upgrade autobricks`。使用者在更新後開啟新對話，並確認專案啟用範圍。

此配置供 Git／本機 marketplace 發行，尚未提交 OpenAI 公開 Plugin Directory。plugin-creator 的靜態驗證器限定技能目錄為 `skills/`，無法驗證本 repo 在 manifest 指定的 `.agents/skills/` 路徑；該路徑已以 Codex CLI 安裝與技能探索確認相容。格式依據：[OpenAI plugin 包裝文件](https://developers.openai.com/plugins/build/plugins)。
