/* 法人籌碼排行 — 前端
 * 讀取 data/index.json → data/YYYY/YYYY-MM-DD.json，純靜態，可放任何靜態主機。
 * 狀態寫進網址 hash，方便分享與加入書籤。
 */
(() => {
  "use strict";

  const CAT_ORDER = ["foreign", "trust", "dealer", "institution", "major"];
  const CAT_NAME = { foreign: "外資", trust: "投信", dealer: "自營商", institution: "三大法人", major: "主力", combo: "綜合分析" };
  const COMBO_CATS = ["foreign", "trust", "dealer", "major"];
  const MKT_ORDER = ["twse", "tpex"];
  const MKT_NAME = { twse: "上市", tpex: "上櫃" };
  const SRC_ORDER = ["fubon", "wantgoo", "twse"];
  const STREAK_DAYS = 5;
  const WEEK = "日一二三四五六";

  const $ = (id) => document.getElementById(id);
  const cache = new Map();
  const state = { dates: [], date: null, cat: "foreign", mkt: "twse", src: null, side: "buy", q: "", cf: "all", cs: "score", etf: "1",
                  mode: "day", from: null, to: null, preset: null };
  let day = null;             // 單日：當日 JSON；區間：彙總後的虛擬「日」物件（結構相同）

  /* ---------- 主題 ---------- */
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    $("themeLabel").textContent = t === "dark" ? "淺色" : "深色";
    try { localStorage.setItem("theme", t); } catch (e) { /* 無痕模式可能不能存 */ }
  }
  $("themeBtn").addEventListener("click", () =>
    applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark"));
  applyTheme(document.documentElement.getAttribute("data-theme") || "light");

  /* ---------- 資料 ---------- */
  async function getJSON(url) {
    if (cache.has(url)) return cache.get(url);
    const p = fetch(url, { cache: "no-cache" }).then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return r.json();
    });
    cache.set(url, p);
    p.catch(() => cache.delete(url));
    return p;
  }
  const dayUrl = (d) => `data/${d.slice(0, 4)}/${d}.json`;

  /* ---------- 網址 hash ---------- */
  function readHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    ["date", "cat", "mkt", "src", "side", "mode", "from", "to", "cf", "cs", "etf"].forEach((k) => { if (h.get(k)) state[k] = h.get(k); });
    if (state.mode !== "range") state.mode = "day";
  }
  function writeHash() {
    const o = { cat: state.cat, mkt: state.mkt, src: state.src || "", side: state.side };
    if (state.cat === "combo") Object.assign(o, { cf: state.cf, cs: state.cs, etf: state.etf });
    if (state.mode === "range") Object.assign(o, { mode: "range", from: state.from, to: state.to });
    else o.date = state.date;
    const h = new URLSearchParams(o);
    history.replaceState(null, "", "#" + h.toString());
  }

  /* ---------- 格式 ---------- */
  const fmt = (n, d = 0) => n == null ? "—" : Number(n).toLocaleString("zh-TW", { minimumFractionDigits: d, maximumFractionDigits: d });
  const signCls = (n) => (n > 0 ? "up" : n < 0 ? "down" : "flat");
  const signed = (n, d = 0) => (n > 0 ? "+" : "") + fmt(n, d);
  const dateLabel = (d) => { const [y, m, dd] = d.split("-").map(Number); return `${d.replace(/-/g, "/")}（${WEEK[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()]}）`; };
  const matchQ = (r, q) => r.code.toUpperCase().includes(q.toUpperCase()) || r.name.includes(q);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- 區間彙總 ---------- */
  // 注意：每日檔只保存買、賣超各前 N 名，區間合計＝各日「有上榜」的買賣超相加，
  // 沒進前 N 名的那幾天無法計入，因此是近似值（大額進出的股票通常很接近實際）。
  const rangeDates = () => state.dates.filter((d) => d >= state.from && d <= state.to);

  function aggregate(days, dates) {
    const boards = new Map();
    days.forEach((d, i) => {
      if (!d) return;
      boardsOf(d).forEach((b) => {
        const key = `${b.source}|${b.category}|${b.market}`;
        let a = boards.get(key);
        if (!a) {
          a = { id: b.id, source: b.source, source_name: b.source_name, category: b.category, category_name: b.category_name,
                market: b.market, market_name: b.market_name, url: "", status: "empty", error: "區間內每天都沒有抓到這份排行",
                okDays: 0, stocks: new Map() };
          boards.set(key, a);
        }
        if (b.status !== "ok") return;
        a.status = "ok"; a.error = null; a.okDays++;
        [...b.buy, ...b.sell].forEach((r) => {
          let s = a.stocks.get(r.code);
          if (!s) { s = { code: r.code, name: r.name, net: 0, days: 0, seen: new Set(), close: null, change: null, closeDate: "" }; a.stocks.set(r.code, s); }
          s.net += r.net;
          s.seen.add(dates[i]);                 // 以日期去重，同一天不重複計算上榜天數
          s.days = s.seen.size;
          if (r.close != null && dates[i] >= s.closeDate) { s.close = r.close; s.closeDate = dates[i]; s.name = r.name || s.name; }
        });
      });
    });
    const N = 50;
    const out = [...boards.values()].map((a) => {
      const all = [...a.stocks.values()];
      const buy = all.filter((x) => x.net > 0).sort((x, y) => y.net - x.net).slice(0, N);
      const sell = all.filter((x) => x.net < 0).sort((x, y) => x.net - y.net).slice(0, N);
      buy.forEach((x, i) => { x.rank = i + 1; });
      sell.forEach((x, i) => { x.rank = i + 1; });
      delete a.stocks;
      return Object.assign(a, { buy, sell });
    });
    const okDates = dates.filter((_, i) => days[i]);
    return { date: state.to, range: true, dates: okDates, demo: days.some((d) => d && d.demo),
             generated_at: (days.find(Boolean) || {}).generated_at, boards: out };
  }

  async function loadRange() {
    const dates = rangeDates();
    setNotice(`讀取 ${dates.length} 個交易日的資料中…`);
    const token = `${state.from}|${state.to}`;
    loadRange.token = token;
    const days = await Promise.all(dates.map((d) => getJSON(dayUrl(d)).catch(() => null)));
    if (loadRange.token !== token) return;
    day = aggregate(days, dates);
    renderBoard();
  }

  function setRange(from, to, preset = null) {
    if (from > to) [from, to] = [to, from];
    state.from = from; state.to = to; state.preset = preset;
    loadRange();
  }
  function applyPreset(n) {
    const end = state.dates[0];
    const start = n > 0 ? state.dates[Math.min(n, state.dates.length) - 1] : state.dates[state.dates.length - 1];
    setRange(start, end, String(n));
  }

  function setMode(m) {
    if (m === state.mode) return;
    state.mode = m;
    if (m === "range") {
      if (!state.from || !state.to) applyPreset(5); else loadRange();
    } else {
      loadDay(state.dates.includes(state.date) ? state.date : state.dates[0]);
    }
  }

  /* ---------- 篩選控制項 ---------- */
  function boardsOf(d) { return (d && d.boards) || []; }
  function pickBoard(d, src, cat, mkt) {
    return boardsOf(d).find((b) => b.source === src && b.category === cat && b.market === mkt);
  }

  function renderControls() {
    const boards = boardsOf(day);
    const has = (fn) => boards.some(fn);

    // 來源
    const srcs = SRC_ORDER.filter((s) => has((b) => b.source === s));
    boards.forEach((b) => { if (!srcs.includes(b.source)) srcs.push(b.source); });
    if (!srcs.includes(state.src)) state.src = srcs.find((s) => pickBoard(day, s, state.cat, state.mkt)) || srcs[0] || null;
    $("srcSelect").innerHTML = srcs.map((s) => {
      const name = (boards.find((b) => b.source === s) || {}).source_name || s;
      return `<option value="${s}" ${s === state.src ? "selected" : ""}>${esc(name)}</option>`;
    }).join("");

    // 類別
    const inSrc = boards.filter((b) => b.source === state.src);
    const comboOk = COMBO_CATS.filter((c) => inSrc.some((b) => b.category === c)).length >= 2;
    const catOk = (c) => (c === "combo" ? comboOk : inSrc.some((b) => b.category === c));
    if (!catOk(state.cat)) state.cat = (CAT_ORDER.find((c) => inSrc.some((b) => b.category === c))) || state.cat;
    const tabs = CAT_ORDER.filter((c) => has((b) => b.category === c));
    if (has((b) => COMBO_CATS.includes(b.category))) tabs.push("combo");
    $("catTabs").innerHTML = tabs.map((c) =>
      `<button role="tab" data-cat="${c}" aria-selected="${c === state.cat}" ${catOk(c) ? "" : "disabled"}${c === "combo" ? ' class="tab-combo"' : ""}>${CAT_NAME[c]}</button>`
    ).join("");

    // 市場
    const inCat = inSrc.filter((b) => (state.cat === "combo" ? COMBO_CATS.includes(b.category) : b.category === state.cat));
    if (!inCat.some((b) => b.market === state.mkt)) state.mkt = (MKT_ORDER.find((m) => inCat.some((b) => b.market === m))) || state.mkt;
    $("mktSeg").innerHTML = MKT_ORDER.map((m) => {
      const ok = inCat.some((b) => b.market === m);
      return `<button role="radio" data-mkt="${m}" aria-checked="${m === state.mkt}" ${ok ? "" : "disabled"}>${MKT_NAME[m]}</button>`;
    }).join("");

    // 單日 / 區間切換
    const range = state.mode === "range";
    $("modeSeg").querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", b.dataset.mode === state.mode));
    $("daySingle").hidden = range;
    $("dayRange").hidden = !range;
    $("presets").hidden = !range;
    if (range) {
      const opt = (sel) => state.dates.map((d) => `<option value="${d}" ${d === sel ? "selected" : ""}>${dateLabel(d)}</option>`).join("");
      $("fromSelect").innerHTML = opt(state.from);
      $("toSelect").innerHTML = opt(state.to);
      $("presets").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.n === state.preset));
    }

    // 日期
    const i = state.dates.indexOf(state.date);
    $("dateSelect").innerHTML = state.dates.map((d) => `<option value="${d}" ${d === state.date ? "selected" : ""}>${dateLabel(d)}</option>`).join("");
    $("prevDay").disabled = i < 0 || i >= state.dates.length - 1;
    $("nextDay").disabled = i <= 0;

    // 手機買/賣切換
    $("sideSwitch").querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", b.dataset.side === state.side));
    $("board").dataset.side = state.side;
  }

  /* ---------- 連續上榜天數 ---------- */
  async function streaks(board) {
    const idx = state.dates.indexOf(state.date);
    const prev = state.dates.slice(idx + 1, idx + STREAK_DAYS);
    const days = await Promise.all(prev.map((d) => getJSON(dayUrl(d)).catch(() => null)));
    const out = { buy: new Map(), sell: new Map() };
    ["buy", "sell"].forEach((side) => {
      board[side].forEach((r) => {
        let n = 1;
        for (const d of days) {
          const b = d && pickBoard(d, board.source, board.category, board.market);
          if (b && b[side].some((x) => x.code === r.code)) n++; else break;
        }
        if (n >= 2) out[side].set(r.code, n);
      });
    });
    return out;
  }

  /* ---------- 排行列 ---------- */
  function rowsHTML(rows, side, max, streak) {
    if (!rows.length) return `<li class="empty">${state.q ? "沒有符合搜尋的股票" : "這一邊沒有資料"}</li>`;
    return rows.map((r) => {
      const w = max ? Math.max(4, Math.round((Math.abs(r.net) / max) * 100)) : 0;
      const s = streak.get(r.code);
      const total = state.mode === "range" && day ? day.dates.length : 0;
      const badge = total
        ? `<span class="days-badge${r.days === total ? " full" : ""}" title="區間 ${total} 個交易日中有 ${r.days} 日上榜">${r.days}/${total}日</span>`
        : (s ? `<span class="streak" title="連續 ${s} 個交易日上榜">連${s}日</span>` : "");
      const hit = state.q && matchQ(r, state.q);
      const chg = r.change != null ? `<span class="chg ${signCls(r.change)}">${signed(r.change, 2)}</span>` : `<span class="chg flat">—</span>`;
      return `<li class="row${hit ? " hit" : ""}" style="--w:${w}%">
        <span class="rk${r.rank <= 3 ? " rk-top" : ""}">${r.rank}</span>
        <span class="cd">${esc(r.code)}</span>
        <span class="nm"><a href="https://www.wantgoo.com/stock/${encodeURIComponent(r.code)}" target="_blank" rel="noopener">${esc(r.name)}</a>${badge}</span>
        <span class="net ${side === "buy" ? "up" : "down"}">${signed(r.net)}</span>
        <span class="px">${r.close != null ? fmt(r.close, 2) : "—"}</span>
        ${chg}
      </li>`;
    }).join("");
  }

  function setNotice(html, err) {
    const n = $("notice");
    n.hidden = !html;
    n.className = "notice" + (err ? " err" : "");
    n.innerHTML = html || "";
  }

  async function renderBoard() {
    renderControls();
    writeHash();
    const isCombo = state.cat === "combo";
    $("combo").hidden = !isCombo;
    $("board").hidden = isCombo;
    $("sideSwitch").style.display = isCombo ? "none" : "";
    if (isCombo) return renderCombo();
    const b = pickBoard(day, state.src, state.cat, state.mkt);
    const range = state.mode === "range";
    const demo = day && day.demo ? "目前顯示的是<b>示範資料</b>，執行一次爬蟲後會換成真實資料。" : "";
    const rangeNote = range && day
      ? `區間合計為各交易日「前 50 名」買賣超相加的<b>近似值</b>：某天沒進前 50 名就不會被計入。徽章「3/5日」表示區間 5 個交易日中有 3 天上榜。`
      : "";

    if (!day) {
      $("buyList").innerHTML = $("sellList").innerHTML = "";
      $("tally").textContent = "";
      return;                                   // loadDay 已顯示錯誤訊息
    }
    if (!b) {
      setNotice(demo || "這個組合沒有資料，請換一個來源或類別。");
      $("buyList").innerHTML = $("sellList").innerHTML = "";
      $("tally").textContent = "";
      return;
    }
    if (b.status !== "ok") {
      setNotice(`${esc(b.source_name)}這一份沒有抓到：${esc(b.error || b.status)}。可以切換其他來源查看。`, true);
    } else {
      setNotice([demo, rangeNote].filter(Boolean).join("<br>"));
    }

    const q = state.q;
    const filt = (rows) => (q ? rows.filter((r) => matchQ(r, q)) : rows);
    const buy = filt(b.buy), sell = filt(b.sell);
    const max = Math.max(1, ...b.buy.map((r) => Math.abs(r.net)), ...b.sell.map((r) => Math.abs(r.net)));
    const sumB = b.buy.reduce((s, r) => s + r.net, 0);
    const sumS = b.sell.reduce((s, r) => s + r.net, 0);

    document.querySelectorAll(".thead .h-net").forEach((el) => { el.textContent = range ? "累計超張數" : "超張數"; });
    document.querySelectorAll(".thead .h-px").forEach((el) => { el.textContent = range ? "最新收盤" : "收盤價"; });
    const label = `${MKT_NAME[b.market] || b.market_name}${CAT_NAME[b.category] || b.category_name}`;
    if (range) {
      const span = `${state.from.replace(/-/g, "/")}～${state.to.replace(/-/g, "/")}`;
      $("subline").textContent = `${label}｜區間 ${span}`;
      $("tally").innerHTML = `${span} 共 ${day.dates.length} 個交易日（此排行有資料 ${b.okDays} 日）｜前 ${b.buy.length} 名累計買超 <b class="up">${signed(sumB)}</b> 張，前 ${b.sell.length} 名累計賣超 <b class="down">${signed(sumS)}</b> 張`;
    } else {
      $("subline").textContent = `${label}｜資料日 ${b.data_date || day.date}`;
      $("tally").innerHTML = `前 ${b.buy.length} 名買超合計 <b class="up">${signed(sumB)}</b> 張，前 ${b.sell.length} 名賣超合計 <b class="down">${signed(sumS)}</b> 張`;
    }
    $("sourceLink").innerHTML = b.url ? `來源：<a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.source_name)}</a>，更新於 ${esc((day.generated_at || "").replace("T", " ").slice(0, 16))}` : "";

    const empty = new Map();
    $("buyList").innerHTML = rowsHTML(buy, "buy", max, empty);
    $("sellList").innerHTML = rowsHTML(sell, "sell", max, empty);

    if (range) return;
    // 連續上榜徽章非同步補上，不擋主畫面
    const token = `${state.date}|${b.id}|${q}`;
    renderBoard.token = token;
    const st = await streaks(b);
    if (renderBoard.token !== token) return;
    $("buyList").innerHTML = rowsHTML(buy, "buy", max, st.buy);
    $("sellList").innerHTML = rowsHTML(sell, "sell", max, st.sell);
  }

  async function loadDay(d) {
    state.date = d;
    try {
      day = await getJSON(dayUrl(d));
    } catch (e) {
      day = null;
      setNotice(`讀不到 ${d} 的資料檔。`, true);
    }
    renderBoard();
  }

  /* ---------- 綜合分析：外資／投信／自營商／主力交叉比對 ---------- */
  const COMBO_FILTERS = {
    all: () => true,
    buy2: (x) => x.score >= 2,
    sell2: (x) => x.score <= -2,
    tybuy: (x) => x.v.foreign > 0 && x.v.trust > 0,
    tysell: (x) => x.v.foreign < 0 && x.v.trust < 0,
    imbuy: (x) => x.inst > 0 && x.v.major > 0,
    imsell: (x) => x.inst < 0 && x.v.major < 0,
    fight: (x) => x.v.foreign != null && x.v.trust != null && Math.sign(x.v.foreign) !== Math.sign(x.v.trust),
  };

  function comboRows() {
    const stocks = new Map();
    const present = [];
    COMBO_CATS.forEach((cat) => {
      const b = pickBoard(day, state.src, cat, state.mkt);
      if (!b || b.status !== "ok") return;
      present.push(cat);
      [...b.buy, ...b.sell].forEach((r) => {
        let x = stocks.get(r.code);
        if (!x) { x = { code: r.code, name: r.name, close: null, change: null, v: {} }; stocks.set(r.code, x); }
        x.v[cat] = (x.v[cat] || 0) + r.net;
        if (x.close == null && r.close != null) { x.close = r.close; x.change = r.change ?? null; }
      });
    });
    const rows = [...stocks.values()].map((x) => {
      const insts = ["foreign", "trust", "dealer"].filter((c) => x.v[c] != null);
      x.inst = insts.length ? insts.reduce((t, c) => t + x.v[c], 0) : null;
      const vals = present.map((c) => x.v[c]).filter((n) => n != null);
      x.score = vals.filter((n) => n > 0).length - vals.filter((n) => n < 0).length;
      x.tags = comboTags(x, present);
      return x;
    });
    return { rows, present };
  }

  function comboTags(x, present) {
    const v = x.v, t = [];
    const all = (fn) => present.length >= 3 && present.every((c) => v[c] != null && fn(v[c]));
    if (all((n) => n > 0)) t.push(["up", present.includes("major") ? "四方同買" : "三法人同買"]);
    else if (all((n) => n < 0)) t.push(["down", present.includes("major") ? "四方同賣" : "三法人同賣"]);
    if (v.foreign > 0 && v.trust > 0) t.push(["up", "土洋同買"]);
    if (v.foreign < 0 && v.trust < 0) t.push(["down", "土洋同賣"]);
    if (x.inst > 0 && v.major > 0) t.push(["up", "法人＋主力"]);
    if (x.inst < 0 && v.major < 0) t.push(["down", "法人＋主力賣"]);
    if (COMBO_FILTERS.fight(x)) t.push(["mid", v.trust > 0 ? "投信買外資賣" : "外資買投信賣"]);
    if (v.major != null && x.inst != null && Math.sign(v.major) !== Math.sign(x.inst)) t.push(["mid", v.major > 0 ? "主力買法人賣" : "法人買主力賣"]);
    return t;
  }

  function renderCombo() {
    const range = state.mode === "range";
    if (!day) { $("comboBody").innerHTML = ""; $("tally").textContent = ""; return; }
    const isEtf = (x) => /^00/.test(x.code);
    const { rows: allRows, present } = comboRows();
    const rows = state.etf === "1" ? allRows.filter((x) => !isEtf(x)) : allRows;
    $("etfToggle").setAttribute("aria-pressed", state.etf === "1");
    const counts = Object.fromEntries(Object.entries(COMBO_FILTERS).map(([k, f]) => [k, rows.filter(f).length]));
    $("comboFilter").querySelectorAll("button").forEach((b) => {
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", b.dataset.f === state.cf);
      const base = b.dataset.label || (b.dataset.label = b.textContent);
      b.innerHTML = `${base}<span class="n">${counts[b.dataset.f]}</span>`;
    });
    $("comboSort").value = state.cs;

    const key = state.cs;
    const val = (x) => (key === "score" ? x.score : key === "inst" ? x.inst : x.v[key]);
    let list = rows.filter(COMBO_FILTERS[state.cf] || COMBO_FILTERS.all);
    if (state.q) list = list.filter((x) => matchQ(x, state.q));
    const strength = (x) => Math.abs(x.inst || 0) + Math.abs(x.v.major || 0);
    // 賣方篩選時把最負的排前面，其餘由大到小
    const desc = !["sell2", "tysell", "imsell"].includes(state.cf);
    list.sort((a, b) => {
      const va = val(a), vb = val(b);
      if (va == null && vb == null) return strength(b) - strength(a);
      if (va == null) return 1;
      if (vb == null) return -1;
      if (va !== vb) return desc ? vb - va : va - vb;
      return strength(b) - strength(a);
    });
    const shown = list.slice(0, 150);

    const cell = (n) => (n == null ? `<td class="c-num na">—</td>` : `<td class="c-num ${signCls(n)}">${signed(n)}</td>`);
    $("comboBody").innerHTML = shown.length ? shown.map((x, i) => {
      const sc = x.score > 0 ? "up" : x.score < 0 ? "down" : "flat";
      return `<tr>
        <td class="c-rk">${i + 1}</td>
        <td class="c-cd">${esc(x.code)}</td>
        <td class="c-nm"><a href="https://www.wantgoo.com/stock/${encodeURIComponent(x.code)}" target="_blank" rel="noopener">${esc(x.name)}</a></td>
        ${cell(x.v.foreign)}${cell(x.v.trust)}${cell(x.v.dealer)}
        ${x.inst == null ? `<td class="c-num c-inst na">—</td>` : `<td class="c-num c-inst ${signCls(x.inst)}">${signed(x.inst)}</td>`}
        ${cell(x.v.major)}
        <td class="c-num">${x.close != null ? fmt(x.close, 2) : "—"}</td>
        <td class="c-num ${signCls(x.change)}">${x.change != null ? signed(x.change, 2) : "—"}</td>
        <td class="c-sig"><span class="score ${sc}" title="買方數減賣方數">${x.score > 0 ? "+" : ""}${x.score}</span>${x.tags.map(([c, t]) => `<span class="sig ${c}">${t}</span>`).join("")}</td>
      </tr>`;
    }).join("") : `<tr><td colspan="11" class="empty">沒有符合條件的股票</td></tr>`;

    const mk = MKT_NAME[state.mkt] || "";
    const span = range ? `區間 ${state.from.replace(/-/g, "/")}～${state.to.replace(/-/g, "/")}` : `資料日 ${day.date}`;
    $("subline").textContent = `${mk}綜合分析｜${span}`;
    const missing = COMBO_CATS.filter((c) => !present.includes(c)).map((c) => CAT_NAME[c]);
    $("tally").innerHTML = `比對 ${present.map((c) => CAT_NAME[c]).join("、")} 共 ${rows.length} 檔${state.etf === "1" ? `（已排除 ETF ${allRows.length - rows.length} 檔）` : ""}，符合條件 ${list.length} 檔` +
      (list.length > shown.length ? `（顯示前 ${shown.length} 檔）` : "") + (missing.length ? `｜${missing.join("、")}這次沒有資料` : "");
    $("sourceLink").innerHTML = "";
    const demo = day.demo ? "目前顯示的是<b>示範資料</b>。<br>" : "";
    setNotice(`${demo}綜合分析把同一來源的外資、投信、自營商、主力排行依股票代碼對齊。每份排行只有買、賣超各前 50 名，` +
      `「—」代表沒進那份排行，<b>不等於 0</b>；三大法人＝已知的外資＋投信＋自營商相加。共振分數＝買超方數 − 賣超方數（-4～+4）。` +
      (range ? "區間模式下各欄為區間累計的近似值。" : ""));
  }

  /* ---------- 事件 ---------- */
  $("catTabs").addEventListener("click", (e) => {
    const c = e.target.closest("button[data-cat]");
    if (c && !c.disabled) { state.cat = c.dataset.cat; renderBoard(); }
  });
  $("mktSeg").addEventListener("click", (e) => {
    const m = e.target.closest("button[data-mkt]");
    if (m && !m.disabled) { state.mkt = m.dataset.mkt; renderBoard(); }
  });
  $("srcSelect").addEventListener("change", (e) => { state.src = e.target.value; renderBoard(); });
  $("dateSelect").addEventListener("change", (e) => loadDay(e.target.value));
  $("comboFilter").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-f]");
    if (b) { state.cf = b.dataset.f; renderBoard(); }
  });
  $("etfToggle").addEventListener("click", () => { state.etf = state.etf === "1" ? "0" : "1"; renderBoard(); });
  $("comboSort").addEventListener("change", (e) => { state.cs = e.target.value; renderBoard(); });
  $("modeSeg").addEventListener("click", (e) => {
    const m = e.target.closest("button[data-mode]");
    if (m) setMode(m.dataset.mode);
  });
  $("fromSelect").addEventListener("change", (e) => setRange(e.target.value, state.to));
  $("toSelect").addEventListener("change", (e) => setRange(state.from, e.target.value));
  $("presets").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-n]");
    if (b && !b.disabled) applyPreset(Number(b.dataset.n));
  });
  $("prevDay").addEventListener("click", () => {
    const i = state.dates.indexOf(state.date);
    if (i < state.dates.length - 1) loadDay(state.dates[i + 1]);
  });
  $("nextDay").addEventListener("click", () => {
    const i = state.dates.indexOf(state.date);
    if (i > 0) loadDay(state.dates[i - 1]);
  });
  $("sideSwitch").addEventListener("click", (e) => {
    const s = e.target.closest("button[data-side]");
    if (s) { state.side = s.dataset.side; renderControls(); writeHash(); }
  });
  let t;
  $("search").addEventListener("input", (e) => {
    clearTimeout(t);
    t = setTimeout(() => { state.q = e.target.value.trim(); renderBoard(); }, 150);
  });
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, select") || state.mode === "range") return;
    if (e.key === "ArrowLeft") $("prevDay").click();
    if (e.key === "ArrowRight") $("nextDay").click();
  });

  /* ---------- 啟動 ---------- */
  (async function init() {
    readHash();
    try {
      const idx = await getJSON("data/index.json");
      state.dates = idx.dates || [];
    } catch (e) {
      setNotice("找不到 data/index.json。請先執行 <code>python -m scraper.main</code>，或用本機伺服器開啟（不要直接雙擊 HTML）。", true);
      return;
    }
    if (!state.dates.length) { setNotice("還沒有任何資料，請先執行一次爬蟲。"); return; }
    if (state.mode === "range") {
      const ok = state.dates.includes(state.from) && state.dates.includes(state.to);
      if (ok) setRange(state.from, state.to); else applyPreset(5);
      state.date = state.dates[0];
    } else {
      loadDay(state.dates.includes(state.date) ? state.date : state.dates[0]);
    }
  })();
})();
