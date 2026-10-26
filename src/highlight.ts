// 正文高亮：用一张动态样式表按讨论串状态给锚点上色，不改动编辑器 DOM。
// 未解决的显示为淡黄高亮；两条讨论串重叠的部分颜色加深（与 Notion 一致）；当前选中的讨论串最深。
// 已解决或未知的锚点不加样式，与普通文字无异。块右侧的评论标记由 BlockBadges 显示，悬停标记时其中的划词评论同样加深。
import {ATTR_ANCHOR, DocThread} from "./types";

const ANCHOR_BASE = `.protyle-wysiwyg span[${ATTR_ANCHOR}]`;

function has(id: string) {
    return `[${ATTR_ANCHOR}~="${id}"]`;
}

export class Highlighter {
    private readonly style: HTMLStyleElement;
    /** 悬停块右侧评论标记时的加深样式，单独一张表，悬停变化不触发整体重绘 */
    private readonly hoverStyle: HTMLStyleElement;

    constructor() {
        this.style = document.createElement("style");
        this.style.id = "siyuan-comments-highlight";
        this.hoverStyle = document.createElement("style");
        this.hoverStyle.id = "siyuan-comments-highlight-hover";
        document.head.append(this.style, this.hoverStyle);
    }

    setHover(threadIds: string[]) {
        this.hoverStyle.textContent = threadIds.length ? `${threadIds.map(id => `${ANCHOR_BASE}${has(id)}${has(id)}${has(id)}`).join(",\n")} {
    background-color: var(--sc-anchor-bg-active);
}` : "";
    }

    update(threads: DocThread[], activeId?: string) {
        const byDoc = new Map<string, string[]>();
        for (const {rootId, thread} of threads) {
            if (thread.status === "open" && thread.anchor === "inline") {
                byDoc.set(rootId, [...(byDoc.get(rootId) ?? []), thread.id]);
            }
        }
        const single: string[] = [];
        const overlap: string[] = [];
        byDoc.forEach((ids) => {
            ids.forEach((id, i) => {
                single.push(`${ANCHOR_BASE}${has(id)}`);
                // 讨论串可跨段落，重叠只会发生在同一文档内，按文档两两生成
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
        this.hoverStyle.remove();
    }
}
