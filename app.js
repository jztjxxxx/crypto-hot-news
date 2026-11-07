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
//     只在确实看到缺口时才用，每个 render 周期最多两次、每页最多 20 次
//     （安全上限，防止来回闪）。上一轮没翻完时不放弃：轮询会一直等到
//     它翻完再查缺口，而不是只查两次就停。
// 做法见 pollEnsureTranslation：每次 render() 后开始一轮轮询
// （首次约 0.9 秒、之后每 2 秒一次、持续约 90 秒），只在“已选非中文、
// 翻译库已就绪、上一轮已结束、头条或页脚在视口内却仍是中文原文”时才
// 强制重翻；滚动时（防抖）也触发一轮检查，覆盖滚到底部才看到的页脚。
// 此前用的 Google 翻译小部件已于 2026-10-01 停服、实测无法渲染下拉框，
// 故全部移除，改用 GTranslate（见 README“翻译”一节）。
// 市场脉搏：顶部是一条银色莫比乌斯环带（index.html 里的 SVG 路径，
// 横向无限环近似，不是真 3D），8 张币种卡片由 renderMarket 从
// data/market.json 生成，沿环带流动（48 秒一圈，悬停暂停，
// 减弱动态偏好时静态排布）。无价格历史数据，故不画迷你走势线。
// 定位失败或行情加载失败时降级为静态网格 / 一句提示，不留空白条带。
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
  /* 轮询状态：每轮 render 开始一轮检查，持续约 90 秒。
     forcedThisCycle：本轮已强制重翻次数（上限 2，第一次重翻完
     验证仍有缺口才允许第二次）；forcedPassesTotal：每页累计
     安全上限 20，防止极端情况下来回闪。旧版的问题：每页上限
     只有 3 次，切几个分类就用完了；而且只在 0.9 秒 / 3.5 秒
     查两次，上一轮还在翻（finished===false，一轮要几十秒）
     时就直接放弃、再也不查。 */
  var forcedPassesTotal = 0;
  var forcedThisCycle = 0;
  var lastForceAt = 0;
  var ensureTimer = null;
  var ensureDeadline = 0;
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

  /* 本轮轮询还没到 90 秒截止时，2 秒后再查一次。 */
  function rescheduleEnsure() {
    if (Date.now() < ensureDeadline) {
      ensureTimer = setTimeout(pollEnsureTranslation, 2000);
    } else {
      ensureTimer = null;
    }
  }

  /* 检查一次头条 / 页脚是否真的被翻了，有真实缺口时强制重翻。
     关键：上一轮还在翻（finished===false）或翻译库还没就绪时
     不放弃，只是等 2 秒再查——GTranslate 一轮要几十秒，只查
     两次必然撞上“还在翻”。强制重翻后也继续轮询，等新一轮翻
     完再验证缺口还在不在；还在且本轮没用完 2 次，才再强制一次。 */
  function pollEnsureTranslation() {
    ensureTimer = null;
    var lang = storedTargetLang();
    if (!lang || lang === "zh-CN") return;   // 没选翻译 / 选回中文，停
    var gt = window.__GT && window.__GT.translator;
    if (!gt || typeof gt.revert !== "function" ||
        typeof gt.translate !== "function") { rescheduleEnsure(); return; }
    if (gt.libReady === false) { rescheduleEnsure(); return; }  // 库还没加载完，继续等
    if (gt.finished === false) { rescheduleEnsure(); return; }  // 上一轮还在翻，等它翻完再看
    if (!hasVisibleGap()) return;   // 没缺口，翻译已完成，停
    if (forcedThisCycle >= 2 || forcedPassesTotal >= 20) return;  // 本轮 / 全页上限，停
    if (forcedThisCycle > 0 && Date.now() - lastForceAt < 10000) {
      rescheduleEnsure(); return;   // 两次强制重翻至少隔 10 秒
    }
    try {
      /* revert() 会把整页先恢复成中文原文、并清空已存语言，
         紧接着的 translate() 因此会新建翻译对象、重新走一遍
         整个页面（含头条和页脚）。 */
      gt.revert();
      gt.translate("zh-CN", lang);
      forcedThisCycle++;
      forcedPassesTotal++;
      lastForceAt = Date.now();
    } catch (e) { /* 翻译失败时不影响新闻本身 */ }
    rescheduleEnsure();   // 继续轮询，验证新一轮翻完后缺口还在不在
  }

  /* 每次 render() 后开始一轮轮询：首次约 0.9 秒查，之后每 2 秒
     查一次、持续约 90 秒（覆盖 GTranslate 几十秒一轮的时长）。 */
  function scheduleEnsureTranslation() {
    if (ensureTimer) clearTimeout(ensureTimer);
    forcedThisCycle = 0;
    ensureDeadline = Date.now() + 90000;
    ensureTimer = setTimeout(pollEnsureTranslation, 900);
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

  /* ---- 市场脉搏：莫比乌斯环带 ----
     环带是 index.html 里的一条 SVG 路径（#mobius-path，横向无限环
     ∞，近似莫比乌斯环，不是真 3D；中间交叉处一个翻转色块表现
     半扭转）。8 张卡片是 HTML 元素，用 requestAnimationFrame
     沿路径逐帧定位：getPointAtLength 取点，getScreenCTM 换算成
     舞台内的像素坐标（SVG 按比例缩放、窄屏加高留白时也能对上），
     切线方向算旋转角（夹到 ±38° 内，保证文字始终正向可读），
     按纵向位置算大小 / 亮度 / 层叠（下方近处大而亮、上方远处
     小而暗），制造纵深感。一整圈 48 秒，沿路径方向流动（上半段
     从左往右），无缝循环。减弱动态偏好时不启动动画，只静态排布；
     悬停时暂停，方便细看。无价格历史数据，故不画迷你走势线，
     不编造数据。 */
  var MOBIUS_LOOP_SECONDS = 48;
  var coinsEl = document.getElementById("coins");
  var mobiusTiles = [];
  var mobiusPath = null;
  var mobiusLen = 0;
  var mobiusRaf = 0;
  var mobiusElapsed = 0;
  var mobiusLastTs = null;
  var mobiusHoverPaused = false;
  var mobiusReducedMotion = false;
  try {
    mobiusReducedMotion = window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (e) { /* 不支持 matchMedia 时默认开启动画 */ }

  /* 路径上的点（SVG 内部坐标）换算成舞台内的像素坐标。
     getScreenCTM 能处理 SVG 按比例缩放、窄屏留白的各种情况；
     换算失败时退回按 viewBox 比例估算。 */
  function mobiusPointAt(len, rect) {
    var p = mobiusPath.getPointAtLength(len);
    try {
      var m = mobiusPath.getScreenCTM();
      if (m && typeof DOMPoint !== "undefined") {
        var pt = new DOMPoint(p.x, p.y).matrixTransform(m);
        return { x: pt.x - rect.left, y: pt.y - rect.top };
      }
    } catch (e) { /* 换算失败时用下面的比例估算 */ }
    return { x: p.x / 1080 * rect.width, y: p.y / 300 * rect.height };
  }

  function mobiusPlaceTile(tile, u, rect) {
    var len = u * mobiusLen;
    var pt = mobiusPointAt(len, rect);
    var ahead = mobiusPointAt((len + 2) % mobiusLen, rect);
    var behind = mobiusPointAt((len - 2 + mobiusLen) % mobiusLen, rect);
    var angle = Math.atan2(ahead.y - behind.y, ahead.x - behind.x) * 180 / Math.PI;
    if (angle > 90) angle -= 180;
    if (angle < -90) angle += 180;
    angle = Math.max(-38, Math.min(38, angle));
    var depth = rect.height ? Math.max(0, Math.min(1, pt.y / rect.height)) : 0.5;
    var scale = 0.82 + 0.26 * depth;
    tile.el.style.transform =
      "translate(-50%, -50%) translate(" + pt.x.toFixed(1) + "px," + pt.y.toFixed(1) + "px)" +
      " rotate(" + angle.toFixed(1) + "deg) scale(" + scale.toFixed(3) + ")";
    tile.el.style.opacity = (0.72 + 0.28 * depth).toFixed(2);
    tile.el.style.zIndex = String(1 + Math.round(depth * 10));
    tile.el.style.filter = "brightness(" + (0.86 + 0.14 * depth).toFixed(2) + ")";
  }

  /* 卡片字号按舞台宽度等比缩放（16px 封顶、8.5px 保底），
     窄屏时卡片跟着变小，整页不出现横向滚动。 */
  function mobiusFitFont(rect) {
    coinsEl.style.fontSize = Math.max(8.5, Math.min(16, rect.width / 1080 * 16)) + "px";
  }

  function mobiusLayoutStatic() {
    if (!mobiusTiles.length || !mobiusLen) return;
    var rect = coinsEl.getBoundingClientRect();
    mobiusFitFont(rect);
    mobiusTiles.forEach(function (tile, i) {
      mobiusPlaceTile(tile, i / mobiusTiles.length, rect);
    });
  }

  function mobiusFrame(ts) {
    mobiusRaf = 0;
    if (!mobiusTiles.length || !mobiusLen) return;
    if (mobiusLastTs == null) mobiusLastTs = ts;
    var dt = (ts - mobiusLastTs) / 1000;
    mobiusLastTs = ts;
    if (!mobiusHoverPaused && dt > 0 && dt < 1) mobiusElapsed += dt;
    var rect = coinsEl.getBoundingClientRect();
    mobiusFitFont(rect);
    var n = mobiusTiles.length;
    for (var i = 0; i < n; i++) {
      var u = (i / n + mobiusElapsed / MOBIUS_LOOP_SECONDS) % 1;
      mobiusPlaceTile(mobiusTiles[i], u, rect);
    }
    mobiusRaf = requestAnimationFrame(mobiusFrame);
  }

  function mobiusStart() {
    if (mobiusRaf) cancelAnimationFrame(mobiusRaf);
    mobiusRaf = 0;
    mobiusLastTs = null;
    if (mobiusReducedMotion) { mobiusLayoutStatic(); return; }
    mobiusRaf = requestAnimationFrame(mobiusFrame);
  }

  /* 行情加载失败 / 无数据：不隐藏整个市场脉搏，留一句提示，
     环带隐藏，新闻照常显示。 */
  function showMarketFallback() {
    pulseEl.hidden = false;
    coinsEl.classList.add("mobius-empty");
    coinsEl.classList.remove("mobius-fallback");
    var msg = coinsEl.querySelector(".mobius-fallback-msg");
    if (msg) msg.hidden = false;
  }

  coinsEl.addEventListener("mouseenter", function () { mobiusHoverPaused = true; });
  coinsEl.addEventListener("mouseleave", function () { mobiusHoverPaused = false; });
  window.addEventListener("resize", function () {
    if (mobiusReducedMotion) mobiusLayoutStatic();
  });

  function renderMarket(data) {
    if (!data || !Array.isArray(data.coins) || !data.coins.length) {
      showMarketFallback();
      return;
    }
    var fg = data.fear_greed || {};
    document.getElementById("fear-greed").textContent =
      "恐惧贪婪指数 " + (fg.value != null ? fg.value : "—") +
      (fg.classification_zh ? "（" + fg.classification_zh + "）" : "");
    document.getElementById("total-mcap").textContent = formatMcap(data.total_market_cap_usd);
    document.getElementById("btc-dom").textContent =
      "BTC 占比 " + (data.btc_dominance_pct != null ? data.btc_dominance_pct.toFixed(2) + "%" : "—");
    document.getElementById("market-updated").textContent =
      "更新于 " + (data.updated_at ? formatDate(data.updated_at) + " " + formatTime(data.updated_at) : "未知");
    /* 旧卡片清掉，SVG 环带保留：只删 .mcoin，不动环带和流光。 */
    var old = coinsEl.querySelectorAll(".mcoin");
    for (var i = 0; i < old.length; i++) old[i].remove();
    var msg = coinsEl.querySelector(".mobius-fallback-msg");
    if (msg) msg.hidden = true;
    coinsEl.classList.remove("mobius-empty", "mobius-fallback");
    mobiusTiles = [];
    data.coins.forEach(function (c) {
      var chg = c.change_24h_pct;
      var cls = chg == null ? "" : (chg >= 0 ? "up" : "down");
      var chgText = chg == null ? "" : (chg >= 0 ? "+" : "") + chg.toFixed(2) + "%";
      var tile = document.createElement("div");
      tile.className = "mcoin";
      tile.setAttribute("role", "listitem");
      tile.innerHTML =
        '<div class="name">' + escapeHtml(c.symbol) + "<span>" + escapeHtml(c.name) + "</span></div>" +
        '<div class="price">' + escapeHtml(formatPrice(c.price_usd)) +
        '<span class="change ' + cls + '">' + escapeHtml(chgText) + "</span></div>";
      coinsEl.appendChild(tile);
      mobiusTiles.push({ el: tile });
    });
    /* 沿 SVG 环带定位卡片；定位接口不可用时降级为静态网格，
       绝不留一条空白或坏掉的条带。 */
    try {
      mobiusPath = document.getElementById("mobius-path");
      mobiusLen = mobiusPath.getTotalLength();
      if (!mobiusLen) throw new Error("empty path");
      mobiusStart();
    } catch (e) {
      coinsEl.classList.add("mobius-fallback");
      mobiusTiles.forEach(function (t) {
        t.el.style.transform = "";
        t.el.style.opacity = "";
        t.el.style.zIndex = "";
        t.el.style.filter = "";
      });
    }
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
    /* 分类 / 搜索切换后重新渲染了卡片与头条，开始一轮轮询：
       头条、页脚是否真的被翻了，有缺口时强制重翻（见文件头注释）。 */
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

  /* 滚动时也检查（防抖）：覆盖滚到底部才进入视口的页脚，
     以及滚回顶部才看到的头条。已有轮询在跑时只延长截止时间；
     没有轮询在跑时新开一轮。 */
  window.addEventListener("scroll", function () {
    if (scrollCheckTimer) clearTimeout(scrollCheckTimer);
    scrollCheckTimer = setTimeout(function () {
      if (ensureTimer) {
        ensureDeadline = Math.max(ensureDeadline, Date.now() + 30000);
      } else {
        scheduleEnsureTranslation();
      }
    }, 800);
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
      // 行情加载失败：不隐藏整个市场脉搏，留一句提示，新闻照常显示。
      showMarketFallback();
    });
})();
