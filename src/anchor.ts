// 行内锚点：把选中文字（可跨段落）切成若干行内片段，片段带 custom-comment-id 属性（空格分隔的讨论串 id 列表），
// 因此评论区域可以重叠或嵌套（先评论整段，再评论其中一句）。
// 每个片段的 data-type 都含 "text"：Lute 保存时会把相邻同类型、且前一个没有属性的行内元素合并，
// 加上 "text" 后片段与两侧原有元素类型不同，评论范围不会被合并扩大。
// Lute 会把行内 custom-* 属性存进 kramdown 的 span IAL；插件卸载后正文外观不变。
import {getAllEditor, IProtyle} from "siyuan";
import {flushTransaction, getBlockDOM, sql, updateBlockDOM} from "./api";
import {ATTR_ANCHOR, ATTR_THREADS, Thread} from "./types";

function closestBlock(node: Node | null): HTMLElement | null {
    const element = node instanceof Element ? node : node?.parentElement;
    return element?.closest<HTMLElement>("[data-node-id]") ?? null;
}

/** 在编辑器里找块元素，跳过嵌入块里渲染的副本 */
export function findBlockElement(root: Element, blockId: string): HTMLElement | null {
    return Array.from(root.querySelectorAll<HTMLElement>(`[data-node-id="${blockId}"]`))
        .find(item => !item.parentElement?.closest('[data-type="NodeBlockQueryEmbed"]')) ?? null;
}

export function anchorIds(element: Element): string[] {
    return (element.getAttribute(ATTR_ANCHOR) || "").split(/\s+/).filter(Boolean);
}

function anchorSelector(threadId: string) {
    return `span[${ATTR_ANCHOR}~="${threadId}"]`;
}

/** 取编辑器当前选区；工具栏按钮触发时选区记录在 toolbar.range 上 */
function currentRange(protyle: IProtyle): Range | null {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        if (!range.collapsed && protyle.wysiwyg!.element.contains(range.commonAncestorContainer)) {
            return range;
        }
    }
    const range = protyle.toolbar?.range;
    if (range && !range.collapsed && protyle.wysiwyg!.element.contains(range.commonAncestorContainer)) {
        return range;
    }
    return null;
}

const UNCOMMENTABLE_BLOCKS = ["NodeCodeBlock", "NodeMathBlock", "NodeHTMLBlock"];

interface SelectedText {
    node: Text;
    editable: HTMLElement;
    /** 节点所在的叶子块 */
    block: HTMLElement;
}

/**
 * 选区覆盖的文本节点（可跨块）。先在边界处拆分文本节点，使每个返回的节点都整段落在选区内；
 * 跳过代码块、公式块、HTML 块和公式等不可编辑的行内元素。
 */
function selectedTextNodes(wysiwyg: HTMLElement, range: Range): SelectedText[] {
    // 先拆终点再拆起点：同一节点时起点偏移不受影响；Range 是活动对象，拆分后边界会自动跟随
    if (range.endContainer instanceof Text && range.endOffset > 0 && range.endOffset < range.endContainer.length) {
        range.endContainer.splitText(range.endOffset);
    }
    if (range.startContainer instanceof Text && range.startOffset > 0 && range.startOffset < range.startContainer.length) {
        range.startContainer.splitText(range.startOffset);
    }
    const common = range.commonAncestorContainer;
    const walkRoot = common instanceof Element ? common : common.parentElement!;
    const result: SelectedText[] = [];
    const walker = document.createTreeWalker(walkRoot, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
        if (!range.intersectsNode(node) || !node.data.replace(/\u200b/g, "")) {
            continue;
        }
        // 边界恰好落在节点末尾/开头时，节点与选区只是相接
        if ((node === range.startContainer && range.startOffset === node.length) ||
            (node === range.endContainer && range.endOffset === 0)) {
            continue;
        }
        const editable = node.parentElement?.closest<HTMLElement>('[contenteditable="true"]');
        if (!editable || !wysiwyg.contains(editable)) {
            continue;
        }
        const locked = node.parentElement!.closest('[contenteditable="false"]');
        if (locked && editable.contains(locked)) {
            continue;
        }
        const block = closestBlock(editable);
        if (!block || UNCOMMENTABLE_BLOCKS.includes(block.dataset.type!)) {
            continue;
        }
        result.push({node, editable, block});
    }
    return result;
}

