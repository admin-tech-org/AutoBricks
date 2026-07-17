# AutoBricks 本機環境 Tutorial — 從 Docker 到第一個 Bricks 頁面

從零把「WordPress + Bricks 1.12.5 驗證環境」跑起來、認識 Bricks 編輯器、
並理解「頁面 = JSON」這件事（AutoBricks 的核心原理）。全程在 Windows Git Bash 操作
（指令都是 bash，macOS/Linux 用內建終端機照跑即可）。

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
（注意：這個開關只管「誰能用 Bricks **編輯**」，不影響範本**渲染**——文章不開放
編輯，套用條件對得上的範本照樣渲染它，見 §7m。）

**注意：新環境點「Edit with Bricks」會被踢走**——因為「哪些型別可以用 Bricks
編輯」這個設定，新裝好的站是**空的＝全部不准**。正常人手動裝 WP 會點進 Bricks
設定頁順手勾一勾；但本環境是腳本自動裝的，沒有人去過那個設定頁，所以它一直是空的。

解法：把「頁面」勾起來，兩條路挑一條，效果一模一樣：

- **滑鼠路**：後台 → Bricks → 設定 → 一般 → 文章類型 → 勾「頁面」→ 存。
- **指令路**：
  ```bash
  MSYS_NO_PATHCONV=1 docker compose run --rm wpcli option update bricks_global_settings '{"postTypes":["page"]}' --format=json
  ```

為什麼兩條路等效？你在後台按下儲存時，WordPress 做的事就是**往資料庫寫一筆資料**
（`wp_options` 表裡叫 `bricks_global_settings` 的那筆）；wp-cli 那行指令做的事：
**直接寫同一筆資料**。

```text
後台勾勾 → 存檔 ─┐
                  ├─→ 資料庫裡同一筆資料
wp-cli 指令 ──────┘
```

順便記住這個通用道理：**後台幾乎每個設定，背後都只是 options 表裡的一筆資料**——
凡是後台能點的，都能用指令自動化（§7e「三扇門殊途同歸」的又一例）。

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
| 結構面板上每顆元素的顯示名稱 | `label`（選填；沒填就顯示元素型別名，見 §6e） |
| 設定面板的每個欄位 | `settings` 的一個 key |

**AutoBricks 的 clone skill 產出的 `template.json` 就是這種 JSON**——等於把「手拉頁面」
自動化，直接生成存檔結果，再由 `docker/push-template.php` 寫進資料庫。

細節注意：空的 `settings` Bricks 存成 `[]`（不是 `{}`）；元素 id 是 6 碼小寫英數。
格式細節：欄位存在性查 `data/bricks-schema-live.json`（`uv run python src/extract_bricks_schema.py`
從 theme 原始碼現抽）；實戰經驗累積在專案的 `bricks-gotchas.local.md`。

### 6a. 自訂 CSS 與 `%root%` 陷阱

`settings` 裡有一個特殊的 key：`_cssCustom`——元素的「Custom CSS」欄位，
放原生設定表達不了的手寫 CSS（keyframes、偽元素、特殊 pattern）。

寫這段 CSS 需要指到「這顆元素自己」。Bricks 官方提供佔位符 `%root%`，
**理論上**輸出時會替換成該元素的真實 selector：

```css
/* 你寫的 */                      /* 期望前台輸出 */
%root% { border: 4px solid #000; }   #brxe-a3k9x2 { border: 4px solid #000; }
%root%:hover { … }                   #brxe-a3k9x2:hover { … }
```

（`brxe-` 是 Bricks 給每顆元素的 HTML id 前綴，後面接元素的 6 碼 id——
就是 §5 設定面板頂端看到的那個 `#brxe-rojdnv`。）

**坑：Bricks 1.12.x 實測這個替換根本沒發生**——前台 CSS 原封不動輸出
`%root% { … }`。而 `%root%` 不是合法的 CSS selector，瀏覽器直接忽略整條規則。
結果是**樣式無聲消失**：不報錯、builder 裡可能看起來正常，前台就是沒效果，非常難查。

