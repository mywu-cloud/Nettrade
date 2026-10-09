"""每日抓取入口。

用法：
    python -m scraper.main                 # 抓今天（週末自動跳過）
    python -m scraper.main --only fubon,twse
    python -m scraper.main --date 2026-10-08 --only twse   # 補抓歷史（僅官方來源支援）
    python -m scraper.main --force         # 週末 / 無資料也照跑
"""
from __future__ import annotations

import argparse
import logging
import sys
from collections import Counter
from datetime import date
from pathlib import Path

import yaml

from .models import Board
from .sources import fubon, twse, wantgoo
from .storage import write_day
from .utils import make_session, polite_sleep, today_tw

ROOT = Path(__file__).resolve().parent.parent
log = logging.getLogger("scraper")


def load_config(path: Path) -> dict:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _new_board(cfg: dict, src_key: str, b: dict) -> Board:
    return Board(
        source=src_key,
        source_name=cfg["sources"][src_key]["name"],
        category=b["category"],
        category_name=cfg["categories"][b["category"]],
        market=b["market"],
        market_name=cfg["markets"][b["market"]],
        url=b.get("url", ""),
    )


def _save_raw(root: Path, cfg: dict, day: str, name: str, content: str | bytes) -> None:
    if not cfg["output"].get("keep_raw"):
        return
    raw_dir = root / cfg["output"]["archive_dir"] / "raw" / day
    raw_dir.mkdir(parents=True, exist_ok=True)
    p = raw_dir / name
    if isinstance(content, bytes):
        p.write_bytes(content)
    else:
        p.write_text(content, encoding="utf-8")


def run(cfg: dict, only: set[str] | None, target: date) -> list[Board]:
    http_cfg, top_n = cfg["http"], cfg["output"]["top_n"]
    session = make_session(http_cfg)
    boards: list[Board] = []
    tag = target.isoformat()

    for src_key, src in cfg["sources"].items():
        if not src.get("enabled", True) or (only and src_key not in only):
            continue
        t86 = None
        for b in src["boards"]:
            if not b.get("enabled", True):
                continue
            board = _new_board(cfg, src_key, b)
            try:
                if src_key == "fubon":
                    # 主力排行買超、賣超是兩個網頁 → url（買）+ url_sell（賣）合併成一張表
                    pages = [("", board.url)] + ([("-sell", b["url_sell"])] if b.get("url_sell") else [])
                    for suffix, url in pages:
                        content = fubon.fetch(session, url, http_cfg)
                        _save_raw(ROOT, cfg, tag, f"{board.id}{suffix}.html", content)
                        buy, sell, page_date = fubon.parse(fubon.decode(content), top_n)
                        board.buy += buy
                        board.sell += sell
                        board.data_date = board.data_date or page_date
                        polite_sleep(http_cfg)
                elif src_key == "wantgoo":
                    board.buy, board.sell, board.data_date, raw = wantgoo.fetch(board.url, http_cfg, top_n)
                    _save_raw(ROOT, cfg, tag, f"{board.id}.json", wantgoo.dump_raw(raw))
                    polite_sleep(http_cfg)
                elif src_key == "twse":
                    if t86 is None:
                        t86 = {}                      # 先標記，失敗時不會每張表重抓
                        t86 = twse.fetch_t86(session, target, http_cfg) or {}
                    if t86:
                        board.buy, board.sell, board.data_date = twse.rank(t86, board.category, top_n)
                    board.url = f"{twse.T86_URL}?date={target:%Y%m%d}&selectType=ALLBUT0999"
                else:
                    raise ValueError(f"未知來源：{src_key}")
                if not board.buy and not board.sell:
                    board.status, board.error = "empty", "沒有解析到資料（休市、尚未公布或版面改變）"
            except Exception as e:  # noqa: BLE001 單一來源失敗不影響其他來源
                board.status, board.error = "error", f"{type(e).__name__}: {e}"[:300]
                log.exception("抓取失敗 %s", board.id)
            log.info("%-28s %-6s 買%3d 賣%3d %s", board.id, board.status, len(board.buy), len(board.sell),
                     board.data_date or "")
            boards.append(board)
    return boards


def decide_day(boards: list[Board], fallback: date) -> str:
    """以各來源頁面標示的資料日期多數決，避免把『上一交易日』資料存成今天。"""
    dates = [b.data_date for b in boards if b.status == "ok" and b.data_date]
    return Counter(dates).most_common(1)[0][0] if dates else fallback.isoformat()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="台股法人 / 主力買賣超排行每日抓取")
    ap.add_argument("--config", default=str(ROOT / "config.yaml"))
    ap.add_argument("--only", help="逗號分隔：fubon,wantgoo,twse")
    ap.add_argument("--date", help="YYYY-MM-DD，預設今天（台北時間）")
    ap.add_argument("--force", action="store_true", help="週末或全部失敗也寫檔")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args(argv)

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    cfg = load_config(Path(args.config))
    target = date.fromisoformat(args.date) if args.date else today_tw()

    if target.weekday() >= 5 and not args.force:
        log.info("%s 是週末，略過。", target)
        return 0

    only = set(args.only.split(",")) if args.only else None
    boards = run(cfg, only, target)
    ok = [b for b in boards if b.status == "ok"]
    if not ok and not args.force:
        log.error("所有來源都沒有資料，不覆寫既有檔案。")
        return 2

    day = decide_day(boards, target)
    write_day(boards, day, cfg, ROOT)
    log.info("完成：%s，成功 %d / %d", day, len(ok), len(boards))
    return 0


if __name__ == "__main__":
    sys.exit(main())