/** 把一个文本节点变成带讨论串 id 的行内片段，返回该片段。editable 为节点所在的可编辑区 */
function markTextNode(editable: HTMLElement, node: Text, threadId: string): HTMLElement {
    const parent = node.parentElement!;
    let piece: HTMLElement;
    if (parent !== editable && parent.tagName === "SPAN" && parent.hasAttribute("data-type")) {
        // 已在行内元素里：把该元素拆成「前 / 选中 / 后」三段，选中段继承原有类型和属性
        const before = Array.from(parent.childNodes).slice(0, Array.from(parent.childNodes).indexOf(node));
        const after = Array.from(parent.childNodes).slice(Array.from(parent.childNodes).indexOf(node) + 1);
        if (before.length) {
            const clone = parent.cloneNode(false) as HTMLElement;
            clone.append(...before);
            parent.before(clone);
        }
        if (after.length) {
            const clone = parent.cloneNode(false) as HTMLElement;
            clone.append(...after);
            parent.after(clone);
        }
        piece = parent;
        const types = new Set((piece.getAttribute("data-type") || "").split(" ").filter(Boolean));
        types.add("text");
        piece.setAttribute("data-type", Array.from(types).join(" "));
    } else {
        piece = document.createElement("span");
        piece.setAttribute("data-type", "text");
        node.before(piece);
        piece.append(node);
    }
    const ids = anchorIds(piece);
    if (!ids.includes(threadId)) {
        ids.push(threadId);
    }
    piece.setAttribute(ATTR_ANCHOR, ids.join(" "));
    return piece;
}

/**
 * 把选中文字（可跨块）标为评论锚点，并把新讨论串写进第一个块的属性。
 * 所有涉及的块在同一个编辑器事务里提交（一次撤销整体撤回）：
 * 若改用 setBlockAttrs 接口写属性，可能被编辑器稍后提交的旧块 DOM 覆盖。
 * 选区不合法时抛出带提示文字的错误。返回存放讨论串的块 id。
 */
export function wrapSelection(protyle: IProtyle, createThread: (quote: string) => Thread): string {
    const range = currentRange(protyle);
    if (!range) {
        throw new Error("请先选中要评论的文字");
    }
    const selected = selectedTextNodes(protyle.wysiwyg!.element, range);
    if (!selected.length) {
        throw new Error("所选内容里没有可评论的文字（代码块、公式块请用块评论）");
    }
    const blocks = Array.from(new Set(selected.map(item => item.block)));
    // 原文引用按块换行拼接
    const quote = blocks.map(block => selected.filter(item => item.block === block)
        .map(item => item.node.data).join("")).join("\n");
    const thread = createThread(quote);
    protyle.getInstance().updateBatchTransaction(blocks, (block) => {
        selected.filter(item => item.block === block)
            .forEach(item => markTextNode(item.editable, item.node, thread.id));
        if (block === blocks[0]) {
            const threads: Thread[] = JSON.parse(block.getAttribute(ATTR_THREADS) || "[]");
            threads.push(thread);
            block.setAttribute(ATTR_THREADS, JSON.stringify(threads));
        }
    });
    window.getSelection()?.removeAllRanges();
    protyle.toolbar?.element.classList.add("fn__none");
    return blocks[0].dataset.nodeId!;
}

/**
 * 从块元素中删掉讨论串：移除属性里的讨论串，并从锚点片段上去掉该 id。
 * 片段不再属于任何讨论串时，撤掉为评论加的 "text" 类型（有颜色等样式时保留），类型清空则拆掉片段。
 */
