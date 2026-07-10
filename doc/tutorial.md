# AutoBricks 本機環境 Tutorial — 從 Docker 到第一個 Bricks 頁面

從零把「WordPress + Bricks 1.12.5 驗證環境」跑起來、認識 Bricks 編輯器、
並理解「頁面 = JSON」這件事（AutoBricks 的核心原理）。全程在 Windows Git Bash 操作
（macOS/Linux 把 `.bat` 換成 `.sh` 即可）。

---

## 1. 前置需求

| 需求 | 說明 |
|---|---|
| Docker Desktop | 已安裝並**啟動**（工作列鯨魚圖示在跑） |
| Git Bash | 裝了 Git for Windows 就有；本文所有指令都在 Git Bash 執行 |
| Bricks theme 檔案 | 已授權的 Bricks 1.12.5（資料夾或 zip；商業軟體，絕不進版控） |
| Bricks 授權金鑰 | 向公司授權管理者索取；**編輯器要啟用授權才能開** |

## 2. 一鍵啟動環境

在 repo 根目錄執行：

```bash
bash docker/init-wp.sh
```

腳本做三件事（冪等，重跑安全）：

1. `docker compose up -d`——起兩個容器：`autobricks-wp`（WordPress 6.8 + PHP 8.2，
   檔案 bind mount 在 `docker/wp/`）與 MariaDB 11.4（資料在 named volume）
2. 等網站回應後，用 wp-cli 裝好 WordPress（站名 AutoBricks Dev，帳密 **admin / admin**）
3. 偵測到 Bricks theme 就啟用；還沒放就印提示（第一次跑到這裡是正常的）

完成後：站台 http://localhost:8080 、後台 http://localhost:8080/wp-admin 。

> 第一次執行會下載三個 image（WordPress、MariaDB、wp-cli），需要幾分鐘。

## 3. 安裝 Bricks theme

1. 把 Bricks theme 解壓到：
   ```text
   docker/wp/wp-content/themes/bricks/
   ```
   ⚠️ **套娃陷阱**：確認 `style.css` 直接位於 `themes/bricks/` 底下。解壓常會多一層
   （變成 `themes/bricks/bricks/style.css`）——多這一層 WordPress 就當它不存在。
   驗證：`ls docker/wp/wp-content/themes/bricks/style.css` 有檔案就對了。
2. 再跑一次 `bash docker/init-wp.sh`——前面步驟自動跳過，只做 `theme activate bricks`。

WordPress 的概念：theme 檔案放進資料夾只是「可選」，**啟用後才生效**；一個站同時只有
一個 active theme。

## 4. WordPress 基本設定

### 4a. 介面切繁體中文（選用）

**最簡單的方式是直接在後台 UI 調**：**設定 → 一般 → 網站介面語言**（Site Language）
下拉選「繁體中文」→ 儲存。WordPress 會自動下載語言包並套用，一步完成。

要自動化（例如寫進環境腳本）才用 wp-cli：

```bash
cd docker
MSYS_NO_PATHCONV=1 docker compose run --rm --user root wpcli language core install zh_TW --allow-root
MSYS_NO_PATHCONV=1 docker compose run --rm wpcli site switch-language zh_TW
```

（wp-cli 這條路在 Windows bind mount 上會踩資料夾建立的權限判定，所以安裝那步要用
root 跑；後台 UI 那條路沒這個問題。）

### 4b. 啟用 Bricks 授權（要用編輯器就必做）

後台 → 左側選單 **Bricks → 授權** → 貼上授權金鑰 → 啟用。狀態顯示 `active` 即完成。

- **不啟用**：前台照常渲染、模板照常匯入，但**編輯器打不開**（會被導回授權頁）。
- 授權金鑰同時解鎖官方更新與線上模板庫；金鑰**絕不寫進 repo 的任何檔案**。

### 4c. 開放「頁面」使用 Bricks 編輯器（必做，手動決定）

