// 侧栏评论面板：对应 Notion 的评论面板，列出当前文档的讨论串（带原文引用），按状态筛选；
// 卡片的渲染和交互由 ThreadView 负责，与正文浮动卡片共用。
import {CommentController} from "./controller";
import {escapeHTML, icon, ThreadView} from "./threadView";
import {DocThread} from "./types";

type Filter = "open" | "resolved" | "all";

const FILTER_LABELS: Record<Filter, string> = {open: "未解决", resolved: "已解决", all: "全部"};

export class CommentPanel {
    private filter: Filter = "open";
    private lastActiveId?: string;
    private focusedDraftId?: string;
    private readonly list: HTMLElement;
    private readonly toolbar: HTMLElement;
    private readonly unsubscribe: () => void;
    private readonly unbind: () => void;

    constructor(private readonly element: HTMLElement, private readonly controller: CommentController,
                private readonly view: ThreadView) {
        element.innerHTML = `<div class="fn__flex-1 fn__flex-column sc-panel">
    <div class="block__icons">
        <div class="block__logo">${icon("iconScComment", "block__logoicon")}评论</div>
        <span class="fn__flex-1"></span>
        <span data-action="new-doc" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="评论此文档">${icon("iconAdd")}</span>
        <span class="fn__space"></span>
        <span data-action="refresh" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="刷新">${icon("iconRefresh")}</span>
    </div>
    <div class="sc-toolbar"></div>
    <div class="sc-list fn__flex-1"></div>
</div>`;
        this.toolbar = element.querySelector(".sc-toolbar")!;
        this.list = element.querySelector(".sc-list")!;
        element.addEventListener("click", this.onClick);
        this.unbind = view.bind(this.list, {
            escDeletesEmptyDraft: true,
            onCardClick: (item) => controller.jump(item),
        });
        this.unsubscribe = controller.onChange(() => this.render());
        this.render();
    }

    destroy() {
        this.unsubscribe();
        this.unbind();
        this.element.removeEventListener("click", this.onClick);
    }

    private visibleThreads(): DocThread[] {
        const threads = this.controller.threads;
        return this.filter === "all" ? threads : threads.filter(item => item.thread.status === this.filter);
    }

    render() {
        const {controller} = this;
        const active = controller.threads.find(item => item.thread.id === controller.activeThreadId);
        // 选中的讨论串不在当前筛选里时，切到「全部」
        if (active && controller.activeThreadId !== this.lastActiveId && !this.visibleThreads().includes(active)) {
            this.filter = "all";
        }

        const count = (filter: Filter) => filter === "all" ? controller.threads.length :
            controller.threads.filter(item => item.thread.status === filter).length;
        this.toolbar.innerHTML = controller.currentRootId ? `<div class="sc-doc-title">${escapeHTML(controller.title)}</div>
<div class="sc-filters">${(Object.keys(FILTER_LABELS) as Filter[]).map(key =>
            `<span data-action="filter" data-filter="${key}" class="sc-filter${key === this.filter ? " sc-filter--active" : ""}">${FILTER_LABELS[key]} ${count(key)}</span>`).join("")}</div>` : "";

        const threads = this.visibleThreads();
        let html: string;
        if (!controller.currentRootId) {
            html = `<div class="sc-empty">打开一个文档后显示它的评论</div>`;
        } else if (!threads.length) {
            html = `<div class="sc-empty">${controller.threads.length ? "没有符合筛选的评论" :
                "当前文档没有评论。<br>选中文字后点工具栏的评论按钮（或按 ⌥⇧M），也可以在块菜单里选择「评论」。"}</div>`;
        } else {
            html = threads.map(item => this.view.html(item, {quote: true})).join("");
        }
        this.view.renderInto(this.list, html);

        // 面板里只负责文档级新讨论串的首条输入，划词和块评论在浮动卡片里输入
        const draft = controller.draftThreadId && controller.findThread(controller.draftThreadId);
        if (draft && draft.thread.anchor === "doc" && draft.thread.id !== this.focusedDraftId) {
            this.focusedDraftId = draft.thread.id;
            this.view.focusComposer(this.list, draft.thread.id);
        }
        if (controller.activeThreadId && controller.activeThreadId !== this.lastActiveId) {
            this.list.querySelector(`[data-thread-id="${controller.activeThreadId}"]`)?.scrollIntoView({block: "nearest"});
        }
        this.lastActiveId = controller.activeThreadId;
    }

    private readonly onClick = (event: MouseEvent) => {
        const actionElement = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
        const {controller} = this;
        switch (actionElement?.dataset.action) {
            case "refresh":
                if (controller.currentRootId) {
                    void controller.load(controller.currentRootId);
                }
                break;
            case "new-doc":
                if (controller.currentRootId) {
                    void controller.createDoc(controller.currentRootId);
                }
                break;
            case "filter":
                this.filter = actionElement.dataset.filter as Filter;
                this.render();
                break;
        }
    };
}
