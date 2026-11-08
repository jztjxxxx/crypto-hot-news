#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
加密货币热点新闻 — RSS 抓取 + 行情抓取脚本（仅使用 Python 标准库）。

用法：
    python3 scripts/fetch_news.py

输出：
    data/news.json
    {"updated_at": "...(+08:00)", "items": [{category, title,
      summary, source, url, published_at}, ...]}
    data/market.json
    {"updated_at": "...", "fear_greed": {...}, "total_market_cap_usd": ...,
     "btc_dominance_pct": ..., "eth_dominance_pct": ...,
     "coins": [{id, symbol, name, price_usd, change_24h_pct,
      market_cap_usd, rank}, ...]}

规则（见 README）：
- 只用 urllib + xml.etree + json，不依赖任何第三方包。
- 新闻只保留近 3 天的条目，按发布时间倒序，最多 40 条，
  每个分类最多 10 条、每个来源最多 10 条；跳过教程/科普类标题
  （What Is / How to 等），只收新闻。
- 内容质量过滤（用户要求“内容要优质”）：跳过快讯式标题、
  中文描述不足 40 字的 RSS 条目、赞助/软文/投稿标记、交易所
  引流教程、带明确目标价的价格预测标题，以及只有一句话的
  上币公告；金色财经只取文章栏目（不取“金色趋势”技术分析
  栏目和快讯），Odaily 只取文章 RSS（不取快讯 RSS）。
- 标题保留 RSS 原文；摘要取 RSS 描述的前 1-2 句，不编造事实。
  英文描述无法在无翻译服务的情况下忠实转述时，按任务要求保留
  英文原文（不做机器翻译、不编造）。
- 分类用标题+描述的关键词打分判定：行情 / 市场 / 政策 / 项目 / DeFi。
- 行情用 CoinGecko 公开 API（市值前 8 币种 + 全球总市值与 BTC 占比）
  与 Alternative.me 恐惧贪婪指数；若行情接口失败，保留旧的
  data/market.json 不覆盖，新闻照常更新。

2026-11-08 实测被排除的源（见 README「数据源」一节）：
- CoinJournal RSS：500
- 金色财经 www.jinse.com RSS：连接被重置（无公开 RSS；改用
  api.jinse.com.cn JSON 接口）；其内容 API 需邮件申请 key
  （jinsecaijing/api_wiki），不采用。
- Odaily www.odaily.news/rss：404（改用官方 RSS
  rss.odaily.news/rss/post，只取文章，不取快讯）。
- PANews www.panewslab.com/rss：返回的是 RSS 订阅说明 HTML 页
  （改用 /rss.xml）。
