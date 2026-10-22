#!/usr/bin/env python3
"""读写思源「评论」插件的讨论串，供 AI（Claude Code）在讨论串里回复。

用法：
  siyuan_comments.py list [文档标题或 id] [--all]   列出讨论串（默认只列未解决），不带文档时列整个工作空间
  siyuan_comments.py show <讨论串 id>               显示讨论串全文、所在块原文和文档信息
  siyuan_comments.py context <讨论串 id>            导出讨论串所在文档的 Markdown 全文，用于理解上下文
  siyuan_comments.py reply <讨论串 id> <内容|->     以 AI 身份回复；内容为 - 时从标准输入读取
  siyuan_comments.py resolve <讨论串 id>            标记为已解决
  siyuan_comments.py reopen <讨论串 id>             重新打开

数据格式见项目 docs/data-model.md：讨论串以 JSON 存在锚点所在块的 custom-comments 属性里。
写入走 /api/attr/setBlockAttrs，思源会把变更推送给编辑器，插件面板实时刷新。
依赖思源客户端在 127.0.0.1:6806 运行；token 取自当前工作空间的 conf.json，不输出。
"""
import json
import os
import random
import re
import string
import sys
import urllib.request
from datetime import datetime, timezone

API = "http://127.0.0.1:6806"
ATTR_THREADS = "custom-comments"
DOC_ID = re.compile(r"^\d{14}-[0-9a-z]{7}$")

# 思源把已打开的工作空间记在 workspace.json，最后一项是当前工作空间
with open(os.path.expanduser("~/.config/siyuan/workspace.json"), encoding="utf-8") as f:
    CONF = os.path.join(json.load(f)[-1], "conf", "conf.json")
with open(CONF, encoding="utf-8") as f:
    TOKEN = json.load(f)["api"]["token"]


