from pathlib import Path

from scraper.sources import fubon, twse, wantgoo
from scraper.utils import to_num

FIX = Path(__file__).parent / "fixtures"


def test_to_num():
    assert to_num("1,234") == 1234
    assert to_num("-5,678") == -5678
    assert to_num("▼0.5") == -0.5
    assert to_num("--") is None


def test_fubon_parse():
    html = (FIX / "fubon_sample.html").read_text(encoding="utf-8")
    buy, sell, d = fubon.parse(html)
    assert [r.code for r in buy] == ["2887", "2883"]
    assert [r.code for r in sell] == ["2330", "2891"]
    assert sell[1].name == "中信金"
    assert buy[0].net == 29635 and sell[0].net == -8629
    assert sell[0].close == 1805.0 and sell[0].change == -15.0
    assert d and d.endswith("-10-08")


def test_wantgoo_json_mapping():
    payload = {"data": [
        {"stockNo": "3481", "stockName": "群創", "netBuySell": 117996, "close": 20.1},
        {"stockNo": "00981A", "stockName": "主動統一台股增長", "netBuySell": -70375, "close": 12.3},
        {"stockNo": "2409", "stockName": "友達", "netBuySell": 90691, "close": 15.0},
    ]}
    buy, sell = wantgoo.rows_from_json([payload], 50)
    assert [r.code for r in buy] == ["3481", "2409"]
    assert sell[0].code == "00981A" and sell[0].rank == 1


def test_twse_rank():
    js = {"stat": "OK", "date": "20261008",
          "fields": ["證券代號", "證券名稱", "外陸資買賣超股數(不含外資自營商)", "投信買賣超股數", "自營商買賣超股數", "三大法人買賣超股數"],
          "data": [["2330", "台積電", "-8,629,000", "120,000", "0", "-8,509,000"],
                   ["3481", "群創", "97,480,000", "0", "1,000", "97,481,000"]]}
    buy, sell, d = twse.rank(js, "foreign", 50)
    assert buy[0].code == "3481" and buy[0].net == 97480
    assert sell[0].net == -8629 and d == "2026-10-08"


def test_fubon_major_header_mapping():
    html = (FIX / "fubon_major_sample.html").read_text(encoding="utf-8")
    buy, sell, d = fubon.parse(html)
    assert buy == []
    assert [r.code for r in sell] == ["00406A", "2330"]
    assert sell[0].net == -138617 and sell[0].close == 10.16
    assert sell[0].buy == 39014 and sell[0].sell == 177632 and sell[0].change_pct == -0.78
    assert sell[1].name == "台積電" and sell[1].close == 2550


def test_fubon_small_net_not_mistaken_for_stock():
    """超張數 ≤ 999 時，後面的價格（1062.5）不能被誤判成「代號+名稱」。"""
    html = (FIX / "fubon_small_net.html").read_text(encoding="utf-8")
    buy, sell, _ = fubon.parse(html)
    assert [(r.code, r.net, r.close) for r in buy] == [("2330", 792, 1062.5)]
    assert [(r.code, r.net) for r in sell] == [("2059", -251)]
