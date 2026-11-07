// 加密货币热点新闻 — 读取 data/news.json 与 data/market.json 并在客户端渲染。
// 直接用浏览器打开 index.html 时 fetch 会被 file:// 限制，
// 请用 `python3 -m http.server` 后访问，或部署到 GitHub Pages。
//
// 翻译：页面用免费的 GTranslate 小部件（cdn.gtranslate.net，无需 key，
// 非商业网站免费）。设置在 index.html 里定义，dropdown.js 用 defer
// 加载，在 .gtranslate_wrapper 里生成一个语言下拉框，点选语言后整页翻译。
// 动态内容与漏翻处理 — 新闻是 fetch 后才渲染进 DOM 的，
// 对照 GTranslate 自身源码（dropdown.js / lib.min.js）核对后：
//  1) 翻译库自带 DOM 变化监听（MutationObserver），新节点加入时会
//     停掉当前一轮、重新走一遍整个页面；但一轮翻完后它会把监听
//     的开关关掉（this.h=false），之后再有渲染变化就不一定触发，
//     特别是切走分类再切回“全部”时头条是同一条内容重建，
//     翻译库全身文本对比可能看不出变化。
//  2) 翻译库只优先翻视口内的节点，视口外的先放一放（约 200px
//     余量），等滚到附近再翻；而且是分批逐步翻的。所以页脚
//     （页面最底下）和刚好在首屏外的头条，在短时间检查里没翻完
//     是正常的，不是被跳过了。
//  3) window.doGTranslate("zh-CN|en") 在已经翻成英文时再调是空操作：
//     翻译库内部只有语言真的变了、或还没有翻译对象时才会开新一轮，
//     同语言再调只会直接报 100%。所以“再调一次 doGTranslate”
//     并不能补翻漏掉的节点——旧版就是这么写的，它其实不起作用。
//  4) 真正能强制同一语言重翻的办法是 __GT.translator.revert()
//     （恢复原文、清空已存语言）再调 __GT.translator.translate()：
//     revert 后翻译库会新建翻译对象、重新走一遍整个页面。这是
//     小部件自己暴露的全局对象（doGTranslate 内部调的就是它），
//     不是编造的 API。代价是整页会先短暂恢复中文再重翻，所以
//     只在确实看到缺口时才用，每个 render 周期最多一次、每页最多 3 次。
// 做法见 ensureTranslationComplete：每次 render() 后分两次检查
// （约 0.9 秒、约 3.5 秒），只在“已选非中文、翻译库已就绪、上一轮
// 已结束、头条或页脚在视口内却仍是中文原文”时才强制重翻一次；
// 滚动时（防抖）也检查一次，覆盖滚到底部才看到的页脚。
// 此前用的 Google 翻译小部件已于 2026-10-01 停服、实测无法渲染下拉框，
// 故全部移除，改用 GTranslate（见 README“翻译”一节）。
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

  /* ---- GTranslate：渲染后检查头条 / 页脚是否真的被翻了 ----
     见文件头注释：同语言再调 doGTranslate() 是空操作，真正能强制
     同一语言重翻的是 __GT.translator.revert() + translate()。
     只在确实看到缺口时才用，避免整页来回闪。 */
  var FOOTER_ORIGINAL = "新闻内容版权属于原来源，本站仅做摘要聚合；点击标题可阅读原文。";
  var forcedPassesTotal = 0;
  var forcedThisRender = false;
  var scrollCheckTimer = null;

  /* 已选的目标语言，存在 localStorage 的 __GT_TRANSLATE_LANGS 里
     （{"srcLang": "zh-CN", "tgtLang": "en"} 这种格式，与
     dropdown.js / lib.min.js 的读写一致，已核对过源码）。 */
  function storedTargetLang() {
    try {
      var stored = JSON.parse(localStorage.getItem("__GT_TRANSLATE_LANGS") || "null");
      if (stored && typeof stored.tgtLang === "string") return stored.tgtLang;
    } catch (e) { /* 忽略读取失败 */ }
    return "";
  }

  function currentHeadlineItem() {
    if (state.category !== "全部" || state.query) return null;
    var filtered = state.items.filter(matches);
    return filtered.length ? filtered[0] : null;
  }

  function rectInViewport(el) {
    if (!el || typeof el.getBoundingClientRect !== "function") return false;
    var r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < window.innerHeight;
  }

  /* 头条或页脚在视口内、却仍显示中文原文 → 有真实缺口。
     不在视口内时不算缺口：翻译库本来就会等滚到附近再翻。 */
  function hasVisibleGap() {
    var item = currentHeadlineItem();
    if (item && !headlineEl.hidden) {
      var h2 = headlineEl.querySelector("h2");
      if (h2 && rectInViewport(headlineEl) &&
          h2.textContent.trim() === item.title) return true;
    }
    var fp = document.querySelector("footer p");
    if (fp && rectInViewport(fp) &&
        fp.textContent.trim() === FOOTER_ORIGINAL) return true;
    return false;
  }

  function ensureTranslationComplete() {
    var lang = storedTargetLang();
    if (!lang || lang === "zh-CN") return;
    if (forcedThisRender || forcedPassesTotal >= 3) return;
    var gt = window.__GT && window.__GT.translator;
    if (!gt || typeof gt.revert !== "function" ||
        typeof gt.translate !== "function") return;
    if (gt.libReady === false) return;   // 翻译库还没加载完，等下一次检查
    if (gt.finished === false) return;   // 上一轮还在翻，等它翻完再看
    if (!hasVisibleGap()) return;
    try {
      /* revert() 会把整页先恢复成中文原文、并清空已存语言，
         紧接着的 translate() 因此会新建翻译对象、重新走一遍
         整个页面（含头条和页脚）。 */
      gt.revert();
      gt.translate("zh-CN", lang);
      forcedThisRender = true;
      forcedPassesTotal++;
    } catch (e) { /* 翻译失败时不影响新闻本身 */ }
  }

  function scheduleEnsureTranslation() {
    setTimeout(ensureTranslationComplete, 900);
    setTimeout(ensureTranslationComplete, 3500);
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
    forcedThisRender = false;
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
    /* 分类 / 搜索切换后重新渲染了卡片与头条，分两次检查
       头条、页脚是否真的被翻了，有缺口时强制重翻一次。 */
    scheduleEnsureTranslation();
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

  /* 滚动时也检查一次（防抖）：覆盖滚到底部才进入视口的页脚，
     以及滚回顶部才看到的头条。 */
  window.addEventListener("scroll", function () {
    if (scrollCheckTimer) clearTimeout(scrollCheckTimer);
    scrollCheckTimer = setTimeout(ensureTranslationComplete, 800);
  }, { passive: true });

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
