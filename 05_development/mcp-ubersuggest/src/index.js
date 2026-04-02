import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE_URL = "https://app.neilpatel.com";

// Auth state
let bearerToken = null;
let tokenExpiry = 0;

function getCookieHeader() {
  const jwtToken = process.env.UBERSUGGEST_JWT_TOKEN;
  if (!jwtToken) {
    throw new Error("UBERSUGGEST_JWT_TOKEN environment variable is required");
  }
  return `id=${jwtToken}`;
}

async function refreshToken() {
  const now = Math.floor(Date.now() / 1000);
  if (bearerToken && tokenExpiry > now + 60) {
    return bearerToken;
  }

  const resp = await fetch(`${BASE_URL}/api/get_token`, {
    headers: { Cookie: getCookieHeader() },
  });

  if (!resp.ok) {
    throw new Error(`Failed to get token: ${resp.status} ${resp.statusText}`);
  }

  const data = await resp.json();
  bearerToken = data.token;
  tokenExpiry = data.ttl;
  return bearerToken;
}

async function apiGet(path) {
  const token = await refreshToken();
  const resp = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Cookie: getCookieHeader(),
      ts: String(Math.floor(Date.now() / 1000)),
    },
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`API GET ${path} failed: ${resp.status} - ${text}`);
  }

  return resp.json();
}

async function apiPost(path, body) {
  const token = await refreshToken();
  const resp = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Cookie: getCookieHeader(),
      "Content-Type": "application/json",
      ts: String(Math.floor(Date.now() / 1000)),
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok && resp.status !== 201) {
    const text = await resp.text();
    throw new Error(`API POST ${path} failed: ${resp.status} - ${text}`);
  }

  const text = await resp.text();
  if (!text || text === "null") return null;
  return JSON.parse(text);
}

// Create MCP server
const server = new McpServer({
  name: "ubersuggest",
  version: "1.0.0",
});

// Tool: Keyword Research (match_keywords)
server.tool(
  "ubersuggest_keyword_research",
  "Search for keyword ideas and get SEO metrics (volume, SD, CPC, competition). Returns related keyword suggestions.",
  {
    keyword: z.string().describe("The keyword to research"),
    locId: z
      .string()
      .default("2392")
      .describe("Location ID (default: 2392 for Japan)"),
    language: z
      .string()
      .default("ja")
      .describe("Language code (default: ja)"),
    limit: z
      .number()
      .default(50)
      .describe("Max number of results (default: 50)"),
    sortby: z
      .string()
      .default("-searchVolume")
      .describe("Sort field (default: -searchVolume)"),
  },
  async ({ keyword, locId, language, limit, sortby }) => {
    try {
      const data = await apiPost("/api/match_keywords", {
        keywords: [keyword],
        locId,
        language,
        sortby,
        limit,
        previousKey: 0,
        filters: {},
        domain: "",
      });

      const suggestions = (data.suggestions || []).map((s) => ({
        keyword: s.keyword,
        volume: s.volume,
        sd: s.sd,
        cpc: s.cpcDollars,
        competition: s.competition,
        searchIntent: s.searchIntent,
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { keyword, results: suggestions.length, suggestions },
              null,
              2
            ),
          },
        ],
      };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }] };
    }
  }
);

// Tool: Keyword Overview (detailed metrics for a keyword)
server.tool(
  "ubersuggest_keyword_overview",
  "Get detailed keyword overview including search volume, SD, CPC, and related questions. Uses async task polling.",
  {
    keyword: z.string().describe("The keyword to analyze"),
    locId: z
      .string()
      .default("2392")
      .describe("Location ID (default: 2392 for Japan)"),
    language: z
      .string()
      .default("ja")
      .describe("Language code (default: ja)"),
  },
  async ({ keyword, locId, language }) => {
    try {
      // Step 1: Get suggestions first via match_keywords
      const matchData = await apiPost("/api/match_keywords", {
        keywords: [keyword],
        locId,
        language,
        sortby: "-searchVolume",
        limit: 100,
        previousKey: 0,
        filters: {},
        domain: "",
      });

      const suggestions = (matchData.suggestions || []).map((s) => s.keyword);

      // Step 2: Submit keyword_suggestions_info task
      await apiPost("/api/keyword_suggestions_info", {
        keywords: {
          [keyword]: { suggestions: suggestions.slice(0, 50) },
        },
      });

      // Step 3: Poll for results
      let result = null;
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        result = await apiPost("/api/keyword_suggestions_info_task_status", {
          keywords: [keyword],
          language,
          locId,
          filters: {},
          sortby: "-searchVolume",
        });
        if (result && result.done) break;
      }

      if (!result || !result.done) {
        return {
          content: [{ type: "text", text: "Task timed out. Try again later." }],
        };
      }

      const report = result.report || {};
      const searched =
        report.searched?.keywords?.map((k) => ({
          keyword: k.keyword,
          volume: k.volume,
          sd: k.sd,
          cpc: k.cpcDollars,
          competition: k.competition,
          searchIntent: k.searchIntent,
        })) || [];

      const questions =
        report.questions?.keywords
          ?.filter((k) => k.volume > 0)
          .map((k) => ({
            keyword: k.keyword,
            volume: k.volume,
            sd: k.sd,
            cpc: k.cpcDollars,
          })) || [];

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { keyword, overview: searched, questions },
              null,
              2
            ),
          },
        ],
      };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }] };
    }
  }
);

