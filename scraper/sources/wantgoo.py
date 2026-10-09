"""玩股網買賣超排行。

頁面特性：
- 內容由前端 JavaScript 呼叫內部 JSON API 後渲染
- 站台前有 Cloudflare 防護，直接用 requests 通常拿到 403 / 驗證頁

做法：
1. 用 Playwright（Chromium）開頁，攔截頁面自己發出的 JSON 回應
2. 從所有 JSON 中挑出「最像排行資料」的陣列，用欄位關鍵字自動對應
3. 若攔截不到 JSON，退回讀取畫面上的 <table>
原始 JSON 會另存（keep_raw），欄位對應若需調整，看 raw 檔改 FIELD_HINTS 即可。
"""
from __future__ import annotations

import json
import logging
from typing import Any, Optional

from ..models import RankRow
from ..utils import parse_page_date, to_num

log = logging.getLogger("scraper.wantgoo")

# 欄位關鍵字（小寫比對，依序嘗試）
FIELD_HINTS = {
    "code": ["stockno", "stockid", "symbol", "code", "id"],
    "name": ["stockname", "name"],
    "net": ["netbuysell", "netbuy", "buysell", "overbought", "net", "diff"],
    "buy": ["buyvolume", "buy"],
    "sell": ["sellvolume", "sell"],
    "close": ["close", "closeprice", "price", "deal"],
    "change": ["change", "updown", "chg"],
    "change_pct": ["changepercent", "changerate", "percent", "rate"],
}


def _pick(d: dict, field: str) -> Any:
    lower = {k.lower(): v for k, v in d.items()}
    for hint in FIELD_HINTS[field]:
        if hint in lower:
            return lower[hint]
    for hint in FIELD_HINTS[field]:          # 模糊比對
        for k, v in lower.items():
            if hint in k:
                return v
    return None


def _candidate_lists(obj: Any, out: list) -> None:
    """遞迴找出所有 list[dict]。"""
    if isinstance(obj, list):
        if obj and all(isinstance(x, dict) for x in obj[:5]):
            out.append(obj)
        for x in obj[:50]:
            _candidate_lists(x, out)
    elif isinstance(obj, dict):
        for v in obj.values():
            _candidate_lists(v, out)


def rows_from_json(payloads: list[Any], top_n: int) -> tuple[list[RankRow], list[RankRow]]:
    lists: list[list[dict]] = []
    for p in payloads:
        _candidate_lists(p, lists)
    # 有代號又有買賣超欄位的才算
    scored = []
    for lst in lists:
        sample = lst[0]
        if _pick(sample, "code") is not None and _pick(sample, "net") is not None:
            scored.append(lst)
    if not scored:
        return [], []

    records: list[RankRow] = []
    for lst in scored:
        for d in lst:
            net = to_num(_pick(d, "net"))
            code = str(_pick(d, "code") or "").strip()
            if net is None or not code:
                continue
            records.append(RankRow(
                rank=0, code=code, name=str(_pick(d, "name") or "").strip(),
                net=net,
                close=to_num(_pick(d, "close")),
                change=to_num(_pick(d, "change")),
                change_pct=to_num(_pick(d, "change_pct")),
                buy=to_num(_pick(d, "buy")),
                sell=to_num(_pick(d, "sell")),
            ))
    return _split(records, top_n)


def _split(records: list[RankRow], top_n: int) -> tuple[list[RankRow], list[RankRow]]:
    uniq = {r.code: r for r in records}.values()
    buy = sorted([r for r in uniq if r.net > 0], key=lambda r: -r.net)[:top_n]
    sell = sorted([r for r in uniq if r.net < 0], key=lambda r: r.net)[:top_n]
    for i, r in enumerate(buy, 1):
        r.rank = i
    for i, r in enumerate(sell, 1):
        r.rank = i
    return buy, sell


def rows_from_tables(tables: list[list[list[str]]], top_n: int) -> tuple[list[RankRow], list[RankRow]]:
    """DOM 備援：tables = [[cell, cell, ...], ...]。第一欄名次、含代號名稱、其後數字。"""
    import re
    records = []
    for table in tables:
        for cells in table:
            if len(cells) < 3:
                continue
            code = name = None
            nums = []
            for c in cells:
                m = re.match(r"^\s*(\d{4}[0-9A-Z]{0,2})\s*(.*)$", c)
                if code is None and m and not re.fullmatch(r"\d{1,3}", c.strip()):
                    code, name = m.group(1), m.group(2).strip()
                elif code is not None:
                    n = to_num(c)
                    if n is not None:
                        nums.append(n)
            if code and nums:
                records.append(RankRow(rank=0, code=code, name=name or "", net=nums[0],
                                       close=nums[1] if len(nums) > 1 else None))
    return _split(records, top_n)


def fetch(url: str, http_cfg: dict, top_n: int) -> tuple[list[RankRow], list[RankRow], Optional[str], dict]:
    """回傳 (buy, sell, page_date, raw)。需先 `playwright install chromium`。"""
    from playwright.sync_api import sync_playwright

    payloads: list[Any] = []

    def on_response(resp):
        try:
            if "json" in (resp.headers.get("content-type") or "") and "wantgoo" in resp.url:
                payloads.append(resp.json())
        except Exception:  # noqa: BLE001 回應可能已被釋放
            pass

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--disable-blink-features=AutomationControlled"])
        ctx = browser.new_context(
            user_agent=http_cfg.get("user_agent"),
            locale="zh-TW",
            timezone_id="Asia/Taipei",
            viewport={"width": 1366, "height": 900},
        )
        page = ctx.new_page()
        page.on("response", on_response)
        page.goto(url, wait_until="domcontentloaded", timeout=http_cfg.get("timeout", 20) * 1000 * 2)
        try:
            page.wait_for_selector("table tbody tr", timeout=20000)
        except Exception:  # noqa: BLE001
            log.warning("等不到表格，可能被 Cloudflare 擋下：%s", url)
        page.wait_for_timeout(1500)
        body_text = page.inner_text("body")
        tables = page.eval_on_selector_all(
            "table",
            "ts => ts.map(t => [...t.querySelectorAll('tbody tr')].map(tr => [...tr.cells].map(c => c.innerText.trim())))",
        )
        browser.close()

    buy, sell = rows_from_json(payloads, top_n)
    if not buy and not sell:
        buy, sell = rows_from_tables(tables, top_n)
    raw = {"json": payloads, "tables": tables}
    return buy, sell, parse_page_date(body_text), raw


def dump_raw(raw: dict) -> str:
    return json.dumps(raw, ensure_ascii=False, indent=1, default=str)
