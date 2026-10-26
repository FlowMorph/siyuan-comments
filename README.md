# 评论

给思源笔记加上可以跟帖的评论，交互和样式复刻 Notion：在文字、块或整篇文档上开一个讨论串，可以回复、编辑、删除，标记已解决或重新打开。鼠标停在高亮文字或块右侧的评论标记上，讨论卡片就会浮出，评论和回复直接在卡片上写。右侧侧栏的「评论」面板列出整篇文档的评论，窗口变窄时按思源原生方式收起，鼠标移到右边缘浮出。

## 使用

- 划词评论：选中文字，点浮动工具栏里的评论按钮，或按 `⌥⇧M`（可在设置 → 快捷键里修改），文字下方弹出卡片直接写。选区可以跨段落；评论区域可以重叠：先评论整段，再单独评论其中一句。发出第一条评论后，所在块右侧也会出现评论标记（💬 数量），同一块上的评论合并计数。
- 块评论：点块标 → 「评论」；块右侧出现评论标记，鼠标放上去浮出卡片。
- 文档评论：点文档标题图标 → 「评论此文档」，或面板右上角的 `+`，在面板里写。
- 回车发送，Shift+回车换行；新建后没写内容就按 `Esc` 或点外面，讨论串撤销。
- 悬停评论出现 ✓（解决，仅第一条）、编辑、删除；删除按钮点一下变成「?」，再点一次才删除。删除第一条评论会删除整个讨论串。
- 点击高亮文字会固定卡片；点面板里的讨论串定位到正文。

## 和 AI 协作

[tools/siyuan_comments.py](https://github.com/FlowMorph/siyuan-comments/blob/main/tools/siyuan_comments.py)（在源码仓库里，不随插件包分发）是给 AI 代理（例如 Claude Code）用的命令行工具：列出未解决的讨论串、查看原文和整篇文档上下文、以 AI 身份回复、标记解决。写入后插件面板实时刷新。工具通过本机思源内核 API（127.0.0.1:6806）工作，token 从当前工作空间的 `conf/conf.json` 读取。

```bash
python3 tools/siyuan_comments.py list            # 列出全部未解决讨论串
python3 tools/siyuan_comments.py show <id>       # 讨论串和所在块原文
echo "回复内容" | python3 tools/siyuan_comments.py reply <id> -
```

## 开发

需要 Node.js。`npm install` 后 `npm run build` 生成 `dist/`，把 `dist/` 软链或复制到工作空间的 `data/plugins/siyuan-comments`，在思源 设置 → 集市 → 已下载 中启用。`npm run package` 构建并生成集市发布用的 `package.zip`。项目结构见 [docs/index.md](https://github.com/FlowMorph/siyuan-comments/blob/main/docs/index.md)。

## 数据

讨论串以 JSON 存在块属性 `custom-comments` 里，划词评论的正文标记是带 `custom-comment-id` 属性的行内片段，本身没有样式。卸载插件后正文外观不变，评论数据仍保留在块属性中。

## 许可

MIT
