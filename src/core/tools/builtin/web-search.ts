/**
 * Tavily Search builtin tools: tavily_web_search, tavily_news_search
 *
 * Uses the Tavily Search API — CORS-compatible, browser-safe.
 * Auth via Authorization: Bearer header (no custom headers = no preflight issues).
 * runtime: "any" — works in both Web and TUI.
 *
 * Required config: { api_key: "<TAVILY_API_KEY>" }
 * Input args: { query: string, max_results?: number }
 *
 * Tavily API: POST https://api.tavily.com/search
 * topic: "general" (web) or "news"
 */
import type { ToolExecutor } from "../types.js";
import { ToolFailure } from "../tool-error.js";

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score?: number;
  published_date?: string;
}

interface TavilySearchResponse {
  results: TavilyResult[];
  answer?: string;
}

async function tavilySearch(
  topic: "general" | "news",
  args: Record<string, unknown>,
  config?: Record<string, string>
): Promise<TavilySearchResponse> {
  const apiKey = config?.api_key?.trim();
  if (!apiKey) {
    throw new ToolFailure(
      "not_configured",
      "Tavily search has no API key configured.",
      "Add your Tavily API key. In the web app: Settings → Toolkits → Tavily. In the TUI: /tools → Tavily Search."
    );
  }

  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) return { results: [] };

  const maxResults = typeof args.max_results === "number" && args.max_results > 0
    ? Math.min(args.max_results, 10)
    : 5;

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      topic,
      max_results: maxResults,
      search_depth: "basic",
    }),
  });

  if (!response.ok) {
    const status = response.status;
    if (status === 401 || status === 403) {
      throw new ToolFailure(
        "api_key_rejected",
        `Tavily rejected the API key (HTTP ${status}).`,
        "Check that the Tavily API key is correct and still active, then replace it. In the web app: Settings → Toolkits → Tavily. In the TUI: /tools → Tavily Search."
      );
    }
    if (status === 429 || status >= 500) {
      throw new ToolFailure(
        "search_unavailable",
        `Tavily search is unavailable right now (HTTP ${status}).`,
        status === 429 ? "Tavily is rate-limiting or out of quota for this key; wait a bit and try again, or check the plan/usage on your Tavily account." : undefined
      );
    }
    const body = (await response.text()).trim();
    const detail = body.length > 300 ? `${body.slice(0, 300)}…` : body;
    throw new ToolFailure("search_failed", `Tavily search failed (HTTP ${status})${detail ? `: ${detail}` : "."}`);
  }

  return response.json() as Promise<TavilySearchResponse>;
}

export const tavilyWebSearchExecutor: ToolExecutor = {
  name: "tavily_web_search",
  async execute(args: Record<string, unknown>, config?: Record<string, string>): Promise<string> {
    const data = await tavilySearch("general", args, config);
    const results = data.results ?? [];
    if (results.length === 0) return JSON.stringify({ result: "No web results found for this query." });
    return JSON.stringify({
      results: results.map(r => ({ title: r.title, url: r.url, snippet: r.content })),
    });
  },
};

export const tavilyNewsSearchExecutor: ToolExecutor = {
  name: "tavily_news_search",
  async execute(args: Record<string, unknown>, config?: Record<string, string>): Promise<string> {
    const data = await tavilySearch("news", args, config);
    const results = data.results ?? [];
    if (results.length === 0) return JSON.stringify({ result: "No news results found for this query." });
    return JSON.stringify({
      results: results.map(r => ({ title: r.title, url: r.url, snippet: r.content, published_date: r.published_date ?? "" })),
    });
  },
};
