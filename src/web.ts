// Tavily web search grounding — native fetch, no deps

interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

interface TavilyResponse {
  results: TavilyResult[];
}

export async function tavilySearch(
  query: string,
  apiKey: string,
  maxResults = 5
): Promise<string | null> {
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: maxResults,
        search_depth: "basic",
      }),
    });

    if (!res.ok) return null;

    const data = (await res.json()) as TavilyResponse;
    if (!data.results?.length) return null;

    return data.results
      .map(
        (r, i) =>
          `${i + 1}. [${r.title}](${r.url}): ${r.content.slice(0, 200)}`
      )
      .join("\n");
  } catch {
    // Network failure — pipeline continues ungrounded
    return null;
  }
}

export function formatForCluster(
  conclusion: string,
  prompt: string
): string {
  // Build a targeted verification query from the cluster's conclusion + original prompt
  const keywords = conclusion
    .split(/\s+/)
    .filter((w) => w.length > 4)
    .slice(0, 5)
    .join(" ");
  return `${keywords} ${prompt}`.slice(0, 400);
}
