/**
 * Web Scraper — 网页抓取与文本提取
 *
 * 从 URL 抓取 HTML 并提取可读文本内容。
 * 用于搜索结果的深度内容获取。
 */

const FETCH_TIMEOUT_MS = 8000;
const MAX_CONTENT_LENGTH = 4000;

/**
 * 从 HTML 中提取正文文本（轻量级，不依赖外部库）
 */
function extractTextFromHtml(html) {
  // 移除 script / style / nav / footer / header 等非正文标签
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<aside[\s\S]*?<\/aside>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "");

  // 提取 title
  const titleMatch = cleaned.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, " ").trim() : "";

  // 提取 meta description
  const descMatch = cleaned.match(
    /<meta[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["']/i
  );
  const description = descMatch ? descMatch[1].trim() : "";

  // 移除所有 HTML 标签
  const text = cleaned
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  // 组合：title + description + 正文
  const parts = [title, description, text].filter(Boolean);
  const content = parts.join("\n\n");

  return content.slice(0, MAX_CONTENT_LENGTH);
}

/**
 * 抓取单个 URL 并提取文本
 */
async function fetchAndExtract(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; HiWebTalk/1.0; +https://github.com/hi-web-talk)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
      redirect: "follow",
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return { url, content: "", error: `HTTP ${response.status}` };
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("xhtml")) {
      return { url, content: "", error: "Not HTML" };
    }

    const html = await response.text();
    const content = extractTextFromHtml(html);

    return { url, content };
  } catch (err) {
    return {
      url,
      content: "",
      error: err.name === "AbortError" ? "Timeout" : err.message,
    };
  }
}

/**
 * 批量抓取多个 URL
 */
export async function scrapeUrls(urls) {
  const results = await Promise.all(urls.map((url) => fetchAndExtract(url)));
  return results;
}

export { fetchAndExtract };