Bricks 依內容型別逐一開放 builder——這是刻意設計：用 Bricks 編輯的內容存進 Bricks
專屬的 JSON（換 theme 就沒人渲染它，格式綁定），所以哪些型別交給 builder、哪些留給
原生編輯器，由站點自己決定（典型分工：頁面用 Bricks、部落格文章用原生編輯器）。
本環境**刻意不自動設定**，由使用者自行決定開放範圍。

另外注意：純 wp-cli 安裝不會經過 Bricks 設定頁，這筆設定從未被初始化＝「全部不開放」
——沒做這步之前，點「Edit with Bricks」會被踢去別頁。設定位置在後台 →
**Bricks → 設定 → 一般 → 文章類型**，勾選「頁面」；或用 wp-cli：

```bash
MSYS_NO_PATHCONV=1 docker compose run --rm wpcli option update bricks_global_settings '{"postTypes":["page"]}' --format=json
```

（UI 勾選框和這行指令改的是同一筆資料：`wp_options` 表的 `bricks_global_settings`。
WP 後台幾乎所有設定背後都是 options 表的一筆資料，所以全部可用 wp-cli 自動化。）

## 5. 認識 Bricks 編輯器

建一個練習頁並直接開編輯器：

```bash
MSYS_NO_PATHCONV=1 docker compose run --rm wpcli post create --post_type=page --post_status=publish --post_title="練習頁" --porcelain
# 記下輸出的數字（page id），然後開瀏覽器：
# http://localhost:8080/?page_id=<那個數字>&bricks=run
```

編輯器四大區域：

```text
┌──┬────────────────────────────┬─────────┐
│元 │                            │  結構    │
│素 │        畫布（即時預覽）      │  面板    │
│面 │   點元素 → 左側變成設定面板   │ （樹狀）  │
│板 │                            │         │
└──┴────────────────────────────┴─────────┘
          ▲ 上方工具列：斷點切換／存檔／預覽／回後台
```

- **左側元素面板**：可拖進頁面的積木。排版四兄弟：**區塊**（Section）、**容器**（Container）、
  **封鎖**（其實是 Block——zh_TW 翻譯品質不佳，對照英文名時注意）、**Div**。
- **中央畫布**：頁面本人，即點即改。
- **右側結構面板**：頁面的樹狀骨架；元素的父子關係在這裡一目了然，也在這裡拖曳調整層級。
- **選中元素後**左側變成該元素的設定（「內容」「樣式」兩頁籤）；面板頂端顯示元素 id
  （形如 `#brxe-rojdnv`）。
- 存檔：`Ctrl+S`。離開：右上 WordPress 圖示回後台（有未存變更會提示）。

## 6. 核心觀念：頁面 = JSON（AutoBricks 的原理）

在編輯器拉的一切，存檔後都是資料庫裡的一筆 JSON。自己驗證：

```bash
MSYS_NO_PATHCONV=1 docker compose run --rm wpcli post meta get <page_id> _bricks_page_content_2 --format=json
```

會看到類似：

```json
[
  {
    "id": "hpzyzk",
    "name": "section",
    "parent": 0,
    "children": ["nbwooq"],
    "settings": []
  },
  {
    "id": "nbwooq",
    "name": "container",
    "parent": "hpzyzk",
    "children": [],
    "settings": []
  },
  {
    "id": "rojdnv",
    "name": "heading",
    "parent": 0,
    "children": [],
    "settings": { "text": "我是一個標題" }
  }
]
```

對應關係：

| 編輯器看到的 | JSON 裡的 |
|---|---|
| 設定面板頂端 `#brxe-rojdnv` | `"id": "rojdnv"` |
| 結構面板那棵樹 | `parent` / `children` |
| 設定面板的每個欄位 | `settings` 的一個 key |

**AutoBricks 的 clone skill 產出的 `template.json` 就是這種 JSON**——等於把「手拉頁面」
自動化，直接生成存檔結果，再由 `docker/push-template.php` 寫進資料庫。

細節注意：空的 `settings` Bricks 存成 `[]`（不是 `{}`）；元素 id 是 6 碼小寫英數。
完整格式規範見 `skills/clone/bricks-1125-gotchas.md`。

## 7. 觀念篇：WordPress、PHP、wp-cli 怎麼運作（複習用）

### 7a. WordPress 不是「跑著的程式」

