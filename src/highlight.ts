// 正文高亮：用一张动态样式表按讨论串状态给锚点上色，不改动编辑器 DOM。
// 未解决的显示为淡黄高亮；两条讨论串重叠的部分颜色加深（与 Notion 一致）；当前选中的讨论串最深。
// 已解决或未知的锚点不加样式，与普通文字无异。块评论由 BlockBadges 在块右侧显示标记。
import {ATTR_ANCHOR, DocThread} from "./types";

const ANCHOR_BASE = `.protyle-wysiwyg span[${ATTR_ANCHOR}]`;

function has(id: string) {
    return `[${ATTR_ANCHOR}~="${id}"]`;
}

export class Highlighter {
    private readonly style: HTMLStyleElement;

    constructor() {
        this.style = document.createElement("style");
        this.style.id = "siyuan-comments-highlight";
        document.head.append(this.style);
    }

    update(threads: DocThread[], activeId?: string) {
        const byBlock = new Map<string, string[]>();
        for (const {blockId, thread} of threads) {
            if (thread.status === "open" && thread.anchor === "inline") {
                byBlock.set(blockId, [...(byBlock.get(blockId) ?? []), thread.id]);
            }
        }
        const single: string[] = [];
        const overlap: string[] = [];
        byBlock.forEach((ids) => {
            ids.forEach((id, i) => {
                single.push(`${ANCHOR_BASE}${has(id)}`);
                // 重叠只会发生在同一块内，按块两两生成
                ids.slice(i + 1).forEach(other => overlap.push(`${ANCHOR_BASE}${has(id)}${has(other)}`));
            });
        });
        const rules: string[] = [];
        if (single.length) {
            rules.push(`${single.join(",\n")} {
    background-color: var(--sc-anchor-bg);
    border-bottom: 2px solid var(--sc-anchor-border);
    cursor: pointer;
}`);
        }
        if (overlap.length) {
            rules.push(`${overlap.join(",\n")} {
    background-color: var(--sc-anchor-bg-overlap);
}`);
        }
        if (activeId) {
            // 重复属性条件以提高优先级，压过重叠规则
            rules.push(`${ANCHOR_BASE}${has(activeId)}${has(activeId)}${has(activeId)} {
    background-color: var(--sc-anchor-bg-active);
}`);
        }
        this.style.textContent = rules.join("\n");
    }

    destroy() {
        this.style.remove();
    }
}
