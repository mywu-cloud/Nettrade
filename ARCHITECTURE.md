# 系統架構：台股法人與主力買賣超排行

## 1. 目標

每個交易日收盤後，自動抓取「外資、投信、自營商、三大法人、主力」的買超／賣超排行，整理成統一格式寫入檔案，並提供一個桌機、平板、手機都能看、可切換淺色／深色的網頁。

設計原則有三條：

1. **全靜態**：沒有資料庫、沒有後端伺服器。爬蟲寫 JSON，網頁直接讀 JSON，可以放在 GitHub Pages、Cloudflare Pages 或任何靜態主機。
2. **多來源互為備援**：富邦 e 點通、玩股網、證交所官方各自獨立，任何一個失敗都不會影響其他來源，也不會覆寫掉已存在的好資料。
3. **設定驅動**：新增來源網址、改排行名數、開關某張表，都只改 `config.yaml`。

## 2. 整體流程

```
          ┌──────────────── 排程 ────────────────┐
          │ GitHub Actions（週一～五 18:40 台北）  │
          │ 或 本機 crontab / Windows 工作排程器   │
          └───────────────────┬──────────────────┘
                              ▼
                  python -m scraper.main
                              │ 讀 config.yaml
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
  sources/fubon.py      sources/wantgoo.py     sources/twse.py
  requests + BS4        Playwright 無頭瀏覽器    requests JSON
  Big5 靜態 HTML         攔截內部 JSON / 讀表格   官方 T86 API
        └─────────────────────┼─────────────────────┘
                              ▼
                 models.Board / RankRow（統一格式）
                              ▼
                        storage.py
        ┌──────────────┬──────┴───────┬──────────────────┐
        ▼              ▼              ▼                  ▼
 web/data/YYYY/   web/data/      web/data/        archive/YYYY/
 YYYY-MM-DD.json  latest.json    index.json       *.csv  *.xlsx
        └──────────────┴──────────────┘           archive/raw/（原始檔）
                       ▼
          web/index.html + assets/app.js
          （GitHub Pages / Cloudflare Pages）
                       ▼
               桌機 · 平板 · 手機
```

## 3. 目錄結構

```
tw-chip-rank/
├── config.yaml               來源網址、類別、輸出設定
├── requirements.txt
├── scraper/
│   ├── main.py               入口：排程判斷、逐一抓取、決定資料日、寫檔
│   ├── models.py             RankRow / Board 資料模型
│   ├── utils.py              數字解析、日期解析、HTTP Session、禮貌延遲
│   ├── storage.py            JSON（原子寫入）、索引、CSV、Excel
│   └── sources/
│       ├── fubon.py          富邦 e 點通（MoneyDJ）解析
│       ├── wantgoo.py        玩股網（Playwright）
│       └── twse.py           證交所 T86 官方資料
├── web/                      ← 部署這個資料夾
│   ├── index.html
│   ├── assets/style.css      淺色 / 深色 token、三段式響應式
│   ├── assets/app.js         讀資料、篩選、連續上榜計算
│   └── data/                 爬蟲輸出（前端讀取）
├── archive/                  CSV、Excel、原始 HTML/JSON（不部署）
├── scripts/
│   ├── generate_demo.py      產生示範資料
│   ├── run_daily.sh          macOS / Linux 排程
│   └── run_daily.bat         Windows 排程
├── tests/                    解析器測試（含 HTML 樣本）
└── .github/workflows/daily.yml
```

## 4. 資料來源與抓取策略

| 來源 | 頁面型態 | 抓法 | 穩定度 | 注意事項 |
|---|---|---|---|---|
| 富邦 e 點通 `fubon-ebrokerdj.fbs.com.tw/Z/ZG/...` | 伺服器端產生的靜態 HTML，Big5 編碼 | `requests` + `BeautifulSoup` | 高 | 同一列左買右賣；股票名稱由 `GenLink2stk()` 產生 |
| 玩股網 `wantgoo.com/stock/institutional-investors/...` | 前端 JS 渲染，前有 Cloudflare | Playwright 開頁，攔截頁面發出的 JSON；失敗再讀 `<table>` | 中低 | 雲端機房 IP 容易被擋，建議本機排程 |
| 證交所 T86 `twse.com.tw/rwd/zh/fund/T86` | 官方 JSON | `requests` | 最高 | 單位是「股」，程式換算成「張」；可補抓歷史日期 |