所以本專案的規矩（CLAUDE.md 鐵律）：

1. **不用 `%root%`，直接寫死真實 selector**：`#brxe-a3k9x2 { … }`。
2. **元素 id 定案後才寫**——selector 是寫死的字串，指向特定 id。clone 流程用
   build script 反覆重建 template，id 還會變動時就把 `#brxe-xxx` 寫進 CSS，
   重建後 id 一換，CSS 就指到不存在的元素、又是無聲失效
   （build script 固定 random seed、每次重建 id 不變，就是在配合這件事）。
3. 防護已內建：`validate_template.py` 看到 `_cssCustom`（以及 code 元素的
   `code`／`javascriptCode`／`cssCode`）含 `%root%` 直接判 **error**，過不了 gate。

### 6b. code 元素的 JS 為什麼不一定會跑：程式碼執行權限與簽章

clone 的動態階梯（見 §6g）第 4 層是把自訂 JS 放進 **code 元素**（`javascriptCode` +
`executeCode: true`）。但「推送成功」≠「前台會跑」——Bricks 在中間設了兩道閘：

1. **總開關**：後台 Bricks → 設定 → 自訂程式碼，「允許執行程式碼」**預設關閉**。
   沒開，所有 code 元素（含 SVG 來源選 code、query editor、`{echo:}` 標籤）一律不執行。
2. **程式碼簽章**：每顆可執行的 code 元素都要有簽章——Bricks 用**只有伺服器知道的
   密鑰**對程式碼內容算雜湊存進元素設定，前台執行前驗章，沒章或章不對就拒跑。

**為什麼搞這麼複雜**：「存在資料庫裡的程式碼會被執行」是 WordPress 被入侵的經典劇本
——駭客只要找到任何能改資料庫的縫（爛外掛漏洞、被盜的小編帳號），就能把惡意 JS
塞進頁面，之後每個訪客打開都執行（偷 cookie、跳轉釣魚頁）。這叫 **Stored XSS**
（儲存型 XSS：攻擊者的程式碼在受害者瀏覽器裡執行；順帶區分：CSRF 是冒你的名義
發請求、利用瀏覽器自動帶 cookie，全程沒有攻擊者的 JS 在跑）。簽章把「資料庫裡的
內容」和「可以執行的程式碼」切開——駭客能改資料庫，但算不出章。

**對本專案的殺傷力**：`push-template.php` 推模板正是「直接寫資料庫」——跟駭客走
同一條路，所以推上去的 code 元素**天生沒章、前台必不執行**，且不報錯、頁面照常渲染。
這就是 push 腳本會點名「executable code elements」、SKILL 要求階梯第 4 層行為
**必逐條實測**的原因。解法方向：後台「自訂程式碼」設定頁的**重新產生簽章**，
或查 theme 原始碼看簽章怎麼算、能否在推送時順手蓋章——查原始碼定案、不猜，
解法回寫 `bricks-gotchas.local.md`。

### 6c. 匯入機制與 id 防撞：為什麼 id 要含數字、一個 zip 一個 JSON

Bricks 匯入模板時會給所有元素**重編新 id**（避免撞站上既有元素），做法是對整份
JSON **全域字串替換**（舊 id 字串出現的每處換成新 id）。字串替換的好處是
`parent`/`children` 引用、`_cssCustom` 裡寫死的 `#brxe-<id>` 會一起換掉、不斷鏈；
副作用是：**id 若剛好是純字母常見單字**（`header`、`button`、`shadow`），
內文和 CSS 裡的同字串也會被誤換，模板直接改爛。所以本專案規定 **id 至少含
1 個數字**（如 `a3k9x2`），撞上真實文字的機率趨近於零（gate 對無數字 id 發警告）。

另一條匯入實證：模板打包成 zip 交付時，**一個 zip 恰好放一個 `.json`**——
塞多個進同一包，Bricks 匯入不會如預期全部吃進去。多個模板就打多個 zip。

