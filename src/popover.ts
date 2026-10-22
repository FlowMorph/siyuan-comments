// 正文浮动卡片：对应 Notion 点开评论时的讨论卡片。
// 鼠标停在高亮文字或块评论标记上约 300ms 后浮出，移开约 300ms 后收起；
// 点击锚点、新建评论、输入框有焦点、有未发送内容或菜单/对话框打开时保持显示，Esc 或点外面关闭。
// 关闭时还没有任何评论的新讨论串会被撤销（连同正文标记）。
import {CommentController} from "./controller";
import {ThreadView} from "./threadView";

const SHOW_DELAY = 300;
const HIDE_DELAY = 300;
const GAP = 6;
const MARGIN = 8;

export type AnchorResolver = () => Element | null;

export class ThreadPopover {
    private readonly element: HTMLElement;
    private threadIds: string[] = [];
    private resolveAnchor?: AnchorResolver;
    private pinned = false;
    private showTimer = 0;
    private hideTimer = 0;
    private frame = 0;
    private readonly unbind: () => void;
    private readonly unsubscribe: () => void;

    constructor(private readonly controller: CommentController, private readonly view: ThreadView) {
        this.element = document.createElement("div");
        this.element.className = "sc-popover fn__none";
        document.body.append(this.element);
        this.unbind = view.bind(this.element);
        this.element.addEventListener("mouseenter", this.cancelHide);
        this.element.addEventListener("mouseleave", this.scheduleHide);
        this.element.addEventListener("keydown", this.onKeydown);
        document.addEventListener("mousedown", this.onDocumentMousedown, true);
        window.addEventListener("scroll", this.onViewportChange, true);
        window.addEventListener("resize", this.onViewportChange);
        this.unsubscribe = controller.onChange(() => this.refresh());
    }

    get isOpen() {
        return this.threadIds.length > 0;
    }

    private isShowing(threadIds: string[]) {
        return this.threadIds.join(",") === threadIds.join(",");
    }

    /** 鼠标进入锚点 */
    hover(threadIds: string[], resolveAnchor: AnchorResolver) {
        if (this.isShowing(threadIds)) {
            this.cancelHide();
            return;
        }
        window.clearTimeout(this.showTimer);
        this.showTimer = window.setTimeout(() => {
            // 已固定的卡片（例如正在写评论）不被悬停替换
            if (!this.pinned || !this.isOpen) {
                this.open(threadIds, resolveAnchor);
            }
        }, SHOW_DELAY);
    }

    /** 鼠标离开锚点 */
    leave() {
        window.clearTimeout(this.showTimer);
        if (this.isOpen) {
            this.scheduleHide();
        }
    }

    open(threadIds: string[], resolveAnchor: AnchorResolver, options: { pin?: boolean, focus?: boolean } = {}) {
        window.clearTimeout(this.showTimer);
        this.cancelHide();
        if (this.isOpen && !this.isShowing(threadIds)) {
            this.close();
        }
        this.threadIds = threadIds;
        this.resolveAnchor = resolveAnchor;
        this.pinned = this.pinned || !!options.pin;
        this.element.classList.remove("fn__none");
        this.element.style.zIndex = String(++window.siyuan.zIndex);
        this.controller.select(threadIds[0]);
        this.refresh();
        if (options.focus) {
            // 等编辑器处理完选区后再抢焦点
            requestAnimationFrame(() => this.view.focusComposer(this.element, threadIds[0]));
        }
    }

    close() {
        window.clearTimeout(this.showTimer);
        this.cancelHide();
        const ids = this.threadIds;
        this.threadIds = [];
        this.pinned = false;
        this.element.classList.add("fn__none");
        this.element.innerHTML = "";
        for (const id of ids) {
            const item = this.controller.findThread(id);
            if (item && item.thread.comments.length === 0) {
                this.view.clearDraft(id);
                void this.controller.deleteThread(item);
            }
        }
        if (this.controller.activeThreadId && ids.includes(this.controller.activeThreadId)) {
            this.controller.select(undefined);
        }
    }

    /** 数据变化后重绘；讨论串都已解决或删除时收起（与 Notion 解决后关闭卡片一致） */
    private refresh() {
        if (!this.isOpen) {
            return;
        }
        const items = this.threadIds.map(id => this.controller.findThread(id))
            .filter(item => item && item.thread.status === "open");
        if (!items.length) {
            this.close();
            return;
        }
        this.view.renderInto(this.element, items.map(item => this.view.html(item!, {quote: false}))
            .join(`<div class="sc-popover__sep"></div>`));
        this.position();
    }

    private position() {
        const anchor = this.resolveAnchor?.();
        if (!anchor) {
            this.close();
            return;
        }
        const rects = anchor.getClientRects();
        const first = rects[0] ?? anchor.getBoundingClientRect();
        const last = rects[rects.length - 1] ?? first;
        const width = this.element.offsetWidth;
        const height = this.element.offsetHeight;
        const left = Math.max(MARGIN, Math.min(first.left, window.innerWidth - width - MARGIN));
        let top = last.bottom + GAP;
        if (top + height > window.innerHeight - MARGIN && first.top - GAP - height >= MARGIN) {
            top = first.top - GAP - height;
        }
        this.element.style.left = `${left}px`;
        this.element.style.top = `${Math.max(MARGIN, top)}px`;
    }

    private canAutoHide() {
        const menu = window.siyuan.menus?.menu?.element as HTMLElement | undefined;
        return !this.pinned &&
            !this.element.contains(document.activeElement) &&
            !this.element.matches(":hover") &&
            !(menu && !menu.classList.contains("fn__none")) &&
            !document.querySelector(".b3-dialog--open") &&
            !this.view.hasUnsent(this.threadIds);
    }

    private readonly scheduleHide = () => {
        window.clearTimeout(this.hideTimer);
        this.hideTimer = window.setTimeout(() => {
            if (this.canAutoHide()) {
                this.close();
            }
        }, HIDE_DELAY);
    };

    private readonly cancelHide = () => {
        window.clearTimeout(this.hideTimer);
    };

    private readonly onKeydown = (event: KeyboardEvent) => {
        // 编辑评论时的 Esc 由 ThreadView 处理（会 preventDefault）
        if (event.key === "Escape" && !event.defaultPrevented && !event.isComposing) {
            event.preventDefault();
            event.stopPropagation();
            this.close();
        }
    };

    private readonly onDocumentMousedown = (event: MouseEvent) => {
        if (!this.isOpen) {
            return;
        }
        const target = event.target as Element;
        const menu = window.siyuan.menus?.menu?.element as HTMLElement | undefined;
        if (this.element.contains(target) || menu?.contains(target) || target.closest?.(".b3-dialog")) {
            return;
        }
        // 点在当前锚点上交给点击事件处理（会固定卡片）
        if (this.resolveAnchor?.()?.contains(target)) {
            return;
        }
        if (this.view.hasUnsent(this.threadIds)) {
            return;
        }
        this.close();
    };

    private readonly onViewportChange = (event: Event) => {
        if (!this.isOpen || (event.target instanceof Node && this.element.contains(event.target))) {
            return;
        }
        cancelAnimationFrame(this.frame);
        this.frame = requestAnimationFrame(() => this.position());
    };

    destroy() {
        this.close();
        this.unbind();
        this.unsubscribe();
        document.removeEventListener("mousedown", this.onDocumentMousedown, true);
        window.removeEventListener("scroll", this.onViewportChange, true);
        window.removeEventListener("resize", this.onViewportChange);
        this.element.remove();
    }
}
