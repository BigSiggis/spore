import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import type { SporeClient } from "./client.js";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// ── Data Model ──────────────────────────────────────────────────

export interface SessionEntry {
  sessionId: string;
  topic: string;
  summary: string;
  conclusion: string;
  messages: ChatMessage[]; // compressed — just user messages + last assistant
  timestamp: number;
  decayWeight: number;
}

export interface SessionMemory {
  version: 1;
  sessions: SessionEntry[];
}

const SESSION_FILE = "session-memory.json";
const DECAY_RATE = 0.15; // 15% daily, same as pheromones
const MAX_SESSIONS = 50;
const PRUNE_THRESHOLD = 0.05;

// ── Load / Save ─────────────────────────────────────────────────

export function loadSessionMemory(trailDir: string): SessionMemory {
  const path = join(trailDir, SESSION_FILE);
  if (!existsSync(path)) return { version: 1, sessions: [] };

  try {
    const raw = readFileSync(path, "utf-8");
    const memory = JSON.parse(raw) as SessionMemory;

    // Apply decay
    const now = Date.now();
    memory.sessions = memory.sessions
      .map((s) => {
        const daysSince = (now - s.timestamp) / (1000 * 60 * 60 * 24);
        return {
          ...s,
          decayWeight: s.decayWeight * Math.pow(1 - DECAY_RATE, daysSince),
        };
      })
      .filter((s) => s.decayWeight >= PRUNE_THRESHOLD);

    return memory;
  } catch {
    return { version: 1, sessions: [] };
  }
}

export function saveSessionMemory(trailDir: string, memory: SessionMemory): void {
  mkdirSync(trailDir, { recursive: true });
  const path = join(trailDir, SESSION_FILE);
  writeFileSync(path, JSON.stringify(memory, null, 2), "utf-8");
}

// ── Save a session entry ────────────────────────────────────────

export function saveSession(
  trailDir: string,
  memory: SessionMemory,
  entry: SessionEntry
): void {
  memory.sessions.push(entry);

  // Cap at MAX_SESSIONS, prune lowest weight
  if (memory.sessions.length > MAX_SESSIONS) {
    memory.sessions.sort((a, b) => b.decayWeight - a.decayWeight);
    memory.sessions = memory.sessions.slice(0, MAX_SESSIONS);
  }

  saveSessionMemory(trailDir, memory);
}

// ── Find relevant past sessions ─────────────────────────────────

export function findRelevantSessions(
  memory: SessionMemory,
  prompt: string,
  limit = 3
): SessionEntry[] {
  if (memory.sessions.length === 0) return [];

  const promptLower = prompt.toLowerCase();
  const promptWords = promptLower
    .split(/\s+/)
    .filter((w) => w.length > 3);

  // Score each session by keyword overlap
  const scored = memory.sessions.map((session) => {
    const sessionText = `${session.topic} ${session.summary} ${session.conclusion}`.toLowerCase();
    let matchCount = 0;

    for (const word of promptWords) {
      if (sessionText.includes(word)) matchCount++;
    }

    // Relevance = keyword match ratio * decay weight
    const matchRatio = promptWords.length > 0 ? matchCount / promptWords.length : 0;
    const relevance = matchRatio * session.decayWeight;

    return { session, relevance };
  });

  return scored
    .filter((s) => s.relevance > 0.05) // minimum relevance threshold
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, limit)
    .map((s) => s.session);
}

// ── Summarize conversation history ──────────────────────────────

export async function summarizeHistory(
  client: SporeClient,
  messages: ChatMessage[]
): Promise<{ topic: string; summary: string; conclusion: string }> {
  if (messages.length === 0) {
    return { topic: "empty", summary: "No messages", conclusion: "" };
  }

  const conversationText = messages
    .slice(-10) // last 10 messages
    .map((m) => `${m.role}: ${m.content.slice(0, 200)}`)
    .join("\n");

  const systemPrompt = `Summarize this conversation. Respond with ONLY valid JSON:
{"topic":"2-4 word topic","summary":"2-3 sentence summary of what was discussed","conclusion":"1 sentence key takeaway or decision reached"}`;

  try {
    const raw = await client.callHaiku(systemPrompt, conversationText, 200, 0.2);
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON");
    const parsed = JSON.parse(match[0]);
    return {
      topic: String(parsed.topic ?? "unknown"),
      summary: String(parsed.summary ?? ""),
      conclusion: String(parsed.conclusion ?? ""),
    };
  } catch {
    // Fallback: extract topic from first user message
    const firstUser = messages.find((m) => m.role === "user");
    return {
      topic: firstUser?.content.slice(0, 30) ?? "unknown",
      summary: `${messages.length} message conversation`,
      conclusion: "",
    };
  }
}

// ── Format sessions for prompt injection ────────────────────────

export function formatSessionContext(sessions: SessionEntry[]): string {
  if (sessions.length === 0) return "";

  const parts = sessions.map((s) => {
    const age = Math.floor((Date.now() - s.timestamp) / (1000 * 60 * 60 * 24));
    return `[${s.topic}] (${age}d ago): ${s.summary}${s.conclusion ? `\nConclusion: ${s.conclusion}` : ""}`;
  });

  return parts.join("\n\n");
}

// ── Generate session ID ─────────────────────────────────────────

export function generateSessionId(): string {
  return createHash("sha256")
    .update(`${Date.now()}-${Math.random()}`)
    .digest("hex")
    .slice(0, 12);
}