### 6d. 複刻忠實度兩規則：圖片比例與間距原值

- **圖片釘 `_width` ＋ id-scoped `aspect-ratio`，絕不固定 `_height`**：
  寬高都寫死，窄螢幕下容器壓縮寬度、高度卻不動 → 圖片變形。正解是高度永遠由
  寬度推算：settings 只釘 `_width`（實測值），`_cssCustom` 補
  `#brxe-<id> { aspect-ratio: 3 / 2; }`——任何斷點等比縮放（id-scoped ＝ 鎖在
  該元素的真實 id 上，只影響這張圖；gate 對同時固定寬高的 image 發警告）。
- **間距用實測值不吸附**：「吸附」＝量到 37px 手癢寫成 40px、gap 22px 湊成
  8 的倍數 24px。規則是量到多少寫多少——複刻的尺是原站不是美感，每處「美化」
  一點，整區疊起來差幾十 px，渲染對照就對不上，回頭找更費工。

### 6e. id 與 label 的分工：識別 vs 意義

看到 `rojdnv`、`67vmzl` 這種 id 會想問：這也太沒意義了吧？——**沒意義是設計**。
這種 id 的角色是機器用的識別碼，跟資料庫流水號主鍵、Git commit hash 同一族，
價值恰恰在於不承載意義：

1. **有意義的 id 在 builder 情境撐不住**：手寫 HTML 取 `#hero` 沒問題，因為整份
   文件一人從頭寫到尾；builder 裡元素不斷被複製、匯入、跨站搬——複製一次「hero 區」
   就兩顆 `#hero` 撞號。隨機碼永不撞號。
2. **有意義反而是 bug 來源**：§6c 的匯入全域字串替換——id 若是 `header`、`button`
   這種人話單字，替換會誤傷內文與 CSS。「id 長得越像人話越危險」，我們的
   「至少含一個數字」規則就是把 id 推得離人話更遠。
3. **意義另有存放處**——這是關鍵分工：

   | 需求 | 誰負責 |
   |---|---|
   | 機器精準指到這顆元素（parent/children 引用、`#brxe-<id>` selector） | 隨機 `id` |
   | 人找到這顆元素 | **`label`**（元素信封的選填欄位，純給人看） |
   | 人理解這組樣式是什麼 | **Global Class 的名字**（`neo-card`…） |

**`label` 是自訂的**：不填，結構面板顯示元素型別名（一整排 Block 分不出誰是誰）；
有填，顯示你給的名字，設計部隨時可改、改了不影響任何引用。clone skill 生成時
每個結構層都寫 zh-TW label（「主視覺」「三欄卡片」）——這是結構鐵律。

**設計師怎麼找元件**：主要靠**右側結構面板的樹＋label 認路**（點中央畫布的元素、
結構面板也會同步高亮，兩邊連動）；id 只在設定面板頂端露臉，幾乎不會拿來找東西。
所以「每層給 zh-TW label」＋「結構極簡、純 wrapper 塌掉」兩條鐵律服務的正是
結構面板裡的查找體驗——這就是 AutoBricks「好編輯 > 還原 DOM」的具體落點。

**匯入時誰會變**：只有 id 被重編（§6c 的字串替換，連引用一起換、不斷鏈）；
**label、settings、文字內容都不動**——設計師靠 label 認路的體驗不受匯入影響。
id 是免洗的、匯入就換一批；label 才是跟著模板走的資產。反過來說，若 id 承載意義，
每次改名都是一次全站 refactor；label 改名則永遠零成本。

### 6f. settings 解剖：三種欄位、一個作用範圍

**settings 就是「左側面板的存檔」**——你在面板上填的每一格，存檔後就是 settings
裡的一個 key。key 分三種（順帶：`name` 是「哪種積木」、`tag`/`customTag` 是
「渲染成什麼 HTML 標籤」，跟 `label` 三個名字很像的欄位各管各的，別混）：

