import type { ToolExecutor } from "../types.js";

const MAX_CHARS = 20000;

export const webFetchExecutor: ToolExecutor = {
  name: "web_fetch",

  async execute(args: Record<string, unknown>): Promise<string> {
    const url = typeof args.url === "string" ? args.url.trim() : "";
    if (!url) {
      return JSON.stringify({ error: "Missing required argument: url" });
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return JSON.stringify({ error: `Invalid URL: ${url}` });
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return JSON.stringify({ error: "Only http and https URLs are supported" });
    }

    try {
      console.log(`[web_fetch] fetching ${url}`);
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Ei/1.0 (AI companion; +https://github.com/Flare576/ei)",
          "Accept": "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.8",
        },
      });

      if (!response.ok) {
        return JSON.stringify({ error: `HTTP ${response.status}: ${response.statusText}`, url });
      }

      const contentType = response.headers.get("content-type") ?? "";
      let text = await response.text();

      // Strip HTML noise for readability
      if (contentType.includes("text/html")) {
        text = text
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/\s+/g, " ")
          .trim();
      }

      const truncated = text.length > MAX_CHARS;
      if (truncated) text = text.slice(0, MAX_CHARS);

      console.log(`[web_fetch] ${url} => ${text.length} chars${truncated ? " (truncated)" : ""}`);

      return JSON.stringify({
        url,
        content_type: contentType,
        content: text,
        ...(truncated ? { truncated: true, note: `Content truncated to ${MAX_CHARS} characters` } : {}),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[web_fetch] failed for ${url}: ${msg}`);
      return JSON.stringify({ error: `Fetch failed: ${msg}`, url });
    }
  },
};
