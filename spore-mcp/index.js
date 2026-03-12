#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Load .env from SPORE root (keys live there)
const dotenv = require("dotenv");
dotenv.config({ path: new URL("../.env", import.meta.url).pathname });

const { createSpore } = require("../dist/index.js");

// Track last reasoning run's angles for feedback
let lastRunAngles = [];

function getSpore(overrides = {}) {
  return createSpore({
    apiKey: process.env.ANTHROPIC_API_KEY,
    tavilyApiKey: process.env.TAVILY_API_KEY,
    trails: true,
    trailDir: new URL("../trails", import.meta.url).pathname,
    ...overrides,
  });
}

const server = new McpServer({
  name: "spore",
  version: "0.4.0",
});

// ── Tool 1: Full multi-angle reasoning ──────────────────────────
server.tool(
  "spore_reason",
  "Run SPORE multi-angle reasoning on a question. Spawns 9 parallel reasoning angles, scores/prunes/clusters them through evolutionary generations, then synthesizes a final answer. Use for complex questions where you want high-confidence, multi-perspective analysis.",
  {
    question: z.string().describe("The question or prompt to reason about"),
    generations: z.number().optional().describe("Number of evolutionary generations (default 2)"),
    web_grounding: z.boolean().optional().describe("Enable web search grounding (default true)"),
  },
  async ({ question, generations, web_grounding }) => {
    console.error(`[spore] reason: "${question.slice(0, 80)}..."`);
    const overrides = {};
    if (generations !== undefined) overrides.generations = generations;
    if (web_grounding === false) overrides.webGrounding = false;

    const spore = getSpore(overrides);
    const result = await spore.reason(question);

    // Track angles for feedback
    lastRunAngles = result.topology.survivingAngles;

    const output = {
      answer: result.answer,
      confidence: result.confidence,
      topology: {
        shape: result.topology.shape,
        survivingAngles: result.topology.survivingAngles,
        deadAngles: result.topology.deadAngles,
        dominantAngle: result.topology.dominantAngle,
        clusterCount: result.topology.clusterCount,
      },
      contradictions: result.contradictions,
      approachBreakdown: result.approachBreakdown,
      meta: result.meta,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
    };
  }
);

// ── Tool 2: Code-aware reasoning ─────────────────────────────────
server.tool(
  "spore_code_reason",
  "Run SPORE multi-angle reasoning on code. Injects code context into all reasoning angles for bug detection, security analysis, architecture review, and performance analysis.",
  {
    question: z.string().describe("The question or prompt about the code"),
    code: z.string().optional().describe("Raw code string to analyze"),
    files: z.array(z.object({
      path: z.string().describe("File path"),
      content: z.string().describe("File content"),
      language: z.string().optional().describe("Language (auto-detected from path if omitted)"),
    })).optional().describe("Array of code files to analyze"),
    generations: z.number().optional().describe("Number of evolutionary generations (default 2)"),
    web_grounding: z.boolean().optional().describe("Enable web search grounding (default true)"),
  },
  async ({ question, code, files, generations, web_grounding }) => {
    console.error(`[spore] code_reason: "${question.slice(0, 80)}..."`);
    const overrides = {};
    if (generations !== undefined) overrides.generations = generations;
    if (web_grounding === false) overrides.webGrounding = false;

    const spore = getSpore(overrides);
    const { formatCodeContext } = require("../dist/code-context.js");

    // Build code context from either raw code or file array
    const codeFiles = [];
    if (code) {
      codeFiles.push({ path: "input", content: code, language: "unknown" });
    }
    if (files) {
      codeFiles.push(...files);
    }

    const formatted = formatCodeContext(codeFiles);
    const codeContext = codeFiles.length > 0
      ? { files: codeFiles, formatted }
      : undefined;

    const result = await spore.reason(question, codeContext);

    // Track angles for feedback
    lastRunAngles = result.topology.survivingAngles;

    const output = {
      answer: result.answer,
      confidence: result.confidence,
      topology: {
        shape: result.topology.shape,
        survivingAngles: result.topology.survivingAngles,
        deadAngles: result.topology.deadAngles,
        dominantAngle: result.topology.dominantAngle,
        clusterCount: result.topology.clusterCount,
      },
      contradictions: result.contradictions,
      approachBreakdown: result.approachBreakdown,
      meta: result.meta,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
    };
  }
);

// ── Tool 3: Recall past sessions ────────────────────────────────
server.tool(
  "spore_recall",
  "Search SPORE's past conversation sessions by query. Returns relevant conclusions and summaries from previous reasoning sessions.",
  {
    query: z.string().describe("Search query to find relevant past sessions"),
    limit: z.number().optional().describe("Max results to return (default 3)"),
  },
  async ({ query, limit }) => {
    console.error(`[spore] recall: "${query.slice(0, 80)}..."`);
    const { loadSessionMemory, findRelevantSessions } = require("../dist/session-memory.js");
    const trailDir = new URL("../trails", import.meta.url).pathname;
    const memory = loadSessionMemory(trailDir);
    const sessions = findRelevantSessions(memory, query, limit ?? 3);

    if (sessions.length === 0) {
      return {
        content: [{ type: "text", text: JSON.stringify({ sessions: [], message: "No relevant past sessions found" }) }],
      };
    }

    const output = sessions.map(s => ({
      topic: s.topic,
      summary: s.summary,
      conclusion: s.conclusion,
      age: `${Math.floor((Date.now() - s.timestamp) / (1000 * 60 * 60 * 24))} days ago`,
    }));

    return {
      content: [{ type: "text", text: JSON.stringify({ sessions: output }, null, 2) }],
    };
  }
);

// ── Tool 4: Feedback ────────────────────────────────────────────
server.tool(
  "spore_feedback",
  "Give explicit feedback on SPORE's last reasoning result. Adjusts approach memory weights for the angles used — good feedback boosts them, bad feedback reduces them.",
  {
    feedback: z.enum(["good", "bad", "partial"]).describe("Quality of the last reasoning result"),
  },
  async ({ feedback }) => {
    console.error(`[spore] feedback: ${feedback}`);

    if (lastRunAngles.length === 0) {
      return {
        content: [{ type: "text", text: JSON.stringify({ status: "error", message: "No previous reasoning run to give feedback on" }) }],
      };
    }

    const { loadApproachMemory, saveApproachMemory, applyFeedback } = require("../dist/approach-memory.js");
    const trailDir = new URL("../trails", import.meta.url).pathname;
    const memory = loadApproachMemory(trailDir);
    applyFeedback(memory, feedback, lastRunAngles);
    saveApproachMemory(trailDir, memory);

    return {
      content: [{ type: "text", text: JSON.stringify({
        status: "ok",
        feedback,
        anglesAdjusted: lastRunAngles,
        message: `Applied ${feedback} feedback to ${lastRunAngles.length} angles`,
      }, null, 2) }],
    };
  }
);

// ── Start ───────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("SPORE MCP server v0.4.0 running on stdio");
}

main().catch((err) => {
  console.error("SPORE MCP fatal error:", err);
  process.exit(1);
});