WordPress 本身沒有常駐 process——它只是**一堆 PHP 檔案 ＋ 一個資料庫**。
所有持久狀態（文章、設定、Bricks 頁面 JSON）都在資料庫；PHP 這邊什麼都留不住。

### 7b. 一個 HTTP 請求的完整旅程

```text
瀏覽器請求 http://localhost:8080/?page_id=6
   │
1) Apache worker（常駐）接到請求
   │   .htaccess rewrite：WordPress 把幾乎所有網址都導向同一支 index.php
   │   （front controller 模式）
2) 副檔名 .php → Apache 交給「內嵌在 worker 裡」的 PHP 引擎（mod_php）執行
   │   （Apache 的工作到此為止，它不知道 wp-load 是什麼）
3) PHP 執行 index.php → WordPress 自己的 require 接力：
       index.php:            require 'wp-blog-header.php';
       wp-blog-header.php:   require 'wp-load.php';   ← 開機點：
                             讀 wp-config → 連 DB → 載入全部外掛 → 載入 theme
                             wp();                     ← 解析這個網址要查什麼
                             require 'template-loader.php';  ← 用 theme 渲染 HTML
4) 回應送出 → 這次請求建立的所有 PHP 變數/物件/WP 狀態全部丟棄
```

`wp-load.php` 不是函式入口，是「**把整個 WordPress 從零蓋出來的開機腳本**」——
每個請求都重蓋一次、用完即拆。

### 7c. PHP 的 shared-nothing 模型（與 Python 對照）

| | 直譯器（引擎） | 應用程式狀態 |
|---|---|---|
| **PHP**（mod_php / php-fpm） | ✅ 常駐（活在 Apache worker 裡） | ❌ 每請求歸零重蓋 |
| **Python**（gunicorn + Flask） | ✅ 常駐（worker process） | ✅ app 物件跨請求活著 |

- 常駐直譯器是**所有** web 技術棧的標配（每請求重啟直譯器是被淘汰的 CGI 模型）；
  PHP 特別之處只在「引擎續命、app 狀態閱後即焚」。
- 類比：**Jupyter kernel** ＝ 常駐引擎，每個 cell ＝ 一次腳本執行；把 Jupyter 想成
  「每跑完一個 cell 自動清空所有變數、但保留編譯快取」——那就是 mod_php。
- 「每請求重開機」的成本由 **OPcache** 壓低：已編譯的 bytecode 留在記憶體，
  重跑只需重新執行、不需重新解析檔案。
- PHP 引擎的壽命由「裝法」（SAPI）決定：CLI ＝ 跟腳本同生共死（同 `python xxx.py`）；
  mod_php / fpm ＝ 長壽型，一生執行幾十萬輪腳本。

### 7d. wp-cli 是什麼角色

- 一支**獨立的 PHP 命令列程式**（本環境中甚至是獨立容器）；WordPress 端**零安裝**——
  不需要外掛、API、agent。
- 它控制 WP 的方式不是「連線到網站」，而是**自己 `require wp-load.php` 把 WordPress
  載進自己的 process 開機**，然後直接呼叫 WP 內部函式（`wp_insert_post()`、
  `update_option()`…）寫同一顆資料庫。每條指令＝開機→做事→結束，不常駐。
- 所以它只需要三樣東西：PHP、WP 的檔案、資料庫連線——這正是 compose 裡 wpcli 服務
  要掛同一個 `./wp` bind mount、給同一組 `WORDPRESS_DB_*` 環境變數的原因。
- Python 對照：`import django; django.setup()` 之後直接用 ORM 操作資料庫——
  `manage.py shell` 的模式。
- `docker/push-template.php` 用的是一模一樣的機制（開頭 `require wp-load.php`）——
  wp-cli 就是這個模式的工業化版本，把幾百種常見操作包成指令。

### 7e. 三扇門殊途同歸

```text
瀏覽器點按鈕 ──(Apache/HTTP)──┐
wp-cli 指令 ─────────────────┼──→ require wp-load.php 開機 ──→ 同一批 WP 函式 ──→ 同一顆資料庫
push-template.php ───────────┘
```

