# Comments

Threaded comments for SiYuan, modeled on Notion: start a discussion on selected text, a block, or a whole document, then reply, edit, delete, resolve or reopen it. Hover a highlighted text or the comment marker on the right of a block and the discussion card pops up; write comments and replies right in the card. The "Comments" dock on the right lists all comments of the current document; on narrow windows it collapses the native SiYuan way and slides out when the mouse reaches the right edge.

The interface is currently in Simplified Chinese only.

## Usage

- Text comments: select text, then click the comment button in the floating toolbar or press `⌥⇧M` (configurable in Settings → Keymap); a card opens below the text. Selections may span paragraphs, and comment ranges may overlap: comment on a whole paragraph, then on one sentence inside it. After the first comment is posted, a marker (💬 count) appears on the right of the block; comments on the same block share one marker.
- Block comments: block icon → "评论" (Comment); a marker appears on the right of the block, hover it to open the card.
- Document comments: document title icon → "评论此文档" (Comment on this document), or the `+` in the dock, and write in the dock.
- Enter sends, Shift+Enter inserts a line break; pressing `Esc` or clicking outside a new, empty discussion discards it.
- Hovering a comment shows ✓ (resolve, first comment only), edit and delete; the delete button turns into "?" on the first click and deletes on the second. Deleting the first comment deletes the whole discussion.
- Clicking a highlight pins the card; clicking a discussion in the dock jumps to the text.

## Working with AI

[tools/siyuan_comments.py](https://github.com/FlowMorph/siyuan-comments/blob/main/tools/siyuan_comments.py) (in the source repository, not in the plugin package) is a command-line tool for AI agents such as Claude Code: list open discussions, show the quoted text and the whole document as context, reply as AI, and resolve. The dock refreshes live after each write. It talks to the local SiYuan kernel API (127.0.0.1:6806) and reads the token from the workspace's `conf/conf.json`.

```bash
python3 tools/siyuan_comments.py list            # list all open discussions
python3 tools/siyuan_comments.py show <id>       # a discussion and its block text
echo "reply text" | python3 tools/siyuan_comments.py reply <id> -
```

## Data

Discussions are stored as JSON in the block attribute `custom-comments`; text anchors are inline spans carrying the attribute `custom-comment-id` and have no styling of their own. After uninstalling the plugin the document looks unchanged and the comment data stays in the block attributes.

## License

MIT
