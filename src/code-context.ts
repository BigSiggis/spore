// ── Code Context Injection ───────────────────────────────────────
// Mirrors src/web.ts pattern — formats code for injection into spore prompts

export interface CodeFile {
  path: string;
  content: string;
  language?: string;
}

const MAX_CHARS_PER_FILE = 4000;
const MAX_TOTAL_CHARS = 12000;

// Smart truncation: preserve function signatures, imports, and class declarations
export function truncateCode(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;

  const lines = content.split("\n");
  const kept: string[] = [];
  let charCount = 0;

  // Priority 1: imports and top-level declarations (first 30 lines)
  const headerLines = Math.min(30, lines.length);
  for (let i = 0; i < headerLines; i++) {
    const line = lines[i];
    if (charCount + line.length + 1 > maxChars * 0.4) break;
    kept.push(line);
    charCount += line.length + 1;
  }

  // Priority 2: function/class/interface signatures throughout the file
  const signaturePatterns = [
    /^\s*(export\s+)?(async\s+)?function\s+/,
    /^\s*(export\s+)?(default\s+)?class\s+/,
    /^\s*(export\s+)?interface\s+/,
    /^\s*(export\s+)?type\s+/,
    /^\s*(export\s+)?const\s+\w+\s*[=:]/,
    /^\s*(pub\s+)?(fn|struct|enum|impl|trait)\s+/,       // Rust
    /^\s*(public|private|protected)\s+.*\(.*\)\s*[{:]/,  // Java/C#
    /^\s*def\s+/,                                         // Python
  ];

  for (let i = headerLines; i < lines.length; i++) {
    const line = lines[i];
    if (signaturePatterns.some((p) => p.test(line))) {
      if (charCount + line.length + 1 > maxChars - 100) break;
      if (!kept.includes(line)) {
        if (kept.length > 0 && kept[kept.length - 1] !== "// ...") {
          kept.push("// ...");
          charCount += 7;
        }
        kept.push(line);
        charCount += line.length + 1;
        // Include the next 2 lines for context (opening brace, first statement)
        for (let j = 1; j <= 2 && i + j < lines.length; j++) {
          if (charCount + lines[i + j].length + 1 > maxChars - 50) break;
          kept.push(lines[i + j]);
          charCount += lines[i + j].length + 1;
        }
      }
    }
  }

  if (kept.length < lines.length) {
    kept.push(`// ... (${lines.length - kept.length} lines truncated)`);
  }

  return kept.join("\n");
}

// Format multiple code files into a single context block
export function formatCodeContext(files: CodeFile[]): string {
  if (files.length === 0) return "";

  const parts: string[] = [];
  let totalChars = 0;
  const perFileLimit = Math.min(MAX_CHARS_PER_FILE, Math.floor(MAX_TOTAL_CHARS / files.length));

  for (const file of files) {
    if (totalChars >= MAX_TOTAL_CHARS) break;

    const remaining = MAX_TOTAL_CHARS - totalChars;
    const limit = Math.min(perFileLimit, remaining);
    const truncated = truncateCode(file.content, limit);
    const lang = file.language ?? inferLanguage(file.path);

    parts.push(`── ${file.path} (${lang}) ──\n${truncated}`);
    totalChars += truncated.length;
  }

  return parts.join("\n\n");
}

function inferLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    py: "python",
    rs: "rust",
    go: "go",
    java: "java",
    cs: "csharp",
    rb: "ruby",
    sol: "solidity",
    move: "move",
    c: "c",
    cpp: "cpp",
    h: "c",
    hpp: "cpp",
  };
  return map[ext] ?? ext;
}
