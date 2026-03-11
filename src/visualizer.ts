import type {
  Angle,
  Spore,
  Cluster,
  PipelineEvent,
  PipelineCallback,
  TopologyAnalysis,
} from "./types.js";
import { ANGLES } from "./types.js";

// ── ANSI helpers ────────────────────────────────────────
const ESC = "\x1b";
const c = {
  reset: `${ESC}[0m`,
  bold: `${ESC}[1m`,
  dim: `${ESC}[2m`,
  // Mushroom palette
  spore: `${ESC}[38;5;179m`,
  cap: `${ESC}[38;5;167m`,
  stem: `${ESC}[38;5;223m`,
  glow: `${ESC}[38;5;214m`,
  mycelium: `${ESC}[38;5;141m`,
  green: `${ESC}[38;5;114m`,
  gray: `${ESC}[38;5;245m`,
  dimGray: `${ESC}[38;5;240m`,
  white: `${ESC}[38;5;255m`,
  red: `${ESC}[38;5;203m`,
  cyan: `${ESC}[38;5;117m`,
  amber: `${ESC}[38;5;214m`,
  purple: `${ESC}[38;5;141m`,
  brightPurple: `${ESC}[38;5;177m`,
};

const CLUSTER_COLORS = [c.purple, c.cyan, c.amber, c.green];

// Short labels for the 3x3 grid
const ANGLE_SHORT: Record<Angle, string> = {
  analytical: "analytical",
  adversarial: "adversarial",
  lateral: "lateral",
  "first-principles": "first-princ",
  "pattern-matching": "pattern-mat",
  steelmanning: "steelman",
  reductio: "reductio",
  "historical-analogy": "hist-analog",
  "constraint-relaxation": "constraint",
  "security-audit": "security",
  "bug-detection": "bug-detect",
  "code-architecture": "code-arch",
  performance: "performance",
};

type NodeState = "waiting" | "spawned" | "scored-high" | "scored-low" | "pruned" | "clustered" | "mycelium";

interface NodeInfo {
  state: NodeState;
  score: number;
  clusterId: number | null;
  clusterColor: string;
}

// ── SporeVisualizer ─────────────────────────────────────
export class SporeVisualizer {
  private nodes: Map<Angle, NodeInfo> = new Map();
  private clusters: Cluster[] = [];
  private clusterColorMap: Map<number, string> = new Map();
  private generation = 0;
  private statusLine = "";
  private renderInterval: ReturnType<typeof setInterval> | null = null;
  private lastFrame = "";
  private totalHeight = 0;
  private started = false;
  private gen1Spores: Spore[] = [];
  private gen1Mode = false;
  private myceliumFiring = 0;
  private myceliumDone = 0;
  private collapsePhase = false;
  private topologyShape = "";
  private done = false;

  constructor() {
    this.reset();
  }

  private reset(): void {
    this.nodes.clear();
    for (const angle of ANGLES) {
      this.nodes.set(angle, {
        state: "waiting",
        score: 0,
        clusterId: null,
        clusterColor: c.dimGray,
      });
    }
    this.clusters = [];
    this.clusterColorMap.clear();
    this.generation = 0;
    this.statusLine = "Initializing...";
    this.gen1Spores = [];
    this.gen1Mode = false;
    this.myceliumFiring = 0;
    this.myceliumDone = 0;
    this.collapsePhase = false;
    this.topologyShape = "";
    this.done = false;
  }

  createCallback(): PipelineCallback {
    return (event: PipelineEvent) => this.handleEvent(event);
  }

