import { getInput, setOutput, setFailed, summary } from '@actions/core';
import { context, getOctokit } from '@actions/github';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

async function run() {
  try {
    const anthropicKey = getInput('anthropic_api_key', { required: true });
    const tavilyKey = getInput('tavily_api_key') || undefined;
    const generations = parseInt(getInput('generations') || '2');
    const filePattern = getInput('file_pattern') || '';
    const maxFiles = parseInt(getInput('max_files') || '10');
    const commentOnPr = getInput('comment_on_pr') !== 'false';

    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      setFailed('GITHUB_TOKEN is required');
      return;
    }

    const octokit = getOctokit(token);
    const { pull_request } = context.payload;

    if (!pull_request) {
      setFailed('This action only works on pull_request events');
      return;
    }

    // Get changed files
    const { data: files } = await octokit.rest.pulls.listFiles({
      ...context.repo,
      pull_number: pull_request.number,
    });

    // Filter files
    let reviewFiles = files.filter(f =>
      f.status !== 'removed' &&
      !f.filename.includes('node_modules') &&
      !f.filename.includes('package-lock.json') &&
      !f.filename.includes('yarn.lock') &&
      !f.filename.match(/\.(png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/i)
    );

    if (filePattern) {
      const { minimatch } = await import('minimatch');
      reviewFiles = reviewFiles.filter(f => minimatch(f.filename, filePattern));
    }

    reviewFiles = reviewFiles.slice(0, maxFiles);

    if (reviewFiles.length === 0) {
      console.log('No reviewable files found in PR');
      return;
    }

    // Fetch file contents
    const codeFiles = await Promise.all(
      reviewFiles.map(async (f) => {
        try {
          const { data } = await octokit.rest.repos.getContent({
            ...context.repo,
            path: f.filename,
            ref: pull_request.head.sha,
          });
          const content = Buffer.from(data.content, 'base64').toString('utf-8');
          return { path: f.filename, content };
        } catch {
          // File might be binary or too large
          return null;
        }
      })
    );

    const validFiles = codeFiles.filter(Boolean);

    if (validFiles.length === 0) {
      console.log('No file contents could be fetched');
      return;
    }

    console.log(`Reviewing ${validFiles.length} files with SPORE...`);

    // Set env for SPORE
    process.env.ANTHROPIC_API_KEY = anthropicKey;
    if (tavilyKey) process.env.TAVILY_API_KEY = tavilyKey;

    const { createSpore, formatCodeContext } = require('spore-reason');

    const spore = createSpore({
      apiKey: anthropicKey,
      tavilyApiKey: tavilyKey,
      generations,
      trails: false, // no persistence in CI
      webGrounding: !!tavilyKey,
    });

    const formatted = formatCodeContext(validFiles);
    const codeContext = { files: validFiles, formatted };

    const prTitle = pull_request.title || '';
    const prBody = (pull_request.body || '').slice(0, 500);
    const fileList = validFiles.map(f => f.path).join(', ');

    const question = `Review this pull request for security vulnerabilities, bugs, architectural issues, and performance problems.

PR: "${prTitle}"
${prBody ? `Description: ${prBody}` : ''}
Files changed: ${fileList}

Focus on:
1. Security: injection points, auth issues, data exposure, unsafe operations
2. Bugs: edge cases, null access, race conditions, error handling gaps
3. Architecture: coupling, separation of concerns, maintainability
4. Performance: unnecessary work, missing caching, blocking operations

Be specific. Reference exact files and issues. Skip nitpicks — focus on things that could actually cause problems.`;

    const result = await spore.reason(question, codeContext);

    // Set outputs
    setOutput('answer', result.answer);
    setOutput('confidence', result.confidence.toString());
    setOutput('topology', result.topology.shape);

    // Build comment
    const confPct = (result.confidence * 100).toFixed(0);
    const survived = result.topology.survivingAngles.length;
    const total = result.topology.survivingAngles.length + result.topology.deadAngles.length;

    const contradictions = result.contradictions.length > 0
      ? result.contradictions.map(c =>
        `| ${c.type} | ${c.explanation.slice(0, 120)} |`
      ).join('\n')
      : '';

    const topAngles = Object.entries(result.approachBreakdown)
      .sort(([, a], [, b]) => b - a)
      .filter(([, v]) => v > 0)
      .slice(0, 5)
      .map(([angle, weight]) => `\`${angle}\` ${(weight * 100).toFixed(0)}%`)
      .join(' · ');

    let commentBody = `## 🍄 SPORE Code Review

> *Multi-angle reasoning modeled on Physarum polycephalum slime mold intelligence*

---

${result.answer}

---

<details>
<summary>Reasoning Metadata</summary>

| Metric | Value |
|--------|-------|
| Confidence | **${confPct}%** |
| Topology | ${result.topology.shape} |
| Angles Survived | ${survived}/${total} |
| Dominant Angle | ${result.topology.dominantAngle || 'none'} |
| Generations | ${result.meta.generations} |
| Total Spores | ${result.meta.totalSpores} |
| Mycelium Calls | ${result.meta.myceliumCalls} |
| Cost | $${result.meta.costEstimate.toFixed(3)} |
| Time | ${(result.meta.wallClockMs / 1000).toFixed(1)}s |

**Angle Weights:** ${topAngles}
`;

    if (result.topology.deadAngles.length > 0) {
      commentBody += `\n**Killed Angles:** ${result.topology.deadAngles.map(a => `\`${a}\``).join(', ')}\n`;
    }

    if (contradictions) {
      commentBody += `\n### Tensions Detected\n\n| Type | Explanation |\n|------|-------------|\n${contradictions}\n`;
    }

    commentBody += `\n</details>\n\n---\n*Powered by [SPORE](https://github.com/agentek-ai/spore) — Simultaneous Parallel Organic Reasoning Engine*`;

    // Post comment
    if (commentOnPr) {
      // Check for existing SPORE comment to update
      const { data: comments } = await octokit.rest.issues.listComments({
        ...context.repo,
        issue_number: pull_request.number,
      });

      const existing = comments.find(c =>
        c.body?.includes('🍄 SPORE Code Review')
      );

      if (existing) {
        await octokit.rest.issues.updateComment({
          ...context.repo,
          comment_id: existing.id,
          body: commentBody,
        });
        console.log(`Updated existing SPORE comment #${existing.id}`);
      } else {
        await octokit.rest.issues.createComment({
          ...context.repo,
          issue_number: pull_request.number,
          body: commentBody,
        });
        console.log('Posted SPORE review comment');
      }
    }

    // Also write to job summary
    await summary.addRaw(commentBody).write();

    console.log(`SPORE review complete — confidence: ${confPct}%, topology: ${result.topology.shape}`);

  } catch (error) {
    setFailed(`SPORE review failed: ${error.message}`);
  }
}

run();
