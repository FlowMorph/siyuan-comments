// 评论状态与操作的中心：缓存各文档的讨论串、维护当前文档和选中讨论串，所有写操作都经过这里。
// 面板只负责展示和把用户操作转发到这里。
import {getAllEditor, IProtyle, showMessage} from "siyuan";
import {getBlocksIndexes} from "./api";
import {deleteInlineThread, scrollToAnchor, wrapSelection} from "./anchor";
import {Highlighter} from "./highlight";
import {addComment, getDocTitle, loadDocThreads, mutateThreads, newId, now, updateThread} from "./store";
import {ATTR_ANCHOR, ATTR_THREADS, AnchorKind, DocThread, Thread, ThreadStatus} from "./types";

export class CommentController {
    /** rootId → 该文档的讨论串，覆盖所有打开过的文档，用于正文高亮 */
    private readonly cache = new Map<string, DocThread[]>();
    private readonly titles = new Map<string, string>();
    private readonly listeners = new Set<() => void>();
    private readonly highlighter = new Highlighter();
    private readonly reloadTimers = new Map<string, number>();

    currentRootId?: string;
    activeThreadId?: string;
    /** 刚创建、还没写第一条评论的讨论串，面板据此自动聚焦输入框 */
    draftThreadId?: string;

    constructor(private readonly showDock: () => void, private readonly openBlock: (id: string) => void) {
    }

    onChange(listener: () => void) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private emit() {
        this.highlighter.update(Array.from(this.cache.values()).flat(), this.activeThreadId);
        this.listeners.forEach(listener => listener());
    }

    get threads(): DocThread[] {
        return this.currentRootId ? this.cache.get(this.currentRootId) ?? [] : [];
    }

    get title(): string {
        return this.currentRootId ? this.titles.get(this.currentRootId) ?? "" : "";
    }

    private fail(error: unknown) {
        console.error("[siyuan-comments]", error);
        showMessage(`评论：${(error as Error).message}`, 6000, "error");
    }

    async load(rootId: string) {
        try {
            const [threads, title] = await Promise.all([loadDocThreads(rootId), getDocTitle(rootId)]);
            this.cache.set(rootId, threads);
            this.titles.set(rootId, title);
            this.emit();
        } catch (e) {
            this.fail(e);
        }
    }

    /** 合并短时间内的多次刷新请求（例如外部连续写入） */
    scheduleReload(rootId: string, delay = 400) {
        window.clearTimeout(this.reloadTimers.get(rootId));
        this.reloadTimers.set(rootId, window.setTimeout(() => {
            this.reloadTimers.delete(rootId);
            void this.load(rootId);
        }, delay));
    }

    setCurrent(rootId: string) {
        if (this.currentRootId === rootId) {
            return;
        }
        this.currentRootId = rootId;
        this.activeThreadId = undefined;
        this.emit();
        this.scheduleReload(rootId, 0);
    }

    /** 编辑器关闭时，若该文档已不在任何编辑器中，丢弃缓存 */
    release(rootId: string) {
        const stillOpen = getAllEditor().some(editor => editor.protyle.block.rootID === rootId);
        if (!stillOpen && rootId !== this.currentRootId) {
            this.cache.delete(rootId);
            this.emit();
        }
    }

    isCached(rootId: string) {
        return this.cache.has(rootId);
    }

    /** 判断内核推送的事务是否涉及评论数据，涉及时刷新对应文档 */
    handleOperation(op: { action: string, id?: string, rootID?: string, data?: any }) {
        let touches = false;
        if (op.action === "updateAttrs") {
            touches = !!op.data && (ATTR_THREADS in (op.data.new ?? {}) || ATTR_THREADS in (op.data.old ?? {}));
        } else if (op.action === "update" || op.action === "delete") {
            touches = (typeof op.data === "string" && op.data.includes(ATTR_ANCHOR)) ||
                Array.from(this.cache.values()).some(list => list.some(item => item.blockId === op.id));
        }
        if (!touches) {
            return;
        }
        const roots = op.rootID ? [op.rootID] :
            Array.from(this.cache.entries()).filter(([, list]) => list.some(item => item.blockId === op.id)).map(([root]) => root);
        if (!roots.length && this.currentRootId) {
            roots.push(this.currentRootId);
        }
        roots.filter(root => this.cache.has(root)).forEach(root => this.scheduleReload(root));
    }

    private newThread(anchor: AnchorKind, quote: string): Thread {
        return {id: newId(), anchor, quote, status: "open", created: now(), comments: []};
    }

