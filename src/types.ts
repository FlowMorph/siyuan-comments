// 评论串数据模型。存储格式同时被 tools/siyuan_comments.py 读写，修改字段时两边同步，详见 docs/data-model.md

/** 讨论串列表存放的块属性名，值为 Thread[] 的 JSON */
export const ATTR_THREADS = "custom-comments";
/** 行内锚点 span 上的属性名，值为讨论串 id */
export const ATTR_ANCHOR = "custom-comment-id";

export type Author = "user" | "ai";
/** inline：划词评论；block：整块评论；doc：文档级评论（挂在文档块上） */
export type AnchorKind = "inline" | "block" | "doc";
export type ThreadStatus = "open" | "resolved";

export interface Comment {
    id: string;
    author: Author;
    /** Markdown 正文 */
    content: string;
    created: string;
    updated?: string;
}

export interface Thread {
    id: string;
    anchor: AnchorKind;
    /** 创建时被评论的原文；块级为块文本摘要，文档级为空 */
    quote: string;
    status: ThreadStatus;
    created: string;
    resolved?: string;
    comments: Comment[];
}

/** 面板中的一条讨论串及其所在块的上下文 */
export interface DocThread {
    rootId: string;
    blockId: string;
    /** 块在文档中的顺序，用于排序 */
    blockIndex: number;
    thread: Thread;
    /** 行内锚点所在文字已被删除 */
    anchorLost: boolean;
}
