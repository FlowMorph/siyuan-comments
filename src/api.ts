// 思源内核 API 的薄封装：失败时直接抛错，由调用方展示
import {fetchSyncPost} from "siyuan";

async function post<T>(url: string, data: unknown): Promise<T> {
    const res = await fetchSyncPost(url, data);
    if (res.code !== 0) {
        throw new Error(`${url} 失败：${res.msg}`);
    }
    return res.data as T;
}

export function sql<T>(stmt: string): Promise<T[]> {
    return post<T[]>("/api/query/sql", {stmt});
}

/** 把内核尚未写入数据库的事务落盘，保证随后的 SQL 读到最新状态 */
export function flushTransaction(): Promise<void> {
    return post("/api/sqlite/flushTransaction", {});
}

export function getBlockAttrs(id: string): Promise<Record<string, string>> {
    return post("/api/attr/getBlockAttrs", {id});
}

export function setBlockAttrs(id: string, attrs: Record<string, string>): Promise<void> {
    return post("/api/attr/setBlockAttrs", {id, attrs});
}

export function getBlocksIndexes(ids: string[]): Promise<Record<string, number>> {
    return post("/api/block/getBlocksIndexes", {ids});
}

export async function getBlockDOM(id: string): Promise<string> {
    const data = await post<{dom: string}>("/api/block/getBlockDOM", {id});
    return data.dom;
}

export function updateBlockDOM(id: string, dom: string): Promise<void> {
    return post("/api/block/updateBlock", {id, dataType: "dom", data: dom});
}
