<p align="center">
  <img src="https://img.shields.io/npm/v/spore-reason?style=flat-square&color=orange" alt="npm version" />
  <img src="https://img.shields.io/npm/l/spore-reason?style=flat-square" alt="license" />
  <img src="https://img.shields.io/badge/powered%20by-Claude-blueviolet?style=flat-square" alt="powered by Claude" />
  <img src="https://img.shields.io/badge/inspired%20by-Physarum%20polycephalum-green?style=flat-square" alt="bio-inspired" />
</p>

```
       ▄▄▄████████████▄▄▄
     ██●████●████●████●██
    ████●████████████●████
    ██████████████████████
     ▀▀████████████████▀▀
         ╭────────╮
         │ ◕  ◕ │
         │  ◡◡  │
       ──╰────┬───╯──
           ╭─┴─╮
           │   │
           ╰─┬─╯
        ╌╌╌─┴───┴─╌╌╌

  ███████╗██████╗  ██████╗ ██████╗ ███████╗
  ██╔════╝██╔══██╗██╔═══██╗██╔══██╗██╔════╝
  ███████╗██████╔╝██║   ██║██████╔╝█████╗
  ╚════██║██╔═══╝ ██║   ██║██╔══██╗██╔══╝
  ███████║██║     ╚██████╔╝██║  ██║███████╗
  ╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝╚══════╝

  Simultaneous Parallel Organic Reasoning Engine
```

<h3 align="center">Multi-angle reasoning modeled on the intelligence of fungal networks</h3>

---

## What is SPORE?

SPORE is an evolutionary reasoning engine that thinks about problems the way slime mold solves mazes.

Instead of asking an LLM once and hoping for the best, SPORE **spawns 9 parallel reasoning angles**, scores them through **adversarial selection**, **kills the weak ones**, clusters survivors, fires **deep synthesis** on the strongest clusters, and collapses everything into a single verified answer with a confidence score.

The result: answers that are stress-tested from multiple perspectives before you ever see them.

## The Bio-Inspiration: Physarum polycephalum

SPORE's reasoning model is directly inspired by **Physarum polycephalum** — a brainless, neuron-less slime mold that exhibits stunning problem-solving intelligence — and the broader intelligence observed in **fungal mycelium networks**.

**What Physarum can do:**

- **Solve mazes** — it explores all paths simultaneously, reinforces the shortest route, and lets dead ends decay. No trial-and-error. No backtracking. Just parallel exploration with pruning.
- **Optimize networks** — when researchers placed food at the locations of Tokyo's major stations, Physarum recreated an efficient approximation of the Tokyo rail network. It solved in hours what human engineers took decades to design.
- **Make decisions under uncertainty** — it allocates resources proportionally to the quality of food sources, dynamically rebalancing as conditions change.
- **Remember without a brain** — it leaves chemical traces (extracellular slime) that act as spatial memory, avoiding previously explored dead ends.

**How SPORE mirrors this:**

| Physarum Behavior | SPORE Equivalent |
|---|---|
| Sends exploratory tendrils in all directions | Spawns 9 reasoning probes across different cognitive angles |
| Reinforces successful pathways | High-scoring spores spawn more children |
| Dead ends decay and die | Low-scoring spores get pruned |
| Tendrils merge at convergence points | Keyword-vector clustering groups similar reasoning |
| Thick tubes carry more nutrients | Dense clusters trigger deep Sonnet synthesis (mycelium) |
| Chemical trail memory | Pheromone trails persist productive directions per prompt |
| Network-wide nutrient optimization | Approach memory learns which angles work across all runs |
| Mycelium communication across a forest | Session memory shares context across reasoning runs |

The key insight from fungal intelligence: **you don't need a central brain to make good decisions. You need parallel exploration, competitive selection, and memory.** SPORE applies this to reasoning.

## Features

