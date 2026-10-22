// 正文高亮：用一张动态样式表按讨论串状态给锚点上色，不改动编辑器 DOM。
// 未知或已解决的锚点只去掉下划线；未解决的显示为淡黄高亮；当前选中的讨论串加深。
// 块评论不改块样式，由 BlockBadges 在块右侧显示评论标记。
import {ATTR_ANCHOR, DocThread} from "./types";

/** 与 index.css 隐藏下划线的基础规则同样的选择器前缀，再加 id 条件后优先级更高 */
const ANCHOR_BASE = `.protyle-wysiwyg span[data-type~="u"][${ATTR_ANCHOR}]`;

export class Highlighter {
    private readonly style: HTMLStyleElement;

    constructor() {
        this.style = document.createElement("style");
        this.style.id = "siyuan-comments-highlight";
        document.head.append(this.style);
    }

    update(threads: DocThread[], activeId?: string) {
        const openInline: string[] = [];
        for (const {thread} of threads) {
            if (thread.status === "open" && thread.anchor === "inline") {
                openInline.push(`${ANCHOR_BASE}[${ATTR_ANCHOR}="${thread.id}"]`);
            }
        }
        const rules: string[] = [];
        if (openInline.length) {
            rules.push(`${openInline.join(",\n")} {
    background-color: var(--sc-anchor-bg);
    border-bottom: 2px solid var(--sc-anchor-border);
    cursor: pointer;
}`);
        }
        if (activeId) {
            rules.push(`${ANCHOR_BASE}[${ATTR_ANCHOR}="${activeId}"] {
    background-color: var(--sc-anchor-bg-active);
}`);
        }
        this.style.textContent = rules.join("\n");
    }

    destroy() {
        this.style.remove();
    }
}
