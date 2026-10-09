/* 法人籌碼排行 — 前端
 * 讀取 data/index.json → data/YYYY/YYYY-MM-DD.json，純靜態，可放任何靜態主機。
 * 狀態寫進網址 hash，方便分享與加入書籤。
 */
(() => {
  "use strict";

  const CAT_ORDER = ["foreign", "trust", "dealer", "institution", "major"];
  const CAT_NAME = { foreign: "外資", trust: "投信", dealer: "自營商", institution: "三大法人", major: "主力" };
  const MKT_ORDER = ["twse", "tpex"];
  const MKT_NAME = { twse: "上市", tpex: "上櫃" };
  const SRC_ORDER = ["fubon", "wantgoo", "twse"];
  const STREAK_DAYS = 5;
  const WEEK = "日一二三四五六";

  const $ = (id) => document.getElementById(id);
  const cache = new Map();
  const state = { dates: [], date: null, cat: "foreign", mkt: "twse", src: null, side: "buy", q: "" };
  let day = null;

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
    ["date", "cat", "mkt", "src", "side"].forEach((k) => { if (h.get(k)) state[k] = h.get(k); });
  }
  function writeHash() {
    const h = new URLSearchParams({ date: state.date, cat: state.cat, mkt: state.mkt, src: state.src || "", side: state.side });
    history.replaceState(null, "", "#" + h.toString());
  }

  /* ---------- 格式 ---------- */
  const fmt = (n, d = 0) => n == null ? "—" : Number(n).toLocaleString("zh-TW", { minimumFractionDigits: d, maximumFractionDigits: d });
  const signCls = (n) => (n > 0 ? "up" : n < 0 ? "down" : "flat");
  const signed = (n, d = 0) => (n > 0 ? "+" : "") + fmt(n, d);
  const dateLabel = (d) => { const [y, m, dd] = d.split("-").map(Number); return `${d.replace(/-/g, "/")}（${WEEK[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()]}）`; };
  const matchQ = (r, q) => r.code.toUpperCase().includes(q.toUpperCase()) || r.name.includes(q);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

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
    if (!inSrc.some((b) => b.category === state.cat)) state.cat = (CAT_ORDER.find((c) => inSrc.some((b) => b.category === c))) || state.cat;
    $("catTabs").innerHTML = CAT_ORDER.filter((c) => has((b) => b.category === c)).map((c) => {
      const ok = inSrc.some((b) => b.category === c);
      return `<button role="tab" data-cat="${c}" aria-selected="${c === state.cat}" ${ok ? "" : "disabled"}>${CAT_NAME[c]}</button>`;
    }).join("");

    // 市場
    const inCat = inSrc.filter((b) => b.category === state.cat);
    if (!inCat.some((b) => b.market === state.mkt)) state.mkt = (MKT_ORDER.find((m) => inCat.some((b) => b.market === m))) || state.mkt;
    $("mktSeg").innerHTML = MKT_ORDER.map((m) => {
      const ok = inCat.some((b) => b.market === m);
      return `<button role="radio" data-mkt="${m}" aria-checked="${m === state.mkt}" ${ok ? "" : "disabled"}>${MKT_NAME[m]}</button>`;
    }).join("");

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
      const hit = state.q && matchQ(r, state.q);
      const px = r.close != null
        ? `<span class="px"><span>${fmt(r.close, 2)}</span><span class="chg ${signCls(r.change)}">${r.change != null ? signed(r.change, 2) : ""}</span></span>`
        : `<span class="px"></span>`;
      return `<li class="row${hit ? " hit" : ""}" style="--w:${w}%">
        <span class="rk${r.rank <= 3 ? " rk-top" : ""}">${r.rank}</span>
        <span class="nm"><a href="https://www.wantgoo.com/stock/${encodeURIComponent(r.code)}" target="_blank" rel="noopener">${esc(r.name)}</a><span class="cd">${esc(r.code)}</span>${s ? `<span class="streak" title="連續 ${s} 個交易日上榜">連${s}日</span>` : ""}</span>
        ${px}
        <span class="net ${side === "buy" ? "up" : "down"}">${signed(r.net)}</span>
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
    const b = pickBoard(day, state.src, state.cat, state.mkt);
    const demo = day && day.demo ? "目前顯示的是<b>示範資料</b>，執行一次爬蟲後會換成真實資料。" : "";

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
      setNotice(demo);
    }

    const q = state.q;
    const filt = (rows) => (q ? rows.filter((r) => matchQ(r, q)) : rows);
    const buy = filt(b.buy), sell = filt(b.sell);
    const max = Math.max(1, ...b.buy.map((r) => Math.abs(r.net)), ...b.sell.map((r) => Math.abs(r.net)));
    const sumB = b.buy.reduce((s, r) => s + r.net, 0);
    const sumS = b.sell.reduce((s, r) => s + r.net, 0);

    $("subline").textContent = `${MKT_NAME[b.market] || b.market_name}${CAT_NAME[b.category] || b.category_name}｜資料日 ${b.data_date || day.date}`;
    $("tally").innerHTML = `前 ${b.buy.length} 名買超合計 <b class="up">${signed(sumB)}</b> 張，前 ${b.sell.length} 名賣超合計 <b class="down">${signed(sumS)}</b> 張`;
    $("sourceLink").innerHTML = b.url ? `來源：<a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.source_name)}</a>，更新於 ${esc((day.generated_at || "").replace("T", " ").slice(0, 16))}` : "";

    const empty = new Map();
    $("buyList").innerHTML = rowsHTML(buy, "buy", max, empty);
    $("sellList").innerHTML = rowsHTML(sell, "sell", max, empty);

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
    if (e.target.matches("input, select")) return;
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
    loadDay(state.dates.includes(state.date) ? state.date : state.dates[0]);
  })();
})();