- **9 General Reasoning Angles** — analytical, adversarial, lateral, first-principles, pattern-matching, steelmanning, reductio, historical-analogy, constraint-relaxation
- **4 Code-Specific Angles** — security-audit, bug-detection, code-architecture, performance (auto-activated when code is provided)
- **Evolutionary Selection** — multi-generation spawn, score, prune, cluster, synthesize
- **Approach Memory** — learns which angles work best for which topics over time
- **Session Memory** — remembers past reasoning runs for context in future analysis
- **Pheromone Trails** — per-prompt persistence biases future runs toward productive directions
- **Code-Aware Scoring** — actionability and severity accuracy dimensions for code analysis
- **Web Grounding** — optional Tavily integration for factual grounding
- **Topology Analysis** — reveals the *shape* of the reasoning (convergent, bipolar, fragmented, monocultural)
- **Contradiction Mapping** — surfaces genuine tensions vs false dichotomies
- **Feedback Loop** — explicit user feedback adjusts angle weights for future runs

## Installation

```bash
npm install spore-reason
```

**Requirements:**
- Node.js >= 18
- Anthropic API key (`ANTHROPIC_API_KEY`)
- Optional: Tavily API key for web grounding (`TAVILY_API_KEY`)

## Quick Start

```typescript
import { createSpore } from 'spore-reason';

const spore = createSpore({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const result = await spore.reason(
  "Should I use PostgreSQL or MongoDB for a social trading app?"
);

console.log(result.answer);          // The synthesized answer
console.log(result.confidence);      // 0-1 confidence score
console.log(result.topology.shape);  // "convergent" | "bipolar" | "fragmented" | "monocultural"
console.log(result.contradictions);  // Tensions found between reasoning angles
```

## Code Analysis

```typescript
import { createSpore, formatCodeContext } from 'spore-reason';

const spore = createSpore({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const files = [
  { path: 'src/auth.ts', content: authFileContent },
  { path: 'src/api.ts', content: apiFileContent },
];

const codeContext = {
  files,
  formatted: formatCodeContext(files),
};

const result = await spore.reason(
  "Review this code for security vulnerabilities and bugs",
  codeContext
);
```

When code is provided, SPORE automatically:
- Activates 4 code-specific angles (security, bugs, architecture, performance)
- Replaces the 4 weakest general angles to keep total spore count at 9
- Uses code-aware scoring (actionability + severity accuracy)
- Extracts code references (file, line, issue) from synthesis

## CLI

```bash
# Install globally
npm install -g spore-reason

# Full reasoning with visualization
spore "What are the tradeoffs between microservices and monoliths?"

# Quiet mode — just the answer
spore --quiet "Is Rust better than Go for CLI tools?"

# Verbose — show the full reasoning trace
spore --verbose "How should I structure a Solana escrow program?"

# Options
spore --generations 3 --no-web "your question"
```

## GitHub Action — Automated PR Review

Add SPORE to your CI pipeline for automatic multi-angle code review on every pull request.

