// 行内锚点：给选中文字包一层原生下划线 span，并在 span 上记录讨论串 id（custom-comment-id）。
// Lute 会把行内元素的 custom-* 属性存进 kramdown 的 span IAL，插件卸载后正文退化为普通下划线。
import {getAllEditor, IProtyle} from "siyuan";
import {getBlockDOM, updateBlockDOM} from "./api";
import {ATTR_ANCHOR, ATTR_THREADS, Thread} from "./types";

function closestBlock(node: Node | null): HTMLElement | null {
    const element = node instanceof Element ? node : node?.parentElement;
    return element?.closest<HTMLElement>("[data-node-id]") ?? null;
}

/** 在编辑器里找块元素，跳过嵌入块里渲染的副本 */
function findBlockElement(root: Element, blockId: string): HTMLElement | null {
    return Array.from(root.querySelectorAll<HTMLElement>(`[data-node-id="${blockId}"]`))
        .find(item => !item.parentElement?.closest('[data-type="NodeBlockQueryEmbed"]')) ?? null;
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

/**
 * 把选中文字标为评论锚点，并把新讨论串写进所在块的属性。
 * 讨论串属性和锚点 id 通过编辑器事务提交（紧跟在原生下划线事务之后），
 * 若改用 setBlockAttrs 接口写属性，可能被编辑器稍后提交的旧块 DOM 覆盖。
 * 选区不合法时抛出带提示文字的错误。返回所在块 id。
 */
export function wrapSelection(protyle: IProtyle, createThread: (quote: string) => Thread): string {
    const range = currentRange(protyle);
    if (!range) {
        throw new Error("请先选中要评论的文字");
    }
    const startBlock = closestBlock(range.startContainer);
    if (!startBlock || startBlock !== closestBlock(range.endContainer)) {
        throw new Error("划词评论暂只支持单个块内的选区");
    }
    if (["NodeCodeBlock", "NodeMathBlock", "NodeHTMLBlock"].includes(startBlock.dataset.type!)) {
        throw new Error("代码块、公式块和 HTML 块请用块评论");
    }
    const toolbar = protyle.toolbar!;
    const hasUnderline = toolbar.getCurrentType(range).includes("u") ||
        range.cloneContents().querySelector('[data-type~="u"]');
    if (hasUnderline) {
        // 原生下划线是开关式的，对已有下划线的文字再加会变成取消，所以这里直接拒绝
        throw new Error("所选文字已有下划线或评论，请调整选区");
    }
    const quote = range.toString();
    toolbar.range = range;
    const nodes = (toolbar.setInlineMark(protyle, "u", "range") ?? [])
        .filter((node): node is HTMLElement => node instanceof HTMLElement && node.matches('[data-type~="u"]'));
    if (!nodes.length) {
        throw new Error("标记选区失败");
    }
    const blockElement = closestBlock(nodes[0])!;
    const oldHTML = blockElement.outerHTML;
    const thread = createThread(quote);
    const threads: Thread[] = JSON.parse(blockElement.getAttribute(ATTR_THREADS) || "[]");
    threads.push(thread);
    blockElement.setAttribute(ATTR_THREADS, JSON.stringify(threads));
    nodes.forEach(node => node.setAttribute(ATTR_ANCHOR, thread.id));
    protyle.getInstance().updateTransactionElement(blockElement, oldHTML);
    return blockElement.dataset.nodeId!;
}

/** 从块元素中删掉讨论串：同时移除属性里的讨论串和正文里的锚点 span（去掉评论标记和下划线） */
function stripThread(blockElement: Element, threadId: string) {
    const threads: Thread[] = JSON.parse(blockElement.getAttribute(ATTR_THREADS) || "[]");
    const rest = threads.filter(item => item.id !== threadId);
    if (rest.length) {
        blockElement.setAttribute(ATTR_THREADS, JSON.stringify(rest));
    } else {
        blockElement.removeAttribute(ATTR_THREADS);
    }
    blockElement.querySelectorAll(`span[${ATTR_ANCHOR}="${threadId}"]`).forEach((span) => {
        const types = (span.getAttribute("data-type") || "").split(" ").filter(type => type && type !== "u");
        if (types.length) {
            span.removeAttribute(ATTR_ANCHOR);
            span.setAttribute("data-type", types.join(" "));
        } else {
            span.replaceWith(...Array.from(span.childNodes));
        }
    });
}

/**
 * 删除行内讨论串。讨论串和锚点在同一次块更新里删除，避免编辑器随后提交的旧 DOM 把属性写回去。
 * 块已在编辑器中打开时走编辑器事务（可撤销），否则直接改块 DOM。
 */
export async function deleteInlineThread(blockId: string, threadId: string) {
    for (const editor of getAllEditor()) {
        const root = editor.protyle.wysiwyg?.element;
        const blockElement = root && findBlockElement(root, blockId);
        if (blockElement) {
            const oldHTML = blockElement.outerHTML;
            stripThread(blockElement, threadId);
            editor.updateTransactionElement(blockElement, oldHTML);
            return;
        }
    }
    const template = document.createElement("template");
    template.innerHTML = await getBlockDOM(blockId);
    const blockElement = template.content.firstElementChild as HTMLElement;
    stripThread(blockElement, threadId);
    await updateBlockDOM(blockId, blockElement.outerHTML);
}

/** 在已打开的编辑器里找锚点或块元素，找到就滚动到视野中央 */
export function scrollToAnchor(blockId: string, threadId: string): boolean {
    for (const editor of getAllEditor()) {
        const root = editor.protyle.wysiwyg?.element;
        if (!root?.offsetParent) {
            continue;
        }
        const blockElement = findBlockElement(root, blockId);
        const target = blockElement?.querySelector(`span[${ATTR_ANCHOR}="${threadId}"]`) ?? blockElement;
        if (target) {
            target.scrollIntoView({block: "center", behavior: "smooth"});
            return true;
        }
    }
    return false;
}