"""

import html
import json
import re
import sys
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET
from collections import Counter
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "news.json"
MARKET_OUT = ROOT / "data" / "market.json"

USER_AGENT = "Mozilla/5.0 (crypto-hot-news; +https://github.com/jztjxxxx/crypto-hot-news)"

# (url, 来源名）
FEEDS = [
    ("https://www.coindesk.com/arc/outboundfeeds/rss/", "CoinDesk"),
    ("https://cointelegraph.com/rss", "CoinTelegraph"),
    ("https://decrypt.co/feed", "Decrypt"),
    ("https://www.theblock.co/rss.xml", "The Block"),
    ("https://cryptoslate.com/feed/", "CryptoSlate"),
    ("https://bitcoinmagazine.com/feed", "Bitcoin Magazine"),
    ("https://u.today/rss", "U.Today"),
    ("https://cryptopotato.com/feed/", "CryptoPotato"),
    ("https://beincrypto.com/feed/", "BeInCrypto"),
    ("https://thedefiant.io/feed/", "The Defiant"),
    # 中文源（2026-11-08 实测可用）
    ("https://www.panewslab.com/rss.xml", "PANews"),
    ("https://rss.odaily.news/rss/post", "Odaily"),
]

# 金色财经没有公开 RSS，改用其公开 JSON 接口（api.jinse.com.cn，
# 无需 key，2026-11-08 实测返回 200）。只取文章类栏目，不取
# fenxishishuo（“金色趋势”技术分析栏目，多为价格预测短评，
# 不符合“内容要优质”的要求），也不取快讯（lives）接口。
JINSE_API = "https://api.jinse.com.cn/v6/www/information/list"
JINSE_CATEGORIES = ["zhengce", "defi", "industry"]

MARKETS_URL = ("https://api.coingecko.com/api/v3/coins/markets"
               "?vs_currency=usd&order=market_cap_desc&per_page=8&page=1"
               "&sparkline=false&price_change_percentage=24h")
GLOBAL_URL = "https://api.coingecko.com/api/v3/global"
FNG_URL = "https://api.alternative.me/fng/?limit=1"

CATEGORIES = ["行情", "市场", "政策", "项目", "DeFi"]
CATEGORY_KEYWORDS = {
    "行情": ["price", "BTC", "ETH", "falls", "drops", "rallies", "surge",
             "plunge", "liquidation", "liquidations", "low", "high",
             "下跌", "上涨", "暴跌", "暴涨", "价格", "行情", "爆仓", "清算",
             "低点", "新高"],
    "市场": ["ETF", "market", "inflows", "outflows", "market cap", "jobs",
             "stocks", "Wall Street", "treasury", "holdings", "buys",
             "sells", "inflow", "outflow",
             "买入", "卖出", "流入", "流出", "市值", "就业", "美股", "财库"],
    "政策": ["regulation", "SEC", "Treasury", "tax", "law", "bill", "ban",
             "license", "licensing", "court", "proposal", "rules",
             "监管", "税收", "法案", "牌照", "法院", "禁止", "政策", "提案",
             "规则", "起诉", "刑事", "合规", "调查"],
    "项目": ["upgrade", "mainnet", "launches", "network", "fork",
             "tokenized", "tokenization", "project", "testnet",
             "升级", "主网", "推出", "分叉", "代币化", "测试版", "挖矿", "发布"],
    "DeFi": ["DeFi", "Aave", "lending", "borrow", "vault", "liquidity",
             "Morpho", "Pendle", "Lido", "collateral",
             "借贷", "金库", "流动性", "抵押", "质押"],
}

MAX_ITEMS = 40
MAX_PER_CATEGORY = 10
MAX_PER_SOURCE = 10
CUTOFF_DAYS = 3  # 只收录近 3 天的条目（按 UTC 日期）

# 教程/科普类标题不收（只收新闻）
EXPLAINER_PREFIXES = ("What Is", "What Are", "What Does", "How to", "How Do",
                      "How Does", "How Fed", "Crypto Clearing", "What Happens",
                      "什么是", "一文读懂", "新手指南", "教程")

# 内容质量过滤（用户要求“内容要优质”）：只针对标题/描述的明显信号，
# 宁可漏收一条可疑的，也不收一条低质的；判断一律基于原文字面，
# 不对条目内容做主观打分。
# (a) 快讯/一句话简讯：标题以“快讯”开头，或中文描述不足 40 字且无实文。
#     注意：英文源的描述本身偏短，故描述长度规则只看中文描述；
#     金色财经的摘要天生只有一句话，不适用长度规则（其接口本身只给文章）。
FLASH_TITLE_PREFIXES = ("快讯", "【快讯】", "快讯|", "快讯：")
# (b) 赞助/软文/投稿：标题里的硬标记；描述里的“本文由/赞助内容”等
#     明确标记。裸“推广”二字不列入标题规则——它常出现在政策新闻里
#     （如“品牌推广违规”），误杀太多。
SPONSORED_TITLE_WORDS = ("赞助", "广告", "合作稿件", "特约", "投稿",
                         "品牌合作", "推广活动", "推广链接")
SPONSORED_DESC_WORDS = ("赞助内容", "本文由", "合作稿件", "推广链接")
# 交易所引流教程（几乎全是合作软文）：“如何通过某交易所参与/购买……”
SPONSORED_TUTORIAL_RE = re.compile(
    r"如何(通过|在|用).{0,12}(Bitget|币安|Binance|OKX|欧易|Bybit|"
    r"Gate\.?io|火币|HTX|Coinbase)")
# (c) 纯价格预测标题：带明确目标价的涨跌预测、目标价、价格预测。
#     真实发生的行情新闻（如“比特币跌破 7.5 万美元”）没有“将/或将”
#     前缀，不会被误伤。
PRICE_PREDICTION_RES = [
    re.compile(r"(将|或将|有望|预计|料).{0,8}(涨到|涨至|跌到|跌至|突破|触及|冲上|跌破)"
               r"\s*\$?[\d,\.]+"),
    re.compile(r"目标价"),
    re.compile(r"(价格预测|价格展望)"),
]
# 上币公告式短讯：标题是交易所上线模板且描述不足 80 字（一句话公告），
# 有实质正文的上线新闻不受影响。
LISTING_SPAM_RE = re.compile(
    r"(币安|Binance|OKX|欧易|Coinbase|Bybit|Gate\.?io|火币|HTX)"
    r".{0,10}(上线|首发|新增).{0,10}(交易|合约|现货)")


def is_low_quality(title, description):
    """低质条目返回原因字符串，否则返回 None。"""
    if title.startswith(FLASH_TITLE_PREFIXES):
        return "快讯标题"
    desc = clean_text(description)
    if desc and is_chinese(desc) and len(desc) < 40:
        return "中文描述不足40字"
    if any(w in title for w in SPONSORED_TITLE_WORDS):
        return "疑似赞助/软文标题"
    if any(w in desc for w in SPONSORED_DESC_WORDS):
        return "疑似赞助/软文描述"
    if SPONSORED_TUTORIAL_RE.search(title):
        return "交易所引流教程"
    for pat in PRICE_PREDICTION_RES:
        if pat.search(title):
            return "纯价格预测标题"
    if LISTING_SPAM_RE.search(title) and len(desc) < 80:
        return "上币公告短讯"
    return None


def contains(text, keyword):
    """中英关键词匹配：中文子串匹配；纯 ASCII 词用词边界匹配。"""
    if not keyword or not text:
        return False
    if keyword.isascii():
        return re.search(r"\b" + re.escape(keyword) + r"\b", text, re.I) is not None
    return keyword in text


def score(text, keywords):
    return sum(1 for k in keywords if contains(text, k))


def detect_category(text):
    # 周报/精选类合集按“市场”归类（内容是资讯汇总，不是政策/项目新闻）
    if "编辑精选" in text or "必关注" in text:
        return "市场"
    scores = {c: score(text, kws) for c, kws in CATEGORY_KEYWORDS.items()}
    best = max(scores.values())
    if best == 0:
        return "市场"
    for c in CATEGORIES:  # 平局按固定顺序：行情、市场、政策、项目、DeFi
        if scores[c] == best:
            return c
    return "市场"


def clean_text(raw):
    if not raw:
        return ""
    text = re.sub(r"<[^>]+>", " ", raw)
    text = html.unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def is_chinese(text):
    return any("\u4e00" <= ch <= "\u9fff" for ch in text)


def make_summary(description):
    """取描述的前 1-2 句，不编造。中文描述直接截取；英文描述保留原文。"""
    text = clean_text(description)
    if not text:
        return ""
    if is_chinese(text):
        parts = re.split(r"(?<=[。！？；])", text)
        out = ""
        for p in parts:
            if len(out) + len(p) > 140 and out:
                break
            out += p
            if len(parts) > 1 and out and len(out) >= 40:
                break
        return out.strip() or text[:140]
    parts = re.split(r"(?<=[.!?])\s+", text)
    out = ""
    for p in parts[:2]:
        if len(out) + len(p) > 220 and out:
            break
        out += (" " if out else "") + p
    out = out.strip() or text[:220]
    if len(out) >= 220:  # 截断时不要切断单词
        out = out[:220].rsplit(" ", 1)[0]
    return out


def parse_date(raw):
    if not raw:
        return None
    try:
        dt = parsedate_to_datetime(raw.strip())
    except (TypeError, ValueError):
        return None
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def norm_url(url):
    url = (url or "").strip()
    url = re.sub(r"[?&](utm_[^=&]+|fbclid|gclid)=[^&]*", "", url)
    return url.rstrip("?&")


def norm_title_tokens(title):
    t = title.lower()
    t = re.sub(r"[^\w\u4e00-\u9fff]+", " ", t)
    return set(t.split())


def similar_title(a, b):
    """跨源同题去重：词集合 Jaccard 相似度过高视为同一新闻。"""
    ta, tb = norm_title_tokens(a), norm_title_tokens(b)
    if not ta or not tb:
        return False
    if ta <= tb or tb <= ta:
        return True
    return len(ta & tb) / len(ta | tb) >= 0.65


def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT,
                                              "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        if resp.status != 200:
            raise urllib.error.HTTPError(url, resp.status, "non-200", None, None)
        return json.loads(resp.read().decode("utf-8"))


def fetch_feed(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=20) as resp:
        if resp.status != 200:
            raise urllib.error.HTTPError(url, resp.status, "non-200", None, None)
        return resp.read()


def fetch_jinse_category(category, limit=20):
    """金色财经 JSON 接口：返回与 RSS 条目同形的列表。

    注意：接口返回的 topic_url 带有多余的 "/.cn/"（如
    https://www.jinse.com.cn/.cn/blockchain/3740705.html），
    实测去掉后才是可访问的原文链接，这里顺手修正。
    published_at 是 Unix 秒级时间戳。
    """
    url = (f"{JINSE_API}?catelogue_key={category}"
           f"&limit={limit}&flag=up")
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT,
                                              "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        if resp.status != 200:
            raise urllib.error.HTTPError(url, resp.status, "non-200", None, None)
        payload = json.loads(resp.read().decode("utf-8"))
    items = []
    for it in payload.get("list") or []:
        extra = it.get("extra") or {}
        title = clean_text(it.get("title"))
        link = (extra.get("topic_url") or "").strip().replace("/.cn/", "/")
        ts = extra.get("published_at")
        if not title or not link or not ts:
            continue
        try:
            dt = datetime.fromtimestamp(int(ts), tz=timezone.utc)
        except (TypeError, ValueError, OSError):
            continue
        items.append({"title": title, "link": link,
                      "description": extra.get("summary") or "",
                      "pub_dt": dt})
    return items


def parse_items(data):
    root = ET.fromstring(data)
    items = []
    for it in root.iter("item"):
        title = clean_text(it.findtext("title"))
        link = (it.findtext("link") or "").strip()
        desc = it.findtext("description") or ""
        if not desc:
            desc = it.findtext("{http://purl.org/rss/1.0/modules/content/}encoded") or ""
        pub = it.findtext("pubDate") or ""
        if not pub:
            pub = it.findtext("{http://purl.org/dc/elements/1.1/}date") or ""
        if title and link:
            items.append({"title": title, "link": link,
                          "description": desc, "pub_raw": pub})
    return items


def fetch_market(beijing):
    """抓取行情；失败时返回 None，调用方保留旧文件。"""
    try:
        markets = fetch_json(MARKETS_URL)
        glob = fetch_json(GLOBAL_URL)["data"]
        fng = fetch_json(FNG_URL)["data"][0]
    except Exception as e:  # noqa: BLE001 - 行情失败不阻塞新闻更新
        print(f"[跳过] 行情接口失败 -> {e}，保留旧 data/market.json")
        return None
    coins = [{
        "id": c["id"],
        "symbol": c["symbol"].upper(),
        "name": c["name"],
        "price_usd": c["current_price"],
        "change_24h_pct": round(c["price_change_percentage_24h"], 2),
        "market_cap_usd": c["market_cap"],
        "rank": c["market_cap_rank"],
    } for c in markets]
    return {
        "updated_at": datetime.now(beijing).isoformat(timespec="seconds"),
        "source": "CoinGecko / Alternative.me",
        "fear_greed": {
            "value": int(fng["value"]),
            "classification": fng["value_classification"],
            "classification_zh": ("极度恐惧" if fng["value_classification"] == "Extreme Fear"
                                  else "恐惧" if fng["value_classification"] == "Fear"
                                  else "中性" if fng["value_classification"] == "Neutral"
                                  else "贪婪" if fng["value_classification"] == "Greed"
                                  else fng["value_classification"]),
        },
        "total_market_cap_usd": glob["total_market_cap"]["usd"],
        "btc_dominance_pct": round(glob["market_cap_percentage"]["btc"], 2),
        "eth_dominance_pct": round(glob["market_cap_percentage"]["eth"], 2),
        "coins": coins,
    }


def main():
    now_utc = datetime.now(timezone.utc)
    cutoff = now_utc - timedelta(days=CUTOFF_DAYS)
    today = now_utc.date().isoformat()
    beijing = timezone(timedelta(hours=8))

    candidates = []
    for url, source in FEEDS:
        try:
            data = fetch_feed(url)
            raw_items = parse_items(data)
        except Exception as e:  # noqa: BLE001 - 记录并继续下一个源
            print(f"[跳过] {source} {url} -> {e}")
            continue
        kept = 0
        today_n = 0
        for raw in raw_items:
            if raw["title"].startswith(EXPLAINER_PREFIXES):
                continue  # 教程/科普，不收
            low = is_low_quality(raw["title"], raw["description"])
            if low:
                continue  # 低质（快讯/软文/价格预测/上币短讯），不收
            dt = parse_date(raw["pub_raw"])
            if dt is None or dt < cutoff:
                continue
            if dt.date().isoformat() == today:
                today_n += 1
            text = raw["title"] + " " + clean_text(raw["description"])
            candidates.append({
                "category": detect_category(text),
                "title": raw["title"],
                "summary": make_summary(raw["description"]) or raw["title"],
                "source": source,
                "url": norm_url(raw["link"]),
                "published_at": dt.astimezone(beijing).isoformat(),
                "_dt": dt,
            })
            kept += 1
        print(f"[OK] {source}: 共 {len(raw_items)} 条，近 3 天 {kept} 条，今日 {today_n} 条")

    # 金色财经（JSON 接口，非 RSS）：摘要本身只有一句话，不做描述长度
    # 过滤，只做标题类质量过滤。
    for category in JINSE_CATEGORIES:
        try:
            raw_items = fetch_jinse_category(category)
        except Exception as e:  # noqa: BLE001 - 记录并继续下一个栏目
            print(f"[跳过] 金色财经/{category} -> {e}")
            continue
        kept = 0
        today_n = 0
        for raw in raw_items:
            if raw["title"].startswith(EXPLAINER_PREFIXES):
                continue
            title = raw["title"]
            if any(w in title for w in SPONSORED_TITLE_WORDS):
                continue
            if SPONSORED_TUTORIAL_RE.search(title):
                continue
            if any(pat.search(title) for pat in PRICE_PREDICTION_RES):
                continue
            if LISTING_SPAM_RE.search(title) and len(clean_text(raw["description"])) < 80:
                continue
            dt = raw["pub_dt"]
            if dt < cutoff:
                continue
            if dt.date().isoformat() == today:
                today_n += 1
            text = title + " " + clean_text(raw["description"])
            candidates.append({
                "category": detect_category(text),
                "title": title,
                "summary": make_summary(raw["description"]) or title,
                "source": "金色财经",
                "url": norm_url(raw["link"]),
                "published_at": dt.astimezone(beijing).isoformat(),
                "_dt": dt,
            })
            kept += 1
        print(f"[OK] 金色财经/{category}: 共 {len(raw_items)} 条，近 3 天 {kept} 条，今日 {today_n} 条")

    # 去重：先按 URL，再按相似标题
    seen_urls, deduped = set(), []
    for c in sorted(candidates, key=lambda x: x["_dt"], reverse=True):
        if c["url"] in seen_urls:
            continue
        if any(similar_title(c["title"], d["title"]) for d in deduped):
            continue
        seen_urls.add(c["url"])
        deduped.append(c)

    # 选条：按时间倒序，每分类上限、每来源上限
    picked = []
    for c in deduped:
        if len(picked) >= MAX_ITEMS:
            break
        if sum(1 for p in picked if p["category"] == c["category"]) >= MAX_PER_CATEGORY:
            continue
        if sum(1 for p in picked if p["source"] == c["source"]) >= MAX_PER_SOURCE:
            continue
        picked.append(c)

    # 类别补齐：若某类别为 0，用未入选的该类别最新条目替换入选最多的类别中最旧的一条
    picked_urls = {p["url"] for p in picked}
    rest = [c for c in deduped if c["url"] not in picked_urls]

    # 来源补齐：每个有候选条目的来源至少入选 1 条（否则新加的源可能因
    # 条目稍旧而一条都进不了 40 条——2026-11-08 金色财经就栽在这点上）。
    # 用该来源最新的一条替换入选条数最多的来源中最旧的一条（被替换的
    # 来源至少保留 1 条，不会被清零）。
    for source in [s for _, s in FEEDS] + ["金色财经"]:
        if any(p["source"] == source for p in picked):
            continue
        repl = next((c for c in rest if c["source"] == source), None)
        if not repl:
            continue
        counts = Counter(p["source"] for p in picked)
        victim_source = counts.most_common(1)[0][0]
        if counts[victim_source] <= 1:
            continue
        # 优先换掉同分类的一条，保持各分类数量不变
        same_cat = [p for p in reversed(picked)
                    if p["source"] == victim_source
                    and p["category"] == repl["category"]]
        victim = (same_cat[0] if same_cat else
                  next(p for p in reversed(picked)
                       if p["source"] == victim_source))
        picked.remove(victim)
        picked.append(repl)
        rest.remove(repl)
        picked_urls.add(repl["url"])

    for cat in CATEGORIES:
        if any(p["category"] == cat for p in picked):
            continue
        repl = next((c for c in rest if c["category"] == cat), None)
        if not repl:
            continue
        counts = Counter(p["category"] for p in picked)
        victim_cat = counts.most_common(1)[0][0]
        victim = next(p for p in reversed(picked) if p["category"] == victim_cat)
        picked.remove(victim)
        picked.append(repl)
        rest.remove(repl)

    picked.sort(key=lambda x: x["_dt"], reverse=True)
    for p in picked:
        p.pop("_dt", None)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "updated_at": datetime.now(beijing).isoformat(timespec="seconds"),
        "items": picked,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
                   encoding="utf-8")

    print(f"\n共收录 {len(picked)} 条")
    print("按分类：", dict(Counter(p["category"] for p in picked)))
    print("按来源：", dict(Counter(p["source"] for p in picked)))
    print("中文标题：", sum(1 for p in picked if is_chinese(p["title"])),
          "英文标题：", sum(1 for p in picked if not is_chinese(p["title"])))
    print(f"已写入 {OUT}")

    market = fetch_market(beijing)
    if market is not None:
        MARKET_OUT.write_text(json.dumps(market, ensure_ascii=False, indent=2) + "\n",
                              encoding="utf-8")
        print(f"行情已写入 {MARKET_OUT}："
              f"BTC ${market['coins'][0]['price_usd']} "
              f"({market['coins'][0]['change_24h_pct']}%), "
              f"恐惧贪婪 {market['fear_greed']['value']} "
              f"({market['fear_greed']['classification_zh']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
