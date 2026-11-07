// 加密货币热点新闻 — 读取 data/news.json 与 data/market.json 并在客户端渲染。
// 直接用浏览器打开 index.html 时 fetch 会被 file:// 限制，
// 请用 `python3 -m http.server` 后访问，或部署到 GitHub Pages。
//
// 翻译：页面用免费的 Google 翻译小部件（translate.google.com，无需 key）。
// 动态内容处理 — 新闻是 fetch 后才渲染进 DOM 的，Google 翻译小部件
// 只会翻译当时已在 DOM 里的内容，所以：
//  1) 首批新闻渲染完成后才动态加载 element.js（见 loadGoogleTranslate），
//     用户第一次选语言时新闻已在页面上；
//  2) 每次切换分类 / 搜索重新渲染后，若已选了非中文目标语言，就把
//     小部件下拉框（.goog-te-combo）的值重设并触发 change 事件，
//     让它把新渲染的卡片再翻一遍（见 reapplyTranslation）。
// 免费小部件没有公开的“重新翻译”API，这是社区常用的变通做法，
// 不能 100% 保证每次都生效（见 README“翻译”一节的局限说明）。
(function () {
  "use strict";

  var CATEGORIES = ["行情", "市场", "政策", "项目", "DeFi"];
  var state = { items: [], updatedAt: "", category: "全部", query: "" };

  var newsEl = document.getElementById("news");
  var statusEl = document.getElementById("status");
  var emptyEl = document.getElementById("empty");
  var headlineEl = document.getElementById("headline");
  var updatedEl = document.getElementById("updated-at");
  var dateEl = document.getElementById("today-date");
  var searchEl = document.getElementById("search");
  var pulseEl = document.getElementById("market-pulse");
  var translateStarted = false;

  /* ---- Google 翻译小部件：首批新闻渲染后才加载 ---- */
  function loadGoogleTranslate() {
    if (translateStarted) return;
    translateStarted = true;
    if (typeof window.googleTranslateElementInit !== "function") return;
    var s = document.createElement("script");
    s.src = "//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit";
    s.async = true;
    s.onerror = function () {
      var note = document.getElementById("translate-note");
      if (note) note.textContent = "翻译加载失败：需访问 translate.google.com（中国大陆可能无法访问）。";
    };
    document.head.appendChild(s);
  }

  /* 当前已选的目标语言：优先读 Google 写下的 googtrans Cookie
    （格式 /zh-CN/en），读不到时读小部件下拉框的值。 */
  function currentTargetLang() {
    try {
      var m = document.cookie.match(/(?:^|;)\s*googtrans=\/[^\/]+\/([^;]+)/);
      if (m) return m[1];
    } catch (e) { /* 忽略 Cookie 读取失败 */ }
    var combo = document.querySelector(".goog-te-combo");
    return combo ? combo.value : "";
  }

  /* 重新渲染后，若已选非中文，就触发小部件下拉框的 change 事件，
     让 Google 把新渲染的卡片再翻一遍。无已选语言 / 未选非中文 /
     小部件尚未加载时什么都不做。 */
  function reapplyTranslation() {
    var lang = currentTargetLang();
    if (!lang || lang === "zh-CN") return;
    var combo = document.querySelector(".goog-te-combo");
    if (!combo) return;
    if (combo.value !== lang) combo.value = lang;
    var ev;
    try {
      ev = new Event("change", { bubbles: true });
    } catch (e) {
      ev = document.createEvent("HTMLEvents");
      ev.initEvent("change", true, false);
    }
    combo.dispatchEvent(ev);
  }

  function scheduleReapplyTranslation() {
    /* 给 Google 的 DOM 监听一点时间，再触发一次；即使它自己已翻了
       新节点，多触发一次也无害。 */
    setTimeout(reapplyTranslation, 250);
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function formatTime(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso || "";
    return d.toLocaleString("zh-CN", {
      month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
      hour12: false
    });
  }

  function formatDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    var week = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"][d.getDay()];
    return d.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" }) + " " + week;
  }

  function formatPrice(p) {
    if (p == null || isNaN(p)) return "—";
    if (p >= 1000) return "$" + p.toLocaleString("en-US", { maximumFractionDigits: 0 });
    if (p >= 1) return "$" + p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return "$" + p.toFixed(4);
  }

  function formatMcap(v) {
    if (v == null || isNaN(v)) return "—";
    return "总市值 $" + (v / 1e12).toFixed(2) + " 万亿";
  }

  function renderMarket(data) {
    if (!data || !Array.isArray(data.coins) || !data.coins.length) return;
    var fg = data.fear_greed || {};
    document.getElementById("fear-greed").textContent =
      "恐惧贪婪指数 " + (fg.value != null ? fg.value : "—") +
      (fg.classification_zh ? "（" + fg.classification_zh + "）" : "");
    document.getElementById("total-mcap").textContent = formatMcap(data.total_market_cap_usd);
    document.getElementById("btc-dom").textContent =
      "BTC 占比 " + (data.btc_dominance_pct != null ? data.btc_dominance_pct.toFixed(2) + "%" : "—");
    document.getElementById("market-updated").textContent =
      "更新于 " + (data.updated_at ? formatDate(data.updated_at) + " " + formatTime(data.updated_at) : "未知");
    var html = "";
    data.coins.forEach(function (c) {
      var chg = c.change_24h_pct;
      var cls = chg == null ? "" : (chg >= 0 ? "up" : "down");
      var chgText = chg == null ? "" : (chg >= 0 ? "+" : "") + chg.toFixed(2) + "%";
      html += '<div class="coin">' +
        '<div class="name">' + escapeHtml(c.symbol) + "<span>" + escapeHtml(c.name) + "</span></div>" +
        '<div class="price">' + escapeHtml(formatPrice(c.price_usd)) +
        '<span class="change ' + cls + '">' + escapeHtml(chgText) + "</span></div>" +
        "</div>";
    });
    document.getElementById("coins").innerHTML = html;
    pulseEl.hidden = false;
  }

  function matches(item) {
    if (state.category !== "全部" && item.category !== state.category) return false;
    if (state.query) {
      var hay = (item.title + " " + item.summary).toLowerCase();
      if (hay.indexOf(state.query) === -1) return false;
    }
    return true;
  }

  function cardHtml(item) {
    return '<article class="card">' +
      '<span class="category">' + escapeHtml(item.category) + '</span>' +
      '<h3><a href="' + escapeHtml(item.url) + '" target="_blank" rel="noopener noreferrer">' +
      escapeHtml(item.title) + "</a></h3>" +
      '<p class="summary">' + escapeHtml(item.summary) + "</p>" +
      '<p class="meta"><span>' + escapeHtml(item.source) + "</span>" +
      "<span>" + escapeHtml(formatTime(item.published_at)) + "</span></p>" +
      "</article>";
  }

  function render() {
    var filtered = state.items.filter(matches);
    var headline = null;
    if (state.category === "全部" && !state.query && filtered.length > 0) {
      headline = filtered[0];
      filtered = filtered.slice(1);
    }

    if (headline) {
      headlineEl.innerHTML =
        '<p class="kicker">头条 · ' + escapeHtml(headline.category) + "</p>" +
        '<h2><a href="' + escapeHtml(headline.url) + '" target="_blank" rel="noopener noreferrer">' +
        escapeHtml(headline.title) + "</a></h2>" +
        '<p>' + escapeHtml(headline.summary) + "</p>" +
        '<p class="meta" style="font-family:system-ui,sans-serif;font-size:12.5px;color:#6b6b6b;">' +
        escapeHtml(headline.source) + " · " + escapeHtml(formatTime(headline.published_at)) + "</p>";
      headlineEl.hidden = false;
    } else {
      headlineEl.hidden = true;
      headlineEl.innerHTML = "";
    }

    var categories = state.category === "全部" ? CATEGORIES : [state.category];
    var html = "";
    categories.forEach(function (category) {
      var list = filtered.filter(function (it) { return it.category === category; });
      if (!list.length) return;
      html += '<section class="category-section"><h2>' + escapeHtml(category) +
        " <span>" + list.length + " 条</span></h2>" +
        '<div class="cards">' + list.map(cardHtml).join("") + "</div></section>";
    });
    newsEl.innerHTML = html;
    emptyEl.hidden = filtered.length !== 0;
    statusEl.hidden = true;
    /* 分类 / 搜索切换后重新渲染了卡片，已选语言时让翻译再跑一遍。 */
    scheduleReapplyTranslation();
  }

  document.getElementById("category-tabs").addEventListener("click", function (e) {
    var btn = e.target.closest("button");
    if (!btn) return;
    state.category = btn.getAttribute("data-category");
    var buttons = document.querySelectorAll("#category-tabs button");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle("active", buttons[i] === btn);
    }
    render();
  });
  searchEl.addEventListener("input", function () {
    state.query = searchEl.value.trim().toLowerCase();
    render();
  });

  fetch("data/news.json")
    .then(function (resp) {
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      return resp.json();
    })
    .then(function (data) {
      state.items = Array.isArray(data.items) ? data.items : [];
      state.updatedAt = data.updated_at || "";
      updatedEl.textContent = state.updatedAt
        ? formatDate(state.updatedAt) + " " + formatTime(state.updatedAt)
        : "未知";
      dateEl.textContent = state.updatedAt
        ? formatDate(state.updatedAt)
        : formatDate(new Date().toISOString());
      if (!state.items.length) {
        statusEl.textContent = "暂无新闻数据。";
        loadGoogleTranslate();
        return;
      }
      render();
      /* 首批新闻已渲染进 DOM，现在才加载翻译小部件，
         用户第一次选语言时新闻已在页面上。 */
      loadGoogleTranslate();
    })
    .catch(function (err) {
      statusEl.textContent = "新闻加载失败（" + err.message +
        "）。请用 python3 -m http.server 启动后访问，或检查 data/news.json 是否存在。";
      loadGoogleTranslate();
    });

  fetch("data/market.json")
    .then(function (resp) {
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      return resp.json();
    })
    .then(renderMarket)
    .catch(function () {
      // 行情加载失败时仅隐藏市场脉搏，新闻照常显示。
      pulseEl.hidden = true;
    });
})();
