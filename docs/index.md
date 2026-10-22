# 思源评论插件 · 语义地图

思源笔记插件：在文字、块或文档上开可跟帖的讨论串，显示在右侧侧栏面板；配套命令行工具让 AI（Claude Code）在讨论串里回复。用户手册见 [[README.md|README]]，存储格式与 AI 工作流见 [[docs/data-model|数据模型]]。

## 模块

插件前端代码在 `src/`，由 [[build.mjs|构建脚本]] 用 esbuild 打包到 `dist/`，`dist/` 软链到工作空间 `~/SiYuan/data/plugins/siyuan-comments`。

- [[src/index.ts|插件入口]]：注册侧栏面板（`addDock`）、浮动工具栏按钮、块菜单与文档标题菜单项、快捷键，并把思源事件（切换编辑器、点击正文、内核推送的事务）转给控制器。
- [[src/controller.ts|CommentController]]：状态中心。缓存所有打开过的文档的讨论串，维护当前文档、选中讨论串和待写首条评论的草稿；所有写操作都经过这里，写完重新加载。
- [[src/panel.ts|CommentPanel]]：侧栏面板的渲染与交互，只读控制器状态、转发操作；整体重绘，草稿和焦点在重绘间保留。
- [[src/store.ts|store]]：讨论串的读写（块属性 JSON）和按文档加载（SQL + 块顺序）。
- [[src/anchor.ts|anchor]]：正文锚点。划词时包原生下划线 span 并写入讨论串；删除行内讨论串时在同一次块更新里去掉属性和锚点；定位滚动。
- [[src/highlight.ts|Highlighter]]：用动态样式表按讨论串状态给锚点上色，不改编辑器 DOM。
- [[src/markdown.ts|markdown]]：评论正文用 Lute 转 HTML，公式用思源自带 KaTeX 渲染。
- [[src/api.ts|api]]：内核 HTTP API 的薄封装。
- [[tools/siyuan_comments.py|siyuan_comments.py]]：AI 侧命令行工具，列出、查看、回复、解决讨论串。

## 关键流程

- **自适应侧栏**：面板是标准 dock，窗口变窄时由思源 3.8.7 的响应式浮动（`responsiveFloating`）自动收起、鼠标靠右边缘浮出，插件不处理布局。点击正文锚点时 `showDock` 调出面板，浮动状态下把它浮出来。
- **创建讨论串**：划词 → `wrapSelection` 用原生 `setInlineMark("u")` 包下划线，再通过编辑器事务给 span 写 `custom-comment-id`、给块写 `custom-comments`。块评论和文档评论直接调 `setBlockAttrs`。新讨论串先放进缓存并打开面板，等用户写第一条评论；取消则删除。
- **外部写入实时刷新**：AI 通过 `setBlockAttrs` 写入后，内核广播 `updateAttrs` 事务；插件在 `ws-main` 事件里识别涉及 `custom-comments` 的操作，防抖后重新加载对应文档。
- **为什么锚点相关写入走编辑器事务**：编辑器会把整块 DOM（含块属性）提交给内核，若用接口写属性、紧接着编辑器又提交了旧 DOM，属性会被覆盖。所以创建行内锚点和删除行内讨论串都在编辑器 DOM 上同时改属性和 span；回复、解决等只改属性的操作走接口。

## 开发

`npm run build` 构建，`npm run watch` 监听；`npm run typecheck` 类型检查。改完在思源里重新加载插件（设置 → 集市 → 已下载，关闭再打开），或重启思源。