| Key 長相 | 例子 | 是什麼 |
|---|---|---|
| **不帶底線** | `text`、`tag`、`image` | **這種積木獨有**的欄位（文字積木才有 `text`）→ 面板「內容」頁籤 |
| **帶底線 `_`** | `_typography`、`_padding`、`_width` | **每種積木都有**的共通欄位，絕大多數是樣式 → 面板「樣式」頁籤 |
| **底線 meta 類** | `_cssGlobalClasses`、`_interactions`、`_conditions` | 也是大家都有，但管的不是外觀，而是「掛哪些 class／有什麼互動／何時顯示」這類行為與關聯 |

live schema 的結構就是照這個分的：`extract_bricks_schema.py` 把 `base.php` 抽成
`__base__`（共通底線欄位全在那），各元素只列自己特有的 controls。

**作用範圍**：元素 settings 裡填的值**只影響這一顆**（Bricks 產 CSS 時鎖在它的
`#brxe-<id>` 上）。要跨元素共用，就往上一層放：

| 填在哪 | 影響範圍 | 用途 |
|---|---|---|
| 元素自己的 settings | 只有這一顆 | 這顆獨有的值 |
| Global Class（用 `_cssGlobalClasses` 掛） | 掛它的每一顆 | 共用樣式包——改一次 class 全站連動 |
| Theme Styles（全站設定） | 全站該型別元素 | 預設值（如「所有 section 上下 padding 80」） |

clone 的分工規則：**重複樣式提成 Global Class**（三張卡片長一樣 → `neo-card`），
元素 settings 只放「這顆獨有」的值。

**後綴語法**：同一格欄位在不同情境的值，用冒號後綴表達——
`_padding:tablet_portrait`（斷點）、`_background:hover`（狀態），可疊加
（`_typography:mobile_landscape:hover`）。RWD 就是靠這個：桌機值放無後綴的基準，
其他斷點只寫後綴、不動基準。

### 6g. 動態行為的五層階梯：由上往下找，落越上層越好

原站量到一個動態/互動行為（hover、輪播、手風琴、入場動畫…）後，clone skill
從第 1 層往下逐層問「這層做得到嗎？」：

1. **原生元素**：Bricks 內建「行為自帶」的積木——`slider-nested`（輪播）、
   `accordion-nested`（FAQ 手風琴）、`tabs-nested`、`counter`、`countdown`、
   `animated-typing`、`nav-nested`、`offcanvas`、`dropdown`…。選了它，JS 一行
   不用寫（`-nested` 後綴＝可巢狀：slide/panel 是開放容器，內容自由組裝，
   優於內容表單式的舊版同名元素）。
2. **`_interactions`**：§6f 的 meta 欄位——「捲入視口淡入」「點 A 顯示 B」這類
   觸發→動作，面板下拉選單就能設。
3. **CSS**：不需要 JS 的視覺行為。優先用 native 狀態設定（`_transform`、`:hover`
   後綴——面板可編輯）；表達不了的 keyframes/偽元素才手寫 `_cssCustom`
   （§6a 的規矩：鎖真實 `#brxe-<id>`）。
4. **自訂 JS（code 元素）**：前三層都表達不了才落到這——自製篩選、視差、複合輪播。
   純 JS 放 `javascriptCode`＋`executeCode: true`；鐵則 vanilla、自包含（IIFE、
   不動全域）、selector 鎖 `#brxe-<id>`、一區至多一顆打包。受執行權限＋簽章管制
   （§6b），行為必逐條實測。
5. **unsupported（明列不做）**：**只准是真後端功能**——登入、購物車、真實表單
   送出、即時資料（以 UI 狀態模擬或明列不做＋原因）。純前端行為不准掉到這層——
   「這個好難」不是理由，上面四層一定有一層接得住。

**「一層一層」是選貨架，不是過關卡**：不是一個行為要依序通過五層處理——
每個行為**最後只落在一層**，五層是「先看哪個貨架」的優先順序。從上往下問
「這層接得住嗎？」，接得住就停、後面的層根本不看；接不住才往下掉：

