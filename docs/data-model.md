# 数据模型与 AI 工作流

插件和 [[tools/siyuan_comments.py|命令行工具]] 共用这份格式，改字段时两边同步；TypeScript 定义见 [[src/types.ts|types]]。

## 存储

- 讨论串列表存在锚点所在块的属性 `custom-comments` 里，值是 `Thread[]` 的 JSON。文档级讨论串挂在文档块上。
- 划词评论在正文里是若干行内片段，片段带 `custom-comment-id`，值为空格分隔的讨论串 id 列表；评论区域可以重叠或嵌套，重叠部分的片段同时列出多个 id。kramdown 中如 `<span data-type="text" custom-comment-id="A B">原文</span>{: custom-comment-id="A B"}`。
- 片段的 `data-type` 总含 `text`（在加粗等元素中为 `strong text`）：Lute 会把相邻同类型、前一个无属性的行内元素合并，类型不同才能保证评论范围不被扩大。删除最后一个 id 时撤掉 `text`（有颜色等 `style` 时保留）。
- SQL `attributes` 表能直接查到两者：`name='custom-comments'`（type `b`，值为原样 JSON）和 `name='custom-comment-id'`（type `s`，行内属性，值为 id 列表）。面板据此判断「原文已删除」：行内讨论串在同文档里找不到对应 id。
- 早期版本用原生下划线（`u`）做锚点，2026-10-22 已把工作空间里的旧锚点迁移为 `text`，代码不再兼容旧写法。

```json
{
  "id": "20261022210000-abcdefg",
  "anchor": "inline | block | doc",
  "quote": "创建时被评论的原文",
  "status": "open | resolved",
  "created": "2026-10-22T13:00:00.000Z",
  "resolved": "解决时间，仅已解决时存在",
  "comments": [
    {"id": "…", "author": "user | ai", "content": "Markdown 正文", "created": "…", "updated": "编辑后才有"}
  ]
}
```

id 与思源块 id 同格式；时间为 UTC ISO 字符串，显示时转本地时间。

## 行为约定

- 块被删除时讨论串随块消失；复制块会连讨论串一起复制。
- 与 Notion 一致：删除讨论串的第一条评论即删除整个讨论串；删除行内讨论串会去掉正文里的下划线标记。
- 新建后还没写任何评论就关闭卡片（Esc、点外面）时，讨论串被撤销。
- 已解决的讨论串在正文中不再高亮、不再浮出卡片，块标记也消失；面板里切到「已解决」查看，可重新打开。
- 插件卸载后正文外观不变（锚点片段没有样式），`custom-comments` 属性保留。

## AI 工作流

用户在 Claude Code 里说「处理一下评论」时：

1. `siyuan_comments.py list` 列出全部未解决讨论串（可加文档标题或 id 限定，`--all` 含已解决）。
2. `siyuan_comments.py show <id>` 看讨论串和所在块原文；需要全文上下文时用 `context <id>` 导出文档 Markdown。
3. `siyuan_comments.py reply <id> -` 从标准输入写入回复（Markdown，支持 `$公式$`），面板实时刷新。
4. 用户确认问题解决后，由用户在面板里点 ✓，或 AI 按用户要求 `resolve <id>`。

工具每次写入前都重新读取块属性，减小与用户同时编辑的冲突窗口；仍可能出现的冲突见 [[docs/index|语义地图]]「关键流程」。
