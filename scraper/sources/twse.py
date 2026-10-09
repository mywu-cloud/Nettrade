"""證交所 T86「三大法人買賣超日報」— 官方 JSON，作為備援與交叉驗證。

一次請求就拿到全部上市個股的外資 / 投信 / 自營商 / 合計買賣超，
自行排序取前 N 名。單位為「股」，這裡換算成「張」(÷1000)。
"""
from __future__ import annotations

from datetime import date
from typing import Optional

from ..models import RankRow
from ..utils import to_num

T86_URL = "https://www.twse.com.tw/rwd/zh/fund/T86"

# 欄位名稱關鍵字 → category
COLUMN_KEYS = {
    "foreign": ["外陸資買賣超股數(不含外資自營商)", "外資買賣超股數"],
    "trust": ["投信買賣超股數"],
    "dealer": ["自營商買賣超股數"],
    "institution": ["三大法人買賣超股數"],
}


def fetch_t86(session, d: date, http_cfg: dict) -> Optional[dict]:
    params = {"date": d.strftime("%Y%m%d"), "selectType": "ALLBUT0999", "response": "json"}
    resp = session.get(T86_URL, params=params, timeout=http_cfg.get("timeout", 20))
    resp.raise_for_status()
    js = resp.json()
    if js.get("stat") != "OK" or not js.get("data"):
        return None            # 休市或尚未公布
    return js


def _col(fields: list[str], keys: list[str]) -> Optional[int]:
    for k in keys:
        for i, f in enumerate(fields):
            if f.replace(" ", "") == k:
                return i
    for k in keys:                 # 欄名微調時的寬鬆比對
        core = k.split("(")[0]
        for i, f in enumerate(fields):
            if core in f and "買賣超" in f:
                return i
    return None


def rank(js: dict, category: str, top_n: int) -> tuple[list[RankRow], list[RankRow], str]:
    fields = js["fields"]
    i_code, i_name = 0, 1
    i_net = _col(fields, COLUMN_KEYS[category])
    if i_net is None:
        raise ValueError(f"T86 找不到欄位：{category}")
    rows = []
    for r in js["data"]:
        net = to_num(r[i_net])
        if net is None or net == 0:
            continue
        rows.append(RankRow(rank=0, code=r[i_code].strip(), name=r[i_name].strip(), net=round(net / 1000)))
    buy = sorted([x for x in rows if x.net > 0], key=lambda x: -x.net)[:top_n]
    sell = sorted([x for x in rows if x.net < 0], key=lambda x: x.net)[:top_n]
    for i, x in enumerate(buy, 1):
        x.rank = i
    for i, x in enumerate(sell, 1):
        x.rank = i
    d = js.get("date", "")
    data_date = f"{d[:4]}-{d[4:6]}-{d[6:8]}" if len(d) == 8 else None
    return buy, sell, data_date