```
「FAQ 點問題展開答案」→ 第 1 層有現成積木（accordion-nested）→ 用它，結束。
「卡片 hover 浮起」   → 第 1 層沒這種積木 → 第 2 層不是它的菜
                       → 第 3 層 CSS 做得到（:hover 後綴＋transform）→ 結束。
「商品列表點分類篩選」→ 1–3 層都表達不了 → 落第 4 層，寫一顆 code 元素 JS。
「加入購物車」        → 真後端功能 → 第 5 層，明列不做。
```

（比喻：急診分流——每個病人評估一次、分到一科處理完；第 5 層有門禁，只收真後端。）

**為什麼是這個順序**：排序依據是設計部在 builder 裡的**可編輯性**——第 1 層是
面板上的現成積木，第 2、3 層還在設定面板裡，第 4 層就得看程式碼了；越往下維護
成本越高，所以**停得越早越好**。行為普查（behavior.js）抓到的程式庫指紋是選層
線索：原站有 Swiper → 第 1 層 `slider-nested`；有 AOS → 第 2 層 `_interactions`。

前提是「**行為不是加分項**」：普查到的每個行為都必須在五層中有下落（做掉或明列
excluded／unsupported），缺效果＝沒做完，不許無聲消失。

### 6h. Global Class：一件共用的樣式外衣

§6f 作用範圍表的第二層，值得單獨講清楚。template.json 頂層有一個 `globalClasses`
陣列，每一項是一件「做好的樣式外衣」：

```json
{
 "id": "q7t8vw",
 "name": "pch-prod",                ← 人看的名字（設計部在 builder 裡看到的）
 "settings": { "_display": "flex", "_typography": { … } }   ← 跟元素 settings 同格式
}
```

它不屬於任何元素；元素要用，就在自己的 settings 掛一行**引用**：

```json
"_cssGlobalClasses": ["q7t8vw"]     ← 這顆元素穿上這件衣服（陣列＝可疊穿多件）
```

概念上等於 HTML 的 `class="pch-prod"`，只是 Bricks 用 **id** 引用而不是名字——
名字隨時可改、引用不斷（§6e「識別 vs 意義分開放」的又一次應用）。

**為什麼要這樣做**——電商頁的典型情境：一頁 94 張商品卡長得一模一樣。

| 寫法 | 後果 |
|---|---|
| 94 顆各自把樣式寫進自己的 settings | 想把字改 15px → 改 94 次 |
| 樣式提成 `pch-prod`，94 顆各掛一行引用 | 改一次 class → 94 顆同時變 |

這就是 clone 分工規則（§6f）的實際產出：重複樣式提成 Global Class，元素自己的
settings 只放「這顆獨有」的值。**最終長相 = 穿的衣服 ＋ 自己的 settings**
（自己的優先——某張卡價格是紅字，紅色寫在它自己的 `_typography` 蓋過 class）。
class 的 settings 同樣支援斷點/狀態後綴（`_padding:mobile_portrait`），
所以共用樣式的 RWD 行為也寫在 class 裡、全站一起變。

**別跟 `_cssClasses` 混**：template 裡常見兩個長很像的欄位——

| 欄位 | 值 | 是什麼 |
|---|---|---|
| `_cssGlobalClasses` | `["q7t8vw"]`（id 陣列） | 掛 **Bricks Global Class**——帶著一整包 settings 的樣式外衣 |
| `_cssClasses` | `"pch-prodcard"`（字串） | 只是往 HTML 加一個**普通 class 名**——不帶任何樣式，供手寫 CSS 或 JS selector 定位用 |

**周邊機制**：推送時 `push-template.php` 會把 template 的 globalClasses 合併寫進
全站 option `bricks_global_classes`（衣櫃是全站共用的，以 id 去重、後者覆蓋）；
驗證 gate 會檢查每個 `_cssGlobalClasses` 引用的 id 真的存在——指到不存在的
衣服＝error。

### 6i. `_cssCustom` vs Global Class：格子與逃生口