```yaml
# .github/workflows/spore-review.yml
name: SPORE Code Review

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write

jobs:
  spore-review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: agentek-ai/spore/action@main
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          # tavily_api_key: ${{ secrets.TAVILY_API_KEY }}
          # generations: 2
          # max_files: 10
          # file_pattern: '**/*.ts'
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Every PR gets a review comment:

> ### 🍄 SPORE Code Review
> *Multi-angle reasoning modeled on Physarum polycephalum slime mold intelligence*
>
> **[analysis with specific file/line references, security findings, bug risks, architecture notes]**
>
> Confidence: **82%** | Topology: convergent | Angles survived: 7/9

### Action Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `anthropic_api_key` | Yes | — | Anthropic API key |
| `tavily_api_key` | No | — | Tavily API key for web grounding |
| `generations` | No | `2` | Evolutionary generations |
| `max_files` | No | `10` | Max files to include in review |
| `file_pattern` | No | `''` | Glob pattern to filter files |
| `comment_on_pr` | No | `true` | Post results as PR comment |

## MCP Server (Claude Code Integration)

SPORE ships as an MCP server for seamless integration with Claude Code and other MCP clients.

```json
{
  "mcpServers": {
    "spore": {
      "command": "node",
      "args": ["/path/to/spore/spore-mcp/index.js"]
    }
  }
}
```

### MCP Tools

| Tool | Description |
|------|-------------|
| `spore_reason` | Full multi-angle reasoning on any question |
| `spore_code_reason` | Code-aware reasoning with security/bug/arch/perf angles |
| `spore_recall` | Search past reasoning sessions by query |
| `spore_feedback` | Adjust angle weights based on result quality |

## How It Works

```
                    ┌─────────────────────────────────────────┐
                    │         QUESTION / CODE INPUT            │
                    └─────────────┬───────────────────────────┘
                                  │
                    ┌─────────────▼───────────────────────────┐
                    │     APPROACH MEMORY + TOPIC CLASSIFY      │
                    │  (which angles work best for this type?)  │
                    └─────────────┬───────────────────────────┘
                                  │
              ┌───────────────────▼───────────────────────────┐
              │              GENERATION 0: SPAWN               │
              │                                                │
              │  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐          │
              │  │ AN │ │ AD │ │ LA │ │ FP │ │ PM │ ...x9    │
              │  └──┬─┘ └──┬─┘ └──┬─┘ └──┬─┘ └──┬─┘          │
              │     └──────┴──────┴──────┴──────┘              │
              └───────────────────┬───────────────────────────┘
                                  │
              ┌───────────────────▼───────────────────────────┐
              │              SCORE (batch Haiku call)           │
              │  specificity · consistency · novelty · hedge    │
              │  + actionability · severity (when code present) │
              └───────────────────┬───────────────────────────┘
                                  │
              ┌───────────────────▼───────────────────────────┐
              │              PRUNE (kill the weak)              │
              │     ████░░░░  survived: 6/9                    │
              └───────────────────┬───────────────────────────┘
                                  │
              ┌───────────────────▼───────────────────────────┐
              │              CLUSTER (keyword vectors)          │
              │    [cluster A: 3 spores] [cluster B: 2 spores] │
              └───────────────────┬───────────────────────────┘
                                  │
              ┌───────────────────▼───────────────────────────┐
              │         MYCELIUM (Sonnet deep synthesis)        │
              │    Fires on dense clusters only                 │
              └───────────────────┬───────────────────────────┘
                                  │
              ┌───────────────────▼───────────────────────────┐
              │         GENERATION 1+: EVOLVE                   │
              │    High scorers → 2 children                    │
              │    Medium scorers → 1 child                     │
              │    Repeat: score → prune → cluster → mycelium   │
              └───────────────────┬───────────────────────────┘
                                  │
              ┌───────────────────▼───────────────────────────┐
              │              COLLAPSE                           │
              │  1. Topology analysis (shape of reasoning)      │
              │  2. Contradiction mapping (genuine tensions)    │
              │  3. Weighted synthesis (Sonnet, temp 0.3)       │
              └───────────────────┬───────────────────────────┘
                                  │
              ┌───────────────────▼───────────────────────────┐
              │           PERSIST + LEARN                       │
              │  • Pheromone trails (per-prompt memory)         │
              │  • Approach memory (per-angle learning)         │
              │  • Session memory (cross-run recall)            │
              └───────────────────────────────────────────────┘
