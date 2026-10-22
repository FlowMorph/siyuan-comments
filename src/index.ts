// 插件入口：注册侧栏面板、工具栏按钮、块菜单、快捷键；把思源事件和鼠标悬停转给控制器与浮动卡片
import {getActiveEditor, IMenuItem, IProtyle, openTab, Plugin} from "siyuan";
import {anchorIds, findAnchorSpans, findBlockElement} from "./anchor";
import {BlockBadges} from "./badges";
import {CommentController} from "./controller";
import {CommentPanel} from "./panel";
import {AnchorResolver, ThreadPopover} from "./popover";
import {ThreadView} from "./threadView";
import {ATTR_ANCHOR} from "./types";
import "./index.css";

const DOCK_TYPE = "dock";
const ANCHOR_SELECTOR = `.protyle-wysiwyg span[${ATTR_ANCHOR}]`;

export default class CommentsPlugin extends Plugin {
    private controller!: CommentController;
    private view!: ThreadView;
    private popover!: ThreadPopover;
    private badges!: BlockBadges;
    private panel?: CommentPanel;

    onload() {
        this.addIcons(`<symbol id="iconScComment" viewBox="0 0 32 32">
<path d="M6 4h20a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H14l-7 5.5V24H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3zm3 6v2.5h14V10H9zm0 5.5V18h10v-2.5H9z"></path>
</symbol>
<symbol id="iconScUser" viewBox="0 0 32 32">
<path d="M16 4.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM5 27.5c0-5.2 4.9-8.5 11-8.5s11 3.3 11 8.5V29H5z"></path>
</symbol>
<symbol id="iconScAI" viewBox="0 0 32 32">
<path d="M14 3c.7 5.8 4.2 9.3 10 10-5.8.7-9.3 4.2-10 10-.7-5.8-4.2-9.3-10-10 5.8-.7 9.3-4.2 10-10zM24.5 18c.4 3.1 2.4 5.1 5.5 5.5-3.1.4-5.1 2.4-5.5 5.5-.4-3.1-2.4-5.1-5.5-5.5 3.1-.4 5.1-2.4 5.5-5.5z"></path>
</symbol>
<symbol id="iconScSend" viewBox="0 0 32 32">
<path d="M16 5l9.5 9.5-2.1 2.1-5.9-5.9V27h-3V10.7l-5.9 5.9-2.1-2.1z"></path>
</symbol>`);
        this.controller = new CommentController((id) => {
            void openTab({app: this.app, doc: {id, action: ["cb-get-hl", "cb-get-focus"]}});
        });
        this.view = new ThreadView(this.controller);
        this.popover = new ThreadPopover(this.controller, this.view);
        this.badges = new BlockBadges(this.controller);

        const plugin = this;
        this.addDock({
            config: {
                position: "RightTop",
                size: {width: 320, height: 0},
                icon: "iconScComment",
                title: "评论",
            },
            data: {},
            type: DOCK_TYPE,
            init() {
                plugin.panel = new CommentPanel(this.element as HTMLElement, plugin.controller, plugin.view);
            },
            destroy() {
                plugin.panel?.destroy();
                plugin.panel = undefined;
            },
        });

        this.addCommand({
            langKey: "addComment",
            langText: "评论所选文字",
            hotkey: "⌥⇧M",
            editorCallback: (protyle: IProtyle) => void this.createInline(protyle),
        });

        this.eventBus.on("switch-protyle", this.onSwitchProtyle);
        this.eventBus.on("loaded-protyle-static", this.onLoadedProtyle);
        this.eventBus.on("destroy-protyle", this.onDestroyProtyle);
        this.eventBus.on("click-editorcontent", this.onClickEditor);
        this.eventBus.on("click-blockicon", this.onBlockMenu);
        this.eventBus.on("click-editortitleicon", this.onTitleMenu);
        this.eventBus.on("ws-main", this.onWsMain);
        document.addEventListener("mouseover", this.onMouseover);
        document.addEventListener("mouseout", this.onMouseout);
        document.addEventListener("click", this.onBadgeClick);
    }

