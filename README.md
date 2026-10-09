# 法人籌碼排行 tw-chip-rank

每個交易日自動抓取台股**外資、投信、自營商、三大法人、主力**的買超／賣超排行，寫成 JSON、CSV、Excel，並提供一個桌機、平板、手機都能看、可切換淺色／深色的網頁。

- 來源：富邦 e 點通、玩股網、證交所官方（互為備援）
- 全靜態：不需要資料庫或後端，可放 GitHub Pages / Cloudflare Pages
- 台股慣例：紅色＝買超／上漲，綠色＝賣超／下跌

系統設計細節請看 [ARCHITECTURE.md](ARCHITECTURE.md)。

---

## 快速開始

```bash
# 1. 建立環境
python -m venv .venv
source .venv/bin/activate            # Windows：.venv\Scripts\activate
pip install -r requirements.txt
python -m playwright install chromium   # 只有要抓玩股網才需要

# 2. 先用示範資料看網頁（示範資料不要 commit，看完記得刪：rm -rf web/data/20* web/data/latest.json）
python scripts/generate_demo.py
cd web && python -m http.server 8000
# 瀏覽器開 http://localhost:8000

# 3. 抓真實資料
cd ..
python -m scraper.main
```

> 網頁要用 `http.server` 或部署後開啟，直接雙擊 `index.html` 會因瀏覽器安全限制讀不到 JSON。
> 抓到真實資料後，可以刪掉示範檔：`rm -rf web/data/*` 再重抓一次。

## 指令

| 指令 | 說明 |
|---|---|
| `python -m scraper.main` | 抓今天全部來源（週末自動略過） |
| `python -m scraper.main --only fubon,twse` | 只抓指定來源 |
| `python -m scraper.main --date 2026-10-08 --only twse` | 補抓歷史日期（只有證交所支援） |
| `python -m scraper.main --force` | 週末或全部失敗也寫檔 |
| `python -m scraper.main -v` | 顯示除錯訊息 |
| `python -m pytest -q tests` | 跑解析器測試 |

結束碼：`0` 成功、`2` 所有來源都沒資料（不會覆寫既有檔案；GitHub Actions 視為休市，不算失敗）。

## 輸出檔案

```
web/data/
├── index.json                 日期清單（前端選單用）
├── latest.json                最新一日
└── 2026/2026-10-08.json       當日全部排行
archive/
├── 2026/2026-10-08.csv        UTF-8 BOM，Excel 直接開
├── 2026/2026-10-08.xlsx       每張排行一個工作表，紅買綠賣
└── raw/2026-10-08/            原始 HTML / JSON（除錯用）
```

## 第一次使用前要確認的事

1. **富邦網址**：外資、投信、自營商（上市＋上櫃）與主力（上市，買超 `ZG_F`＋賣超 `ZG_FA` 合併）都已在瀏覽器確認過，預設全部開啟。主力頁欄位順序不同，程式會依表頭自動對應。
2. **玩股網網址**：投信、自營商、主力頁是推定路徑，請確認後再用。主力頁預設關閉。
3. **玩股網欄位**：第一次跑完看 `archive/raw/日期/wantgoo-*.json`，若解析不到資料，把實際欄位名稱加進 `scraper/sources/wantgoo.py` 的 `FIELD_HINTS`。
4. **證交所**：證交所有時會擋海外 IP（含 GitHub Actions 機房），若一直失敗屬正常，富邦仍會有資料。

## 每日自動執行

### 方案 A：GitHub Actions + GitHub Pages

1. 把專案推到 GitHub。
2. Settings → Pages → Source 選 **GitHub Actions**。
3. Settings → Actions → General → Workflow permissions 選 **Read and write**。
4. `.github/workflows/daily.yml` 已設定週一到五台北時間 18:40 執行，抓完自動 commit 並部署。也可以在 Actions 頁面手動執行（Run workflow）。
5. 只改網頁（`web/`）時，push 會自動重新部署、不抓資料。國定假日抓不到資料時會顯示警告而不是失敗。

> 玩股網有 Cloudflare 防護，GitHub 機房 IP 常被擋。若玩股網一直失敗，改用方案 B，或在 `config.yaml` 把 `wantgoo.enabled` 設成 `false`。

### 方案 B：本機排程 + 推到雲端

macOS / Linux：

```bash
crontab -e
40 18 * * 1-5 /完整路徑/tw-chip-rank/scripts/run_daily.sh >> /tmp/chip-rank.log 2>&1
```

Windows：工作排程器 → 建立基本工作 → 每週一到五 18:40 → 啟動程式選 `scripts\run_daily.bat`。

把腳本最後的 `git push` 註解拿掉，就會自動推上 GitHub，再由 Pages 或 Cloudflare Pages 更新網頁。

### Cloudflare Pages

連結 GitHub repo，Build command 留空，Build output directory 填 `web`。

## 網頁功能

- 淺色／深色切換（記住選擇，沒選過就跟隨系統）
- 桌機：買賣左右對拉，量能條從中央往外長
- 平板：同樣左右並排，隱藏收盤價欄
- 手機：單欄，上方切換「買超／賣超」
- 類別分頁、上市／上櫃、來源切換、代號名稱搜尋
- 「連N日」徽章：同來源同類別連續上榜天數
- 網址會記住目前畫面，可直接分享或加書籤
- 鍵盤左右鍵切換日期

## 調整設定

`config.yaml` 常用項目：

| 設定 | 說明 |
|---|---|
| `output.top_n` | 每邊保留幾名（預設 50） |
| `output.write_xlsx` / `write_csv` | 是否輸出 Excel / CSV |
| `output.keep_raw` | 是否保存原始網頁 |
| `http.delay_seconds` | 請求間隔秒數區間 |
| `sources.<名稱>.enabled` | 整個來源開關 |
| `sources.<名稱>.boards[].enabled` | 單一排行表開關 |

## 疑難排解

| 狀況 | 處理 |
|---|---|
| 網頁顯示「找不到 data/index.json」 | 先跑一次爬蟲或 `generate_demo.py`，並用 http server 開啟 |
| 某來源顯示「沒有解析到資料」 | 看 `archive/raw/` 原始檔，確認網址與版面；休市日也會這樣 |
| 富邦中文亂碼 | 程式已用 CP950 解碼；若仍亂碼請回報原始檔 |
| 玩股網 403 / 一直空白 | Cloudflare 擋下，改本機執行或停用該來源 |
| 存檔日期是前一天 | 正常：來源頁面當時還是前一交易日資料，程式依頁面日期存檔 |

## 注意事項

- 本專案抓取公開網頁供個人研究使用，請遵守各網站服務條款，勿提高抓取頻率。
- 資料可能有延遲或誤差，**僅供參考，不構成任何投資建議**，投資請自行判斷並承擔風險。