差別只有「誰觸發、從哪進來」；進來之後用的是完全相同的程式碼，
所以 wp-cli 做的事和後台點滑鼠做的事**效果保證一致**。

### 7f. WordPress 的世界觀：內容與長相徹底分離（前端直覺的最大地雷）

WP 的用詞跟前端直覺是打架的——**「頁面（Page）」不是 view，它也是內容（資料）**。
用 MVC / Flask 對照：

| 前端直覺 | WordPress 的實際對應 |
|---|---|
| Model（資料） | 文章、**頁面**、留言——全存在同一張 `wp_posts` 表，只差 `post_type` 標記 |
| View（畫面） | theme 的模板——內容「長什麼樣」由 theme 決定 |
| Router | `.htaccess` rewrite ＋ `wp()`：網址 → 查出對應哪筆內容 → 挑模板渲染 |

- 同一筆內容，換個 theme 就換一副面孔，內容一個字不動——這是 CMS 的核心賣點
  （不會寫程式的人改內容不用碰 view）。
- **Bricks 是一張白畫布 theme**：一般 theme 的後備模板自帶頁首/頁尾/樣式；Bricks 的
  哲學是「一切由使用者用 builder 蓋」，還沒蓋任何模板前，首頁等預設畫面幾近裸奔的
  HTML——**白底不是壞掉，是它在等人開工**。
- 全新站台的「Hello world!」文章、範例留言、Sample Page 都是 WordPress 安裝程式
  自動塞的預設內容，可直接刪除。

### 7g. 頁面 vs 文章

資料層面幾乎相同，差別在「時間性」與「歸屬」：

| | 文章（post） | 頁面（page） |
|---|---|---|
| 性質 | 時間流內容（部落格文、公告） | 恆常獨立內容（關於我們、landing page） |
| 出現在 | 最新文章列表、RSS、彙整頁 | 都不出現，只活在自己的網址上 |
| 分類/標籤 | 有 | 無（改為可有父子頁面層級） |

類比：文章＝粉專貼文（被時間流卷走）；頁面＝粉專「關於」分頁（固定門面）。
**AutoBricks 推送的模板都建成「頁面」**——行銷 landing page 屬於恆常內容。

### 7h. 網址：永久連結、.htaccess、front controller

- **每筆內容自動有網址**。後台的「頁面」「文章」列表滑鼠移上去按「檢視」即直達——
  後台內容列表等於整站的網址目錄，不用猜。
- **永久連結**（後台 → 設定 → 永久連結）決定網址格式：預設是 `/?p=1`、`/?page_id=6`；
  可改成 `/hello-world/` 等漂亮網址。純門牌美觀與 SEO 差異，內容不動。
  本機測試環境用預設即可。
- **`.htaccess`：機制是 Apache 的、內容是 WordPress 寫的**。Apache 規定「目錄裡有
  這個檔就照裡面規則辦事」；WP 在永久連結設定變更時把 rewrite 規則寫進去——
  「網址對不到實體檔案的，一律轉進 index.php」。
- 這個「全站單一入口＋內部路由」的模式叫 **front controller**——Flask 本身就是這個
  模式（所有請求進同一個 app，`@app.route` 內部分發），沒有人為每個 route 開一個
  獨立入口檔。WP 的 `index.php` ＝ app 入口，`wp()` ＝ 路由分發器（只是它的路由表
  是資料庫）。對面的反例是上古 PHP 的多入口式：`/about.php`、`/contact.php`
  一網址一檔案、各自為政。

### 7i. 內容策略：套範本 vs 逐頁 builder（Bricks 兩種模式都支援）

「版面的來源有兩種」不是混亂，是分層：

```text
全站框架層   header / footer / 全站字體配色    ← Bricks 範本 + Theme Styles（統一管理）
             │
內容區層     ├── 文章、商品等「量產型內容」     ← 套 Bricks 範本，本體只有文字（原生編輯器）
             └── landing page 等「獨一無二頁」  ← 該頁自己的 Bricks JSON（逐頁 builder）
```