    onLayoutReady() {
        const editor = getActiveEditor(false);
        if (editor) {
            this.controller.setCurrent(editor.protyle.block.rootID!);
        }
    }

    onunload() {
        this.eventBus.off("switch-protyle", this.onSwitchProtyle);
        this.eventBus.off("loaded-protyle-static", this.onLoadedProtyle);
        this.eventBus.off("destroy-protyle", this.onDestroyProtyle);
        this.eventBus.off("click-editorcontent", this.onClickEditor);
        this.eventBus.off("click-blockicon", this.onBlockMenu);
        this.eventBus.off("click-editortitleicon", this.onTitleMenu);
        this.eventBus.off("ws-main", this.onWsMain);
        document.removeEventListener("mouseover", this.onMouseover);
        document.removeEventListener("mouseout", this.onMouseout);
        document.removeEventListener("click", this.onBadgeClick);
        this.panel?.destroy();
        this.popover.destroy();
        this.badges.destroy();
        this.controller.destroy();
    }

    updateProtyleToolbar(toolbar: Array<string | IMenuItem>) {
        toolbar.push("|", {
            name: "siyuan-comments",
            icon: "iconScComment",
            tipPosition: "n",
            tip: "评论",
            click: (protyle) => void this.createInline(protyle.protyle),
        });
        return toolbar;
    }

    /** 划词新建评论：标记文字后在下方弹出卡片，直接写第一条评论 */
    private async createInline(protyle: IProtyle) {
        const id = await this.controller.createInline(protyle);
        if (id) {
            this.popover.open([id], this.inlineResolver(id, protyle.wysiwyg?.element), {pin: true, focus: true});
        }
    }

    private inlineResolver(threadId: string, root?: Element | null): AnchorResolver {
        return () => findAnchorSpans(threadId, root);
    }

    /** 块评论卡片挂在块右侧的标记上；标记尚未渲染时挂在块上 */
    private blockResolver(blockId: string, root?: Element | null): AnchorResolver {
        return () => {
            const element = this.badges.findBadge(blockId) ?? (root ? findBlockElement(root, blockId) : null);
            return element ? [element] : [];
        };
    }

    /** 打开侧栏面板；面板已显示时不做切换，浮动收起状态下把它浮出来 */
    private showDock() {
        const type = this.name + DOCK_TYPE;
        const layout = window.siyuan.layout;
        const dock = [layout.leftDock, layout.rightDock, layout.bottomDock].find(item => item && type in item.data);
        if (!dock) {
            return;
        }
        const dockItem = document.querySelector(`.dock__item[data-type="${type}"]`);
        if (dockItem?.classList.contains("dock__item--active") && dock.isPanelVisible()) {
            if (dock.isFloating()) {
                dock.showDock();
            }
            return;
        }
        dock.toggleModel(type, true);
    }

    /** 只有页签里的编辑器决定面板显示哪个文档，悬浮预览等编辑器只用于加载高亮 */
    private isTabEditor(protyle: IProtyle) {
        return !!protyle.model;
    }

    /** 鼠标下的评论锚点：未解决的划词高亮，或块评论标记 */
    private anchorAt(target: EventTarget | null): { element: Element, threadIds: string[], resolver: AnchorResolver } | undefined {
        if (!(target instanceof Element)) {
            return undefined;
        }
        const span = target.closest(ANCHOR_SELECTOR);
        if (span) {
            const root = span.closest(".protyle-wysiwyg");
            // 重叠区域属于多条讨论串：只取未解决的，范围小的（内层）排前，卡片定位到内层那条
            const length = (id: string) => findAnchorSpans(id, root).reduce((sum, item) => sum + (item.textContent?.length ?? 0), 0);
            const threadIds = anchorIds(span)
                .filter(id => this.controller.findThread(id)?.thread.status === "open")
                .sort((a, b) => length(a) - length(b));
            if (!threadIds.length) {
                return undefined;
            }
            return {element: span, threadIds, resolver: this.inlineResolver(threadIds[0], root)};
        }
        const badge = target.closest<HTMLElement>(".sc-badge");
        if (badge) {
            const blockId = badge.dataset.blockId!;
            return {
                element: badge,
                threadIds: badge.dataset.threadIds!.split(","),
                resolver: this.blockResolver(blockId, badge.closest(".protyle")?.querySelector(".protyle-wysiwyg")),
            };
        }
        return undefined;
    }

