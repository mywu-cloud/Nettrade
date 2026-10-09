"""產生示範資料（demo=true），讓網頁在第一次真正抓取前就能預覽版面。

    python scripts/generate_demo.py
真實資料寫入後，前端會自動以真實資料為主；示範檔可直接刪除 web/data/。
"""
from __future__ import annotations

import copy
import random
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scraper.main import load_config  # noqa: E402
from scraper.models import Board, RankRow  # noqa: E402
from scraper.storage import write_day  # noqa: E402

STOCKS = [
    ("2330", "台積電", 1450), ("2317", "鴻海", 210), ("2454", "聯發科", 1380), ("2303", "聯電", 52),
    ("3481", "群創", 20), ("2409", "友達", 15), ("2887", "台新新光金", 23), ("2883", "凱基金", 18),
    ("2882", "國泰金", 72), ("2891", "中信金", 48), ("2884", "玉山金", 31), ("2890", "永豐金", 27),
    ("2344", "華邦電", 38), ("6770", "力積電", 24), ("2408", "南亞科", 66), ("2618", "長榮航", 41),
    ("2603", "長榮", 205), ("2609", "陽明", 68), ("2002", "中鋼", 22), ("1314", "中石化", 9),
    ("3231", "緯創", 128), ("2382", "廣達", 295), ("2356", "英業達", 48), ("3037", "欣興", 182),
    ("2313", "華通", 96), ("3105", "穩懋", 155), ("2455", "全新", 118), ("8086", "宏捷科", 102),
    ("3443", "創意", 1620), ("4967", "十銓", 86), ("2449", "京元電子", 135), ("6239", "力成", 142),
    ("1717", "長興", 34), ("2353", "宏碁", 36), ("2324", "仁寶", 33), ("0050", "元大台灣50", 198),
    ("0056", "元大高股息", 37), ("00919", "群益台灣精選高息", 22), ("00981A", "主動統一台股增長", 13),
    ("2812", "台中銀", 19), ("5880", "合庫金", 25), ("2892", "第一金", 28), ("1605", "華新", 31),
]


def make_rows(rng: random.Random, sign: int, n: int, scale: int) -> list[RankRow]:
    picks = rng.sample(STOCKS, n)
    vals = sorted((int(scale * rng.paretovariate(1.4)) for _ in range(n)), reverse=True)
    rows = []
    for i, ((code, name, px), v) in enumerate(zip(picks, vals), 1):
        chg = round(px * rng.uniform(-0.05, 0.05) + sign * px * 0.01, 2)
        rows.append(RankRow(rank=i, code=code, name=name, net=sign * v,
                            close=round(px + chg, 2), change=chg, change_pct=round(chg / px * 100, 2)))
    return rows


def main() -> None:
    cfg = copy.deepcopy(load_config(ROOT / "config.yaml"))
    cfg["output"]["write_csv"] = cfg["output"]["write_xlsx"] = False
    scale = {"foreign": 1800, "trust": 400, "dealer": 300, "institution": 2000, "major": 900}
    d = date(2026, 10, 8)
    days = []
    while len(days) < 5:
        if d.weekday() < 5:
            days.append(d)
        d -= timedelta(days=1)

    for day in reversed(days):
        rng = random.Random(day.toordinal())
        boards = []
        for src_key, src in cfg["sources"].items():
            cats = ["foreign", "trust", "dealer", "major"] if src_key != "twse" else ["foreign", "trust", "dealer", "institution"]
            for market in ("twse", "tpex") if src_key == "fubon" else ("twse",):
                for cat in cats:
                    b = Board(src_key, src["name"], cat, cfg["categories"][cat], market, cfg["markets"][market],
                              url="", data_date=day.isoformat())
                    b.buy = make_rows(rng, 1, 20, scale[cat])
                    b.sell = make_rows(rng, -1, 20, scale[cat])
                    boards.append(b)
        write_day(boards, day.isoformat(), cfg, ROOT, demo=True)
    print("示範資料已產生：", ", ".join(x.isoformat() for x in days))


if __name__ == "__main__":
    main()