    /** 新讨论串写入后立即放进缓存并打开面板，不等内核索引 */
    private async addDraft(rootId: string, blockId: string, thread: Thread) {
        const indexes = blockId === rootId ? {} : await getBlocksIndexes([blockId]);
        const list = this.cache.get(rootId) ?? [];
        list.push({rootId, blockId, blockIndex: blockId === rootId ? -1 : indexes[blockId] ?? Number.MAX_SAFE_INTEGER, thread, anchorLost: false});
        list.sort((a, b) => a.blockIndex - b.blockIndex || a.thread.created.localeCompare(b.thread.created));
        this.cache.set(rootId, list);
        this.currentRootId = rootId;
        this.activeThreadId = thread.id;
        this.draftThreadId = thread.id;
        this.showDock();
        this.emit();
    }

    async createInline(protyle: IProtyle) {
        try {
            let thread: Thread | undefined;
            const blockId = wrapSelection(protyle, (quote) => (thread = this.newThread("inline", quote)));
            await this.addDraft(protyle.block.rootID!, blockId, thread!);
        } catch (e) {
            this.fail(e);
        }
    }

    async createBlock(rootId: string, blockId: string, text: string) {
        try {
            const thread = this.newThread("block", text.slice(0, 120));
            await mutateThreads(blockId, threads => [...threads, thread]);
            await this.addDraft(rootId, blockId, thread);
        } catch (e) {
            this.fail(e);
        }
    }

    async createDoc(rootId: string) {
        try {
            const thread = this.newThread("doc", "");
            await mutateThreads(rootId, threads => [...threads, thread]);
            await this.addDraft(rootId, rootId, thread);
        } catch (e) {
            this.fail(e);
        }
    }

    private async run(item: DocThread, action: () => Promise<unknown>) {
        try {
            await action();
        } catch (e) {
            this.fail(e);
        }
        await this.load(item.rootId);
    }

    reply(item: DocThread, content: string) {
        if (this.draftThreadId === item.thread.id) {
            this.draftThreadId = undefined;
        }
        return this.run(item, () => addComment(item.blockId, item.thread.id, "user", content));
    }

    editComment(item: DocThread, commentId: string, content: string) {
        return this.run(item, () => updateThread(item.blockId, item.thread.id, (thread) => {
            const comment = thread.comments.find(c => c.id === commentId);
            if (!comment) {
                throw new Error("评论已不存在");
            }
            comment.content = content;
            comment.updated = now();
        }));
    }

    /** 删除单条评论；删到一条不剩时连讨论串（和锚点）一起删除 */
    deleteComment(item: DocThread, commentId: string) {
        if (item.thread.comments.length <= 1) {
            return this.deleteThread(item);
        }
        return this.run(item, () => updateThread(item.blockId, item.thread.id, (thread) => {
            thread.comments = thread.comments.filter(c => c.id !== commentId);
        }));
    }

    deleteThread(item: DocThread) {
        if (this.draftThreadId === item.thread.id) {
            this.draftThreadId = undefined;
        }
        if (this.activeThreadId === item.thread.id) {
            this.activeThreadId = undefined;
        }
        return this.run(item, () => item.thread.anchor === "inline" ?
            deleteInlineThread(item.blockId, item.thread.id) :
            mutateThreads(item.blockId, threads => threads.filter(t => t.id !== item.thread.id)));
    }

    setStatus(item: DocThread, status: ThreadStatus) {
        return this.run(item, () => updateThread(item.blockId, item.thread.id, (thread) => {
            thread.status = status;
            if (status === "resolved") {
                thread.resolved = now();
            } else {
                delete thread.resolved;
            }
        }));
    }

    /** 选中讨论串；fromEditor 表示由点击正文锚点触发，需要把面板调出来 */
    select(threadId: string | undefined, fromEditor = false) {
        this.activeThreadId = threadId;
        if (fromEditor) {
            this.showDock();
        }
        this.emit();
    }

    /** 正文定位到讨论串的锚点；块未加载（长文档动态加载）时通过打开块来定位 */
    jump(item: DocThread) {
        this.select(item.thread.id);
        if (item.thread.anchor === "doc") {
            return;
        }
        if (!scrollToAnchor(item.blockId, item.thread.id)) {
            this.openBlock(item.blockId);
        }
    }

    destroy() {
        this.reloadTimers.forEach(timer => window.clearTimeout(timer));
        this.highlighter.destroy();
        this.listeners.clear();
    }
}