先建立一個比方：builder 左側面板上的每個輸入欄位（字型下拉、大小輸入框、色票）
叫一個「**格子**」。settings 的每個 key 對應一個格子，而**格子是官方定義的、有限的**
——Bricks 原始碼 `$this->controls['key']` 定義了哪些，就只有哪些
（live schema 抽的正是這份清單；gate 對查無的 key 發警告——**發明一個不存在的
格子，Bricks 不會理它**，樣式無聲消失）。於是樣式分成兩個世界：

- **格子有的** → 填 settings（單顆）或 Global Class（共用）——Global Class 的
  settings 跟元素同格式，**同樣只能裝官方格子**。設計師滑鼠可改。
- **格子沒有的** → 走逃生口 **`_cssCustom`** 手寫原始 CSS。得讀程式碼，
  所以能用格子就用格子（五層階梯第 3 層「native 優先」的道理）。

**什麼東西格子裝不下**（實例來自 pchome 複刻）：

```css
.pch-prodcard:hover img { transform: scale(1.04) }    /* hover 我 → 改我裡面的小孩：
.pch-prodcard:hover .pch-prodname { color: #ea1717 }     面板 hover 只能「hover 誰改誰自己」*/
.pch-prodname { -webkit-line-clamp: 2; … }            /* 文字截兩行：沒這個格子 */
body { background: #f2f2f2 }                          /* body 不是元素，沒地方掛 */
```

所以同一批商品卡兩種機制**各管一半**：`pch-prod`（Global Class，字體排版——
格子裝得下）＋ `pch-prodcard`（`_cssClasses` 名牌＋手寫 CSS，hover 連動——
裝不下走逃生口）。

**手寫 CSS 的兩個要點**：

1. **寄放位置與作用範圍無關**：`_cssCustom` 只是「一段 stylesheet 文字掛在
   這顆元素身上一起輸出」，影響誰由每條規則自己的 selector 決定（同段裡的
   `body{…}` 影響整頁就是證據）。共用規則慣例寄放在第一個 section——為了
   **可攜性**：元素身上的 CSS 跟著 content JSON 走，匯到任何站都不掉
   （寫進 Bricks 全站設定的 Custom CSS 就不在 template.json 裡了）。
2. **為什麼不把手寫 CSS 放在 Global Class 身上**：class 不是單一元素、沒有自己的
   `#brxe-<id>`，官方語法得用 `%root%`——而 `%root%` 在 1.12.x 壞掉（§6a）。
   所以走「寄放＋名牌」pattern：規則用明確的 `.pch-prodcard` selector，
   目標元素 `_cssClasses` 貼名牌讓 selector 認人。

**最後出貨都是普通 CSS**：前台沒有 settings 也沒有 `_cssCustom`——渲染時
Bricks 把三種來源全編譯成 CSS 合併輸出（settings → `#brxe-<id>{…}`；
Global Class → `.pch-prod{…}`；`_cssCustom` → 原文照抄），形式看全站設定的
CSS loading：external file（有快取，§8 那條地雷）或 inline `<style>`。
關係跟「TS 是源碼、JS 是產物」一樣：**JSON 是給編輯器的源碼，CSS 是給瀏覽器的
編譯產物**——F12 看到的渲染頁跟手寫網站沒有兩樣。

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

### 7k. WordPress 寫入的鐵律：走程式門，路上有三個地雷

CLAUDE.md 的規則「WordPress 寫入走 `docker exec … php`（`wp_set_current_user(admin)`
+ `wp_slash()`），Git Bash 一律加 `MSYS_NO_PATHCONV=1`；絕不用瀏覽器登入後台」——
拆開就是「用哪條門」＋「門上三個歷史地雷各踩掉一個」：

**走哪條門**：容器裡跑 PHP 腳本（`push-template.php`），`require wp-load.php` 把
WordPress 載進來直接呼叫內部函式寫資料庫——就是 §7d wp-cli 的模式、§7e 三扇門
的其中一扇，跟後台點滑鼠效果保證一致，但快速、確定性、可腳本化。

