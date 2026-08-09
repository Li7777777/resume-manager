#!/usr/bin/env python3
"""组合脚本：从 data/ 信息全集按 scripts/variants.yml 配方生成 resumes/*.yml
（与 resume-manager 的 server/lib/compose.js 语义一致，CI 环境用此实现）"""
import os
import sys

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")
VARIANTS_FILE = os.path.join(ROOT, "scripts", "variants.yml")
OUT_DIR = os.path.join(ROOT, "resumes")

META_KEYS = {"id", "tags", "notes"}
ACHIEVEMENTS_KEY = "achievements"

HEADER = (
    "# 本文件由 scripts/compose.py 自动生成，请勿手改。\n"
    "# 改信息 -> data/；改筛选/模板/章节顺序 -> scripts/variants.yml\n"
    "---\n"
)


class Dumper(yaml.SafeDumper):
    """null 输出为空值（endDate: 表示"至今"）"""


def _null_representer(dumper, _):
    return dumper.represent_scalar("tag:yaml.org,2002:null", "")


Dumper.add_representer(type(None), _null_representer)


def load(path):
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def strip_meta(item):
    if not isinstance(item, dict):
        return item
    return {k: v for k, v in item.items() if k not in META_KEYS and not k.startswith("_")}


def tag_overlap(item_tags, wanted_tags):
    if not wanted_tags:
        return True
    if not item_tags:
        return False
    return bool(set(item_tags) & set(wanted_tags))


def select_entries(entries, cfg):
    if not entries:
        return []
    if cfg is None or cfg.get("include") == "all":
        return list(entries)
    ids = cfg.get("ids")
    tags = cfg.get("tags")
    result = []
    for e in entries:
        if ids is not None:
            if e.get("id") in ids:
                result.append(e)
            continue
        if tag_overlap(e.get("tags"), tags):
            result.append(e)
    return result


def to_summary_string(summary):
    if summary is None:
        return None
    if isinstance(summary, str):
        return summary
    if isinstance(summary, list):
        lines = ["- " + str(s) for s in summary if s]
        return "\n".join(lines) if lines else None
    return str(summary)


def build_summary(entry, wanted_tags):
    if ACHIEVEMENTS_KEY not in entry:
        return entry.get("summary")
    items = []
    for a in entry[ACHIEVEMENTS_KEY]:
        if isinstance(a, dict):
            if wanted_tags and a.get("tags") and not tag_overlap(a.get("tags"), wanted_tags):
                continue
            if a.get("text"):
                items.append(str(a["text"]))
        else:
            items.append(str(a))
    if not items:
        return None
    return "\n".join("- " + t for t in items)


def compose_basics(overrides):
    b = strip_meta(load(os.path.join(DATA_DIR, "basics.yml")))
    ov = (overrides or {}).get("basics") or {}
    b.update(ov)
    if isinstance(b.get("summary"), list):
        b["summary"] = to_summary_string(b["summary"])
    return b if b else None


def compose_list(block, cfg):
    entries = load(os.path.join(DATA_DIR, block + ".yml")) or []
    selected = select_entries(entries, cfg)
    if not selected:
        return None
    wanted = (cfg or {}).get("tags")
    out = []
    for e in selected:
        item = strip_meta(e)
        if "company" in item and "name" not in item:
            item["name"] = item.pop("company")
        summary = build_summary(e, wanted)
        if summary is not None:
            item["summary"] = to_summary_string(summary)
        elif ACHIEVEMENTS_KEY in e:
            item.pop("summary", None)
        item.pop(ACHIEVEMENTS_KEY, None)
        if isinstance(item.get("summary"), list):
            item["summary"] = to_summary_string(item["summary"])
        out.append(item)
    return out


def build_layout(v, defaults):
    d = dict(defaults.get("layout") or {})
    d.update(v.get("layout") or {})
    order = v.get("sectionOrder") or defaults.get("sectionOrder")
    if order:
        d.setdefault("sections", {})["order"] = list(order)
    return d


def compose_variant(name, v, defaults):
    content = {}
    for block, cfg in (v.get("blocks") or {}).items():
        if block == "basics":
            b = compose_basics(v.get("overrides"))
            if b:
                content["basics"] = b
        else:
            items = compose_list(block, cfg)
            if items:
                content[block] = items
    return {
        "content": content,
        "locale": {"language": v.get("locale", defaults.get("locale", "zh-hans"))},
        "layouts": [build_layout(v, defaults)],
    }


def main():
    args = sys.argv[1:]
    check_only = "--check" in args
    only = [a for a in args if not a.startswith("--")]

    cfg = load(VARIANTS_FILE)
    defaults = cfg.get("defaults") or {}
    variants = cfg.get("variants") or {}
    if not variants:
        print("variants.yml 中没有定义任何变体")
        return 1

    os.makedirs(OUT_DIR, exist_ok=True)
    generated = []
    for name, v in variants.items():
        if only and name not in only:
            continue
        resume = compose_variant(name, v, defaults)
        path = os.path.join(OUT_DIR, name + ".yml")
        if not check_only:
            with open(path, "w", encoding="utf-8") as f:
                f.write(HEADER)
                yaml.dump(resume, f, Dumper=Dumper, allow_unicode=True,
                          sort_keys=False, default_flow_style=False, width=120)
        blocks = list(resume["content"].keys())
        print(f"[{'check' if check_only else 'gen '}] {name}.yml  sections={blocks}")
        generated.append(path)
    if check_only:
        print(f"check passed: {len(generated)} variant(s) would be generated")
    else:
        print(f"generated {len(generated)} file(s) in {os.path.relpath(OUT_DIR, ROOT)}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
