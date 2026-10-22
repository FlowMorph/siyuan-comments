// 侧栏评论面板：展示当前文档的讨论串，把用户操作转发给 CommentController。
// 每次状态变化整体重绘；输入框内容和焦点在重绘前后保留。
import {confirm, Menu} from "siyuan";
import {CommentController} from "./controller";
import {renderMarkdown, renderMath} from "./markdown";
import {Comment, DocThread} from "./types";

type Filter = "open" | "resolved" | "all";

const FILTER_LABELS: Record<Filter, string> = {open: "未解决", resolved: "已解决", all: "全部"};
const COLLAPSE_THRESHOLD = 3;

function escapeHTML(text: string) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

function formatTime(iso: string) {
    const date = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    const year = date.getFullYear() === new Date().getFullYear() ? "" : `${date.getFullYear()}-`;
    return `${year}${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function icon(name: string) {
    return `<svg><use xlink:href="#${name}"></use></svg>`;
}

export class CommentPanel {
    private filter: Filter = "open";
    private readonly expanded = new Set<string>();
    /** 输入框草稿：reply:<threadId> 或 edit:<commentId> */
    private readonly drafts = new Map<string, string>();
    private editingCommentId?: string;
    private lastActiveId?: string;
    private focusedDraftId?: string;
    private readonly list: HTMLElement;
    private readonly toolbar: HTMLElement;
    private readonly unsubscribe: () => void;

    constructor(private readonly element: HTMLElement, private readonly controller: CommentController) {
        element.innerHTML = `<div class="fn__flex-1 fn__flex-column sc-panel">
    <div class="block__icons">
        <div class="block__logo">${icon("iconScComment").replace("<svg>", '<svg class="block__logoicon">')}评论</div>
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
        element.addEventListener("input", this.onInput);
        element.addEventListener("keydown", this.onKeydown);
        this.unsubscribe = controller.onChange(() => this.render());
        this.render();
    }

    destroy() {
        this.unsubscribe();
        this.element.removeEventListener("click", this.onClick);
        this.element.removeEventListener("input", this.onInput);
        this.element.removeEventListener("keydown", this.onKeydown);
    }

    private visibleThreads(): DocThread[] {
        const threads = this.controller.threads;
        if (this.filter === "all") {
            return threads;
        }
        return threads.filter(item => item.thread.status === this.filter);
    }

    render() {
        const {controller} = this;
        const active = controller.threads.find(item => item.thread.id === controller.activeThreadId);
        // 从正文点进来的讨论串不在当前筛选里时，切到「全部」
        if (active && controller.activeThreadId !== this.lastActiveId && !this.visibleThreads().includes(active)) {
            this.filter = "all";
        }

        const counts = {
            open: controller.threads.filter(item => item.thread.status === "open").length,
            resolved: controller.threads.filter(item => item.thread.status === "resolved").length,
            all: controller.threads.length,
        };
        this.toolbar.innerHTML = controller.currentRootId ? `<div class="sc-doc-title">${escapeHTML(controller.title)}</div>
<div class="sc-filters">${(Object.keys(FILTER_LABELS) as Filter[]).map(key =>
            `<span data-action="filter" data-filter="${key}" class="sc-filter${key === this.filter ? " sc-filter--active" : ""}">${FILTER_LABELS[key]} ${counts[key]}</span>`).join("")}</div>` : "";

        // 记录焦点，重绘后恢复
        const focused = document.activeElement as HTMLTextAreaElement | null;
        const focusKey = focused && this.list.contains(focused) ? focused.dataset.key : undefined;
        const selection = focusKey ? [focused!.selectionStart, focused!.selectionEnd] : undefined;

        const threads = this.visibleThreads();
        if (!controller.currentRootId) {
            this.list.innerHTML = `<div class="sc-empty">打开一个文档后显示它的评论</div>`;
        } else if (!threads.length) {
            this.list.innerHTML = `<div class="sc-empty">${controller.threads.length ? "没有符合筛选的评论" :
                "当前文档没有评论。<br>选中文字后点工具栏的评论按钮（或按 ⌥⇧M），也可以在块菜单里选择「评论」。"}</div>`;
        } else {
            this.list.innerHTML = threads.map(item => this.renderThread(item)).join("");
        }

        if (focusKey) {
            const textarea = this.list.querySelector<HTMLTextAreaElement>(`textarea[data-key="${focusKey}"]`);
            if (textarea) {
                textarea.focus();
                textarea.setSelectionRange(selection![0], selection![1]);
            }
        }
        const draftId = controller.draftThreadId;
        if (draftId && draftId !== this.focusedDraftId) {
            const textarea = this.list.querySelector<HTMLTextAreaElement>(`textarea[data-key="reply:${draftId}"]`);
            if (textarea) {
                this.focusedDraftId = draftId;
                textarea.focus();
            }
        }
        if (controller.activeThreadId && controller.activeThreadId !== this.lastActiveId) {
            this.list.querySelector(`[data-thread-id="${controller.activeThreadId}"]`)?.scrollIntoView({block: "nearest"});
        }
        this.lastActiveId = controller.activeThreadId;
        this.list.querySelectorAll<HTMLTextAreaElement>("textarea").forEach(autoResize);
        renderMath(this.list).catch(e => console.error("[siyuan-comments]", e));
    }

    private renderThread(item: DocThread) {
        const {thread} = item;
        const resolved = thread.status === "resolved";
        const quote = thread.anchor === "doc" ? `<span class="sc-quote__kind">文档</span>` :
            `<span class="sc-quote__kind">${thread.anchor === "block" ? "块" : "原文"}</span>${escapeHTML(thread.quote || "（空）")}`;
        const lost = item.anchorLost ? `<span class="sc-tag">原文已删除</span>` : "";

        let comments = thread.comments;
        let collapsed = "";
        if (comments.length > COLLAPSE_THRESHOLD && !this.expanded.has(thread.id)) {
            const hidden = comments.length - 2;
            comments = [comments[0], comments[comments.length - 1]];
            collapsed = `<div class="sc-expand" data-action="expand">展开 ${hidden} 条回复</div>`;
        }
        const commentHTML = comments.map((comment, index) =>
            this.renderComment(comment) + (index === 0 ? collapsed : "")).join("");

        const replyKey = `reply:${thread.id}`;
        const isDraft = this.controller.draftThreadId === thread.id || thread.comments.length === 0;
        const replyBox = resolved ? "" : `<div class="sc-reply">
    <textarea class="b3-text-field" data-key="${replyKey}" rows="1" placeholder="${isDraft ? "写下评论" : "回复"}（⌘Enter 发送）">${escapeHTML(this.drafts.get(replyKey) ?? "")}</textarea>
    <div class="sc-reply__actions">
        ${isDraft ? `<button class="b3-button b3-button--cancel" data-action="cancel-draft">取消</button>` : ""}
        <button class="b3-button b3-button--text" data-action="send">发送</button>
    </div>
</div>`;

        return `<div class="sc-thread${thread.id === this.controller.activeThreadId ? " sc-thread--active" : ""}${resolved ? " sc-thread--resolved" : ""}" data-thread-id="${thread.id}">
    <div class="sc-thread__head">
        <div class="sc-quote" data-action="jump">${quote}</div>${lost}
        <span class="sc-icon b3-tooltips b3-tooltips__sw" data-action="${resolved ? "reopen" : "resolve"}" aria-label="${resolved ? "重新打开" : "标记为已解决"}">${icon(resolved ? "iconUndo" : "iconCheck")}</span>
        <span class="sc-icon" data-action="thread-menu">${icon("iconMore")}</span>
    </div>
    ${commentHTML}
    ${replyBox}
</div>`;
    }

    private renderComment(comment: Comment) {
        const editKey = `edit:${comment.id}`;
        const body = this.editingCommentId === comment.id ? `<textarea class="b3-text-field" data-key="${editKey}" rows="1">${escapeHTML(this.drafts.get(editKey) ?? comment.content)}</textarea>
<div class="sc-reply__actions">
    <button class="b3-button b3-button--cancel" data-action="cancel-edit">取消</button>
    <button class="b3-button b3-button--text" data-action="save-edit">保存</button>
</div>` : `<div class="sc-comment__body b3-typography">${renderMarkdown(comment.content)}</div>`;
        return `<div class="sc-comment" data-comment-id="${comment.id}">
    <div class="sc-comment__meta">
        <span class="sc-author sc-author--${comment.author}">${comment.author === "ai" ? "AI" : "我"}</span>
        <span class="sc-time">${formatTime(comment.created)}${comment.updated ? "（已编辑）" : ""}</span>
        <span class="fn__flex-1"></span>
        <span class="sc-icon" data-action="comment-menu">${icon("iconMore")}</span>
    </div>
    ${body}
</div>`;
    }

    private findItem(element: Element): DocThread | undefined {
        const id = element.closest<HTMLElement>("[data-thread-id]")?.dataset.threadId;
        return this.controller.threads.find(item => item.thread.id === id);
    }

    private findComment(item: DocThread, element: Element): Comment | undefined {
        const id = element.closest<HTMLElement>("[data-comment-id]")?.dataset.commentId;
        return item.thread.comments.find(comment => comment.id === id);
    }

    private send(item: DocThread) {
        const key = `reply:${item.thread.id}`;
        const content = (this.drafts.get(key) ?? "").trim();
        if (!content) {
            return;
        }
        this.drafts.delete(key);
        void this.controller.reply(item, content);
    }

    private saveEdit(item: DocThread, comment: Comment) {
        const key = `edit:${comment.id}`;
        const content = (this.drafts.get(key) ?? comment.content).trim();
        this.drafts.delete(key);
        this.editingCommentId = undefined;
        if (content && content !== comment.content) {
            void this.controller.editComment(item, comment.id, content);
        } else {
            this.render();
        }
    }

    private readonly onInput = (event: Event) => {
        const target = event.target as HTMLTextAreaElement;
        if (target.dataset.key) {
            this.drafts.set(target.dataset.key, target.value);
            autoResize(target);
        }
    };

    private readonly onKeydown = (event: KeyboardEvent) => {
        const target = event.target as HTMLTextAreaElement;
        const key = target.dataset?.key;
        if (!key) {
            return;
        }
        const item = this.findItem(target);
        if (!item) {
            return;
        }
        // 面板内的按键不交给思源全局快捷键处理
        event.stopPropagation();
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.isComposing) {
            event.preventDefault();
            if (key.startsWith("edit:")) {
                this.saveEdit(item, this.findComment(item, target)!);
            } else {
                this.send(item);
            }
        } else if (event.key === "Escape") {
            event.preventDefault();
            if (key.startsWith("edit:")) {
                this.drafts.delete(key);
                this.editingCommentId = undefined;
                this.render();
            } else if (item.thread.comments.length === 0 && !target.value.trim()) {
                void this.controller.deleteThread(item);
            } else {
                target.blur();
            }
        }
    };

    private readonly onClick = (event: MouseEvent) => {
        const target = event.target as HTMLElement;
        const actionElement = target.closest<HTMLElement>("[data-action]");
        const action = actionElement?.dataset.action;
        const {controller} = this;
        if (action === "refresh") {
            if (controller.currentRootId) {
                void controller.load(controller.currentRootId);
            }
            return;
        }
        if (action === "new-doc") {
            if (controller.currentRootId) {
                void controller.createDoc(controller.currentRootId);
            }
            return;
        }
        if (action === "filter") {
            this.filter = actionElement!.dataset.filter as Filter;
            this.render();
            return;
        }
        const item = this.findItem(target);
        if (!item) {
            return;
        }
        switch (action) {
            case "jump":
                controller.jump(item);
                break;
            case "resolve":
                void controller.setStatus(item, "resolved");
                break;
            case "reopen":
                void controller.setStatus(item, "open");
                break;
            case "expand":
                this.expanded.add(item.thread.id);
                this.render();
                break;
            case "send":
                this.send(item);
                break;
            case "cancel-draft":
                this.drafts.delete(`reply:${item.thread.id}`);
                void controller.deleteThread(item);
                break;
            case "save-edit":
                this.saveEdit(item, this.findComment(item, target)!);
                break;
            case "cancel-edit":
                this.editingCommentId = undefined;
                this.render();
                break;
            case "thread-menu":
                this.openThreadMenu(item, event);
                break;
            case "comment-menu":
                this.openCommentMenu(item, this.findComment(item, target)!, event);
                break;
            default:
                // 点击卡片空白处：选中讨论串并在正文中定位
                if (!target.closest("textarea, button, a") && item.thread.id !== controller.activeThreadId) {
                    controller.jump(item);
                }
        }
    };

    private openThreadMenu(item: DocThread, event: MouseEvent) {
        const menu = new Menu("sc-thread-menu");
        menu.addItem({
            icon: "iconTrashcan",
            label: "删除讨论串",
            click: () => confirm("删除讨论串", `将删除这条讨论串的全部 ${item.thread.comments.length} 条评论${item.thread.anchor === "inline" ? "，并去掉正文中的标记" : ""}。`,
                () => void this.controller.deleteThread(item)),
        });
        menu.open({x: event.clientX, y: event.clientY});
    }

    private openCommentMenu(item: DocThread, comment: Comment, event: MouseEvent) {
        const menu = new Menu("sc-comment-menu");
        menu.addItem({
            icon: "iconEdit",
            label: "编辑",
            click: () => {
                this.editingCommentId = comment.id;
                this.render();
                const textarea = this.list.querySelector<HTMLTextAreaElement>(`textarea[data-key="edit:${comment.id}"]`);
                textarea?.focus();
                textarea?.setSelectionRange(textarea.value.length, textarea.value.length);
            },
        });
        menu.addItem({
            icon: "iconTrashcan",
            label: "删除",
            click: () => {
                const last = item.thread.comments.length <= 1;
                confirm("删除评论", last ? "这是讨论串里的最后一条评论，删除后整条讨论串也会删除。" : "确定删除这条评论？",
                    () => void this.controller.deleteComment(item, comment.id));
            },
        });
        menu.open({x: event.clientX, y: event.clientY});
    }
}

function autoResize(textarea: HTMLTextAreaElement) {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 240)}px`;
}