    private readonly onMouseover = (event: MouseEvent) => {
        const anchor = this.anchorAt(event.target);
        if (anchor) {
            this.popover.hover(anchor.threadIds, anchor.resolver);
        }
    };

    private readonly onMouseout = (event: MouseEvent) => {
        const anchor = this.anchorAt(event.target);
        if (anchor && !(event.relatedTarget instanceof Node && anchor.element.contains(event.relatedTarget))) {
            this.popover.leave();
        }
    };

    private readonly onBadgeClick = (event: MouseEvent) => {
        const anchor = this.anchorAt(event.target);
        if (anchor && (event.target as Element).closest(".sc-badge")) {
            this.popover.open(anchor.threadIds, anchor.resolver, {pin: true});
        }
    };

    private readonly onSwitchProtyle = ({detail}: CustomEvent<{ protyle: IProtyle }>) => {
        if (this.isTabEditor(detail.protyle)) {
            this.controller.setCurrent(detail.protyle.block.rootID!);
        }
    };

    private readonly onLoadedProtyle = ({detail}: CustomEvent<{ protyle: IProtyle }>) => {
        const rootId = detail.protyle.block.rootID!;
        this.badges.attach(detail.protyle);
        if (this.isTabEditor(detail.protyle) &&
            (!this.controller.currentRootId || getActiveEditor(false)?.protyle === detail.protyle)) {
            this.controller.setCurrent(rootId);
        }
        // 文档重新加载（例如外部修改后刷新）时同步刷新评论
        if (!this.controller.isCached(rootId) || rootId === this.controller.currentRootId) {
            this.controller.scheduleReload(rootId, 0);
        }
    };

    private readonly onDestroyProtyle = ({detail}: CustomEvent<{ protyle: IProtyle }>) => {
        this.badges.detach(detail.protyle);
        this.controller.release(detail.protyle.block.rootID!);
    };

    /** 点击高亮文字：弹出并固定讨论卡片 */
    private readonly onClickEditor = ({detail}: CustomEvent<{ protyle: IProtyle, event: MouseEvent }>) => {
        const anchor = this.anchorAt(detail.event.target);
        if (anchor) {
            if (this.isTabEditor(detail.protyle)) {
                this.controller.setCurrent(detail.protyle.block.rootID!);
            }
            this.popover.open(anchor.threadIds, anchor.resolver, {pin: true});
        }
    };

    private readonly onBlockMenu = ({detail}: CustomEvent<{ menu: any, protyle: IProtyle, blockElements: HTMLElement[] }>) => {
        if (detail.blockElements.length !== 1) {
            return;
        }
        const block = detail.blockElements[0];
        const blockId = block.dataset.nodeId!;
        detail.menu.addItem({
            icon: "iconScComment",
            label: "评论",
            click: async () => {
                const text = (block.querySelector("[contenteditable]")?.textContent ?? block.textContent ?? "").trim();
                const id = await this.controller.createBlock(detail.protyle.block.rootID!, blockId, text);
                if (id) {
                    this.popover.open([id], this.blockResolver(blockId, detail.protyle.wysiwyg?.element), {pin: true, focus: true});
                }
            },
        });
    };

    private readonly onTitleMenu = ({detail}: CustomEvent<{ menu: any, protyle: IProtyle }>) => {
        detail.menu.addItem({
            icon: "iconScComment",
            label: "评论此文档",
            click: () => {
                this.showDock();
                void this.controller.createDoc(detail.protyle.block.rootID!);
            },
        });
    };

    private readonly onWsMain = ({detail}: CustomEvent<{ cmd?: string, data?: any }>) => {
        if (detail.cmd !== "transactions" || !Array.isArray(detail.data)) {
            return;
        }
        for (const transaction of detail.data) {
            for (const op of transaction.doOperations ?? []) {
                this.controller.handleOperation(op);
            }
        }
    };
}
