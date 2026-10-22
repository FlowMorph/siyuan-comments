// 评论正文的 Markdown 渲染：Lute 转 HTML，公式用思源自带的 KaTeX 渲染
let lute: ReturnType<typeof window.Lute.New> | undefined;

export function renderMarkdown(markdown: string): string {
    if (!lute) {
        lute = window.Lute.New();
        lute.SetSanitize(true);
    }
    return lute.Md2HTML(markdown);
}

function addResource(tag: "script" | "link", url: string, id: string): Promise<void> {
    if (document.getElementById(id)) {
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        const element = document.createElement(tag);
        element.id = id;
        if (element instanceof HTMLScriptElement) {
            element.src = url;
        } else {
            element.rel = "stylesheet";
            element.href = url;
        }
        element.onload = () => resolve();
        element.onerror = () => reject(new Error(`加载 ${url} 失败`));
        document.head.append(element);
    });
}

/** 渲染容器内的公式。脚本和样式 id 与思源自身一致，已加载过就直接复用 */
export async function renderMath(root: HTMLElement) {
    const elements = root.querySelectorAll<HTMLElement>(".language-math");
    if (!elements.length) {
        return;
    }
    if (!window.katex) {
        await addResource("link", "/stage/protyle/js/katex/katex.min.css?v=0.19.0", "protyleKatexStyle");
        await addResource("script", "/stage/protyle/js/katex/katex.min.js?v=0.19.0", "protyleKatexScript");
    }
    elements.forEach((element) => {
        const displayMode = element.tagName === "DIV";
        const tex = (element.textContent || "").replace(/^\$+|\$+$/g, "");
        element.innerHTML = window.katex!.renderToString(tex, {displayMode, throwOnError: false});
    });
}