- **套範本模式**（後台 → Bricks → 範本）：用 builder 刻一個版型（內容用「動態資料」
  佔位符），設定套用條件（如「所有文章」）。之後小編用原生編輯器只寫文字、永遠碰不到
  版面；改一次範本，千篇文章一起變。這就是「版面靠 theme、內容靠編輯器」的正統分工。
- **逐頁 builder 模式**：行銷 landing page 這類「版面就是內容」的頁面，兩頁之間沒有
  共通版型可抽——硬抽模板，模板數會等於頁面數。這種頁逐頁手工拉，文字和版面綁在
  一起存（**AutoBricks 服務的正是這類頁面**）。
- **判斷準則一句話**：這類內容有幾十上百筆長得都一樣？→ 套範本。每一筆都獨一無二？
  → 逐頁 builder。例：首頁、關於我們＝獨一無二 → builder；文章、商品＝千篇一律 →
  範本（隱私權聲明這種純文字的一次性頁，用原生編輯器打字即可，殺雞不必用牛刀）。
- 混亂只發生在用錯邊（如讓小編用 builder 逐篇編部落格文章＝維護地獄）——這正是
  §4c「逐內容型別手動開放 builder」存在的原因。

### 7j. 一個頁面 = 三段拼接（header / content / footer）

渲染出來的頁面由三個內容區拼成，各自是一條 postmeta、同款扁平元素陣列：

```text
_bricks_page_header_2    ← 頁首（通常來自 Bricks 範本，全站/依條件套用）
_bricks_page_content_2   ← 中間內容區（每頁自己的；AutoBricks 推送寫的就是它）
_bricks_page_footer_2    ← 頁尾（同 header，來自範本）
```

- 建範本時選「範本類型」（頁首／頁尾／單篇／彙整…）就是決定它掛到哪個位置或情境。
- 本測試環境沒建任何 header/footer 範本，所以推送的頁面上下空空——只渲染 content
  那一段，屬正常現象。要複刻整頁含頁首頁尾，就是把對應區塊建成 header/footer
  範本的事。

## 8. 疑難排解

| 症狀 | 原因與解法 |
|---|---|
| `Bind for 0.0.0.0:8080 failed: port is already allocated` | 別的容器/程式佔了 8080。`docker ps` 找出來 `docker stop`，或 `netstat -ano \| grep 8080` 查行程 |
| 埠讓出來了還是連不上，`docker ps` 的 PORTS 沒有 `0.0.0.0:8080->80` | 埠衝突失敗時建立的「殭屍容器」。`docker compose -f docker/docker-compose.yml up -d --force-recreate wordpress` 重建 |
| wp-cli 報 `could not be established ... at 'mysql'` | wpcli 服務缺 `WORDPRESS_DB_*` 環境變數（compose 已內建，若自行改動 compose 記得保留） |
| wp-cli 裝語言/更新時 `Could not create directory` | Windows bind mount 權限判定問題。加 `--user root`＋`--allow-root` 跑該指令 |
| 前台頁面樣式沒更新 | Bricks 會快取 CSS。後台重存該頁一次，或 Bricks 設定把 CSS loading 改 inline |
| 點「Edit with Bricks」被導去授權頁 | 授權未啟用（見 §4b）或該文章類型未開放（見 §4c） |

## 9. 日常操作速查

```bash
docker compose -f docker/docker-compose.yml ps               # 看狀態
docker compose -f docker/docker-compose.yml up -d            # 開機後把環境帶起來
docker compose -f docker/docker-compose.yml down             # 停（資料都留著）
docker compose -f docker/docker-compose.yml down -v          # 停＋清資料庫（砍掉重練）
docker compose -f docker/docker-compose.yml logs -f wordpress # 看日誌
docker compose -f docker/docker-compose.yml run --rm wpcli <wp 指令>   # 任意 wp-cli
```

- Git Bash 跑 `docker exec`／`docker cp` 一律加 `MSYS_NO_PATHCONV=1` 前綴。
- admin/admin 僅限本機測試環境；8080 不要對外開放。
- 整個環境是免洗的：`down -v` ＋ 刪 `docker/wp/` ＝ 完全重來，重跑本 tutorial 即可。
