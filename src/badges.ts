// 块评论标记：对应 Notion 块右侧的「💬 数量」图标。
// 标记画在编辑器（.protyle）里的一个覆盖层上，不改动编辑器 DOM；块位置变化（滚动、编辑、尺寸变化）时重新定位。
import {IProtyle} from "siyuan";
import {findBlockElement} from "./anchor";
import {CommentController} from "./controller";
import {icon} from "./threadView";

interface Entry {
    protyle: IProtyle;
    layer: HTMLElement;
    frame: number;
    /** 上次渲染的内容，没变化时不重建元素，避免打断鼠标悬停 */
    html: string;
    dispose: () => void;
}

export class BlockBadges {
    private readonly entries = new Map<HTMLElement, Entry>();
    private readonly unsubscribe: () => void;

    constructor(private readonly controller: CommentController) {
        this.unsubscribe = controller.onChange(() => this.entries.forEach(entry => this.schedule(entry)));
    }

    attach(protyle: IProtyle) {
        if (this.entries.has(protyle.element) || !protyle.wysiwyg || !protyle.contentElement) {
            return;
        }
        const layer = document.createElement("div");
        layer.className = "sc-badges";
        protyle.element.append(layer);
        const entry: Entry = {protyle, layer, frame: 0, html: "", dispose: () => undefined};
        const schedule = () => this.schedule(entry);
        const mutation = new MutationObserver(schedule);
        mutation.observe(protyle.wysiwyg.element, {childList: true, subtree: true, characterData: true});
        const resize = new ResizeObserver(schedule);
        resize.observe(protyle.wysiwyg.element);
        resize.observe(protyle.element);
        protyle.contentElement.addEventListener("scroll", schedule, {passive: true});
        entry.dispose = () => {
            mutation.disconnect();
            resize.disconnect();
            protyle.contentElement?.removeEventListener("scroll", schedule);
            cancelAnimationFrame(entry.frame);
            layer.remove();
        };
        this.entries.set(protyle.element, entry);
        this.schedule(entry);
    }

    detach(protyle: IProtyle) {
        this.entries.get(protyle.element)?.dispose();
        this.entries.delete(protyle.element);
    }

    /** 找某个块的标记元素，浮动卡片据此定位 */
    findBadge(blockId: string): HTMLElement | null {
        for (const entry of this.entries.values()) {
            const badge = entry.layer.querySelector<HTMLElement>(`.sc-badge[data-block-id="${blockId}"]`);
            if (badge?.offsetParent) {
                return badge;
            }
        }
        return null;
    }

    private schedule(entry: Entry) {
        if (entry.frame) {
            return;
        }
        entry.frame = requestAnimationFrame(() => {
            entry.frame = 0;
            this.render(entry);
        });
    }

    private render(entry: Entry) {
        const {protyle, layer} = entry;
        const groups = this.controller.openBlockThreads(protyle.block.rootID!);
        const host = protyle.element.getBoundingClientRect();
        const content = protyle.contentElement!.getBoundingClientRect();
        const html: string[] = [];
        groups.forEach((items, blockId) => {
            const block = findBlockElement(protyle.wysiwyg!.element, blockId);
            if (!block?.offsetParent) {
                return;
            }
            const rect = block.getBoundingClientRect();
            if (rect.bottom < content.top || rect.top + 20 > content.bottom) {
                return;
            }
            // 块右侧留白里，空间不够时贴着编辑区右边缘（避开滚动条）
            const left = Math.min(rect.right + 6, content.right - 52) - host.left;
            const count = items.reduce((sum, item) => sum + item.thread.comments.length, 0);
            html.push(`<div class="sc-badge" data-block-id="${blockId}" data-thread-ids="${items.map(item => item.thread.id).join(",")}" style="top:${rect.top - host.top + 2}px;left:${left}px">${icon("iconScComment")}${count ? `<span>${count}</span>` : ""}</div>`);
        });
        const joined = html.join("");
        if (joined !== entry.html) {
            entry.html = joined;
            layer.innerHTML = joined;
        }
    }

    destroy() {
        this.unsubscribe();
        this.entries.forEach(entry => entry.dispose());
        this.entries.clear();
    }
}
