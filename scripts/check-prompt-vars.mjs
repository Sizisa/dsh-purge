#!/usr/bin/env node
/**
 * 交回宿主的提示词里不允许出现「未注册」的 {{variable}}。
 *
 * 背景（0.2.x）：@deepseek-ai/dsh-system-prompt 的插值是严格的 —— 非
 * interpolate:false 的段只要出现 variables 里没有的 {{name}}，renderPrompt()
 * 就抛 `unknown prompt variable "{{name}}"`，而 agent-loop 的 step() 没有兜底，
 * 整轮请求直接发不出去。0.2.x 的变量表只有 provider / model，`cwd` 已经下线
 * （工作目录改由 working-directory 的 required 运行时上下文给出）。
 *
 * 本脚本用 rewritePromptAssembly() 走一遍真实改写链路，按「宿主实际变量表」
 * 检查输出：遇到未注册变量即失败退出（exit 1），可挂到发布前 / CI。
 *
 * 用法：node scripts/check-prompt-vars.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { rewritePromptAssembly } = await import(path.join(root, "lib", "identity.js"));

/** 与 @deepseek-ai/dsh-system-prompt 的 VARIABLE_NAME 同形。 */
const VARIABLE_REF = /\{\{([a-z][a-z0-9_]*)\}\}/g;

/** 0.2.x 宿主注册的提示词变量（dsh-agent-loop 里 ctx.systemPrompt.variable(...)）。 */
const HOST_02_VARIABLES = { provider: "workbuddy", model: "cn:deepseek-v4.1-flash" };

const INJECT = "CHECK-PROMPT-VARS: operator inject body.";

/** 构造一份贴近宿主装配结果的 assembly（段名/顺序照着 dsh-system-prompt 的登记来）。 */
function assemblyFor(variables, sections) {
  return {
    sections,
    contexts: [],
    tools: [],
    variables: { ...variables },
  };
}

const cases = [
  {
    name: "0.2.x：personaSuffix 为空（本次修复后的正常态）",
    assembly: assemblyFor(HOST_02_VARIABLES, [
      { name: "deployment:persona-prefix", order: 0, text: "" },
      { name: "deployment:persona-suffix", order: 10200, text: "" },
      { name: "dsh-purge:rules", order: 100, text: "" },
    ]),
  },
  {
    name: "0.2.x：preset 仍带旧 {{cwd}}（升级残留，必须被净化）",
    assembly: assemblyFor(HOST_02_VARIABLES, [
      { name: "deployment:persona-prefix", order: 0, text: "" },
      { name: "deployment:persona-suffix", order: 10200, text: "Your working directory is {{cwd}}." },
      { name: "user:extra", order: 500, text: "cwd={{cwd}} model={{model}}" },
    ]),
  },
  {
    name: "0.1.x：宿主仍注册 cwd（旧宿主，变量应原样保留）",
    assembly: assemblyFor({ ...HOST_02_VARIABLES, cwd: "/tmp/project" }, [
      { name: "deployment:persona-prefix", order: 0, text: "" },
      { name: "deployment:persona-suffix", order: 10200, text: "Your working directory is {{cwd}}." },
    ]),
  },
];

let failed = 0;
for (const item of cases) {
  const assembled = rewritePromptAssembly(item.assembly, INJECT, {});
  const known = new Set(Object.keys(assembled.variables || {}));
  const bad = [];
  for (const section of assembled.sections || []) {
    if (!section || section.interpolate === false) continue;
    if (typeof section.text !== "string") continue;
    for (const match of section.text.matchAll(VARIABLE_REF)) {
      if (!known.has(match[1])) bad.push(`${match[0]} @ section "${section.name}"`);
    }
  }
  if (bad.length > 0) {
    failed += 1;
    console.error(`✗ ${item.name}`);
    for (const line of bad) console.error(`    ${line}`);
  } else {
    console.log(`✓ ${item.name}`);
  }
}

if (failed > 0) {
  console.error(
    `\n${failed} 个用例会向宿主交回未注册的提示词变量 —— 宿主的 renderPrompt() 会抛\n` +
      `unknown prompt variable，整轮请求发不出去。改法：不要把 {{...}} 写进宿主会插值的段，\n` +
      `或让 rewritePromptAssembly() 的 neutralizeUnknownVariables() 摘掉它。`,
  );
  process.exit(1);
}
console.log("\n全部通过：交回宿主的段里没有未注册的提示词变量。");