### 4.1 富邦解析邏輯（`fubon.py`）

不綁定 CSS class，而是在每個 `<tr>` 裡找「名次格 → 股票格 → 數字格…」的重複區段：

1. 名次格：內容是 1～3 位數字。
2. 股票格：依序嘗試 `GenLink2stk('AS2330','台積電')`、`<a href="...ZCX_2330...">`、`2330台積電`、`台積電(2330)`。
3. 股票格之後、下一個名次格之前的數字，依序是「買賣超張數、收盤價、漲跌、漲跌幅」。
4. 一列有兩組 → 左組買超、右組賣超；一列只有一組 → 依正負號判斷。

網站小幅改版（換 class、加欄位）通常不會壞。

### 4.2 玩股網抓取邏輯（`wantgoo.py`）

1. Playwright 以台北時區、繁中語系開頁。
2. 監聽所有 `wantgoo` 網域、`content-type` 含 `json` 的回應。
3. 遞迴找出所有 `list[dict]`，用 `FIELD_HINTS` 關鍵字（`stockNo`、`netBuySell` 等）自動對應欄位。
4. 攔截不到就讀畫面上的表格。
5. 原始 JSON 存到 `archive/raw/日期/`，欄位名稱若不同，看原始檔調整 `FIELD_HINTS` 即可。

### 4.3 禮貌抓取

- 每次請求間隔 2～4 秒隨機延遲（`http.delay_seconds`）。
- 429 / 5xx 自動重試 3 次，指數退避。
- 每日只跑一次，總請求數約 10 次。
- 使用前請自行確認各網站服務條款，僅供個人研究使用。

## 5. 資料日期判定

收盤後執行時，各網站可能還顯示「上一個交易日」的資料。為避免存錯日期：

1. 各解析器從頁面文字找資料日期（支援西元、民國、`日期：10/08`）。
2. `main.decide_day()` 取所有成功來源的**多數決**日期當檔名。
3. 全部來源都失敗時**不寫檔**，以結束碼 2 離開（排程會顯示失敗），既有檔案不受影響。
4. 週六日自動略過；國定假日時 T86 回傳無資料、其他來源會標示舊日期，多數決會把它歸到正確日期，重複寫入同一天是冪等的。

## 6. 輸出格式

### 6.1 `web/data/YYYY/YYYY-MM-DD.json`

```json
{
  "date": "2026-10-08",
  "generated_at": "2026-10-08T18:41:07+08:00",
  "demo": false,
  "unit": "張",
  "boards": [
    {
      "id": "fubon-foreign-twse",
      "source": "fubon", "source_name": "富邦 e 點通",
      "category": "foreign", "category_name": "外資",
      "market": "twse", "market_name": "上市",
      "url": "https://...", "data_date": "2026-10-08",
      "status": "ok", "error": null,
      "buy":  [{"rank": 1, "code": "2887", "name": "台新新光金", "net": 29635, "close": 23.5, "change": 0.15}],
      "sell": [{"rank": 1, "code": "2330", "name": "台積電", "net": -8629, "close": 1805, "change": -15}]
    }
  ]
}
```

- `net`：買超為正、賣超為負，單位「張」。
- `status`：`ok`、`empty`（沒解析到）、`error`（抓取失敗，`error` 欄有原因）。

### 6.2 其他檔案

| 檔案 | 用途 |
|---|---|
| `web/data/latest.json` | 最新一日（與當日檔相同），給其他工具快速取用 |
| `web/data/index.json` | `{"dates": ["2026-10-08", ...]}`，新到舊，前端日期選單用 |
| `archive/YYYY/YYYY-MM-DD.csv` | UTF-8 BOM，Excel 直接開不亂碼 |
| `archive/YYYY/YYYY-MM-DD.xlsx` | 每張排行一個工作表，買賣左右並排，紅買綠賣 |
| `archive/raw/YYYY-MM-DD/` | 原始 HTML / JSON，解析失敗時除錯用（不進版控） |

JSON 一律先寫 `.tmp` 再改名（原子寫入），網頁不會讀到寫一半的檔。

## 7. 前端設計

### 7.1 版面：中央脊線的「對拉排行板」

買超在左、賣超在右，中間一條脊線。每一列的量能條從脊線往外長，長度＝該檔買賣超張數 ÷ 當頁最大值，紅色為買、綠色為賣，一眼就能看出今天資金往哪邊倒。

