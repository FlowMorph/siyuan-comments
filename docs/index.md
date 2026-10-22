# 思源评论插件 · 语义地图

思源笔记插件：在文字、块或文档上开可跟帖的讨论串，交互和样式复刻 Notion——正文里悬停高亮文字或块右侧的评论标记浮出讨论卡片，直接在卡片上写评论和回复；右侧侧栏面板对应 Notion 的评论面板，用于总览和筛选。配套命令行工具让 AI（Claude Code）在讨论串里回复。用户手册见 [[README.md|README]]，存储格式与 AI 工作流见 [[docs/data-model|数据模型]]。

## 模块

插件前端代码在 `src/`，由 [[build.mjs|构建脚本]] 用 esbuild 打包到 `dist/`，`dist/` 软链到工作空间 `~/SiYuan/data/plugins/siyuan-comments`。

- [[src/index.ts|插件入口]]：注册侧栏面板（`addDock`）、浮动工具栏按钮、块菜单与文档标题菜单项、快捷键；把思源事件（切换编辑器、点击正文、内核推送的事务）转给控制器，把鼠标悬停/点击锚点转给浮动卡片。
- [[src/controller.ts|CommentController]]：状态中心。缓存所有打开过的文档的讨论串，维护当前文档、选中讨论串和待写首条评论的草稿；所有写操作都经过这里，写完重新加载。
- [[src/threadView.ts|ThreadView]]：讨论串卡片的渲染与交互（头像、相对时间、悬停操作条、回车发送、编辑、原地二次确认删除），面板和浮动卡片共用一个实例，草稿和编辑状态因此两处同步。
- [[src/popover.ts|ThreadPopover]]：正文浮动卡片。悬停延时浮出/收起、点击或新建时固定、Esc 与点外面关闭、按锚点位置上下翻转定位；关闭时撤销还没有评论的新讨论串。
- [[src/badges.ts|BlockBadges]]：块评论标记，画在每个编辑器 `.protyle` 内的覆盖层上，随滚动、编辑、尺寸变化重新定位，不改编辑器 DOM。
- [[src/panel.ts|CommentPanel]]：侧栏面板，列出当前文档讨论串（带原文引用）并按状态筛选，卡片由 ThreadView 渲染。
- [[src/store.ts|store]]：讨论串的读写（块属性 JSON）和按文档加载（SQL + 块顺序）。
- [[src/anchor.ts|anchor]]：正文锚点。划词时按选区拆分文本节点和行内元素，给片段追加讨论串 id（支持重叠、嵌套）并写入讨论串；删除行内讨论串时在同一次块更新里去掉属性和片段上的 id；定位滚动。
- [[src/highlight.ts|Highlighter]]：用动态样式表按讨论串状态给锚点上色（重叠部分加深），不改编辑器 DOM。
- [[src/markdown.ts|markdown]]：评论正文用 Lute 转 HTML，公式用思源自带 KaTeX 渲染。
- [[src/api.ts|api]]：内核 HTTP API 的薄封装。
- [[tools/siyuan_comments.py|siyuan_comments.py]]：AI 侧命令行工具，列出、查看、回复、解决讨论串。

## 关键流程

- **浮动卡片**：`index.ts` 在 document 上监听 mouseover/mouseout，命中未解决的锚点 span 或块评论标记时交给 `ThreadPopover.hover/leave`；点击锚点（`click-editorcontent`）或标记时 `open(..., {pin})` 固定。卡片通过 resolver 每次重新查找锚点元素定位，块被重渲染后仍能找到。
- **创建讨论串**：划词（可跨段落）→ `wrapSelection` 自行拆分选区（不用思源的 `setInlineMark`，它对已有同类标记是开关式的，无法叠加），给各块片段追加 `custom-comment-id`、给第一个块写 `custom-comments`，所有涉及的块用 `updateBatchTransaction` 一次提交，随后在文字下方弹出固定的卡片并聚焦输入框。悬停重叠区域时卡片列出所有未解决的讨论串，范围小的（内层）排前。片段格式和防合并规则见 [[docs/data-model|数据模型]]。块评论直接调 `setBlockAttrs`，卡片挂在块标记上；文档评论在侧栏面板里输入。新讨论串先放进缓存，不等内核索引。
- **侧栏面板**：标准 dock，窗口变窄时由思源 3.8.7 的响应式浮动（`responsiveFloating`）自动收起、鼠标靠右边缘浮出，插件不处理布局。
- **外部写入实时刷新**：AI 通过 `setBlockAttrs` 写入后，内核广播 `updateAttrs` 事务；插件在 `ws-main` 事件里识别涉及 `custom-comments` 的操作，防抖后重新加载对应文档。
- **为什么锚点相关写入走编辑器事务**：编辑器会把整块 DOM（含块属性）提交给内核，若用接口写属性、紧接着编辑器又提交了旧 DOM，属性会被覆盖。所以创建行内锚点和删除行内讨论串都在编辑器 DOM 上同时改属性和 span（跨段落时删除前用编辑器 DOM 加 SQL 找齐所有带锚点的块）；回复、解决等只改属性的操作走接口。

## 开发

`npm run build` 构建，`npm run watch` 监听；`npm run typecheck` 类型检查。改完在思源里重新加载插件（设置 → 集市 → 已下载，关闭再打开），或重启思源。

## 思源前端的坑

- 思源在 window 上的全局点击处理会关闭通用菜单，除非点击目标在菜单里或祖先带 `data-menu="true"`。插件 DOM 里点击后打开 `Menu` 的按钮必须带这个属性，否则菜单打开即被关闭。
- 浮动卡片有滚动区域，`b3-tooltips` 的伪元素提示会被裁掉；卡片内按钮用 `ariaLabel` 类加 `aria-label`，由思源全局提示浮层显示。
- 不要在点击处理中同步重绘被点元素所在的 DOM：思源全局点击处理在 window 上运行，拿 `event.target` 向上找祖先判断是否点在浮动侧栏（`layout--float`）内，目标已被替换脱离文档时会判为点在外面并收起侧栏。插件所有重绘都经 [[src/controller.ts|CommentController]] 的 `emit` 推迟到下一帧。