// Tool: List Projects
server.tool(
  "ubersuggest_projects",
  "List all Ubersuggest projects with their domains, keywords, and competitors.",
  {},
  async () => {
    try {
      const data = await apiGet("/api/projects");
      const projects = (data.projects || []).map((p) => ({
        id: p.id,
        domain: p.domain,
        title: p.title,
        keywords: p.keywords ? Object.keys(p.keywords) : [],
        competitors: p.competitors ? Object.keys(p.competitors) : [],
        status: p.pstatus,
        locations: p.locations,
      }));

      return {
        content: [
          { type: "text", text: JSON.stringify({ projects }, null, 2) },
        ],
      };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }] };
    }
  }
);

// Tool: Rank Tracking
server.tool(
  "ubersuggest_rank_tracking",
  "Get keyword ranking data for a project. Shows position changes over time.",
  {
    projectId: z
      .string()
      .describe("Project ID hash (get from ubersuggest_projects)"),
    startDate: z
      .string()
      .describe("Start date (YYYY-MM-DD)"),
    endDate: z
      .string()
      .describe("End date (YYYY-MM-DD)"),
    device: z
      .string()
      .default("desktop")
      .describe("Device type: desktop or mobile"),
  },
  async ({ projectId, startDate, endDate, device }) => {
    try {
      const data = await apiGet(
        `/api/projects/${projectId}/position_info?startDate=${startDate}&endDate=${endDate}&device=${device}`
      );

      const result = {
        summary: data.summary,
        distribution: data.binned,
        keywords: (data.keywords || []).map((k) => ({
          keyword: k.keyword,
          volume: k.volume,
          sd: k.sd,
          oldPosition: k.old_position?.position,
          newPosition: k.new_position?.position,
          url: k.new_position?.url || k.old_position?.url,
        })),
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }] };
    }
  }
);

// Tool: Traffic Data (via Google Analytics)
server.tool(
  "ubersuggest_traffic",
  "Get organic traffic data for a project via Google Analytics integration.",
  {
    projectId: z
      .string()
      .describe("Project ID hash (get from ubersuggest_projects)"),
    startDate: z
      .string()
      .describe("Start date (YYYY-MM-DD)"),
    endDate: z
      .string()
      .describe("End date (YYYY-MM-DD)"),
    dimension: z
      .string()
      .default("day")
      .describe("Dimension: day, week, or month"),
    device: z
      .string()
      .default("all")
      .describe("Device filter: all, desktop, or mobile"),
  },
  async ({ projectId, startDate, endDate, dimension, device }) => {
    try {
      const data = await apiGet(
        `/api/projects/${projectId}/google_analytics?startDate=${startDate}&endDate=${endDate}&device=${device}&dimension=${dimension}`
      );

      const report = data.report?.data || {};
      const entries = Object.entries(report).map(([date, metrics]) => ({
        date,
        organic: metrics.organic || 0,
      }));

      const totalOrganic = entries.reduce((sum, e) => sum + e.organic, 0);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                totalOrganic,
                period: `${startDate} to ${endDate}`,
                dailyData: entries,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }] };
    }
  }
);

// Tool: SEO Opportunities
server.tool(
  "ubersuggest_seo_opportunities",
  "Get SEO optimization opportunities for a project.",
  {
    projectId: z
      .string()
      .describe("Project ID hash (get from ubersuggest_projects)"),
  },
  async ({ projectId }) => {
    try {
      const data = await apiGet(
        `/api/projects/${projectId}/seo_opportunities`
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }] };
    }
  }
);

// Tool: Usage Limits
server.tool(
  "ubersuggest_usage",
  "Check current API usage limits and remaining reports.",
  {},
  async () => {
    try {
      const [limits, token] = await Promise.all([
        apiGet("/api/user/limits"),
        apiGet("/api/get_token"),
      ]);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                reportsLimit: token.reports_limits,
                reportsUsed: token.reports_used,
                reportsRemaining: token.reports_limits - token.reports_used,
                tokenExpiry: new Date(token.ttl * 1000).toISOString(),
                detailedLimits: limits,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }] };
    }
  }
);

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