三個地雷：

1. **`wp_set_current_user(admin)`——防「靜默丟棄」**：CLI 腳本執行時沒有登入者
   （user id = 0），而 `_bricks_page_content_2` 這種底線開頭的 meta 是 WP 的
   「受保護 meta」——沒權限的寫入 WP **不報錯、直接丟棄**，回傳看起來正常、
   資料庫就是沒東西，超難查。所以腳本第一件事是把當前使用者設成 admin。
2. **`wp_slash()`——防「剝引號」**：歷史包袱——WP 的寫入 API（`update_post_meta`
   等）預期收到「加過反斜線」的資料，內部會先 `wp_unslash` 一次再存。餵原始資料，
   這次 unslash 就會剝掉內容裡真實的引號和反斜線——模板 JSON 全是引號，剝一輪
   直接爛掉。寫入前先 `wp_slash()` 補一層，讓它剝的是你補的那層。
3. **`MSYS_NO_PATHCONV=1`——防 Git Bash 亂改路徑**：Windows 的 Git Bash 看到
   長得像 POSIX 路徑的參數（`/tmp/template.json`）會自動改寫成 Windows 路徑
   （`C:/Program Files/Git/tmp/...`）再傳給指令——但這路徑是給**容器內**用的，
   改寫後容器裡根本沒這個檔。這個環境變數關掉自動改寫。

**為什麼絕不用瀏覽器登入後台**：同樣的事理論上可以開瀏覽器登 wp-admin 在 UI 上點
——但慢、脆（UI 自動化隨版面變動而壞），而且 clone 流程的 CDP Chrome 是留給
「分析原站＋對照渲染頁」用的，拿去操作後台會污染截圖與分頁狀態。程式門做的是
一模一樣的事（§7e：同一批 WP 函式、同一顆資料庫），沒有理由走 UI。

### 7l. 範本 vs 頁面：template.json 的兩條上站路

`template.json` 要變成訪客看得到的頁面，有兩條路，**終點不一樣**：

**路一：push（AutoBricks 自動化路）**——`push-template.php` 直接把 JSON 寫進
**某個頁面**的 `_bricks_page_content_2`。推完該頁立刻能看，clone 的逐區渲染對照
走的就是這條。不經過範本系統。

**路二：手動匯入（後台 Bricks → 範本 → 匯入）**——餵它 `template.json` 或
zip（一包恰好一個 JSON，見 §6c）。注意：**匯入後得到的是「範本」，不是「頁面」**
——模板進的是範本庫（存成 `bricks_template` 這個自訂文章類型的一筆資料，
§7f 的世界觀：它也是內容），只是躺在庫裡，還不會出現在任何頁面上。要落地，二選一：

1. **插進某個頁面**：開任一頁的 Bricks 編輯器，從範本庫插入——內容被**複製**進
   該頁的 JSON，之後跟範本脫鉤、各改各的（一次性 landing page 走這條）。
2. **設套用條件**：在範本上設 templateConditions（套用到哪些頁面/文章類型）——
   §7i 的「套範本模式」，適合量產型內容。

一句話：**匯入 ≠ 上頁面**——庫裡多了一個版型，還要插進頁面或設條件才算落地；
push 則是直接寫頁面、跳過範本庫的快速道。

### 7m. 套範本模式實作：動態資料元素＋兩個獨立的開關

§7i 說「文章套範本、頁面逐頁拉」，這裡講怎麼實際做到「SEO 小編用古騰堡發文、
前台自動長進 Bricks 版型」。

**先弄清兩個獨立的開關**——名字像、管的事完全不同：

| 設定 | 管什麼 |
|---|---|
| §4c 的「文章類型開放」（`postTypes`） | 誰能**用 Bricks 編輯**該型別——「Edit with Bricks」按鈕出不出現 |
| 範本的**套用條件**（templateConditions） | 該型別前台**用什麼版型渲染** |

