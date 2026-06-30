/**
 * Web Search Service — 搜索 API 调用
 *
 * 支持多种搜索引擎，统一返回格式。
 */

import * as cheerio from "cheerio";
import {
  searchEngine,
  buildBraveConfig,
  buildBingConfig,
  buildGoogleConfig,
  buildSearxngConfig,
  bingHtmlConfig,
} from "../config/searchProviders.js";
import { scrapeUrls } from "./webScraper.js";

const MAX_RESULTS = 8;
const MAX_CONTENT_LENGTH = 3000;

// ── Brave Search ──

async function searchBrave(query, maxResults, providerConfig = {}) {
  const cfg = buildBraveConfig(providerConfig);
  if (!cfg.apiKey) {
    throw new Error("Brave Search API key not configured (BRAVE_API_KEY)");
  }

  const url = new URL(cfg.baseUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(maxResults));

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": cfg.apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`Brave Search API error: ${response.status}`);
  }

  const data = await response.json();
  const results = (data.web?.results || []).slice(0, maxResults);

  return results.map((r) => ({
    title: r.title || "",
    url: r.url || "",
    snippet: r.description || "",
    image: r.thumbnail?.src || r.logo?.url || "",
  }));
}

// ── Bing Search ──

async function searchBing(query, maxResults, providerConfig = {}) {
  const cfg = buildBingConfig(providerConfig);
  if (!cfg.apiKey) {
    throw new Error("Bing Search API key not configured (BING_API_KEY)");
  }

  const url = new URL(cfg.baseUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(maxResults));
  url.searchParams.set("mkt", "zh-CN");

  const response = await fetch(url.toString(), {
    headers: {
      "Ocp-Apim-Subscription-Key": cfg.apiKey,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Bing Search API error: ${response.status}`);
  }

  const data = await response.json();
  const results = (data.webPages?.value || []).slice(0, maxResults);

  return results.map((r) => ({
    title: r.name || "",
    url: r.url || "",
    snippet: r.snippet || "",
    image: r.thumbnailUrl || "",
  }));
}

// ── Google Custom Search ──

async function searchGoogle(query, maxResults, providerConfig = {}) {
  const cfg = buildGoogleConfig(providerConfig);
  if (!cfg.apiKey || !cfg.cseId) {
    throw new Error("Google Search not configured (GOOGLE_API_KEY & GOOGLE_CSE_ID)");
  }

  const url = new URL(cfg.baseUrl);
  url.searchParams.set("key", cfg.apiKey);
  url.searchParams.set("cx", cfg.cseId);
  url.searchParams.set("q", query);
  url.searchParams.set("num", String(maxResults));

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Google Search API error: ${response.status}`);
  }

  const data = await response.json();
  const results = (data.items || []).slice(0, maxResults);

  return results.map((r) => ({
    title: r.title || "",
    url: r.link || "",
    snippet: r.snippet || "",
  }));
}

// ── SearXNG ──

async function searchSearXNG(query, maxResults, providerConfig = {}) {
  const cfg = buildSearxngConfig(providerConfig);

  const url = new URL(`${cfg.baseUrl}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("categories", "general");

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`SearXNG error: ${response.status}`);
  }

  const data = await response.json();
  const results = (data.results || []).slice(0, maxResults);

  return results.map((r) => ({
    title: r.title || "",
    url: r.url || "",
    snippet: r.content || "",
  }));
}

// ── Bing HTML（免费，无需 API 密钥）──

async function searchBingHtml(query, maxResults) {
  const url = new URL(bingHtmlConfig.baseUrl);
  url.searchParams.set("q", query);

  const response = await fetch(url.toString(), {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      "Accept-Encoding": "gzip, deflate, sdch",
      Connection: "keep-alive",
      Referer: "https://www.bing.com/",
      Cookie: "SRCHHPGUSR=ULSR=1",
    },
  });

  if (!response.ok) {
    throw new Error(`Bing HTML search error: ${response.status}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const results = [];

  $("li.b_algo").each((_i, el) => {
    if (results.length >= maxResults) return false;

    const $el = $(el);
    const title = $el.find("h2").text().trim();
    const link = $el.find("h2 > a").attr("href") || "";
    const snippet = $el.find(".b_caption p").text().trim();
    // 缩略图：Bing 用 class 含 r_js 的 img
    const image = $el.find("img[class*='r_js']").first().attr("src") || "";

    if (title && link) {
      results.push({ title, url: link, snippet, image });
    }
  });

  if (results.length === 0) {
    throw new Error("Bing HTML search returned no results");
  }

  return results;
}

// ── 统一搜索入口 ──

const searchFunctions = {
  brave: searchBrave,
  bing: searchBing,
  google: searchGoogle,
  searxng: searchSearXNG,
  bing_html: searchBingHtml,
};

/**
 * 执行搜索并抓取页面内容
 * @param {string} query - 搜索关键词
 * @param {Object} options
 * @param {number} options.maxResults - 最大结果数
 * @param {string} options.engine - 搜索引擎（覆盖默认配置）
 * @param {boolean} options.fetchContent - 是否抓取页面全文
 * @param {Object} options.providerConfigs - 各引擎的用户配置（override env vars）
 * @returns {Promise<{query: string, sources: Array}>}
 */
export async function webSearch(query, options = {}) {
  const {
    maxResults = MAX_RESULTS,
    engine = searchEngine,
    fetchContent = true,
    providerConfigs = {},
  } = options;

  const searchFn = searchFunctions[engine];
  if (!searchFn) {
    throw new Error(`Unsupported search engine: ${engine}`);
  }

  // 1. 执行搜索（传入该引擎的用户配置覆盖）
  const providerConfig = providerConfigs[engine] || {};
  const results = await searchFn(query, maxResults, providerConfig);

  // 2. 抓取页面全文（可选）
  let enrichedResults = results;
  if (fetchContent && results.length > 0) {
    const urls = results.map((r) => r.url);
    const pages = await scrapeUrls(urls);

    enrichedResults = results.map((r, i) => ({
      ...r,
      content: (pages[i]?.content || "").slice(0, MAX_CONTENT_LENGTH),
    }));
  }

  return {
    query,
    engine,
    sources: enrichedResults,
  };
}