function stripThread(blockElement: Element, threadId: string) {
    const threads: Thread[] = JSON.parse(blockElement.getAttribute(ATTR_THREADS) || "[]");
    const rest = threads.filter(item => item.id !== threadId);
    if (rest.length) {
        blockElement.setAttribute(ATTR_THREADS, JSON.stringify(rest));
    } else {
        blockElement.removeAttribute(ATTR_THREADS);
    }
    blockElement.querySelectorAll(anchorSelector(threadId)).forEach((span) => {
        const ids = anchorIds(span).filter(id => id !== threadId);
        if (ids.length) {
            span.setAttribute(ATTR_ANCHOR, ids.join(" "));
            return;
        }
        span.removeAttribute(ATTR_ANCHOR);
        const types = (span.getAttribute("data-type") || "").split(" ")
            .filter(type => type && (type !== "text" || span.getAttribute("style")));
        if (types.length) {
            span.setAttribute("data-type", types.join(" "));
        } else {
            span.replaceWith(...Array.from(span.childNodes));
        }
    });
}

/**
 * 删除行内讨论串：存放讨论串的块去掉属性，所有带锚点的块（跨段落时有多个）去掉片段上的 id，在同一次更新里完成，
 * 避免编辑器随后提交的旧 DOM 把属性写回去。
 * 涉及的块由编辑器 DOM 和 SQL 索引合并得出（长文档可能只加载了一部分块）；
 * 已加载的块走编辑器批量事务（可撤销），其余直接改块 DOM。
 */
export async function deleteInlineThread(storageBlockId: string, threadId: string) {
    await flushTransaction();
    const rows = await sql<{ block_id: string, value: string }>(
        `SELECT block_id, value FROM attributes WHERE name = '${ATTR_ANCHOR}' AND value LIKE '%${threadId}%' LIMIT 1000`);
    const blockIds = new Set([storageBlockId,
        ...rows.filter(row => row.value.split(/\s+/).includes(threadId)).map(row => row.block_id)]);
    for (const editor of getAllEditor()) {
        editor.protyle.wysiwyg?.element.querySelectorAll(anchorSelector(threadId)).forEach((span) => {
            const id = closestBlock(span)?.dataset.nodeId;
            if (id) {
                blockIds.add(id);
            }
        });
    }

    const editor = getAllEditor().find(item => item.protyle.wysiwyg &&
        Array.from(blockIds).some(id => findBlockElement(item.protyle.wysiwyg!.element, id)));
    const loaded = editor ? Array.from(blockIds).map(id => findBlockElement(editor.protyle.wysiwyg!.element, id))
        .filter((item): item is HTMLElement => !!item) : [];
    if (editor && loaded.length) {
        editor.updateBatchTransaction(loaded, block => stripThread(block, threadId));
    }
    for (const id of blockIds) {
        if (loaded.some(block => block.dataset.nodeId === id)) {
            continue;
        }
        const template = document.createElement("template");
        template.innerHTML = await getBlockDOM(id);
        const blockElement = template.content.firstElementChild as HTMLElement;
        stripThread(blockElement, threadId);
        await updateBlockDOM(id, blockElement.outerHTML);
    }
}

/** 在已打开的编辑器里找锚点或块元素，找到就滚动到视野中央 */
export function scrollToAnchor(blockId: string, threadId: string): boolean {
    for (const editor of getAllEditor()) {
        const root = editor.protyle.wysiwyg?.element;
        if (!root?.offsetParent) {
            continue;
        }
        const blockElement = findBlockElement(root, blockId);
        const target = blockElement?.querySelector(anchorSelector(threadId)) ?? blockElement;
        if (target) {
            target.scrollIntoView({block: "center", behavior: "smooth"});
            return true;
        }
    }
    return false;
}

/** 讨论串的全部锚点片段：优先在给定编辑器内找，其次在任一可见编辑器中找 */
export function findAnchorSpans(threadId: string, root?: Element | null): HTMLElement[] {
    const inRoot = root ? Array.from(root.querySelectorAll<HTMLElement>(anchorSelector(threadId))) : [];
    if (inRoot.length) {
        return inRoot;
    }
    const editor = Array.from(document.querySelectorAll<HTMLElement>(".protyle-wysiwyg"))
        .find(item => item.offsetParent && item.querySelector(anchorSelector(threadId)));
    return editor ? Array.from(editor.querySelectorAll<HTMLElement>(anchorSelector(threadId))) : [];
}
