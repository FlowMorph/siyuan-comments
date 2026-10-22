// 插件入口：注册侧栏面板、工具栏按钮、块菜单、快捷键，并把思源事件转给 CommentController
import {getActiveEditor, IMenuItem, IProtyle, openTab, Plugin} from "siyuan";
import {CommentController} from "./controller";
import {CommentPanel} from "./panel";
import {ATTR_ANCHOR} from "./types";
import "./index.css";

const DOCK_TYPE = "dock";

export default class CommentsPlugin extends Plugin {
    private controller!: CommentController;
    private panel?: CommentPanel;

    onload() {
        this.addIcons(`<symbol id="iconScComment" viewBox="0 0 32 32">
<path d="M6 4h20a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H14l-7 5.5V24H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3zm3 6v2.5h14V10H9zm0 5.5V18h10v-2.5H9z"></path>
</symbol>`);
        this.controller = new CommentController(() => this.showDock(), (id) => {
            void openTab({app: this.app, doc: {id, action: ["cb-get-hl", "cb-get-focus"]}});
        });

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
                plugin.panel = new CommentPanel(this.element as HTMLElement, plugin.controller);
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
            editorCallback: (protyle: IProtyle) => void this.controller.createInline(protyle),
        });

        this.eventBus.on("switch-protyle", this.onSwitchProtyle);
        this.eventBus.on("loaded-protyle-static", this.onLoadedProtyle);
        this.eventBus.on("destroy-protyle", this.onDestroyProtyle);
        this.eventBus.on("click-editorcontent", this.onClickEditor);
        this.eventBus.on("click-blockicon", this.onBlockMenu);
        this.eventBus.on("click-editortitleicon", this.onTitleMenu);
        this.eventBus.on("ws-main", this.onWsMain);
    }

    onLayoutReady() {
        const rootId = getActiveEditor(false)?.protyle.block.rootID;
        if (rootId) {
            this.controller.setCurrent(rootId);
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
        this.panel?.destroy();
        this.controller.destroy();
    }

    updateProtyleToolbar(toolbar: Array<string | IMenuItem>) {
        toolbar.push("|", {
            name: "siyuan-comments",
            icon: "iconScComment",
            tipPosition: "n",
            tip: "评论",
            click: (protyle) => void this.controller.createInline(protyle.protyle),
        });
        return toolbar;
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

    private readonly onSwitchProtyle = ({detail}: CustomEvent<{ protyle: IProtyle }>) => {
        if (this.isTabEditor(detail.protyle)) {
            this.controller.setCurrent(detail.protyle.block.rootID!);
        }
    };

    private readonly onLoadedProtyle = ({detail}: CustomEvent<{ protyle: IProtyle }>) => {
        const rootId = detail.protyle.block.rootID!;
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
        this.controller.release(detail.protyle.block.rootID!);
    };

    private readonly onClickEditor = ({detail}: CustomEvent<{ protyle: IProtyle, event: MouseEvent }>) => {
        const anchor = (detail.event.target as Element).closest?.(`span[${ATTR_ANCHOR}]`);
        if (anchor) {
            if (this.isTabEditor(detail.protyle)) {
                this.controller.setCurrent(detail.protyle.block.rootID!);
            }
            this.controller.select(anchor.getAttribute(ATTR_ANCHOR)!, true);
        } else if (this.controller.activeThreadId) {
            this.controller.select(undefined);
        }
    };

    private readonly onBlockMenu = ({detail}: CustomEvent<{ menu: any, protyle: IProtyle, blockElements: HTMLElement[] }>) => {
        if (detail.blockElements.length !== 1) {
            return;
        }
        const block = detail.blockElements[0];
        detail.menu.addItem({
            icon: "iconScComment",
            label: "评论",
            click: () => void this.controller.createBlock(detail.protyle.block.rootID!, block.dataset.nodeId!,
                (block.querySelector("[contenteditable]")?.textContent ?? block.textContent ?? "").trim()),
        });
    };

    private readonly onTitleMenu = ({detail}: CustomEvent<{ menu: any, protyle: IProtyle }>) => {
        detail.menu.addItem({
            icon: "iconScComment",
            label: "评论此文档",
            click: () => void this.controller.createDoc(detail.protyle.block.rootID!),
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