```

## Configuration

```typescript
const spore = createSpore({
  // API Keys
  apiKey: 'sk-...',
  tavilyApiKey: 'tvly-...',        // optional

  // Reasoning
  generations: 2,                   // Evolutionary generations
  sporesPerAngle: 1,               // Spores per angle per gen
  pruneThreshold: 0.3,             // Min score to survive
  clusterSimilarity: 0.55,         // Cosine similarity for clustering
  densityThreshold: 2,             // Min cluster size for mycelium

  // Features
  trails: true,                     // Pheromone trail persistence
  trailDir: './trails',
  approachMemory: true,             // Cross-run angle learning
  webGrounding: true,               // Web search grounding

  // Performance
  concurrency: 20,                  // Max parallel API calls
  verbose: false,                   // Reasoning trace output

  // Events
  onEvent: (event) => { ... },     // Pipeline event callback
});
```

## Result Shape

```typescript
{
  answer: string;
  confidence: number;              // 0-1
  topology: {
    shape: "convergent" | "bipolar" | "fragmented" | "monocultural";
    survivingAngles: string[];
    deadAngles: string[];
    dominantAngle: string | null;
    clusterCount: number;
  };
  contradictions: [{
    between: [string, string];
    type: "genuine" | "false-dichotomy" | "irreconcilable";
    explanation: string;
  }];
  approachBreakdown: Record<string, number>;
  meta: {
    generations: number;
    totalSpores: number;
    survivingSpores: number;
    myceliumCalls: number;
    costEstimate: number;
    wallClockMs: number;
  };
}
```

## Topology — Reading the Shape

| Shape | What Happened | Signal |
|-------|--------------|--------|
| **convergent** | All angles agreed | High confidence — multiple perspectives reached same conclusion |
| **bipolar** | Two camps formed | Genuine tension exists — answer navigates both sides |
| **fragmented** | No agreement | Problem is complex or underdetermined — be skeptical |
| **monocultural** | One angle dominated | Answer may be one-sided — note which angle dominated |

## Cost

SPORE uses ~15-20 API calls per run. Designed for questions where being wrong is expensive.

| Component | Model | Calls | Est. Cost |
|-----------|-------|-------|-----------|
| Spore spawning | Haiku | 9/gen | ~$0.005 |
| Scoring | Haiku | 1/gen | ~$0.001 |
| Topic classify | Haiku | 1 | ~$0.0001 |
| Mycelium | Sonnet | 1-3/gen | ~$0.01 |
| Collapse | Sonnet + Haiku | 2-3 | ~$0.01 |
| **Total (2 gen)** | | **~18-25** | **~$0.03-0.05** |

## Why Not Just Prompt Better?

You could ask Claude "think about this from 9 angles" in one prompt. But:

- **Serial contamination** — each angle is influenced by the ones before it
- **No adversarial pressure** — weak reasoning persists, nothing gets killed
- **No evolution** — ideas don't compete and improve across generations
- **No clustering** — you can't see which ideas naturally converge
- **No memory** — it doesn't get better at familiar problem types over time
- **No topology** — you have no idea *how* the answer was reached

SPORE's parallel-then-prune approach produces reasoning that has **earned its survival** through competition — just like Physarum's optimal pathways emerge from the death of suboptimal ones.

## Architecture

```
src/
  index.ts            Pipeline orchestrator — createSpore() entry point
  types.ts            All types, interfaces, angle definitions
  spore.ts            Tier 1: spawn probes, angle prompts, child generation
  scoring.ts          Batch scoring via Haiku, code-aware rubric
  density.ts          Keyword vectors, cosine similarity, clustering
  mycelium.ts         Tier 2: Sonnet synthesis on dense clusters
  collapse.ts         Topology analysis + contradiction mapping + synthesis
  pheromone.ts        Per-prompt trail persistence with decay
  approach-memory.ts  Cross-run angle learning with feedback
  session-memory.ts   Reasoning session persistence and recall
  code-context.ts     Code formatting and smart truncation
  angle-selector.ts   Dynamic angle selection (general vs code)
  client.ts           Anthropic SDK wrapper + concurrency control
  cli.ts              Terminal interface + visualization
  visualizer.ts       Real-time pipeline visualization
  web.ts              Tavily web grounding integration

spore-mcp/
  index.js            MCP server (4 tools)

action/
  action.yml          GitHub Action definition
  index.js            PR review automation
```

## License

MIT

---

<p align="center">
  <em>Built by <a href="https://github.com/agentek-ai">Agentek</a></em>
  <br/>
  <em>Inspired by the intelligence of fungi</em>
  <br/><br/>
  🍄
</p>