```
 桌機 ≥ 981px                         平板 641–980px            手機 ≤ 640px
┌───────────────────────────────┐   ┌───────────────────────┐   ┌─────────────┐
│ 標題        ‹ 日期 ›   主題鈕  │   │ 標題    ‹日期›  主題鈕 │   │ 標題   主題 │
│ 外資 投信 自營商 三大法人 主力 │   │ 類別分頁               │   │  ‹ 日期 ›   │
│ [上市|上櫃] 來源▼     搜尋     │   │ [上市|上櫃] 來源 搜尋  │   │ 類別分頁→   │
│ 合計列                         │   │ 合計列                 │   │ 市場 來源   │
│ ┌──── 買超 ────┃──── 賣超 ────┐│   │ ┌─ 買超 ─┃─ 賣超 ─┐  │   │ 搜尋        │
│ │1 名稱 價 ▓▓▓+│-▓▓▓ 價 名稱 1││   │ │名稱 ▓▓+│-▓▓ 名稱│  │   │[買超|賣超]  │
│ └──────────────┃──────────────┘│   │ └────────┃────────┘  │   │ 單欄清單    │
└───────────────────────────────┘   └──（隱藏收盤價欄）────┘   └─────────────┘
```

### 7.2 主題

- 色彩全部定義成 CSS 變數，`:root` 為淺色，`[data-theme="dark"]` 與 `prefers-color-scheme: dark` 為深色。
- `<head>` 內聯小段 script 先決定主題再渲染，避免閃白。
- 使用者選擇存在 `localStorage`（以 try/catch 包住，無痕模式也不報錯）；沒選過就跟隨系統。
- 台股慣例：紅＝買超／上漲，綠＝賣超／下跌，深色模式改用較亮的紅綠維持對比。

### 7.3 互動

| 功能 | 說明 |
|---|---|
| 日期切換 | 下拉選單、‹ › 按鈕、鍵盤左右鍵 |
| 類別／市場／來源 | 只顯示資料中存在的組合，沒有的自動停用 |
| 搜尋 | 代號或名稱，即時過濾並標黃 |
| 連續上榜 | 背景讀前 4 個交易日檔案，同來源同類別連續上榜 ≥2 日顯示「連N日」 |
| 分享 | 狀態寫在網址 `#date=...&cat=...&src=...`，可加書籤 |
| 股票連結 | 點名稱開啟玩股網個股頁 |
| 異常提示 | 來源抓取失敗時顯示原因，並提示換來源 |

### 7.4 效能

- 單日 JSON 約 80 KB（3 來源 × 4–5 類別 × 買賣各 50 名），不需要分頁。
- `fetch` 結果在記憶體快取，切換分頁不重抓。
- 無框架、無建置步驟，只有一支 JS、一支 CSS。

## 8. 部署選項

| 方案 | 排程 | 主機 | 適合 |
|---|---|---|---|
| A. 全 GitHub | Actions cron | GitHub Pages | 只用富邦 + 證交所時最省事 |
| B. 本機抓 + 雲端放 | crontab / 工作排程器，`git push` | GitHub / Cloudflare Pages | 需要玩股網（避開雲端 IP 被擋） |
| C. 全本機 | crontab | `python -m http.server` 或 NAS | 只在家用網路內看 |

Cloudflare Pages 設定：Build command 留空、Output directory 填 `web`。

## 9. 擴充

- **新增來源**：在 `scraper/sources/` 加一個模組，回傳 `(buy, sell, data_date)`；在 `main.run()` 加一個分支；在 `config.yaml` 加設定。
- **上櫃資料**：在 `config.yaml` 對應來源加 `market: tpex` 的 board 與網址即可，前端會自動出現「上櫃」。
- **通知**：在 `main()` 寫檔後，可加 LINE Notify / Telegram 推播當日前五名。
- **併入股市資訊站**：直接讀 `latest.json`，或把 `web/` 當子路徑掛上去。

## 10. 風險與限制

- 第三方網站改版或加強防爬，解析可能失效；`status` 會標示，且保留原始檔方便修正。
- 玩股網有 Cloudflare，雲端執行成功率不穩，建議本機排程或只當輔助來源。
- 富邦的投信、自營商、主力網址沿用同一套命名慣例推定，**首次使用請在瀏覽器確認**。
- 資料僅供參考，不構成投資建議。
