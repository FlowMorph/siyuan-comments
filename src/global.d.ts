// 思源前端注入的全局对象（只声明本插件用到的部分）
interface Window {
    Lute: {
        NewNodeID(): string;
        New(): {
            SetSanitize(enable: boolean): void;
            Md2HTML(markdown: string): string;
        };
    };
    katex?: { renderToString(tex: string, options?: Record<string, unknown>): string };
    siyuan: any;
}
