# 加密货币热点新闻

> 👉 **在线查看：https://jztjxxxx.github.io/crypto-hot-news/**
>
> 直接点上面这个链接就能看，不用下载、不用安装。

整合加密货币的热点新闻：报纸头版式页面，顶部是市场脉搏（BTC/ETH 及市值前 8 币种价格、恐惧贪婪指数、全球总市值与 BTC 占比），下方是新闻流，覆盖行情、市场、政策、项目、DeFi 五类，可按分类筛选、全文搜索，每天自动更新一次。

> **English summary:** A static, open-source crypto hot-news page. A market-pulse header (top-8 coins by market cap, Fear & Greed Index, global market cap and BTC dominance, via CoinGecko and Alternative.me) sits above a news stream filtered by Market / Industry / Policy / Projects / DeFi. News is fetched from public RSS feeds, rendered client-side from `data/news.json`, and refreshed daily by GitHub Actions. No build step, no external fonts; the only external script is the free GTranslate widget (see “翻译 / Translation”).

## 功能

- 市场脉搏：市值前 8 币种的价格与 24 小时涨跌、恐惧贪婪指数、全球总市值、BTC 占比
- 分类页签：全部 / 行情 / 市场 / 政策 / 项目 / DeFi
- 搜索框：按标题、摘要过滤
- 每条新闻：中文标题、1–2 句中文摘要、来源、发布时间、原文链接（新标签页打开）
- 翻译：右上角“🌐 翻译 / Translate”下拉框，免费 GTranslate 小部件，可把整页翻成 15 种主流语言（见下文“翻译”）
- 页眉显示数据更新时间；响应式布局，手机可正常浏览
- 唯一外部依赖：GTranslate 翻译脚本（cdn.gtranslate.net，免费），其余只用系统字体，不加载其他外部字体或 CDN；纯静态页面

## 翻译 / Translation

页面右上角搜索框旁有“🌐 翻译 / Translate”下拉框，点开选一种语言，整页（标题、市场脉搏、新闻标题和摘要、分类）就会翻成该语言，原文链接不变，仍跳到原新闻。

用的是免费的 GTranslate 小部件（无需 key、无需注册），支持以下 15 种语言：

中文（简体）、繁體中文、English、Español、Français、Deutsch、日本語、한국어、Português、Русский、العربية、हिन्दी、Bahasa Indonesia、Tiếng Việt、Türkçe

注意：

- **这是唯一的外部依赖。** 页面会加载 `https://cdn.gtranslate.net/widgets/latest/dropdown.js`，需要能访问 cdn.gtranslate.net；打不开时页面本身（新闻、行情）不受影响，只会显示“翻译加载失败”的提示。
- **免费版适用范围。** GTranslate 的免费小部件面向非商业网站（个人网站、教育项目、非营利组织、政府网站等），不限字数和浏览量；商业网站、需要被搜索引擎收录的翻译页面、手动改译文等功能要付费版。本项目是非商业的公开新闻聚合页，符合免费版用途。
- **为什么不用 Google 翻译小部件。** 此前用的 Google 翻译小部件已于 2026-10-01 停止支持，实测在真浏览器里只剩一个“🌐 翻译 / Translate”文字标签、下拉框根本渲染不出来，请求其脚本还会返回 429/验证码页，故已全部移除，改用 GTranslate。
- **动态新闻与漏翻的处理。** 新闻是页面加载后从 `data/news.json` 抓取、由 `app.js` 渲染进 DOM 的。GTranslate 的翻译库自带 DOM 变化监听，新节点加入时会停掉当前一轮、重新走一遍整个页面；但一轮翻完后监听的开关会关掉，之后再有渲染变化就不一定触发，特别是切走分类再切回“全部”时头条是同一条内容重建。另外翻译库只优先翻视口内的节点，视口外的先放一放（约 200px 余量），等滚到附近再翻，而且是分批逐步翻的——所以页脚（页面最底下）和刚好在首屏外的头条，在短时间的检查里没翻完是正常的，不是被跳过了。为此 `app.js` 在每次渲染后开始一轮轮询（首次约 0.9 秒、之后每 2 秒查一次、持续约 90 秒，覆盖翻译库一轮几十秒的时长），滚动时也触发检查：只在“已选非中文、翻译库已就绪、上一轮已结束、头条或页脚在视口内却仍是中文原文”时，才用 `__GT.translator.revert()` + `translate()` 强制同一语言重翻（每渲染周期最多两次、每页累计最多 20 次的安全上限；同语言再调 `doGTranslate()` 是空操作，核对过 GTranslate 源码才改成这个办法）。上一轮还在翻时轮询会一直等它翻完再查，不会只查两次就放弃——旧版就是只查两次、每页上限 3 次，实测切分类回“全部”后头条变回中文、105 秒都没再被翻，就是栽在这两点上。已选语言会记在浏览器的 localStorage 里，刷新页面后小部件会自动恢复；新开标签页时页面会先显示中文、再逐步翻过去，这是翻译库分批翻的正常表现。
- **局限（实话实说）。** 机器翻译质量以 GTranslate 为准，专有名词、币种和数字以原文链接为准；强制重翻时会整页先短暂恢复中文再重翻，这是为了补翻漏掉的头条/页脚付出的代价，只在确实看到缺口时才触发。想做到每次都稳定、准，就得改用付费翻译 API 在每天更新时预先翻好各语言版本，那是下一步的优化，不是现在这个免费方案。

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

