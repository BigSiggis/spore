import Anthropic from "@anthropic-ai/sdk";

// ── Semaphore (promise-queue, no race condition) ─────────────
class Semaphore {
  private waiting: Array<() => void> = [];
  private active = 0;

  constructor(private readonly max: number) {}

  acquire(): Promise<void> {
    return new Promise<void>((resolve) => {
      const tryRun = () => {
        if (this.active < this.max) {
          this.active++;
          resolve();
        } else {
          this.waiting.push(tryRun);
        }
      };
      tryRun();
    });
  }

  release(): void {
    this.active--;
    const next = this.waiting.shift();
    if (next) next();
  }
}

// ── Retry with exponential backoff ───────────────────────────
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 529]);
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      const status = err?.status ?? err?.statusCode;
      if (!RETRYABLE_STATUS.has(status) || attempt === MAX_RETRIES) throw err;
      const delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 500;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

// ── Per-call timeout ─────────────────────────────────────────
const DEFAULT_TIMEOUT_MS = 60_000; // 60s per API call

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

export interface ClientConfig {
  apiKey?: string;
  concurrency: number;
  timeoutMs?: number;
}

export interface CallMetrics {
  inputTokens: number;
  outputTokens: number;
  model: string;
}

// Track cumulative cost across a reasoning session
export class CostTracker {
  private calls: CallMetrics[] = [];

  record(metrics: CallMetrics): void {
    this.calls.push(metrics);
  }

  estimate(): number {
    let total = 0;
    for (const call of this.calls) {
      const rates: Record<string, { input: number; output: number }> = {
        "claude-haiku-4-5": { input: 1.0, output: 5.0 },
        "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
      };
      const rate = rates[call.model] ?? { input: 3.0, output: 15.0 };
      total +=
        (call.inputTokens * rate.input) / 1_000_000 +
        (call.outputTokens * rate.output) / 1_000_000;
    }
    return total;
  }

  get totalCalls(): number {
    return this.calls.length;
  }
}

// ── Cost estimation before execution ─────────────────────────
export interface CostEstimate {
  low: number;
  high: number;
  breakdown: { stage: string; calls: number; model: string }[];
}

export function estimateCost(config: {
  generations: number;
  anglesPerGeneration: number;
  sporesPerAngle: number;
  densityThreshold: number;
}): CostEstimate {
  const { generations, anglesPerGeneration, sporesPerAngle, densityThreshold } = config;

  // Gen 0: one haiku call per angle per spore
  const gen0Spawns = anglesPerGeneration * sporesPerAngle;
  // Scoring: 1 haiku call per generation
  const scoringCalls = generations;
  // Topic classification: 1 haiku call
  const classifyCalls = 1;
  // Session summary: 1 haiku call
  const summaryCalls = 1;
  // Subsequent gens: ~60% survive, high scorers spawn 2, medium 1 → ~1.3x survivors
  let subsequentSpawns = 0;
  let survivors = Math.ceil(gen0Spawns * 0.7);
  for (let g = 1; g < generations; g++) {
    subsequentSpawns += Math.ceil(survivors * 1.3);
    survivors = Math.ceil(survivors * 0.7);
  }

  const totalHaikuCalls = gen0Spawns + subsequentSpawns + scoringCalls + classifyCalls + summaryCalls;

  // Mycelium: assume 2-3 clusters meet density, 1 sonnet each
  const myceliumCalls = Math.max(1, Math.ceil(anglesPerGeneration / densityThreshold));
  // Contradiction mapping: 1 sonnet
  const contradictionCalls = 1;
  // Synthesis: 1 sonnet
  const synthesisCalls = 1;
  // Self-review: 1 sonnet + ~0.3 estimated revision calls
  const reviewCalls = 1;
  const revisionCalls = 0.3;
  const totalSonnetCalls = myceliumCalls + contradictionCalls + synthesisCalls + reviewCalls + revisionCalls;

  // Avg tokens per call (empirical)
  const haikuAvgInput = 800;
  const haikuAvgOutput = 150;
  const sonnetAvgInput = 1500;
  const sonnetAvgOutput = 600;

  const haikuCost = totalHaikuCalls * (haikuAvgInput * 1.0 + haikuAvgOutput * 5.0) / 1_000_000;
  const sonnetCost = totalSonnetCalls * (sonnetAvgInput * 3.0 + sonnetAvgOutput * 15.0) / 1_000_000;

  return {
    low: (haikuCost + sonnetCost) * 0.7,
    high: (haikuCost + sonnetCost) * 1.5,
    breakdown: [
      { stage: "spawning", calls: gen0Spawns + subsequentSpawns, model: "haiku" },
      { stage: "scoring", calls: scoringCalls, model: "haiku" },
      { stage: "classification", calls: classifyCalls + summaryCalls, model: "haiku" },
      { stage: "contradiction-mapping", calls: contradictionCalls, model: "sonnet" },
      { stage: "mycelium", calls: myceliumCalls, model: "sonnet" },
      { stage: "synthesis", calls: synthesisCalls, model: "sonnet" },
      { stage: "self-review", calls: reviewCalls, model: "sonnet" },
      { stage: "revision", calls: revisionCalls, model: "sonnet" },
    ],
  };
}

