#!/usr/bin/env node
import { config } from "dotenv";
import { join } from "path";

// Load .env from the spore project root, not cwd
config({ path: join(__dirname, "..", ".env") });

import { createSpore } from "./index.js";
import type { ReasonResult } from "./types.js";
import { SporeVisualizer } from "./visualizer.js";

// ── ANSI Colors ────────────────────────────────────────────────
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  // Mushroom palette
  spore: "\x1b[38;5;179m",   // warm tan
  cap: "\x1b[38;5;167m",     // red-brown
  stem: "\x1b[38;5;223m",    // cream
  glow: "\x1b[38;5;214m",    // amber glow
  mycelium: "\x1b[38;5;141m", // purple
  green: "\x1b[38;5;114m",   // soft green
  gray: "\x1b[38;5;245m",
  white: "\x1b[38;5;255m",
  red: "\x1b[38;5;203m",
  cyan: "\x1b[38;5;117m",
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Animated Splash ────────────────────────────────────────────
const DANCE_FRAMES = [
  // Frame 0: standing center
  [
    `${c.cap}       ▄▄▄████████████▄▄▄`,
    `${c.cap}     ██${c.white}●${c.cap}████${c.white}●${c.cap}████${c.white}●${c.cap}████${c.white}●${c.cap}██`,
    `${c.cap}    ████${c.white}●${c.cap}████████████${c.white}●${c.cap}████`,
    `${c.cap}    ██████████████████████`,
    `${c.cap}     ▀▀████████████████▀▀`,
    `${c.stem}         ╭────────╮`,
    `${c.stem}         │ ${c.green}◕${c.stem}  ${c.green}◕${c.stem} │`,
    `${c.stem}         │  ${c.glow}◡◡${c.stem}  │`,
    `${c.stem}       ${c.spore}──${c.stem}╰────┬───╯${c.spore}──`,
    `${c.stem}           ${c.spore}╭─┴─╮`,
    `${c.stem}           ${c.spore}│   │`,
    `${c.stem}           ${c.spore}╰─┬─╯`,
    `${c.mycelium}        ╌╌╌─┴───┴─╌╌╌`,
  ],
  // Frame 1: shifted right
  [
    `${c.cap}          ▄▄▄████████████▄▄▄`,
    `${c.cap}        ██${c.white}●${c.cap}████${c.white}●${c.cap}████${c.white}●${c.cap}████${c.white}●${c.cap}██`,
    `${c.cap}       ████${c.white}●${c.cap}████████████${c.white}●${c.cap}████`,
    `${c.cap}       ██████████████████████`,
    `${c.cap}        ▀▀████████████████▀▀`,
    `${c.stem}            ╭────────╮`,
    `${c.stem}            │  ${c.green}◕${c.stem} ${c.green}◕${c.stem} │`,
    `${c.stem}            │   ${c.glow}◡◡${c.stem} │`,
    `${c.stem}          ${c.spore}──${c.stem}╰────┬───╯${c.spore}──`,
    `${c.stem}              ${c.spore}╭─┴─╮`,
    `${c.stem}              ${c.spore}│   │`,
    `${c.stem}              ${c.spore}╰─┬─╯`,
    `${c.mycelium}           ╌╌╌─┴───┴─╌╌╌`,
  ],
  // Frame 2: shifted left
  [
    `${c.cap}    ▄▄▄████████████▄▄▄`,
    `${c.cap}  ██${c.white}●${c.cap}████${c.white}●${c.cap}████${c.white}●${c.cap}████${c.white}●${c.cap}██`,
    `${c.cap} ████${c.white}●${c.cap}████████████${c.white}●${c.cap}████`,
    `${c.cap} ██████████████████████`,
    `${c.cap}  ▀▀████████████████▀▀`,
    `${c.stem}      ╭────────╮`,
    `${c.stem}      │ ${c.green}◕${c.stem} ${c.green}◕${c.stem}  │`,
    `${c.stem}      │ ${c.glow}◡◡${c.stem}   │`,
    `${c.stem}    ${c.spore}──${c.stem}╰────┬───╯${c.spore}──`,
    `${c.stem}        ${c.spore}╭─┴─╮`,
    `${c.stem}        ${c.spore}│   │`,
    `${c.stem}        ${c.spore}╰─┬─╯`,
    `${c.mycelium}     ╌╌╌─┴───┴─╌╌╌`,
  ],
  // Frame 3: center settle
  [
    `${c.cap}       ▄▄▄████████████▄▄▄`,
    `${c.cap}     ██${c.white}●${c.cap}████${c.white}●${c.cap}████${c.white}●${c.cap}████${c.white}●${c.cap}██`,
    `${c.cap}    ████${c.white}●${c.cap}████████████${c.white}●${c.cap}████`,
    `${c.cap}    ██████████████████████`,
    `${c.cap}     ▀▀████████████████▀▀`,
    `${c.stem}         ╭────────╮`,
    `${c.stem}         │ ${c.green}◕${c.stem}  ${c.green}◕${c.stem} │`,
    `${c.stem}         │  ${c.glow}◡◡${c.stem}  │`,
    `${c.stem}       ${c.spore}──${c.stem}╰────┬───╯${c.spore}──`,
    `${c.stem}           ${c.spore}╭─┴─╮`,
    `${c.stem}           ${c.spore}│   │`,
    `${c.stem}           ${c.spore}╰─┬─╯`,
    `${c.mycelium}        ╌╌╌─┴───┴─╌╌╌`,
  ],
];

