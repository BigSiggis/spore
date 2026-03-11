import Anthropic from "@anthropic-ai/sdk";

// Simple semaphore for concurrency control
class Semaphore {
  private queue: (() => void)[] = [];
  private running = 0;

  constructor(private max: number) {}

  async acquire(): Promise<void> {
    if (this.running < this.max) {
      this.running++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.running++;
        resolve();
      });
    });
  }

  release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) next();
  }
}

export interface ClientConfig {
  apiKey?: string;
  concurrency: number;
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
      // Per-token pricing (per million)
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

export class SporeClient {
  private client: Anthropic;
  private semaphore: Semaphore;
  public costTracker = new CostTracker();

  constructor(config: ClientConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
    });
    this.semaphore = new Semaphore(config.concurrency);
  }

  async callHaiku(
    system: string,
    prompt: string,
    maxTokens = 150,
    temperature = 0.95
  ): Promise<string> {
    await this.semaphore.acquire();
    try {
      const response = await this.client.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: maxTokens,
        temperature,
        system,
        messages: [{ role: "user", content: prompt }],
      });

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
      const response = await this.client.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: maxTokens,
        temperature,
        system,
        messages,
      });

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
      const response = await this.client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: maxTokens,
        temperature,
        system,
        messages: [{ role: "user", content: prompt }],
      });

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
}
