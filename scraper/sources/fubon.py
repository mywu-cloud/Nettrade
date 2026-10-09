"""富邦 e 點通（MoneyDJ 架構）買賣超排行解析。

頁面特性：
- 靜態 HTML、Big5/CP950 編碼，不需要瀏覽器
- 同一個 <tr> 內左半是「買超」、右半是「賣超」
- 股票名稱常以 <script>GenLink2stk('AS2330','台積電');</script> 產生

解析策略刻意寫得「寬鬆」：不綁死 class 名稱，而是在每一列找
「名次 → 股票 → 數字…」的重複區段，版面小改也不容易壞。
"""
from __future__ import annotations

import re
from typing import Optional

from bs4 import BeautifulSoup, Tag

from ..models import RankRow
from ..utils import parse_page_date, to_num

_GENLINK = re.compile(r"GenLink2stk\(\s*'(?:A[SP])?([0-9A-Z]{4,6})'\s*,\s*'([^']+)'")
_HREF_CODE = re.compile(r"(?:ZCX_|[?&]a=|stkid=|/stock/|Link2Stk\(\s*')(?:A[SP])?([0-9A-Z]{4,6})", re.I)
# 名稱第一個字不可以是數字、小數點、逗號、百分比，避免把「1062.5」這種價格誤認成「代號+名稱」
_TEXT_CODE = re.compile(r"^\s*([0-9]{4}[0-9A-Z]{0,2})\s*([^\d\s.,%+\-].*)$|^(.+?)\s*\(([0-9]{4}[0-9A-Z]{0,2})\)\s*$")

# 表頭文字 → RankRow 欄位（依序比對，先比對較長的關鍵字）
_HEADER_MAP = [("漲跌幅", "change_pct"), ("漲跌", "change"), ("收盤", "close"), ("成交價", "close"),
               ("買進", "buy"), ("賣出", "sell"), ("超", "net")]


def decode(content: bytes) -> str:
    for enc in ("cp950", "big5", "utf-8"):
        try:
            return content.decode(enc)
        except UnicodeDecodeError:
            continue
    return content.decode("cp950", errors="ignore")


def _stock_of(td: Tag) -> Optional[tuple[str, str]]:
    raw = str(td)
    m = _GENLINK.search(raw)
    if m:
        return m.group(1), m.group(2).strip()
    a = td.find("a")
    if a is not None:
        m = _HREF_CODE.search(a.get("href", ""))
        name = a.get_text(strip=True)
        if m:
            code = m.group(1)
            name = name.replace(code, "").strip("()（） ") or name
            return code, name
    text = td.get_text(" ", strip=True)
    m = _TEXT_CODE.match(text)
    if m:
        if m.group(1):
            return m.group(1), m.group(2).strip()
        return m.group(4), m.group(3).strip()
    return None


def _is_rank(td: Tag) -> bool:
    return bool(re.fullmatch(r"\d{1,3}", td.get_text(strip=True)))


def _header_groups(tds: list[Tag]) -> Optional[list[list[Optional[str]]]]:
    """表頭列 → 每一組「股票名稱之後」各欄對應的欄位名稱。不是表頭回傳 None。"""
    texts = [td.get_text(strip=True) for td in tds]
    if "名次" not in texts or not any("股票" in t for t in texts):
        return None
    groups: list[list[Optional[str]]] = []
    for t in texts:
        if t == "名次":
            groups.append([])
            continue
        if not groups or "股票" in t:
            continue
        groups[-1].append(next((f for k, f in _HEADER_MAP if k in t), None))
    return groups or None


def parse(html: str, top_n: int = 50) -> tuple[list[RankRow], list[RankRow], Optional[str]]:
    """支援兩種版面：
    - 法人排行（ZGK_*）：一列左買右賣，欄位「名次 股票 超張數 收盤價 漲跌」
    - 主力排行（ZG_F / ZG_FA）：一列一檔，欄位「名次 股票 收盤價 漲跌 漲跌幅 買進 賣出 買賣超」
    有表頭時依表頭對應欄位；找不到表頭時退回「股票後第一個數字是買賣超」的位置規則。
    """
    soup = BeautifulSoup(html, "lxml")
    buy: list[RankRow] = []
    sell: list[RankRow] = []
    header: Optional[list[list[Optional[str]]]] = None

    for tr in soup.find_all("tr"):
        tds = tr.find_all("td", recursive=False)
        if len(tds) < 3:
            continue
        h = _header_groups(tds)
        if h:
            header = h
            continue
        # 找出每個「股票格」的位置，前一格必須是名次
        groups: list[tuple[int, int]] = []          # (rank_idx, stock_idx)
        i = 1
        while i < len(tds):
            if _is_rank(tds[i - 1]) and _stock_of(tds[i]):
                groups.append((i - 1, i))
                i += 2                                # 股票格本身不會再是下一組的名次
            else:
                i += 1
        if not groups:
            continue

        for g, (r_idx, s_idx) in enumerate(groups):
            end = groups[g + 1][0] if g + 1 < len(groups) else len(tds)
            cells = tds[s_idx + 1:end]
            code, name = _stock_of(tds[s_idx])
            row = RankRow(rank=int(tds[r_idx].get_text(strip=True)), code=code, name=name, net=0.0)
            labels = header[min(g, len(header) - 1)] if header else None
            if labels and "net" in labels:
                vals: dict = {}
                for lab, td in zip(labels, cells):
                    if lab and lab not in vals:
                        vals[lab] = to_num(td.get_text(strip=True))
                if vals.get("net") is None:
                    continue
                row.net = vals["net"]
                for f in ("close", "change", "change_pct", "buy", "sell"):
                    setattr(row, f, vals.get(f))
            else:
                nums = [n for n in (to_num(td.get_text(strip=True)) for td in cells) if n is not None]
                if not nums:
                    continue
                row.net = nums[0]
                row.close = nums[1] if len(nums) > 1 else None
                row.change = nums[2] if len(nums) > 2 else None
                row.change_pct = nums[3] if len(nums) > 3 else None
            # 單列兩組 → 左買右賣；單列一組 → 依數值正負判斷
            side_is_sell = (g == 1) if len(groups) >= 2 else (row.net < 0)
            if side_is_sell:
                row.net = -abs(row.net)
                sell.append(row)
            else:
                row.net = abs(row.net)
                buy.append(row)

    page_date = parse_page_date(soup.get_text(" ", strip=True))
    return _dedupe(buy)[:top_n], _dedupe(sell)[:top_n], page_date


def _dedupe(rows: list[RankRow]) -> list[RankRow]:
    seen, out = set(), []
    for r in sorted(rows, key=lambda x: x.rank):
        if r.code in seen:
            continue
        seen.add(r.code)
        out.append(r)
    return out


def fetch(session, url: str, http_cfg: dict) -> bytes:
    resp = session.get(url, timeout=http_cfg.get("timeout", 20))
    resp.raise_for_status()
    return resp.content
