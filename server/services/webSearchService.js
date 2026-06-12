/**
 * Web Search Service — 搜索 API 调用
 *
 * 支持多种搜索引擎，统一返回格式。
 */

import {
  searchEngine,
  braveConfig,
  bingConfig,
  googleConfig,
  searxngConfig,
} from "../config/searchProviders.js";
import { scrapeUrls } from "./webScraper.js";

const MAX_RESULTS = 8;
const MAX_CONTENT_LENGTH = 3000;

// ── Brave Search ──

async function searchBrave(query, maxResults) {
  if (!braveConfig.apiKey) {
    throw new Error("Brave Search API key not configured (BRAVE_API_KEY)");
  }

  const url = new URL(braveConfig.baseUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(maxResults));

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": braveConfig.apiKey,
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
  }));
}

// ── Bing Search ──

async function searchBing(query, maxResults) {
  if (!bingConfig.apiKey) {
    throw new Error("Bing Search API key not configured (BING_API_KEY)");
  }

  const url = new URL(bingConfig.baseUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(maxResults));
  url.searchParams.set("mkt", "zh-CN");

  const response = await fetch(url.toString(), {
    headers: {
      "Ocp-Apim-Subscription-Key": bingConfig.apiKey,
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
  }));
}

// ── Google Custom Search ──

async function searchGoogle(query, maxResults) {
  if (!googleConfig.apiKey || !googleConfig.cseId) {
    throw new Error("Google Search not configured (GOOGLE_API_KEY & GOOGLE_CSE_ID)");
  }

  const url = new URL(googleConfig.baseUrl);
  url.searchParams.set("key", googleConfig.apiKey);
  url.searchParams.set("cx", googleConfig.cseId);
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

async function searchSearXNG(query, maxResults) {
  const url = new URL(`${searxngConfig.baseUrl}/search`);
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

// ── 统一搜索入口 ──

const searchFunctions = {
  brave: searchBrave,
  bing: searchBing,
  google: searchGoogle,
  searxng: searchSearXNG,
};

/**
 * 执行搜索并抓取页面内容
 * @param {string} query - 搜索关键词
 * @param {Object} options
 * @param {number} options.maxResults - 最大结果数
 * @param {string} options.engine - 搜索引擎（覆盖默认配置）
 * @param {boolean} options.fetchContent - 是否抓取页面全文
 * @returns {Promise<{query: string, sources: Array}>}
 */
export async function webSearch(query, options = {}) {
  const {
    maxResults = MAX_RESULTS,
    engine = searchEngine,
    fetchContent = true,
  } = options;

  const searchFn = searchFunctions[engine];
  if (!searchFn) {
    throw new Error(`Unsupported search engine: ${engine}`);
  }

  // 1. 执行搜索
  const results = await searchFn(query, maxResults);

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
