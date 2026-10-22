// 讨论串卡片的渲染与交互，侧栏面板和正文浮动卡片共用一份，样式和行为对齐 Notion：
// 头像 + 名字 + 相对时间；悬停评论时右上角出现 ✓（仅第一条）、编辑、删除；底部输入框回车发送、Shift+回车换行。
// 删除不弹对话框：第一次点击按钮变成「?」，再点一次才删除，几秒内不点或鼠标移出评论则恢复。
// 输入框草稿、编辑中的评论、展开状态都存在这里，两处显示同一讨论串时互相同步。
import {CommentController} from "./controller";
import {renderMarkdown, renderMath} from "./markdown";
import {Comment, DocThread} from "./types";

const COLLAPSE_THRESHOLD = 3;
/** 删除按钮变成「?」后等待再次点击的时长 */
const DELETE_CONFIRM_MS = 3000;

export function escapeHTML(text: string) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

export function icon(name: string, className = "") {
    return `<svg${className ? ` class="${className}"` : ""}><use xlink:href="#${name}"></use></svg>`;
}

function pad(n: number) {
    return String(n).padStart(2, "0");
}

/** Notion 式相对时间：刚刚 / N 分钟前 / N 小时前 / 昨天 HH:mm / M月D日 / YYYY年M月D日 */
function relativeTime(iso: string) {
    const date = new Date(iso);
    const nowDate = new Date();
    const minutes = Math.floor((nowDate.getTime() - date.getTime()) / 60000);
    if (minutes < 1) {
        return "刚刚";
    }
    if (minutes < 60) {
        return `${minutes} 分钟前`;
    }
    const startOfToday = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime();
    if (date.getTime() >= startOfToday) {
        return `${Math.floor(minutes / 60)} 小时前`;
    }
    if (date.getTime() >= startOfToday - 86400000) {
        return `昨天 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }
    if (date.getFullYear() === nowDate.getFullYear()) {
        return `${date.getMonth() + 1}月${date.getDate()}日`;
    }
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function fullTime(iso: string) {
    const d = new Date(iso);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function avatar(author: Comment["author"]) {
    return `<span class="sc-avatar sc-avatar--${author}">${icon(author === "ai" ? "iconScAI" : "iconScUser")}</span>`;
}

export interface BindOptions {
    /** 点击卡片空白处的行为（面板里用于定位正文） */
    onCardClick?: (item: DocThread) => void;
    /** 在空的新讨论串里按 Esc 时删除它；浮动卡片自己处理关闭，不需要 */
    escDeletesEmptyDraft?: boolean;
}

export class ThreadView {
    /** reply:<threadId> 或 edit:<commentId> → 输入内容 */
    private readonly drafts = new Map<string, string>();
    private editingCommentId?: string;
    private readonly expanded = new Set<string>();
    /** 已渲染过的讨论串和评论，用于给新出现的评论加淡入动画 */
    private readonly seenThreads = new Set<string>();
    private readonly seenComments = new Set<string>();
    /** 每个容器上次渲染的 HTML，内容没变时跳过重绘，避免打断选中文字和悬停状态 */
    private readonly lastHTML = new WeakMap<HTMLElement, string>();
    /** 已点过一次删除、等待确认的评论 */
    private armedDeleteId?: string;
    private disarmTimer = 0;

    constructor(private readonly controller: CommentController) {
    }

    html(item: DocThread, options: { quote: boolean }) {
        const {thread} = item;
        if (!this.seenThreads.has(thread.id)) {
            this.seenThreads.add(thread.id);
            thread.comments.forEach(comment => this.seenComments.add(comment.id));
        }
        const resolved = thread.status === "resolved";
        let quote = "";
        if (options.quote) {
            const text = thread.anchor === "doc" ? "文档评论" :
                thread.anchor === "block" ? `块：${thread.quote || "（空）"}` : thread.quote || "（空）";
            quote = `<div class="sc-quote" data-action="jump"><span class="sc-quote__text">${escapeHTML(text)}</span>${item.anchorLost ? `<span class="sc-tag">原文已删除</span>` : ""}</div>`;
        }

        let comments = thread.comments.map((comment, index) => this.commentHTML(item, comment, index === 0));
        if (thread.comments.length > COLLAPSE_THRESHOLD && !this.expanded.has(thread.id)) {
            const hidden = thread.comments.length - 2;
            comments = [comments[0], `<div class="sc-expand" data-action="expand">显示另外 ${hidden} 条回复</div>`, comments[comments.length - 1]];
        }

        const replyKey = `reply:${thread.id}`;
        const empty = thread.comments.length === 0;
        const footer = resolved ?
            `<div class="sc-resolved">${icon("iconCheck")}已解决<span class="fn__flex-1"></span><span class="sc-link" data-action="reopen">重新打开</span></div>` :
            `<div class="sc-composer">
    ${avatar("user")}
    <textarea data-key="${replyKey}" rows="1" placeholder="${empty ? "添加评论…" : "回复…"}">${escapeHTML(this.drafts.get(replyKey) ?? "")}</textarea>
    <span class="sc-send ariaLabel" data-position="north" data-action="send" aria-label="发送（回车）">${icon("iconScSend")}</span>
</div>`;

        return `<div class="sc-thread${thread.id === this.controller.activeThreadId ? " sc-thread--active" : ""}${resolved ? " sc-thread--resolved" : ""}${empty ? " sc-thread--empty" : ""}" data-thread-id="${thread.id}">
    ${quote}${comments.join("")}${footer}
</div>`;
    }

    private commentHTML(item: DocThread, comment: Comment, first: boolean) {
        const editKey = `edit:${comment.id}`;
        const editing = this.editingCommentId === comment.id;
        const body = editing ? `<textarea data-key="${editKey}" rows="1">${escapeHTML(this.drafts.get(editKey) ?? comment.content)}</textarea>
<div class="sc-edit-actions">
    <button class="b3-button b3-button--cancel" data-action="cancel-edit">取消</button>
    <button class="b3-button b3-button--text" data-action="save-edit">保存</button>
</div>` : `<div class="sc-comment__body b3-typography">${renderMarkdown(comment.content)}</div>`;
        const resolveAction = first && item.thread.status === "open" ?
            `<span class="sc-action ariaLabel" data-position="north" data-action="resolve" aria-label="解决">${icon("iconCheck")}</span>` : "";
        const armed = this.armedDeleteId === comment.id;
        const deleteAction = armed ?
            `<span class="sc-action sc-action--confirm ariaLabel" data-position="north" data-action="delete" aria-label="再点一次删除${first ? "整个讨论串" : ""}">?</span>` :
            `<span class="sc-action ariaLabel" data-position="north" data-action="delete" aria-label="${first ? "删除讨论串" : "删除评论"}">${icon("iconTrashcan")}</span>`;
        const fresh = !this.seenComments.has(comment.id);
        this.seenComments.add(comment.id);
        return `<div class="sc-comment${editing ? " sc-comment--editing" : ""}${fresh ? " sc-comment--new" : ""}${armed ? " sc-comment--armed" : ""}" data-comment-id="${comment.id}">
    ${avatar(comment.author)}
    <div class="sc-comment__main">
        <div class="sc-comment__meta">
            <span class="sc-author">${comment.author === "ai" ? "AI" : "我"}</span>
            <span class="sc-time" title="${fullTime(comment.created)}">${relativeTime(comment.created)}${comment.updated ? "（已编辑）" : ""}</span>
        </div>
        ${body}
    </div>
    ${editing ? "" : `<div class="sc-comment__actions">${resolveAction}<span class="sc-action ariaLabel" data-position="north" data-action="edit" aria-label="编辑">${icon("iconEdit")}</span>${deleteAction}</div>`}
</div>`;
    }

    /** 这些讨论串里是否有未发送的输入（新评论、回复或编辑中） */
    hasUnsent(threadIds: string[]) {
        return threadIds.some((id) => {
            if ((this.drafts.get(`reply:${id}`) ?? "").trim()) {
                return true;
            }
            const item = this.controller.findThread(id);
            return !!item && !!this.editingCommentId && item.thread.comments.some(c => c.id === this.editingCommentId);
        });
    }

    clearDraft(threadId: string) {
        this.drafts.delete(`reply:${threadId}`);
    }

    /** 重绘容器，保留其中输入框的焦点和光标位置，并完成公式渲染等收尾 */
    renderInto(root: HTMLElement, html: string) {
        if (this.lastHTML.get(root) === html && root.childElementCount) {
            return;
        }
        this.lastHTML.set(root, html);
        const focused = document.activeElement as HTMLTextAreaElement | null;
        const focusKey = focused && root.contains(focused) ? focused.dataset.key : undefined;
        const selection = focusKey ? [focused!.selectionStart, focused!.selectionEnd] : undefined;
        root.innerHTML = html;
        if (focusKey) {
            const textarea = root.querySelector<HTMLTextAreaElement>(`textarea[data-key="${focusKey}"]`);
            if (textarea) {
                textarea.focus();
                textarea.setSelectionRange(selection![0], selection![1]);
            }
        }
        root.querySelectorAll<HTMLTextAreaElement>("textarea").forEach(syncTextarea);
        renderMath(root).catch(e => console.error("[siyuan-comments]", e));
    }

    focusComposer(root: HTMLElement, threadId: string) {
        const textarea = root.querySelector<HTMLTextAreaElement>(`textarea[data-key="reply:${threadId}"]`);
        if (textarea) {
            textarea.focus();
            textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        }
    }

    private findItem(element: Element): DocThread | undefined {
        const id = element.closest<HTMLElement>("[data-thread-id]")?.dataset.threadId;
        return id ? this.controller.findThread(id) : undefined;
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

    /** root 为发起编辑的容器：同一讨论串可能同时显示在面板和浮动卡片里，焦点放在发起的那一处 */
    private startEdit(comment: Comment, root: HTMLElement) {
        this.editingCommentId = comment.id;
        this.drafts.delete(`edit:${comment.id}`);
        this.controller.emit();
        const textarea = root.querySelector<HTMLTextAreaElement>(`textarea[data-key="edit:${comment.id}"]`);
        textarea?.focus();
        textarea?.setSelectionRange(textarea.value.length, textarea.value.length);
    }

    private stopEdit(item: DocThread, comment: Comment, save: boolean) {
        const key = `edit:${comment.id}`;
        const content = (this.drafts.get(key) ?? comment.content).trim();
        this.drafts.delete(key);
        this.editingCommentId = undefined;
        if (save && content && content !== comment.content) {
            void this.controller.editComment(item, comment.id, content);
        } else {
            this.controller.emit();
        }
    }

    /** 第一次点击把删除按钮变成「?」，再次点击才删除；与 Notion 一致，删除第一条评论即删除整个讨论串 */
    private clickDelete(item: DocThread, comment: Comment) {
        window.clearTimeout(this.disarmTimer);
        if (this.armedDeleteId === comment.id) {
            this.armedDeleteId = undefined;
            void this.controller.deleteComment(item, comment.id);
            return;
        }
        this.armedDeleteId = comment.id;
        this.disarmTimer = window.setTimeout(() => this.disarm(), DELETE_CONFIRM_MS);
        this.controller.emit();
    }

    private disarm() {
        window.clearTimeout(this.disarmTimer);
        if (this.armedDeleteId) {
            this.armedDeleteId = undefined;
            this.controller.emit();
        }
    }

    /** 在容器上绑定交互，返回解绑函数 */
    bind(root: HTMLElement, options: BindOptions = {}) {
        const onInput = (event: Event) => {
            const target = event.target as HTMLTextAreaElement;
            if (target.dataset.key) {
                this.drafts.set(target.dataset.key, target.value);
                syncTextarea(target);
            }
        };

        const onKeydown = (event: KeyboardEvent) => {
            const target = event.target as HTMLTextAreaElement;
            const key = target.dataset?.key;
            const item = key ? this.findItem(target) : undefined;
            if (!key || !item) {
                return;
            }
            // 输入框里的按键不交给思源全局快捷键
            event.stopPropagation();
            if (event.isComposing) {
                return;
            }
            if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (key.startsWith("edit:")) {
                    this.stopEdit(item, this.findComment(item, target)!, true);
                } else {
                    this.send(item);
                }
            } else if (event.key === "Escape") {
                if (key.startsWith("edit:")) {
                    event.preventDefault();
                    this.stopEdit(item, this.findComment(item, target)!, false);
                } else if (options.escDeletesEmptyDraft && item.thread.comments.length === 0 && !target.value.trim()) {
                    event.preventDefault();
                    void this.controller.deleteThread(item);
                }
            }
        };

        const onClick = (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            const item = this.findItem(target);
            if (!item) {
                return;
            }
            const action = target.closest<HTMLElement>("[data-action]")?.dataset.action;
            switch (action) {
                case "jump":
                    this.controller.jump(item);
                    break;
                case "resolve":
                    void this.controller.setStatus(item, "resolved");
                    break;
                case "reopen":
                    void this.controller.setStatus(item, "open");
                    break;
                case "expand":
                    this.expanded.add(item.thread.id);
                    this.controller.emit();
                    break;
                case "send":
                    this.send(item);
                    break;
                case "save-edit":
                    this.stopEdit(item, this.findComment(item, target)!, true);
                    break;
                case "cancel-edit":
                    this.stopEdit(item, this.findComment(item, target)!, false);
                    break;
                case "edit":
                    this.startEdit(this.findComment(item, target)!, root);
                    break;
                case "delete":
                    this.clickDelete(item, this.findComment(item, target)!);
                    break;
                default:
                    if (!target.closest("textarea, button, a")) {
                        options.onCardClick?.(item);
                    }
            }
        };

        // 鼠标移出待确认删除的评论时恢复删除按钮
        const onMouseout = (event: MouseEvent) => {
            // 重绘时被替换掉的旧元素也可能触发 mouseout，忽略
            if (!this.armedDeleteId || !(event.target as Node).isConnected) {
                return;
            }
            const comment = (event.target as Element).closest?.(`[data-comment-id="${this.armedDeleteId}"]`);
            if (comment && !(event.relatedTarget instanceof Node && comment.contains(event.relatedTarget))) {
                this.disarm();
            }
        };

        root.addEventListener("input", onInput);
        root.addEventListener("keydown", onKeydown);
        root.addEventListener("click", onClick);
        root.addEventListener("mouseout", onMouseout);
        return () => {
            root.removeEventListener("input", onInput);
            root.removeEventListener("keydown", onKeydown);
            root.removeEventListener("click", onClick);
            root.removeEventListener("mouseout", onMouseout);
        };
    }
}

/** 输入框随内容增高，并同步发送按钮的可用状态 */
function syncTextarea(textarea: HTMLTextAreaElement) {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 240)}px`;
    textarea.parentElement?.classList.toggle("sc-composer--ready", !!textarea.value.trim());
}
