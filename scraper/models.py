"""統一資料模型：所有來源最後都轉成 Board / RankRow。"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Optional


@dataclass
class RankRow:
    rank: int
    code: str
    name: str
    net: float                       # 買賣超張數（買超為正、賣超為負）
    close: Optional[float] = None    # 收盤價
    change: Optional[float] = None   # 漲跌（元）
    change_pct: Optional[float] = None
    buy: Optional[float] = None      # 買進張數（有提供才填）
    sell: Optional[float] = None     # 賣出張數

    def to_dict(self) -> dict:
        return {k: v for k, v in asdict(self).items() if v is not None}


@dataclass
class Board:
    source: str
    source_name: str
    category: str
    category_name: str
    market: str
    market_name: str
    url: str = ""
    data_date: Optional[str] = None  # 來源頁面自己標示的資料日期（YYYY-MM-DD）
    buy: list[RankRow] = field(default_factory=list)
    sell: list[RankRow] = field(default_factory=list)
    status: str = "ok"               # ok / empty / error
    error: Optional[str] = None

    @property
    def id(self) -> str:
        return f"{self.source}-{self.category}-{self.market}"

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "source": self.source,
            "source_name": self.source_name,
            "category": self.category,
            "category_name": self.category_name,
            "market": self.market,
            "market_name": self.market_name,
            "url": self.url,
            "data_date": self.data_date,
            "status": self.status,
            "error": self.error,
            "buy": [r.to_dict() for r in self.buy],
            "sell": [r.to_dict() for r in self.sell],
        }
