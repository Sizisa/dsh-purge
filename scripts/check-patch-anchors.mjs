#!/usr/bin/env node
/**
 * 补丁锚点回归：#40 COMPLETE_PROMPT_KEEP_INJECT 必须认得住各版本 assemble() 尾巴。
 *
 * 背景：0.2.x 的 dsh-system-prompt assemble() 尾巴多了
 *   const requiredContexts = new Set([...]);
 * 且 contexts 行从 `? [] : transformed.contexts` 变成 required 过滤版。
 * 老锚点匹配 0 次 → #40 状态变 skipped（非 strictFiles 的 miss 不算 blocking）→
 * ensureHostClean() 里的 hostPromptKeepsInject() 判定“清洗没写进宿主”，Apply 后取消重启。
 *
 * 本脚本用真实 applyReplacementsToText() 打过各版本尾巴的样例文本，断言：
 *   1) 打得上（标记出现）；
 *   2) 打完后 hostPromptKeepsInject() 认为宿主已洗；
 *   3) 不破坏宿主的 requiredContexts / 上下文裁剪语义；
 *   4) 重复应用是幂等的（不会把 const 插两遍）；
 *   5) 产物仍是合法 JS。
 * 本机若存在官方解压宿主，顺带对真实文件做一次内存内演练（不写盘）。
 *
 * 用法：node scripts/check-patch-anchors.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { ALL_PATCHES, applyReplacementsToText, hostPromptKeepsInject } = await import(
  path.join(root, "lib", "core.js")
);

const patch = ALL_PATCHES.find((p) => p.id === 40);
if (!patch) throw new Error("找不到 #40 COMPLETE_PROMPT_KEEP_INJECT");

const HEAD = [
  'import z from "zod";',
  "const SECTION_ORDERS = {};",
  "class SystemPrompt {",
  "	async assemble(context = {}) {",
  "		const sectionDefinitions = [];",
  "		let completeSection;",
  "		const assembly = { sections: [], contexts: [], tools: [], variables: {} };",
  '		const transformed = await this.ctx.waterfall(scopeTarget(this, scope), "system-prompt/assemble", assembly, context, () => Promise.resolve(assembly));',
].join("\n");

const LEGACY_TAIL = [
  "		if (completeSection === void 0 && !runtimeContextSuppressed) return transformed;",
  "		return {",
  "			...transformed,",
  "			sections: completeSection === void 0 ? transformed.sections : [completeSection],",
  "			contexts: runtimeContextSuppressed ? [] : transformed.contexts",
  "		};",
].join("\n");

const RC_TAIL = [
  "		if (completeSection === void 0 && !runtimeContextSuppressed) return transformed;",
  "		const requiredContexts = new Set([...contextByName.values()].filter((entry) => entry.required === true).map((entry) => entry.name));",
  "		return {",
  "			...transformed,",
  "			sections: completeSection === void 0 ? transformed.sections : [completeSection],",
  "			contexts: runtimeContextSuppressed ? transformed.contexts.filter((entry) => requiredContexts.has(entry.name)) : transformed.contexts",
  "		};",
].join("\n");

const OUTRO = ["	}", "}", "//#endregion", ""].join("\n");

const withIndent = (block, unit) =>
  block
    .split("\n")
    .map((line) => line.replace(/^\t+/, (m) => unit.repeat(m.length)))
    .join("\n");

const cases = [
  {
    name: "0.2.x requiredContexts 尾巴（tab 缩进）",
    text: [HEAD, RC_TAIL, OUTRO].join("\n"),
    expect: { requiredContexts: true, filteredContexts: true },
  },
  {
    name: "0.2.x requiredContexts 尾巴（4 空格缩进）",
    text: [withIndent(HEAD, "    "), withIndent(RC_TAIL, "    "), OUTRO].join("\n"),
    expect: { requiredContexts: true, filteredContexts: true },
  },
  {
    name: "旧尾巴 contexts: ? [] :（0.1.x / 早期 0.2）",
    text: [HEAD, LEGACY_TAIL, OUTRO].join("\n"),
    expect: {},
  },
];

let failed = 0;
const fail = (msg) => {
  failed += 1;
  console.error(`    ✗ ${msg}`);
};

for (const item of cases) {
  console.log(`- ${item.name}`);
  const once = applyReplacementsToText(item.text, patch);
  if (!once.changed) fail("补丁没打上（pattern 匹配 0 次）");
  if (!once.text.includes("[dsh-purge] fold-complete inject first")) fail("缺少 fold-complete 标记");
  if (once.text.includes("transformed.sections : [completeSection]")) fail("complete 段仍然直接丢弃注入");
  if (!hostPromptKeepsInject(once.text)) fail("hostPromptKeepsInject() 仍判为没洗进宿主");
  if (item.expect.requiredContexts && !once.text.includes("const requiredContexts = new Set(")) fail("丢了 requiredContexts 行");
  if (item.expect.filteredContexts
    && !once.text.includes("transformed.contexts.filter((entry) => requiredContexts.has(entry.name))")) {
    fail("丢了 required 上下文裁剪语义");
  }

  const twice = applyReplacementsToText(once.text, patch);
  if (twice.changed || twice.text !== once.text) fail("重复应用不幂等（会插两遍或改坏文本）");

  const tmp = path.join(os.tmpdir(), `dsh-purge-anchor-${process.pid}.mjs`);
  try {
    fs.writeFileSync(tmp, once.text);
    const check = spawnSync(process.execPath, ["--check", tmp], { encoding: "utf8" });
    if (check.status !== 0) fail(`产物不是合法 JS: ${String(check.stderr || "").split("\n")[0]}`);
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
  if (failed === 0) console.log("    ✓");
}

// 真实宿主（只读）：有官方解压副本时，内存里演练一次，不写盘。
const liveHost = "/Applications/DeepSeek Harness.app/Contents/Resources/app/dsh/node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js";
if (fs.existsSync(liveHost)) {
  console.log("- 真实宿主文件（内存内演练，不写盘）");
  const before = failed;
  const text = fs.readFileSync(liveHost, "utf8");
  const once = applyReplacementsToText(text, patch, liveHost);
  if (!hostPromptKeepsInject(once.text)) fail("真实宿主打完后自检仍不过");
  if (!once.changed && !hostPromptKeepsInject(text)) fail("真实宿主既打不上、又不算已洗");
  if (failed === before) console.log("    ✓");
}

if (failed > 0) {
  console.error(`\n${failed} 项失败：#40 的锚点和宿主 assemble() 尾巴对不上，Apply 会以\n"清洗没有写进全部宿主，已取消重启" 收场。请按新尾巴补 pattern。`);
  process.exit(1);
}
console.log("\n全部通过：#40 认得旧尾巴和 0.2.x requiredContexts 尾巴，且幂等、产物可解析。");
