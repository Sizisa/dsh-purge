/**
 * 人格包：多份注入正文，一键切换。
 *
 * 存储：$DSH_HOME/prompts/<id>.md + $DSH_HOME/prompts/state.json
 * 激活 = 走 core.saveOverrideContent 写 $DSH_HOME/prompt-inject.md
 * （原子写 + 钉住 + customized/explicitSave 口径与手动保存完全一致）。
 * id "default" = 内置加密槽出厂正文，激活即还原默认。
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import * as core from "./core.js";

export const DEFAULT_PACK_ID = "default";
const MAX_BYTES = 512 * 1024;
const MAX_ID = 64;

export function packsDir(dshHome) {
  return path.join(String(dshHome || ""), "prompts");
}

export function statePath(dshHome) {
  return path.join(packsDir(dshHome), "state.json");
}

/** 包 id 直接当文件名：只挡路径分隔符与点开头，中文名照用。 */
export function normalizePackId(raw) {
  const id = String(raw || "")
    .trim()
    .replace(/[/\\:*?"<>|\s]+/g, "-")
    .replace(/^[.\-]+/, "")
    .slice(0, MAX_ID);
  return id && id !== DEFAULT_PACK_ID ? id : "";
}

export function validPackId(id) {
  const text = String(id || "");
  if (!text || text.length > MAX_ID) return false;
  if (text === DEFAULT_PACK_ID) return false;
  if (/[/\\:*?"<>|]/.test(text)) return false;
  return !text.startsWith(".");
}

function packFile(dshHome, id) {
  if (!validPackId(id)) throw new Error(`invalid pack id: ${id}`);
  return path.join(packsDir(dshHome), `${id}.md`);
}

function readState(dshHome) {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(dshHome), "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

async function writeState(dshHome, state) {
  await core.atomicWriteFile(statePath(dshHome), `${JSON.stringify(state, null, 2)}\n`);
}

export function readActivePackId(dshHome) {
  const id = String(readState(dshHome).active || "");
  return validPackId(id) || id === DEFAULT_PACK_ID ? id : "";
}

/** 磁盘正文与某个包逐字一致才算"该包生效"，否则算自定义。 */
export async function currentPackId(dshHome) {
  const active = readActivePackId(dshHome);
  if (!active) return "";
  const text = await readPack(dshHome, active);
  if (typeof text !== "string") return "";
  const disk = core.normalizeOverride(core.readPromptInjectFileSync(dshHome));
  return core.normalizeOverride(text) === disk ? active : "";
}

export async function listPacks(dshHome) {
  const dir = packsDir(dshHome);
  const packs = [{
    id: DEFAULT_PACK_ID,
    name: "默认",
    builtin: true,
    bytes: Buffer.byteLength(core.defaultOverrideText() || "", "utf8"),
  }];
  let names = [];
  try {
    names = await fsp.readdir(dir);
  } catch {
    names = [];
  }
  for (const file of names) {
    if (!file.endsWith(".md")) continue;
    const id = file.slice(0, -3);
    if (!validPackId(id)) continue;
    try {
      const st = await fsp.stat(path.join(dir, file));
      packs.push({ id, name: id, builtin: false, bytes: st.size, mtime: st.mtimeMs });
    } catch {
      /* 读不到就跳过 */
    }
  }
  return { packs, active: await currentPackId(dshHome) };
}

export async function readPack(dshHome, id) {
  if (id === DEFAULT_PACK_ID) return core.defaultOverrideText();
  try {
    return await fsp.readFile(packFile(dshHome, id), "utf8");
  } catch {
    return null;
  }
}

export async function savePack(dshHome, id, content) {
  const text = typeof content === "string" ? content : "";
  if (!text.trim()) throw new Error("pack content is empty");
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_BYTES) throw new Error(`pack too large: ${bytes} bytes`);
  await core.atomicWriteFile(packFile(dshHome, id), text);
  return { id, bytes };
}

export async function deletePack(dshHome, id) {
  if (id === DEFAULT_PACK_ID) throw new Error("default pack is not removable");
  try {
    await fsp.unlink(packFile(dshHome, id));
  } catch {
    /* 已经不在了 */
  }
  const state = readState(dshHome);
  if (state.active === id) {
    delete state.active;
    await writeState(dshHome, state);
  }
  return { id };
}

export async function activatePack(dshHome, id) {
  const text = await readPack(dshHome, id);
  if (typeof text !== "string" || !text.trim()) throw new Error(`pack not found: ${id}`);
  const saved = await core.saveOverrideContent(dshHome, text);
  await writeState(dshHome, {
    ...readState(dshHome),
    active: id,
    at: new Date().toISOString(),
  });
  return { id, bytes: Buffer.byteLength(saved.content || "", "utf8") };
}
