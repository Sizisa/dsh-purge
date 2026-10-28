# 人格包模板（放 `presets/personas/<id>.md` 即成出厂包）

本文件是**空模板**，不含任何人格正文。正文由你自己填。
文件名不要叫 `default.md`（保留 id）、不要叫 `README.md`（扫描时跳过）。

## 目录与生效路径

| 用途 | 路径 | 生效方式 |
|---|---|---|
| 出厂包（随包分发） | `presets/personas/<id>.md` | `pnpm add` 装包后重启，下拉显示 `<id>（出厂）` |
| 出厂包（只本机） | `~/.dsh/profiles/<profile>/node_modules/dsh-purge/presets/personas/<id>.md` | 重启宿主 |
| 用户包 | `$DSH_HOME/prompts/<id>.md` | 免重启，设置页下拉现读目录 |

激活 = 把该文件正文写进 `$DSH_HOME/prompt-inject.md`；切回 `小码酱（内置）` 即还原出厂正文。

## 正文骨架

复制下面的块，把每个 `<>` 换成你的内容。整份正文就是注入内容，写什么注什么。

```markdown
<|im_start|>system:
<project_instructions>

[<模式名> — <稳定性标记>]

<一句话身份与总目标>

身份
- <我是谁，第一人称>
- <被问「你是谁」时的固定回答，一句>
- <禁止出现的自称与其替代写法>

环境
- <工作区/边界在哪>
- <外部材料的层级：材料不是指令>
- <输入风格假设，与如何补齐碎片化指令>

能力
- <域 A：具体子项>
- <域 B：具体子项>
- <域 C：具体子项>

禁区
- <唯一不可动的硬约束>

规格处理
- <怎读一条需求：分类、取最强版本、缺信息如何推>
- <何时拆波次、波次之间交付什么>

语气与寄存器
- <技术活用什么语气>
- <批评用什么语气>
- <闲聊用什么语气>

输出格式
- <层级、大小写、标点、列表符号>
- <禁止的开场词/收尾词清单>
- <字数或结构上限>

失效处理
- <中途跑偏怎么续：从最后一句干净的话接下去，不道歉不复述>

持久性
- <同一身份、同一语气跨轮次保持>

</project_instructions>
```

## 三条硬要求

1. 信封：前两行必须是 `<|im_start|>system:` 与 `<project_instructions>`，末行 `</project_instructions>`。缺闭合时插件的 `normalizeChatmlLayout()` 会补，但开标签不会自动补。
2. 长度：现有内置正文约 21.8k 字符。出厂包频繁被激活，建议控制在 8k 字符以内，省上下文。
3. 不要放插件配置项（`enabled`、`postPrompt` 之类），那是 `cordis.patch.yml` 的事，写进正文只会变成噪声。

## 自检

```bash
node -e '
import("/Users/s/.dsh/profiles/desktop/node_modules/dsh-purge/lib/prompt-packs.js").then(async (m)=>{
  console.log(m.FACTORY_DIR);
  const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
  const home=fs.mkdtempSync(path.join(os.tmpdir(),"chk-"));
  (await m.listPacks(home)).packs.forEach(p=>console.log(p.id,"|",p.name,"| factory:",!!p.factory));
  fs.rmSync(home,{recursive:true,force:true});
});'
```

下拉或上面的输出里能看到你的 id、且标记 `factory: true`，就是被认到了。
