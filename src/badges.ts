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
        const entry: Entry = {protyle, layer, frame: 0, dispose: () => undefined};
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

    /** 复用已有标记元素，只更新位置和内容；新出现的块才创建元素（淡入动画只播一次） */
    private render(entry: Entry) {
        const {protyle, layer} = entry;
        const groups = this.controller.openBlockThreads(protyle.block.rootID!);
        const host = protyle.element.getBoundingClientRect();
        const content = protyle.contentElement!.getBoundingClientRect();
        const existing = new Map(Array.from(layer.querySelectorAll<HTMLElement>(".sc-badge"))
            .map(badge => [badge.dataset.blockId!, badge]));
        groups.forEach((items, blockId) => {
            const block = findBlockElement(protyle.wysiwyg!.element, blockId);
            const rect = block?.offsetParent ? block.getBoundingClientRect() : undefined;
            if (!rect || rect.bottom < content.top || rect.top + 20 > content.bottom) {
                return;
            }
            let badge = existing.get(blockId);
            existing.delete(blockId);
            if (!badge) {
                badge = document.createElement("div");
                badge.className = "sc-badge";
                badge.dataset.blockId = blockId;
                layer.append(badge);
            }
            const threadIds = items.map(item => item.thread.id).join(",");
            const count = items.reduce((sum, item) => sum + item.thread.comments.length, 0);
            const html = `${icon("iconScComment")}${count ? `<span>${count}</span>` : ""}`;
            if (badge.dataset.threadIds !== threadIds) {
                badge.dataset.threadIds = threadIds;
            }
            if (badge.dataset.count !== String(count)) {
                badge.dataset.count = String(count);
                badge.innerHTML = html;
            }
            // 块右侧留白里，空间不够时贴着编辑区右边缘（避开滚动条）
            badge.style.top = `${rect.top - host.top + 2}px`;
            badge.style.left = `${Math.min(rect.right + 6, content.right - 52) - host.left}px`;
        });
        existing.forEach(badge => badge.remove());
    }

    destroy() {
        this.unsubscribe();
        this.entries.forEach(entry => entry.dispose());
        this.entries.clear();
    }
}