兩者互不相干：**文章就算沒開放 Bricks 編輯，範本照樣套用、照樣渲染**。
所以正確配置是 post 型別**刻意不開放**編輯（小編永遠不會誤開 builder 產生一份
脫離範本的獨立 JSON）＋ 一個套用條件設「所有文章」的範本。

**建範本的流程**：後台 → Bricks → 範本 → 新增，類型選 **Single（單篇）**，
用 Bricks 開啟——進的是同一套 builder，差別是內容用「動態資料」佔位，
渲染時抓「當前這篇文章」的資料。佔位有兩招：

1. **專用元素（版面骨架）**：元素面板的 WordPress 類——**Post Title**（標題）、
   **Post Content**（內文）、**Featured Image**（精選圖）、**Post Meta**
   （日期/作者/分類）…像一般積木一樣拖進畫布排版。
   （這批就是 element-map 對**靜態複刻禁用**的 WORDPRESS 類元素——禁令是
   「別在複刻裡誤用」，**範本才是它們的正確用途**：接真的 WP 資料。）
2. **動態資料標籤（零碎處）**：任何內容欄位旁的**閃電 ⚡ 圖示**→ 插
   `{post_title}`、`{post_date}`、`{author_name}`…，可與固定文字混寫
   （heading 填「`{post_title}` ｜ 官方部落格」）。專用元素其實就是
   預填好標籤的包裝（Post Title ≈ 填了 `{post_title}` 的 heading）。

收尾兩步：範本設定（左上齒輪）→ **條件**設「文章」；**Populate content**
指定一篇文章當預覽資料（不然畫布上只有佔位符、看不出排版）。

**為什麼頁面反而開放 builder**：不是「頁面 vs 文章」的型別差異（§7g：資料層
幾乎相同），是 §7i 的量產準則——文章一百篇共用一版、只有字不同，抽得出範本；
首頁/landing page **每頁版面就是內容本身**，抽範本＝範本數等於頁面數，
只能逐頁拉。反例注意：隱私權政策這種純文字「頁面」，原生編輯器打字即可，
開放 builder 給頁面型別是給「需要拉版面的頁」一個入口，不是每頁都非用不可。

## 8. 疑難排解

| 症狀 | 原因與解法 |
|---|---|
| `Bind for 0.0.0.0:8080 failed: port is already allocated` | 別的容器/程式佔了 8080。`docker ps` 找出來 `docker stop`，或 `netstat -ano \| grep 8080` 查行程 |
| 埠讓出來了還是連不上，`docker ps` 的 PORTS 沒有 `0.0.0.0:8080->80` | 埠衝突失敗時建立的「殭屍容器」。`docker compose -f docker/docker-compose.yml up -d --force-recreate wordpress` 重建 |
| wp-cli 報 `could not be established ... at 'mysql'` | wpcli 服務缺 `WORDPRESS_DB_*` 環境變數（compose 已內建，若自行改動 compose 記得保留） |
| wp-cli 裝語言/更新時 `Could not create directory` | Windows bind mount 權限判定問題。加 `--user root`＋`--allow-root` 跑該指令 |
| 前台頁面樣式沒更新 | Bricks 會快取 CSS。後台重存該頁一次，或 Bricks 設定把 CSS loading 改 inline |
| 點「Edit with Bricks」被導去授權頁 | 授權未啟用（見 §4b）或該文章類型未開放（見 §4c） |
| code 元素的 JS 前台不執行（console 也無錯） | 程式碼執行總開關沒開，或直推資料庫的元素沒有簽章（見 §6b） |
| 自寫 PHP 推送「成功」但頁面空白／內容引號消失 | 漏了 `wp_set_current_user`（受保護 meta 被靜默丟棄）或漏了 `wp_slash`（見 §7k） |
| `docker exec`/`docker cp` 報容器內找不到 `/tmp/...` | Git Bash 把路徑改寫成 Windows 路徑——指令前加 `MSYS_NO_PATHCONV=1`（見 §7k） |

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
