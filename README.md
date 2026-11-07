# 加密货币热点新闻

> 👉 **在线查看：https://jztjxxxx.github.io/crypto-hot-news/**
>
> 直接点上面这个链接就能看，不用下载、不用安装。

整合加密货币的热点新闻：报纸头版式页面，顶部是市场脉搏（BTC/ETH 及市值前 8 币种价格、恐惧贪婪指数、全球总市值与 BTC 占比），下方是新闻流，覆盖行情、市场、政策、项目、DeFi 五类，可按分类筛选、全文搜索，每天自动更新一次。

> **English summary:** A static, open-source crypto hot-news page. A market-pulse header (top-8 coins by market cap, Fear & Greed Index, global market cap and BTC dominance, via CoinGecko and Alternative.me) sits above a news stream filtered by Market / Industry / Policy / Projects / DeFi. News is fetched from public RSS feeds, rendered client-side from `data/news.json`, and refreshed daily by GitHub Actions. No build step, no external fonts; the only external script is the free Google Translate widget (see “翻译 / Translation”).

## 功能

- 市场脉搏：市值前 8 币种的价格与 24 小时涨跌、恐惧贪婪指数、全球总市值、BTC 占比
- 分类页签：全部 / 行情 / 市场 / 政策 / 项目 / DeFi
- 搜索框：按标题、摘要过滤
- 每条新闻：中文标题、1–2 句中文摘要、来源、发布时间、原文链接（新标签页打开）
- 翻译：右上角“🌐 翻译 / Translate”下拉框，免费 Google 翻译小部件，可把整页翻成 15 种主流语言（见下文“翻译”）
- 页眉显示数据更新时间；响应式布局，手机可正常浏览
- 唯一外部依赖：Google 翻译脚本（translate.google.com，免费），其余只用系统字体，不加载其他外部字体或 CDN；纯静态页面

## 翻译 / Translation

页面右上角搜索框旁有“🌐 翻译 / Translate”下拉框，点开选一种语言，整页（标题、市场脉搏、新闻标题和摘要、分类）就会翻成该语言，原文链接不变，仍跳到原新闻。

用的是免费的 Google 翻译小部件（Google Translate Element，无需 key、无需注册），支持以下 15 种语言：

中文（简体）、繁體中文、English、Español、Français、Deutsch、日本語、한국어、Português、Русский、العربية、हिन्दी、Bahasa Indonesia、Tiếng Việt、Türkçe

注意：

- **这是唯一的外部依赖。** 页面会加载 `//translate.google.com/translate_a/element.js`，需要能访问 translate.google.com；在中国大陆可能打不开或很慢，打不开时页面本身（新闻、行情）不受影响，只会显示“翻译加载失败”的提示。
- **动态新闻的处理。** 新闻是页面加载后从 `data/news.json` 抓取、由 `app.js` 渲染进 DOM 的，Google 翻译只会翻译当时已在页面上的内容。所以小部件是等首批新闻渲染完成后再加载的，用户第一次选语言时新闻已在页面上。切换分类 / 搜索重新渲染后，脚本会把已选语言重设给小部件下拉框并触发一次 change 事件，让它把新卡片再翻一遍。
- **局限（实话实说）。** 免费小部件没有公开的“重新翻译”API，上面那步是社区常用的变通做法，不能 100% 保证每次切换分类后新内容都会被翻；如果某次没翻，再点一次语言下拉框、或把语言先切回中文再切回去即可。机器翻译质量以 Google 为准，专有名词、币种和数字以原文链接为准。想做到每次都稳定、准，就得改用付费翻译 API 在每天更新时预先翻好各语言版本，那是下一步的优化，不是现在这个免费方案。

## 本地使用

直接用浏览器打开 `index.html` 会因为 `file://` 限制读不到 `data/news.json`，请用本地服务器：

```bash
python3 -m http.server 8000
# 浏览器打开 http://localhost:8000
```

也可以部署到 GitHub Pages：仓库 Settings → Pages → 选择 `main` 分支根目录即可。

## 手动更新数据

```bash
python3 scripts/fetch_news.py
```

脚本只用 Python 标准库（`urllib` + `xml.etree`），不需要安装任何依赖。它会抓取下方数据源的 RSS，保留近 3 天的条目，按发布时间倒序、去重后取最多 40 条（每分类最多 10 条、每来源最多 10 条），写入 `data/news.json`；同时从 CoinGecko 与 Alternative.me 抓取行情，写入 `data/market.json`（行情接口失败时保留旧的 `data/market.json`，新闻照常更新）。

## 每天自动更新

`.github/workflows/update-news.yml` 每天 00:16 UTC（北京时间约 08:16）自动运行一次：

1. 检出代码，安装 Python 3.12
2. 运行 `python3 scripts/fetch_news.py`
3. `data/news.json` 或 `data/market.json` 有变化时自动提交并推送

也可以在仓库 Actions 页面点 **Run workflow** 手动触发。

## 数据源

抓取脚本使用的 RSS（2026-11-08 实测，全部返回 200 且近 3 天有新条目）：

| 来源 | RSS |
| --- | --- |
| CoinDesk | `www.coindesk.com/arc/outboundfeeds/rss/` |
| CoinTelegraph | `cointelegraph.com/rss` |
| Decrypt | `decrypt.co/feed` |
| The Block | `www.theblock.co/rss.xml` |
| CryptoSlate | `cryptoslate.com/feed/` |
| Bitcoin Magazine | `bitcoinmagazine.com/feed` |
| U.Today | `u.today/rss` |
| CryptoPotato | `cryptopotato.com/feed/` |
| BeInCrypto | `beincrypto.com/feed/` |
| The Defiant | `thedefiant.io/feed/` |

行情数据：CoinGecko 公开 API（市值前 8 币种、`global` 总市值与占比）、Alternative.me 恐惧贪婪指数。

2026-11-08 实测**未采用**的源：CoinJournal RSS（500）。

## 摘要与分类说明

- 标题与摘要均译为中文，取 RSS 描述的前 1–2 句忠实转述，**不编造事实**。2026-11-08 的首批数据由人工逐条译为中文；此后每日自动更新由脚本抓取，脚本本身没有翻译服务，英文源的新条目将保留英文原文，以免机器转述失真。
- 分类由标题 + 描述的关键词打分判定：行情（价格、涨跌、爆仓）、市场（ETF 资金流、财库、宏观）、政策（监管、税收、法案）、项目（升级、主网、代币化）、DeFi（借贷、金库、流动性）。个别条目的归类可能存在争议，以原文链接为准。
- 2026-11-08 生成的首批数据共 40 条：行情 7、市场 7、政策 9、项目 9、DeFi 8；已全部译为中文。首批行情快照（2026-11-08 00:19 北京时间，CoinGecko）：BTC $75,722（+0.44%）、ETH $2,235.39（+0.84%）、BNB $693.57（+0.24%）、XRP $1.16（-2.16%）、SOL $89.52（-0.32%）、TRX $0.32（+0.36%），USDT/USDC 约 $1.00；恐惧贪婪指数 25（极度恐惧）；全球总市值约 $2.56 万亿，BTC 占比 59.32%。
- 每条新闻的发布时间均为原文的真实发布日期，绝不用抓取时间冒充。

## 版权

- 本项目代码按 **MIT 许可证**开源（见 `LICENSE`）。
- **新闻内容与行情数据版权属于原来源**，本站仅做摘要聚合、注明来源并链接原文；如需转载请遵循原来源的授权。