const TITLE = [
  `${c.glow}${c.bold}  ███████╗██████╗  ██████╗ ██████╗ ███████╗`,
  `${c.glow}  ██╔════╝██╔══██╗██╔═══██╗██╔══██╗██╔════╝`,
  `${c.spore}  ███████╗██████╔╝██║   ██║██████╔╝█████╗  `,
  `${c.spore}  ╚════██║██╔═══╝ ██║   ██║██╔══██╗██╔══╝  `,
  `${c.cap}  ███████║██║     ╚██████╔╝██║  ██║███████╗`,
  `${c.cap}  ╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝╚══════╝`,
];

async function animateSplash(): Promise<void> {
  console.clear();
  process.stdout.write("\x1b[?25l"); // hide cursor

  const frameOrder = [1, 0, 2, 0, 1, 0, 2, 3];
  const frameHeight = DANCE_FRAMES[0].length + 1;

  console.log();
  for (const line of DANCE_FRAMES[0]) {
    console.log(line + c.reset);
  }

  for (const fi of frameOrder) {
    await sleep(220);
    process.stdout.write(`\x1b[${frameHeight}A`);
    console.log();
    for (const line of DANCE_FRAMES[fi]) {
      process.stdout.write("\x1b[K");
      console.log(line + c.reset);
    }
  }
  console.log();

  for (const line of TITLE) {
    console.log(line + c.reset);
    await sleep(40);
  }
  console.log();

  const tagline = "  Simultaneous Parallel Organic Reasoning Engine";
  process.stdout.write(`${c.dim}${c.stem}`);
  for (const ch of tagline) {
    process.stdout.write(ch);
    await sleep(15);
  }
  console.log(c.reset);

  console.log(`${c.gray}  v0.3.0 — multi-angle reasoning · code analysis · approach memory${c.reset}`);
  console.log(`${c.gray}  Pass a question as argument, or use as MCP server${c.reset}`);
  console.log();

  process.stdout.write("\x1b[?25h"); // show cursor
}

// ── Spinner ────────────────────────────────────────────────────
class Spinner {
  private frames = ["◜", "◠", "◝", "◞", "◡", "◟"];
  private i = 0;
  private interval: ReturnType<typeof setInterval> | null = null;
  private msg: string;

  constructor(msg: string) {
    this.msg = msg;
  }

  start(): void {
    process.stdout.write("\x1b[?25l"); // hide cursor
    this.interval = setInterval(() => {
      const frame = this.frames[this.i % this.frames.length];
      process.stdout.write(`\r${c.glow}  ${frame}${c.reset} ${c.dim}${this.msg}${c.reset}`);
      this.i++;
    }, 80);
  }

  update(msg: string): void {
    this.msg = msg;
  }

  stop(finalMsg?: string): void {
    if (this.interval) clearInterval(this.interval);
    process.stdout.write("\r\x1b[K"); // clear line
    process.stdout.write("\x1b[?25h"); // show cursor
    if (finalMsg) {
      console.log(`${c.green}  ✓${c.reset} ${finalMsg}`);
    }
  }
}

// ── Full SPORE Result Display ──────────────────────────────────
function displayFullResult(result: ReasonResult): void {
  console.log();
  console.log(`${c.glow}${c.bold}  ┌${"─".repeat(60)}┐${c.reset}`);
  console.log(`${c.glow}${c.bold}  │${c.reset}${c.bold}  DEEP REASONING${" ".repeat(45)}${c.glow}│${c.reset}`);
  console.log(`${c.glow}${c.bold}  └${"─".repeat(60)}┘${c.reset}`);
  console.log();

  wordWrap(result.answer);

  // Confidence bar
  console.log();
  const conf = result.confidence;
  const confPct = (conf * 100).toFixed(0);
  const confBar = "█".repeat(Math.round(conf * 20));
  const confEmpty = "░".repeat(20 - Math.round(conf * 20));
  const confColor = conf >= 0.8 ? c.green : conf >= 0.5 ? c.glow : c.red;
  console.log(`${c.dim}  confidence ${confColor}${confBar}${c.gray}${confEmpty}${c.reset} ${confColor}${c.bold}${confPct}%${c.reset}`);

  // Topology
  const shapeIcon =
    result.topology.shape === "convergent" ? "⊕" :
    result.topology.shape === "bipolar" ? "⊖" :
    result.topology.shape === "monocultural" ? "◉" : "◈";
  console.log(`${c.dim}  topology   ${c.mycelium}${shapeIcon} ${result.topology.shape}${c.reset}`);

  if (result.topology.deadAngles.length > 0) {
    console.log(`${c.dim}  killed     ${c.red}${result.topology.deadAngles.join(", ")}${c.reset}`);
  }

  // Tensions
  if (result.contradictions.length > 0) {
    console.log();
    console.log(`${c.cap}  ⚡ ${result.contradictions.length} tension(s)${c.reset}`);
    for (const t of result.contradictions) {
      const icon = t.type === "genuine" ? "◆" : t.type === "irreconcilable" ? "◆" : "◇";
      console.log(`${c.gray}   ${icon} [${t.type}] ${t.explanation.slice(0, 100)}${c.reset}`);
    }
  }

  // Top angles
  console.log();
  const sorted = Object.entries(result.approachBreakdown)
    .sort(([, a], [, b]) => (b as number) - (a as number))
    .filter(([, v]) => (v as number) > 0)
    .slice(0, 5);

  for (const [angle, weight] of sorted) {
    const w = weight as number;
    const bar = "█".repeat(Math.round(w * 15));
    const pct = (w * 100).toFixed(0).padStart(3);
    console.log(`${c.dim}  ${angle.padEnd(22)}${c.spore}${bar}${c.reset} ${c.dim}${pct}%${c.reset}`);
  }

  // Meta line
  console.log();
  console.log(
    `${c.gray}  ${result.meta.totalSpores} spores · ${result.meta.myceliumCalls} deep · $${result.meta.costEstimate.toFixed(3)} · ${(result.meta.wallClockMs / 1000).toFixed(1)}s${c.reset}`
  );
  console.log();
}

