"""共用工具：數字解析、日期、HTTP Session、禮貌延遲。"""
from __future__ import annotations

import logging
import random
import re
import time
from datetime import date, datetime, timedelta, timezone
from typing import Optional

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

log = logging.getLogger("scraper")

TW_TZ = timezone(timedelta(hours=8))
_NUM_RE = re.compile(r"[-+]?\d[\d,]*\.?\d*")


def now_tw() -> datetime:
    return datetime.now(TW_TZ)


def today_tw() -> date:
    return now_tw().date()


def to_num(text) -> Optional[float]:
    """'1,234' → 1234.0；'-5,678' → -5678.0；'▼0.5' → -0.5；空值 → None"""
    if text is None:
        return None
    if isinstance(text, (int, float)):
        return float(text)
    s = str(text).strip().replace("\xa0", "").replace(" ", "")
    if not s or s in {"-", "--", "N/A", "X"}:
        return None
    neg = s.startswith(("▼", "－")) or s.startswith("-")
    m = _NUM_RE.search(s.lstrip("▲▼+－"))
    if not m:
        return None
    val = float(m.group().replace(",", "").lstrip("+-"))
    return -val if neg else val


def parse_page_date(text: str, ref: Optional[date] = None) -> Optional[str]:
    """從頁面文字找資料日期，支援 2026/10/08、115/10/08（民國）、10/08。"""
    ref = ref or today_tw()
    # 優先找「日期：」標籤後面的日期，避免抓到頁尾或廣告上的其他日期
    m = re.search(r"(?:資料)?日期[:：]\s*(\d{3,4}[/\-.]\d{1,2}[/\-.]\d{1,2})", text)
    if m:
        text = m.group(1)
    short = re.search(r"日期[:：]\s*(\d{1,2})/(\d{1,2})(?![/\d])", text)
    m = None if short else re.search(r"(\d{3,4})[/\-.](\d{1,2})[/\-.](\d{1,2})", text)
    if m:
        y, mo, d = (int(x) for x in m.groups())
        if y < 1911:
            y += 1911
        try:
            return date(y, mo, d).isoformat()
        except ValueError:
            return None
    m = short
    if m:
        mo, d = int(m.group(1)), int(m.group(2))
        y = ref.year if (mo, d) <= (ref.month, ref.day) else ref.year - 1
        try:
            return date(y, mo, d).isoformat()
        except ValueError:
            return None
    return None


def make_session(cfg: dict) -> requests.Session:
    s = requests.Session()
    retry = Retry(
        total=cfg.get("retries", 3),
        backoff_factor=1.5,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=("GET",),
    )
    s.mount("https://", HTTPAdapter(max_retries=retry))
    s.mount("http://", HTTPAdapter(max_retries=retry))
    s.headers.update({
        "User-Agent": cfg.get("user_agent", "Mozilla/5.0"),
        "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
    })
    return s


def polite_sleep(cfg: dict) -> None:
    lo, hi = cfg.get("delay_seconds", [1.5, 3.0])
    time.sleep(random.uniform(lo, hi))