脚本只用 Python 标准库（`urllib` + `xml.etree`），不需要安装任何依赖。它会抓取下方数据源的 RSS（金色财经没有公开 RSS，改用其公开 JSON 接口），保留近 3 天的条目，按发布时间倒序、去重后取最多 40 条（每分类最多 10 条、每来源最多 10 条，且每个有候选条目的来源至少入选 1 条），写入 `data/news.json`；同时从 CoinGecko 与 Alternative.me 抓取行情，写入 `data/market.json`（行情接口失败时保留旧的 `data/market.json`，新闻照常更新）。

## 内容质量

用户要求“内容要优质”，抓取脚本里有以下硬过滤（只看标题/描述的字面信号，不做主观打分）：

- **不收快讯**：标题以“快讯”开头的、中文描述不足 40 字的 RSS 条目（多为一句话简讯）；金色财经只取文章栏目，不取快讯接口；Odaily 只取文章 RSS（`rss/post`），不取快讯 RSS（`rss/newsflash`）。
- **不收软文**：标题含赞助、广告、合作稿件、特约、投稿、品牌合作等标记的，描述含“赞助内容”“本文由”等标记的，以及“如何通过某交易所参与/购买……”这类交易所引流教程。
- **不收纯价格预测**：标题带明确目标价的涨跌预测（如“或将涨至 15 万美元”）、“目标价”“价格预测”字样的；金色财经的“金色趋势”技术分析栏目整栏不取。真实发生的行情新闻（如“比特币跌破 7.5 万美元”）不受影响。
- **不收上币公告短讯**：标题是交易所上线模板且描述不足 80 字的；有实质正文的上线新闻照常收。
- **保底覆盖**：每个有候选条目的来源至少入选 1 条，避免新加的源因条目稍旧而一条都进不了 40 条（2026-11-08 实测：金色财经的文章多为 11 月 5–6 日，加保底前一条都没入选）。

## 每天自动更新

`.github/workflows/update-news.yml` 每天 00:16 UTC（北京时间约 08:16）自动运行一次：

1. 检出代码，安装 Python 3.12
2. 运行 `python3 scripts/fetch_news.py`
3. `data/news.json` 或 `data/market.json` 有变化时自动提交并推送

也可以在仓库 Actions 页面点 **Run workflow** 手动触发。

## 数据源

抓取脚本使用的 RSS（2026-11-08 实测，全部返回 200 且近 3 天有新条目）：

| 来源 | RSS / 接口 |
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
| PANews | `www.panewslab.com/rss.xml` |
| Odaily（星球日报） | `rss.odaily.news/rss/post`（文章；快讯 `rss/newsflash` 不取） |
| 金色财经 | `api.jinse.com.cn/v6/www/information/list`（公开 JSON 接口，无需 key；取政策、DeFi、产业三个文章栏目，“金色趋势”栏目与快讯不取） |

行情数据：CoinGecko 公开 API（市值前 8 币种、`global` 总市值与占比）、Alternative.me 恐惧贪婪指数。

2026-11-08 实测**未采用**的源：CoinJournal RSS（500）；金色财经 `www.jinse.com/rss`（连接被重置，无公开 RSS）；Odaily `www.odaily.news/rss`（404）；PANews `www.panewslab.com/rss`（返回的是 RSS 订阅说明 HTML 页，不是 feed 本体）。金色财经另有需邮件申请 key 的内容 API（`jinsecaijing/api_wiki`），不采用。

## 摘要与分类说明

- 标题与摘要均译为中文，取 RSS 描述的前 1–2 句忠实转述，**不编造事实**。2026-11-08 的首批数据由人工逐条译为中文；此后每日自动更新由脚本抓取，脚本本身没有翻译服务，英文源的新条目将保留英文原文，以免机器转述失真；中文源（金色财经、Odaily、PANews）的新条目本身就是中文，直接采用。
- 分类由标题 + 描述的关键词打分判定：行情（价格、涨跌、爆仓）、市场（ETF 资金流、财库、宏观）、政策（监管、税收、法案）、项目（升级、主网、代币化）、DeFi（借贷、金库、流动性）。个别条目的归类可能存在争议，以原文链接为准。
- 2026-11-08 生成的首批数据共 40 条：行情 7、市场 7、政策 9、项目 9、DeFi 8；已全部译为中文。首批行情快照（2026-11-08 00:19 北京时间，CoinGecko）：BTC $75,722（+0.44%）、ETH $2,235.39（+0.84%）、BNB $693.57（+0.24%）、XRP $1.16（-2.16%）、SOL $89.52（-0.32%）、TRX $0.32（+0.36%），USDT/USDC 约 $1.00；恐惧贪婪指数 25（极度恐惧）；全球总市值约 $2.56 万亿，BTC 占比 59.32%。
- 每条新闻的发布时间均为原文的真实发布日期，绝不用抓取时间冒充。

## 版权

- 本项目代码按 **MIT 许可证**开源（见 `LICENSE`）。
- **新闻内容与行情数据版权属于原来源**，本站仅做摘要聚合、注明来源并链接原文；如需转载请遵循原来源的授权。
