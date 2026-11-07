// 加密货币热点新闻 — 读取 data/news.json 与 data/market.json 并在客户端渲染。
// 无外部依赖；直接用浏览器打开 index.html 时 fetch 会被 file:// 限制，
// 请用 `python3 -m http.server` 后访问，或部署到 GitHub Pages。
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
        return;
      }
      render();
    })
    .catch(function (err) {
      statusEl.textContent = "新闻加载失败（" + err.message +
        "）。请用 python3 -m http.server 启动后访问，或检查 data/news.json 是否存在。";
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
