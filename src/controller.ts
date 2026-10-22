// 评论状态与操作的中心：缓存各文档的讨论串、维护当前文档和选中讨论串，所有写操作都经过这里。
// 面板只负责展示和把用户操作转发到这里。
import {getAllEditor, IProtyle, showMessage} from "siyuan";
import {getBlocksIndexes} from "./api";
import {deleteInlineThread, scrollToAnchor, wrapSelection} from "./anchor";
import {Highlighter} from "./highlight";
import {addComment, loadDocThreads, mutateThreads, newId, now, updateThread} from "./store";
import {ATTR_ANCHOR, ATTR_THREADS, AnchorKind, DocThread, Thread, ThreadStatus} from "./types";

export class CommentController {
    /** rootId → 该文档的讨论串，覆盖所有打开过的文档，用于正文高亮 */
    private readonly cache = new Map<string, DocThread[]>();
    private readonly listeners = new Set<() => void>();
    private readonly highlighter = new Highlighter();
    private readonly reloadTimers = new Map<string, number>();

    currentRootId?: string;
    activeThreadId?: string;
    /** 刚创建、还没写第一条评论的讨论串，面板据此自动聚焦输入框 */
    draftThreadId?: string;

    constructor(private readonly openBlock: (id: string) => void) {
    }

    onChange(listener: () => void) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /** 状态或视图状态（展开、编辑中）变化后通知面板、浮动卡片和高亮重绘 */
    emit() {
        this.highlighter.update(Array.from(this.cache.values()).flat(), this.activeThreadId);
        this.listeners.forEach(listener => listener());
    }

    get threads(): DocThread[] {
        return this.currentRootId ? this.cache.get(this.currentRootId) ?? [] : [];
    }

    private fail(error: unknown) {
        console.error("[siyuan-comments]", error);
        showMessage(`评论：${(error as Error).message}`, 6000, "error");
    }

    async load(rootId: string) {
        try {
            this.cache.set(rootId, await loadDocThreads(rootId));
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

    /** 在所有已缓存文档中查找讨论串 */
    findThread(threadId: string): DocThread | undefined {
        for (const list of this.cache.values()) {
            const item = list.find(entry => entry.thread.id === threadId);
            if (item) {
                return item;
            }
        }
        return undefined;
    }

    /** 某个文档里挂在指定块上的未解决块评论 */
    openBlockThreads(rootId: string): Map<string, DocThread[]> {
        const result = new Map<string, DocThread[]>();
        for (const item of this.cache.get(rootId) ?? []) {
            if (item.thread.anchor === "block" && item.thread.status === "open") {
                result.set(item.blockId, [...(result.get(item.blockId) ?? []), item]);
            }
        }
        return result;
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

    /** 新讨论串写入后立即放进缓存，不等内核索引；由调用方决定在浮动卡片还是面板里输入首条评论 */
    private async addDraft(rootId: string, blockId: string, thread: Thread) {
        const indexes = blockId === rootId ? {} : await getBlocksIndexes([blockId]);
        const list = this.cache.get(rootId) ?? [];
        list.push({rootId, blockId, blockIndex: blockId === rootId ? -1 : indexes[blockId] ?? Number.MAX_SAFE_INTEGER, thread, anchorLost: false});
        list.sort((a, b) => a.blockIndex - b.blockIndex || a.thread.created.localeCompare(b.thread.created));
        this.cache.set(rootId, list);
        this.currentRootId = rootId;
        this.activeThreadId = thread.id;
        this.draftThreadId = thread.id;
        this.emit();
    }

    /** 以下三个创建方法成功时返回新讨论串 id，失败时提示并返回 undefined */
    async createInline(protyle: IProtyle): Promise<string | undefined> {
        try {
            let thread: Thread | undefined;
            const blockId = wrapSelection(protyle, (quote) => (thread = this.newThread("inline", quote)));
            await this.addDraft(protyle.block.rootID!, blockId, thread!);
            return thread!.id;
        } catch (e) {
            this.fail(e);
        }
    }

    async createBlock(rootId: string, blockId: string, text: string): Promise<string | undefined> {
        try {
            const thread = this.newThread("block", text.slice(0, 120));
            await mutateThreads(blockId, threads => [...threads, thread]);
            await this.addDraft(rootId, blockId, thread);
            return thread.id;
        } catch (e) {
            this.fail(e);
        }
    }

    async createDoc(rootId: string): Promise<string | undefined> {
        try {
            const thread = this.newThread("doc", "");
            await mutateThreads(rootId, threads => [...threads, thread]);
            await this.addDraft(rootId, rootId, thread);
            return thread.id;
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

    /** 删除单条评论；与 Notion 一致，删除第一条评论即删除整个讨论串（连同锚点） */
    deleteComment(item: DocThread, commentId: string) {
        if (item.thread.comments[0]?.id === commentId || item.thread.comments.length <= 1) {
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

    /** 选中讨论串：正文锚点加深高亮，面板里对应卡片高亮 */
    select(threadId: string | undefined) {
        if (this.activeThreadId === threadId) {
            return;
        }
        this.activeThreadId = threadId;
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
