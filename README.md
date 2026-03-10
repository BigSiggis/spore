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

# SPORE

**Bio-inspired parallel reasoning framework for Claude.** Intelligence emerges from the density of what survives parallel exploration — like slime mold finding optimal routes.

SPORE throws 9 different reasoning angles at your question simultaneously, scores them, kills the weak ones, breeds the strong ones, and repeats. Dense clusters trigger deep reasoning. The final answer is synthesized from what survived evolutionary pressure — not from a single LLM call.

## How It Works

```
Question → 9 angles × parallel spores → score → prune → breed → repeat
                                                            ↓
                          dense clusters → deep reasoning (Sonnet)
                                                            ↓
                          topology analysis → contradiction mapping → synthesis
```

**Two-Tier System:**
- **Tier 1 (Spores):** Fast Haiku probes. Cheap directional signals across 9 approach angles.
- **Tier 2 (Mycelium):** Sonnet deep reasoning. Only fires where spores cluster together.

**9 Approach Angles:**
`analytical` · `adversarial` · `lateral` · `first-principles` · `pattern-matching` · `steelmanning` · `reductio` · `historical-analogy` · `constraint-relaxation`

**Evolutionary Selection:**
- High scorers spawn 2 children, medium spawn 1, low scorers die
- Scoring rubric: specificity (0.35) + consistency (0.25) + novelty (0.25) - hedge penalty (0.15)
- Scored by a separate judge (not self-eval)

**Pheromone Trails:**
Results persist as JSON trails. Repeat or similar questions get smarter over time via exponential-decay bias injection.

## Install

```bash
git clone https://github.com/BigSiggis/spore.git
cd spore
npm install
npm run build
```

Add your Anthropic API key:
```bash
echo "ANTHROPIC_API_KEY=your-key-here" > .env
```

## Usage

### Interactive Mode
```bash
node dist/cli.js
```

Opens the REPL with the dancing toadstool. Type questions, get stress-tested answers.

### Single-Shot
```bash
node dist/cli.js "Should a startup build or buy auth?"
```

### Quiet Mode (for piping)
```bash
node dist/cli.js --quiet "What's the best database for my use case?"
```

### As a Library
```typescript
import { createSpore } from "spore";

const spore = createSpore({ verbose: true });
const result = await spore.reason("Should we build or buy?");

console.log(result.answer);            // Decisive synthesized answer
console.log(result.topology);          // What survived/died
console.log(result.contradictions);    // Unresolved tensions
console.log(result.approachBreakdown); // Weight of each angle
console.log(result.confidence);        // 0.0 - 1.0
console.log(result.meta.costEstimate); // ~$0.05-0.10 per call
```

### CLI Options
```
--verbose       Show full reasoning trace (spore spawning, scoring, clustering)
--quiet         Just print the answer
--generations N Number of evolution generations (default: 2)
--spores N      Spores per angle per generation (default: 1)
--no-trails     Disable pheromone trail persistence
```

### REPL Commands
```
/help     Show commands
/verbose  Toggle verbose mode
/config   Show current settings
/quit     Exit
```

## Cost

~28 API calls per reasoning run. **~$0.08** at current pricing. Wall clock ~50-80 seconds (parallel execution).

## Architecture

```
src/
  index.ts       Public API: createSpore() → { reason() }
  types.ts       All types/interfaces
  client.ts      Anthropic SDK wrapper + concurrency semaphore
  spore.ts       Tier 1: spawn, angle prompts, child generation
  mycelium.ts    Tier 2: cluster-triggered deep reasoning
  density.ts     Keyword→vector hashing, cosine similarity, agglomerative clustering
  scoring.ts     Batch scoring via Haiku, rubric enforcement
  collapse.ts    Topology analysis + contradiction mapping + weighted synthesis
  pheromone.ts   Trail persistence, exponential decay, bias injection
  cli.ts         Interactive REPL + single-shot CLI
```

## License

MIT
