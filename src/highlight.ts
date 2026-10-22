// 正文高亮：用一张动态样式表按讨论串状态给锚点上色，不改动编辑器 DOM。
// 未知或已解决的锚点只去掉下划线；未解决的显示为淡黄高亮；当前选中的讨论串加深。
import {ATTR_ANCHOR, DocThread} from "./types";

export class Highlighter {
    private readonly style: HTMLStyleElement;

    constructor() {
        this.style = document.createElement("style");
        this.style.id = "siyuan-comments-highlight";
        document.head.append(this.style);
    }

    update(threads: DocThread[], activeId?: string) {
        const openInline: string[] = [];
        const openBlocks = new Set<string>();
        for (const {blockId, thread} of threads) {
            if (thread.status !== "open") {
                continue;
            }
            if (thread.anchor === "inline") {
                openInline.push(`.protyle-wysiwyg span[${ATTR_ANCHOR}="${thread.id}"]`);
            } else if (thread.anchor === "block") {
                openBlocks.add(`.protyle-wysiwyg [data-node-id="${blockId}"]`);
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
        if (openBlocks.size) {
            rules.push(`${Array.from(openBlocks).join(",\n")} {
    box-shadow: inset 3px 0 0 var(--sc-anchor-border);
}`);
        }
        if (activeId) {
            rules.push(`.protyle-wysiwyg span[${ATTR_ANCHOR}="${activeId}"] {
    background-color: var(--sc-anchor-bg-active);
}`);
        }
        this.style.textContent = rules.join("\n");
    }

    destroy() {
        this.style.remove();
    }
}