export class SporeClient {
  private client: Anthropic;
  private semaphore: Semaphore;
  private timeoutMs: number;
  public costTracker = new CostTracker();

  constructor(config: ClientConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
    });
    this.semaphore = new Semaphore(config.concurrency);
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async callHaiku(
    system: string,
    prompt: string,
    maxTokens = 150,
    temperature = 0.95
  ): Promise<string> {
    await this.semaphore.acquire();
    try {
      const response = await withRetry(
        () => withTimeout(
          this.client.messages.create({
            model: "claude-haiku-4-5",
            max_tokens: maxTokens,
            temperature,
            system,
            messages: [{ role: "user", content: prompt }],
          }),
          this.timeoutMs,
          "callHaiku"
        ),
        "callHaiku"
      );

      this.costTracker.record({
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        model: "claude-haiku-4-5",
      });

      const text = response.content.find((b) => b.type === "text");
      return text?.text ?? "";
    } finally {
      this.semaphore.release();
    }
  }

  async callHaikuWithHistory(
    system: string,
    messages: Array<{ role: "user" | "assistant"; content: string }>,
    maxTokens = 500,
    temperature = 0.3
  ): Promise<string> {
    await this.semaphore.acquire();
    try {
      const response = await withRetry(
        () => withTimeout(
          this.client.messages.create({
            model: "claude-haiku-4-5",
            max_tokens: maxTokens,
            temperature,
            system,
            messages,
          }),
          this.timeoutMs,
          "callHaikuWithHistory"
        ),
        "callHaikuWithHistory"
      );

      this.costTracker.record({
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        model: "claude-haiku-4-5",
      });

      const text = response.content.find((b) => b.type === "text");
      return text?.text ?? "";
    } finally {
      this.semaphore.release();
    }
  }

  async callSonnet(
    system: string,
    prompt: string,
    maxTokens = 1500,
    temperature = 0.7
  ): Promise<string> {
    await this.semaphore.acquire();
    try {
      const response = await withRetry(
        () => withTimeout(
          this.client.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: maxTokens,
            temperature,
            system,
            messages: [{ role: "user", content: prompt }],
          }),
          this.timeoutMs,
          "callSonnet"
        ),
        "callSonnet"
      );

      this.costTracker.record({
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        model: "claude-sonnet-4-6",
      });

      const text = response.content.find((b) => b.type === "text");
      return text?.text ?? "";
    } finally {
      this.semaphore.release();
    }
  }

  async *streamSonnet(
    system: string,
    prompt: string,
    maxTokens = 1500,
    temperature = 0.7
  ): AsyncGenerator<string, string, undefined> {
    await this.semaphore.acquire();
    try {
      // Retry wrapper for stream — retries on transient errors before any chunks are yielded
      let lastError: unknown;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const stream = this.client.messages.stream({
            model: "claude-sonnet-4-6",
            max_tokens: maxTokens,
            temperature,
            system,
            messages: [{ role: "user", content: prompt }],
          });

          let fullText = "";
          let lastChunkTime = Date.now();
          const streamTimeout = this.timeoutMs * 2; // streams get 2x timeout for slow generation

          for await (const event of stream) {
            // Check for stalled stream
            if (Date.now() - lastChunkTime > streamTimeout) {
              throw new Error(`streamSonnet stalled — no data for ${streamTimeout}ms`);
            }
            lastChunkTime = Date.now();

            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              fullText += event.delta.text;
              yield event.delta.text;
            }
          }

          const finalMessage = await stream.finalMessage();
          this.costTracker.record({
            inputTokens: finalMessage.usage.input_tokens,
            outputTokens: finalMessage.usage.output_tokens,
            model: "claude-sonnet-4-6",
          });

          return fullText;
        } catch (err: any) {
          lastError = err;
          const status = err?.status ?? err?.statusCode;
          if (!RETRYABLE_STATUS.has(status) || attempt === MAX_RETRIES) throw err;
          const delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 500;
          await new Promise((r) => setTimeout(r, delay));
        }
      }
      throw lastError;
    } finally {
      this.semaphore.release();
    }
  }
}