function wordWrap(text: string): void {
  const words = text.split(" ");
  let line = "  ";
  for (const word of words) {
    if (line.length + word.length > 76) {
      console.log(`${c.white}${line}${c.reset}`);
      line = "  " + word + " ";
    } else {
      line += word + " ";
    }
  }
  if (line.trim()) console.log(`${c.white}${line}${c.reset}`);
}

// ── Parse CLI Args ─────────────────────────────────────────────
const args = process.argv.slice(2);
const flags: Record<string, string> = {};
const positional: string[] = [];

for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith("--")) {
    const key = args[i].slice(2);
    const next = args[i + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = "true";
    }
  } else {
    positional.push(args[i]);
  }
}

// ── Main ───────────────────────────────────────────────────────
let verbose = flags["verbose"] === "true";

const sporeConfig: Partial<import("./types.js").SporeConfig> = {
  verbose: false, // we handle display ourselves
  trails: flags["no-trails"] !== "true",
  tavilyApiKey: process.env.TAVILY_API_KEY,
  webGrounding: flags["no-web"] !== "true",
};
// Only set overrides if flags are provided — undefined values would clobber defaults
if (flags["generations"]) sporeConfig.generations = parseInt(flags["generations"]);
if (flags["spores"]) sporeConfig.sporesPerAngle = parseInt(flags["spores"]);

// Quiet single-shot mode (always uses full SPORE)
if (flags["quiet"] === "true" && positional.length > 0) {
  const spore = createSpore(sporeConfig);
  spore.reason(positional.join(" ")).then((result) => {
    console.log(result.answer);
  }).catch((err: any) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
} else if (positional.length > 0) {
  // Single-shot with display (full SPORE)
  (async () => {
    await animateSplash();
    const question = positional.join(" ");
    console.log(`${c.dim}  ▸ ${c.white}${question}${c.reset}\n`);

    if (verbose) {
      // Verbose mode: raw logs, no viz
      const spore = createSpore({ ...sporeConfig, verbose: true });
      const spinner = new Spinner("Spawning spores...");
      spinner.start();
      const result = await spore.reason(question);
      spinner.stop("Reasoning complete");
      displayFullResult(result);
    } else {
      // Visualization mode
      const viz = new SporeVisualizer();
      const spore = createSpore({ ...sporeConfig, verbose: false, onEvent: viz.createCallback() });
      viz.start();
      const result = await spore.reason(question);
      viz.stop();
      displayFullResult(result);
    }
  })().catch((err: any) => {
    process.stdout.write("\x1b[?25h"); // ensure cursor visible on error
    console.error(`\n${c.red}  Error: ${err.message ?? err}${c.reset}`);
    process.exit(1);
  });
} else {
  // No question provided — show usage
  (async () => {
    await animateSplash();
    console.log();
    console.log(`${c.glow}${c.bold}  Usage:${c.reset}`);
    console.log(`${c.white}    spore "your question here"${c.gray}         Full reasoning with visualization${c.reset}`);
    console.log(`${c.white}    spore --quiet "your question"${c.gray}      Just the answer${c.reset}`);
    console.log(`${c.white}    spore --verbose "your question"${c.gray}    Show reasoning trace${c.reset}`);
    console.log();
    console.log(`${c.dim}  Options:${c.reset}`);
    console.log(`${c.white}    --generations N${c.gray}    Number of evolutionary generations (default 2)${c.reset}`);
    console.log(`${c.white}    --spores N${c.gray}         Spores per angle (default 1)${c.reset}`);
    console.log(`${c.white}    --no-trails${c.gray}        Disable persistence${c.reset}`);
    console.log(`${c.white}    --no-web${c.gray}           Disable web grounding${c.reset}`);
    console.log();
  })();
}