def post(endpoint, payload):
    req = urllib.request.Request(
        API + endpoint,
        data=json.dumps(payload).encode(),
        headers={"Authorization": "Token " + TOKEN, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as resp:
        res = json.loads(resp.read())
    if res["code"] != 0:
        raise RuntimeError(f"{endpoint}: {res['msg']}")
    return res["data"]


def sql(stmt):
    return post("/api/query/sql", {"stmt": stmt})


def esc(s):
    return s.replace("'", "''")


def now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def new_id():
    # 与思源块 id 同格式：14 位时间 + 7 位小写字母数字
    return datetime.now().strftime("%Y%m%d%H%M%S") + "-" + "".join(random.choices(string.ascii_lowercase + string.digits, k=7))


def find_doc(key):
    if DOC_ID.match(key):
        rows = sql(f"select id, hpath from blocks where type='d' and id='{key}'")
    else:
        rows = sql(f"select id, hpath from blocks where type='d' and content='{esc(key)}'")
        if not rows:
            rows = sql(f"select id, hpath from blocks where type='d' and content like '%{esc(key)}%'")
    if not rows:
        sys.exit(f"找不到文档：{key}")
    if len(rows) > 1:
        lines = "\n".join(f"  {r['id']}  {r['hpath']}" for r in rows)
        sys.exit(f"匹配到多篇文档，请改用文档 id：\n{lines}")
    return rows[0]


def thread_rows(where=""):
    post("/api/sqlite/flushTransaction", {})
    return sql(f"select block_id, root_id, value from attributes where name='{ATTR_THREADS}' {where} limit 10000")


def find_thread(thread_id):
    """返回 (block_id, root_id)；用 SQL 定位，再由调用方读取最新属性"""
    if not DOC_ID.match(thread_id):
        sys.exit(f"讨论串 id 格式不对：{thread_id}")
    for row in thread_rows(f"and value like '%{thread_id}%'"):
        if any(t["id"] == thread_id for t in json.loads(row["value"])):
            return row["block_id"], row["root_id"]
    sys.exit(f"找不到讨论串：{thread_id}")


def mutate(thread_id, update):
    block_id, _ = find_thread(thread_id)
    threads = json.loads(post("/api/attr/getBlockAttrs", {"id": block_id}).get(ATTR_THREADS) or "[]")
    thread = next((t for t in threads if t["id"] == thread_id), None)
    if thread is None:
        sys.exit(f"讨论串已不存在：{thread_id}")
    update(thread)
    post("/api/attr/setBlockAttrs", {"id": block_id, "attrs": {ATTR_THREADS: json.dumps(threads, ensure_ascii=False)}})
    return thread


def block_info(block_id):
    rows = sql(f"select b.id, b.root_id, b.type, b.markdown, d.content as title, d.hpath from blocks b "
               f"join blocks d on d.id = b.root_id where b.id='{block_id}'")
    return rows[0] if rows else None


def local_time(iso):
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone().strftime("%Y-%m-%d %H:%M")


def print_thread(thread, indent="  "):
    kind = {"inline": "划词", "block": "块", "doc": "文档"}[thread["anchor"]]
    status = "未解决" if thread["status"] == "open" else "已解决"
    print(f"{indent}[{thread['id']}] {kind}评论 · {status}")
    if thread.get("quote"):
        print(f"{indent}  原文：{thread['quote']}")
    for c in thread["comments"]:
        who = "AI" if c["author"] == "ai" else "用户"
        body = c["content"].replace("\n", "\n" + indent + "    ")
        print(f"{indent}  {who}（{local_time(c['created'])}）：{body}")
    if not thread["comments"]:
        print(f"{indent}  （还没有评论）")


def cmd_list(args):
    show_all = "--all" in args
    args = [a for a in args if a != "--all"]
    where = f"and root_id='{find_doc(args[0])['id']}'" if args else ""
    rows = thread_rows(where)
    titles = {}
    if rows:
        ids = ",".join(f"'{r['root_id']}'" for r in rows)
        titles = {r["id"]: r["hpath"] for r in sql(f"select id, hpath from blocks where id in ({ids})")}
    by_doc = {}
    for row in rows:
        for t in json.loads(row["value"]):
            if show_all or t["status"] == "open":
                by_doc.setdefault(row["root_id"], []).append(t)
    if not by_doc:
        print("没有" + ("" if show_all else "未解决的") + "讨论串")
        return
    for root_id, threads in by_doc.items():
        print(f"{titles.get(root_id, root_id)}（文档 {root_id}）")
        for t in sorted(threads, key=lambda t: t["created"]):
            print_thread(t)
        print()


def cmd_show(args):
    block_id, _ = find_thread(args[0])
    threads = json.loads(post("/api/attr/getBlockAttrs", {"id": block_id}).get(ATTR_THREADS) or "[]")
    thread = next(t for t in threads if t["id"] == args[0])
    info = block_info(block_id)
    print(f"文档：{info['hpath']}（{info['root_id']}）")
    print(f"所在块：{block_id}（{info['type']}）")
    if thread["anchor"] != "doc":
        print("块原文：")
        print("  " + re.sub(r"\{: [^}]*\}", "", info["markdown"]).strip().replace("\n", "\n  "))
    print()
    print_thread(thread, indent="")


def cmd_context(args):
    _, root_id = find_thread(args[0])
    print(post("/api/export/exportMdContent", {"id": root_id})["content"])


def cmd_reply(args):
    if len(args) < 2:
        sys.exit("用法：reply <讨论串 id> <内容|->")
    content = sys.stdin.read() if args[1] == "-" else " ".join(args[1:])
    content = content.strip()
    if not content:
        sys.exit("回复内容为空")
    mutate(args[0], lambda t: t["comments"].append({"id": new_id(), "author": "ai", "content": content, "created": now()}))
    print(f"已回复 {args[0]}")


def cmd_status(args, status):
    def update(t):
        t["status"] = status
        if status == "resolved":
            t["resolved"] = now()
        else:
            t.pop("resolved", None)
    mutate(args[0], update)
    print(f"{args[0]} → {'已解决' if status == 'resolved' else '未解决'}")


def main():
    if len(sys.argv) < 2 or sys.argv[1] in ("-h", "--help"):
        print(__doc__)
        return
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd != "list" and not args:
        sys.exit(f"{cmd} 需要讨论串 id")
    if cmd == "list":
        cmd_list(args)
    elif cmd == "show":
        cmd_show(args)
    elif cmd == "context":
        cmd_context(args)
    elif cmd == "reply":
        cmd_reply(args)
    elif cmd == "resolve":
        cmd_status(args, "resolved")
    elif cmd == "reopen":
        cmd_status(args, "open")
    else:
        sys.exit(f"未知命令：{cmd}\n{__doc__}")


if __name__ == "__main__":
    main()
