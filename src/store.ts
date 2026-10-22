// 讨论串的读写：讨论串以 JSON 存在锚点所在块的 custom-comments 属性里
import {flushTransaction, getBlockAttrs, getBlocksIndexes, setBlockAttrs, sql} from "./api";
import {ATTR_ANCHOR, ATTR_THREADS, Author, DocThread, Thread} from "./types";

export function newId(): string {
    return window.Lute.NewNodeID();
}

export function now(): string {
    return new Date().toISOString();
}

function parseThreads(blockId: string, value: string | undefined): Thread[] {
    if (!value) {
        return [];
    }
    try {
        return JSON.parse(value) as Thread[];
    } catch (e) {
        throw new Error(`块 ${blockId} 的 ${ATTR_THREADS} 属性不是合法 JSON：${(e as Error).message}`);
    }
}

/**
 * 读取最新属性 → 修改 → 写回。每次修改前都重新读取，减少与外部写入（AI 回复）互相覆盖的窗口。
 * 修改后列表为空时清空属性。
 */
export async function mutateThreads(blockId: string, mutate: (threads: Thread[]) => Thread[]): Promise<Thread[]> {
    const attrs = await getBlockAttrs(blockId);
    const threads = mutate(parseThreads(blockId, attrs[ATTR_THREADS]));
    await setBlockAttrs(blockId, {[ATTR_THREADS]: threads.length ? JSON.stringify(threads) : ""});
    return threads;
}

export function updateThread(blockId: string, threadId: string, update: (thread: Thread) => void): Promise<Thread[]> {
    return mutateThreads(blockId, (threads) => {
        const thread = threads.find(item => item.id === threadId);
        if (!thread) {
            throw new Error(`讨论串 ${threadId} 已不存在`);
        }
        update(thread);
        return threads;
    });
}

export function addComment(blockId: string, threadId: string, author: Author, content: string) {
    return updateThread(blockId, threadId, (thread) => {
        thread.comments.push({id: newId(), author, content, created: now()});
    });
}

/** 加载文档内所有讨论串，按块在文档中的顺序排列，文档级讨论串排最前 */
export async function loadDocThreads(rootId: string): Promise<DocThread[]> {
    await flushTransaction();
    const rows = await sql<{ block_id: string, name: string, value: string }>(
        `SELECT block_id, name, value FROM attributes WHERE root_id = '${rootId}' AND name IN ('${ATTR_THREADS}', '${ATTR_ANCHOR}') LIMIT 10000`);
    const anchors = new Set<string>();
    const threadRows: { block_id: string, value: string }[] = [];
    for (const row of rows) {
        if (row.name === ATTR_ANCHOR) {
            anchors.add(row.value);
        } else {
            threadRows.push(row);
        }
    }
    if (!threadRows.length) {
        return [];
    }
    const indexes = await getBlocksIndexes(threadRows.map(row => row.block_id));
    const result: DocThread[] = [];
    for (const row of threadRows) {
        for (const thread of parseThreads(row.block_id, row.value)) {
            result.push({
                rootId,
                blockId: row.block_id,
                blockIndex: row.block_id === rootId ? -1 : (indexes[row.block_id] ?? Number.MAX_SAFE_INTEGER),
                thread,
                anchorLost: thread.anchor === "inline" && !anchors.has(thread.id),
            });
        }
    }
    result.sort((a, b) => a.blockIndex - b.blockIndex || a.thread.created.localeCompare(b.thread.created));
    return result;
}

export async function getDocTitle(rootId: string): Promise<string> {
    const rows = await sql<{ content: string }>(`SELECT content FROM blocks WHERE id = '${rootId}' LIMIT 1`);
    return rows[0]?.content ?? "";
}