  private handleEvent(event: PipelineEvent): void {
    this.generation = event.generation;

    switch (event.stage) {
      case "web-search":
        this.statusLine = "Searching web...";
        break;

      case "spawn-start":
        if (event.generation === 0) {
          this.statusLine = `Spawning ${event.data?.totalSpores ?? 9} spores...`;
        } else {
          this.gen1Mode = true;
          this.gen1Spores = [];
          this.statusLine = `Gen ${event.generation}: spawning children...`;
        }
        break;

      case "spawn-spore": {
        const spore = event.data?.spore;
        if (!spore) break;
        if (event.generation === 0) {
          const node = this.nodes.get(spore.angle);
          if (node) node.state = "spawned";
        } else {
          this.gen1Spores.push(spore);
        }
        break;
      }

      case "spawn-done":
        if (event.generation === 0) {
          this.statusLine = `Scoring ${event.data?.spores?.length ?? 9} spores...`;
        } else {
          this.statusLine = `Scoring ${this.gen1Spores.length} gen-${event.generation} spores...`;
        }
        break;

      case "score-done": {
        const spores = event.data?.spores ?? [];
        if (event.generation === 0) {
          for (const s of spores) {
            const node = this.nodes.get(s.angle);
            if (node) {
              node.score = s.score;
              node.state = s.score >= 0.5 ? "scored-high" : "scored-low";
            }
          }
        } else {
          this.gen1Spores = spores;
        }
        this.statusLine = "Pruning...";
        break;
      }

      case "prune-done": {
        const spores = event.data?.spores ?? [];
        if (event.generation === 0) {
          for (const s of spores) {
            if (!s.alive) {
              const node = this.nodes.get(s.angle);
              if (node) node.state = "pruned";
            }
          }
        } else {
          this.gen1Spores = spores;
        }
        this.statusLine = `${event.data?.aliveCount ?? "?"} alive, ${event.data?.deadCount ?? "?"} pruned`;
        break;
      }

      case "cluster-done": {
        this.clusters = event.data?.clusters ?? [];
        this.clusterColorMap.clear();
        for (let i = 0; i < this.clusters.length; i++) {
          this.clusterColorMap.set(this.clusters[i].id, CLUSTER_COLORS[i % CLUSTER_COLORS.length]);
        }
        if (event.generation === 0) {
          // Assign cluster info to nodes
          for (const cl of this.clusters) {
            const clColor = this.clusterColorMap.get(cl.id) ?? c.purple;
            const spores = event.data?.spores ?? [];
            for (const sid of cl.sporeIds) {
              const spore = spores.find(s => s.id === sid);
              if (spore) {
                const node = this.nodes.get(spore.angle);
                if (node && node.state !== "pruned") {
                  node.state = "clustered";
                  node.clusterId = cl.id;
                  node.clusterColor = clColor;
                }
              }
            }
          }
        }
        this.statusLine = `${this.clusters.length} cluster(s) formed`;
        break;
      }

      case "mycelium-start": {
        const dense = (event.data?.clusters ?? []).filter(cl => cl.sporeIds.length >= 2);
        this.myceliumFiring = dense.length;
        this.myceliumDone = 0;
        this.statusLine = `Mycelium: firing on ${this.myceliumFiring} cluster(s)...`;
        break;
      }

      case "mycelium-fire": {
        this.myceliumDone++;
        // Mark nodes in this cluster as mycelium
        const cluster = event.data?.cluster;
        if (cluster && event.generation === 0) {
          for (const sid of cluster.sporeIds) {
            for (const [angle, node] of this.nodes) {
              if (node.clusterId === cluster.id && node.state === "clustered") {
                node.state = "mycelium";
              }
            }
          }
        }
        this.statusLine = `Mycelium: ${this.myceliumDone}/${this.myceliumFiring} complete`;
        break;
      }

      case "mycelium-done":
        this.statusLine = "Mycelium synthesis complete";
        break;

      case "collapse-start":
        this.collapsePhase = true;
        this.statusLine = "Collapsing topology...";
        break;

      case "collapse-topology": {
        const topo = event.data?.topology;
        if (topo) this.topologyShape = topo.shape;
        this.statusLine = `Topology: ${this.topologyShape}`;
        break;
      }

      case "collapse-done":
        this.statusLine = "Synthesis complete";
        this.done = true;
        break;
    }
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.lastFrame = "";
    this.totalHeight = 0;

    process.stdout.write(`${ESC}[?25l`); // hide cursor
    console.log(); // blank line before viz

    this.renderInterval = setInterval(() => this.render(), 100);
  }

  stop(): void {
    if (this.renderInterval) clearInterval(this.renderInterval);
    this.renderInterval = null;

    // Final render
    this.render();

    // Clear the viz area
    if (this.totalHeight > 0) {
      process.stdout.write(`${ESC}[${this.totalHeight}A`);
      for (let i = 0; i < this.totalHeight; i++) {
        process.stdout.write(`${ESC}[K\n`);
      }
      process.stdout.write(`${ESC}[${this.totalHeight}A`);
    }

    process.stdout.write(`${ESC}[?25h`); // show cursor
    this.started = false;
  }

  private render(): void {
    const lines = this.buildFrame();
    const frame = lines.join("\n");

    if (frame === this.lastFrame) return;

    // Move cursor up to overwrite previous frame
    if (this.totalHeight > 0) {
      process.stdout.write(`${ESC}[${this.totalHeight}A`);
    }

    for (const line of lines) {
      process.stdout.write(`${ESC}[K${line}\n`);
    }

    this.totalHeight = lines.length;
    this.lastFrame = frame;
  }

  private buildFrame(): string[] {
    const lines: string[] = [];

    // Header
    lines.push(`${c.dim}  ── ${c.glow}SPORE${c.dim} gen ${this.generation} ${"─".repeat(45)}${c.reset}`);
    lines.push("");

    if (!this.gen1Mode) {
      // Gen 0: 3x3 grid
      const grid = this.buildGrid();
      lines.push(...grid);
    } else {
      // Gen 1+: compact list
      lines.push(...this.buildGen1Display());
    }

    lines.push("");

    // Cluster + mycelium status
    const clusterCount = this.clusters.length;
    const mycelStr = this.myceliumFiring > 0
      ? `  mycelium: ${this.myceliumDone}/${this.myceliumFiring}`
      : "";
    if (clusterCount > 0 || mycelStr) {
      lines.push(`${c.dim}  clusters: ${c.white}${clusterCount}${c.reset}${c.dim}${mycelStr ? `           ${mycelStr}` : ""}${c.reset}`);
      lines.push("");
    }

    // Status line
    const statusIcon = this.done ? `${c.green}✓` : `${c.glow}◠`;
    lines.push(`${c.dim}  ── ${statusIcon} ${c.dim}${this.statusLine} ${"─".repeat(Math.max(0, 43 - this.statusLine.length))}${c.reset}`);
    lines.push("");

    return lines;
  }

  private buildGrid(): string[] {
    const lines: string[] = [];
    const angleList = [...ANGLES]; // 9 angles, 3x3

    for (let row = 0; row < 3; row++) {
      let nodeLine = "  ";
      let connLine = "  ";

      for (let col = 0; col < 3; col++) {
        const idx = row * 3 + col;
        const angle = angleList[idx];
        const node = this.nodes.get(angle)!;
        const { symbol, color } = this.getNodeDisplay(node);
        const label = ANGLE_SHORT[angle];

        // Node symbol + label
        const paddedLabel = label.padEnd(12);
        nodeLine += `${color}${symbol}${c.reset} ${c.dim}${paddedLabel}${c.reset}`;

        // Connection to next in row
        if (col < 2) {
          const nextAngle = angleList[idx + 1];
          const nextNode = this.nodes.get(nextAngle)!;
          if (this.areInSameCluster(node, nextNode)) {
            const connColor = node.state === "mycelium" || nextNode.state === "mycelium"
              ? c.brightPurple
              : node.clusterColor;
            const connChar = node.state === "mycelium" || nextNode.state === "mycelium"
              ? "═══"
              : "──";
            nodeLine += `${connColor}${connChar}${c.reset}`;
          } else {
            nodeLine += "   ";
          }
        }
      }

      lines.push(nodeLine);

      // Vertical connections between rows
      if (row < 2) {
        connLine = "  ";
        for (let col = 0; col < 3; col++) {
          const idx = row * 3 + col;
          const angle = angleList[idx];
          const belowAngle = angleList[idx + 3];
          const node = this.nodes.get(angle)!;
          const belowNode = this.nodes.get(belowAngle)!;

          if (this.areInSameCluster(node, belowNode)) {
            const connColor = node.state === "mycelium" || belowNode.state === "mycelium"
              ? c.brightPurple
              : node.clusterColor;
            const connChar = node.state === "mycelium" || belowNode.state === "mycelium"
              ? "║"
              : "│";
            connLine += `${connColor}${connChar}${c.reset}${"".padEnd(14)}`;
          } else {
            connLine += `${"".padEnd(15)}`;
          }
        }
        lines.push(connLine);
      }
    }

    return lines;
  }

  private buildGen1Display(): string[] {
    const lines: string[] = [];

    // Count by angle
    const angleCounts: Map<Angle, { total: number; alive: number }> = new Map();
    for (const s of this.gen1Spores) {
      const existing = angleCounts.get(s.angle) ?? { total: 0, alive: 0 };
      existing.total++;
      if (s.alive) existing.alive++;
      angleCounts.set(s.angle, existing);
    }

    const survivors = this.gen1Spores.filter(s => s.alive).length;
    lines.push(`${c.dim}  gen ${this.generation}: ${c.white}${this.gen1Spores.length}${c.dim} children from ${c.white}${survivors}${c.dim} survivors${c.reset}`);

    let line = "  ";
    for (const [angle, counts] of angleCounts) {
      const dots = counts.alive > 0
        ? `${c.green}${"●".repeat(counts.alive)}${c.reset}`
        : "";
      const dead = counts.total - counts.alive;
      const deadDots = dead > 0 ? `${c.dimGray}${"×".repeat(dead)}${c.reset}` : "";
      const short = ANGLE_SHORT[angle];
      const segment = `${dots}${deadDots} ${c.dim}${short}(${counts.total})${c.reset}  `;

      // Rough check for line length (accounting for ANSI codes)
      if (line.length > 200) {
        lines.push(line);
        line = "  ";
      }
      line += segment;
    }
    if (line.trim()) lines.push(line);

    return lines;
  }

  private getNodeDisplay(node: NodeInfo): { symbol: string; color: string } {
    switch (node.state) {
      case "waiting":
        return { symbol: "·", color: c.dimGray };
      case "spawned":
        return { symbol: "●", color: c.spore };
      case "scored-high":
        return { symbol: "●", color: c.green };
      case "scored-low":
        return { symbol: "●", color: c.red };
      case "pruned":
        return { symbol: "×", color: c.dimGray };
      case "clustered":
        return { symbol: "◉", color: node.clusterColor };
      case "mycelium":
        return { symbol: "◈", color: c.brightPurple };
    }
  }

  private areInSameCluster(a: NodeInfo, b: NodeInfo): boolean {
    if (a.clusterId === null || b.clusterId === null) return false;
    return a.clusterId === b.clusterId;
  }
}
