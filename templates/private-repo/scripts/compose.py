#!/usr/bin/env python3
"""
组合脚本：从 data/ 信息全集按 scripts/variants.yml 配方生成 resumes/*.yml

用法：
    python scripts/compose.py            # 生成所有变体
    python scripts/compose.py frontend   # 只生成指定变体
    python scripts/compose.py --check    # 只做完整性检查，不写文件

原则：
- data/ 是唯一真相源，本脚本只读 data/，生成的 resumes/*.yml 不应手改
- 组稿键（id / tags / 以 _ 开头）不进入最终简历；notes 仅作旧数据兼容并剥除
- achievements 每条成就可打 tags；无标签成就视为通用，任何方向都保留
"""
import json
import os
import re
import sys

import yaml

from font_options import get_typography_font_family, normalize_font_settings
from brand_icons import detect_url_brand

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
    """去掉元数据键，返回纯简历字段"""
    if not isinstance(item, dict):
        return item
    # subtitle/source/role/stage 为管理端字段，schema 无此字段，不进简历
    return {k: v for k, v in item.items() if k not in META_KEYS and k not in ("subtitle", "source", "role", "stage") and not k.startswith("_")}


def tag_overlap(item_tags, wanted_tags):
    if not wanted_tags:
        return True
    if not item_tags:
        return False
    return bool(set(item_tags) & set(wanted_tags))


def select_entries(entries, cfg):
    """按配方选择条目：include-all / ids / tags"""
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


def collect_achievements(entry, wanted_tags):
    """成就点 -> markdown 列表（按标签过滤）；无成就点返回 None"""
    if ACHIEVEMENTS_KEY not in entry:
        return None
    items = []
    for a in entry[ACHIEVEMENTS_KEY]:
        if isinstance(a, dict):
            # 无标签成就 = 通用，保留；有标签的必须与方向命中
            if wanted_tags and a.get("tags") and not tag_overlap(a.get("tags"), wanted_tags):
                continue
            if a.get("text"):
                items.append(str(a["text"]))
        else:
            items.append(str(a))
    if not items:
        return None
    return "\n".join("- " + t for t in items)


def build_summary(entry, wanted_tags):
    """成就点 -> summary（按标签过滤）；无成就点则保留原 summary"""
    if ACHIEVEMENTS_KEY not in entry:
        return entry.get("summary")
    return collect_achievements(entry, wanted_tags)


def to_summary_string(summary):
    """summary 规范化为 markdown 字符串（schema 要求 summary 是字符串）"""
    if summary is None:
        return None
    if isinstance(summary, str):
        return summary
    if isinstance(summary, list):
        lines = ["- " + str(s) for s in summary if s]
        return "\n".join(lines) if lines else None
    return str(summary)


def normalize_project_summary(summary):
    text = (to_summary_string(summary) or "").strip()
    if not text:
        return None
    # 已使用 Markdown 列表时原样保留缩进；旧纯文本按行迁移为顶级项目要点。
    if re.search(r"^\s{0,3}(?:[-+*]|\d+[.)])\s+", text, re.MULTILINE):
        return text
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    return "\n".join("- " + line for line in lines) if lines else None


def normalize_project_background(description):
    text = str(description or "").strip()
    if not text:
        return None
    return text if re.match(r"^项目背景[：:]", text) else "项目背景：" + text


def compact_skills(items):
    # 按细分方向（tags）分组：每个方向一行“方向：技能、技能”，跨方向技能同时出现在多行。
    dir_order = []
    groups = {}
    for item in items:
        candidates = item.get("keywords") if isinstance(item.get("keywords"), list) and item.get("keywords") else [item.get("name")]
        names = []
        for candidate in candidates:
            name = str(candidate or "").strip()
            if name.startswith("熟悉 ") or name.startswith("掌握 "):
                name = name[3:].strip()
            if name and name not in names:
                names.append(name)
        if not names:
            continue
        tags = [t for t in (item.get("tags") or []) if isinstance(t, str) and t.strip()]
        dirs = tags if tags else ["通用"]
        for d in dirs:
            if d not in groups:
                groups[d] = []
                dir_order.append(d)
            for n in names:
                if n not in groups[d]:
                    groups[d].append(n)
    return [
        {"name": f"{d}：{'、'.join(groups[d])}", "level": "Expert", "keywords": []}
        for d in dir_order
        if groups[d]
    ]


def compact_interests(items):
    names = []
    for item in items:
        name = str(item.get("name") or "").strip()
        if name and name not in names:
            names.append(name)
    return [{"name": "、".join(names), "keywords": []}] if names else []


def compose_basics():
    b = strip_meta(load(os.path.join(DATA_DIR, "basics.yml")))
    # photo 是管理端构建元数据；YAMLResume basics schema 不接受该字段，由后处理注入。
    b.pop("photo", None)
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
        # 字段别名：work 章节的 schema 字段名是 name（数据里用 company 更自然）
        if "company" in item and "name" not in item:
            item["name"] = item.pop("company")
        if block == "projects":
            # 字段映射：数据 background → schema description；数据 tech → schema keywords
            if "background" in item:
                item["description"] = item.pop("background")
            if "tech" in item:
                item["keywords"] = item.pop("tech")
            summary = normalize_project_summary(e.get("summary"))
            achievements = collect_achievements(e, wanted)
            parts = []
            if summary:
                parts.append(summary)
            if achievements:
                parts.append("**成果**\n" + achievements)
            if parts:
                item["summary"] = "\n\n".join(parts)
            else:
                item.pop("summary", None)
            item.pop(ACHIEVEMENTS_KEY, None)
            background = normalize_project_background(item.get("description"))
            if background:
                item["description"] = background
            else:
                item.pop("description", None)
        else:
            summary = build_summary(e, wanted)
            if summary is not None:
                item["summary"] = to_summary_string(summary)
            elif ACHIEVEMENTS_KEY in e:
                item.pop("summary", None)
            item.pop(ACHIEVEMENTS_KEY, None)
        # 项目背景保留完整原文；项目要点保留 Markdown 层级。
        out.append(item)
    # 技能/兴趣分组需要方向（tags）元数据，因此直接用原始选中条目（含 tags）
    if block == "skills":
        return compact_skills(selected)
    if block == "interests":
        return compact_interests(selected)
    # GitHub star 徽章：与 server/lib/github-stars.js 行为一致，读本机缓存注入项目名
    if block == "projects":
        inject_github_stars(out)
    # 非 GitHub 品牌链接：自动选择 lobe-icons 品牌 logo
    if block == "projects":
        inject_url_brands(out)
    return out


GITHUB_STARS_CACHE = os.path.join(
    os.path.expanduser("~"), ".resume-manager", "github-stars.json"
)


def parse_github_repo_url(url):
    if not url or not isinstance(url, str):
        return None
    s = url.strip()
    if s.lower().endswith(".git"):
        s = s[:-4]
    s = s.rstrip("/")
    m = re.search(r"github\.com/([^/?#]+/[^/?#]+)", s, re.IGNORECASE)
    if not m:
        return None
    parts = m.group(1).split("/")
    if len(parts) != 2:
        return None
    if not all(re.fullmatch(r"[\w.-]+", p) for p in parts):
        return None
    return parts[0] + "/" + parts[1]


def format_star_count(n):
    try:
        num = int(n)
    except (TypeError, ValueError):
        return ""
    if num >= 1000000:
        s = "%.1f" % (num / 1000000.0)
        return s.rstrip("0").rstrip(".") + "m"
    if num >= 1000:
        s = "%.1f" % (num / 1000.0)
        return s.rstrip("0").rstrip(".") + "k"
    return str(num)


def load_stars_cache():
    try:
        with open(GITHUB_STARS_CACHE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def inject_github_stars(items):
    cache = load_stars_cache()
    for it in items:
        owner_repo = parse_github_repo_url(it.get("url"))
        hit = cache.get(owner_repo) if owner_repo else None
        if not hit:
            continue
        try:
            count = int(hit.get("count"))
        except (TypeError, ValueError):
            continue
        if count < 0:
            continue  # 无效值不显示；0 star 仅显示仓库地址
        badge = format_star_count(count) if count > 0 else ""
        if count > 0 and not badge:
            continue
        if "[github|" in str(it.get("name") or ""):
            continue
        it["name"] = "%s [github|%s|%s]" % (it["name"], owner_repo, badge)


def inject_url_brands(items):
    """非 GitHub 的品牌链接（OpenAI/Claude/DeepSeek 等）追加品牌 logo 标记"""
    for it in items:
        name = str(it.get("name") or "")
        if "[github|" in name or "[brand|" in name:
            continue
        brand = detect_url_brand(it.get("url"))
        if brand:
            it["name"] = "%s [brand|%s]" % (name, brand["iconId"])


def apply_layout_fonts(layout, fonts):
    family = get_typography_font_family(
        layout.get("engine"),
        layout.get("template"),
        normalize_font_settings(fonts),
    )
    if family:
        layout["typography"] = {**(layout.get("typography") or {}), "fontFamily": family}
    return layout


def build_layout(v, defaults):
    d = dict(defaults.get("layout") or {})
    d.update(v.get("layout") or {})
    order = v.get("sectionOrder") or defaults.get("sectionOrder")
    if order:
        d.setdefault("sections", {})["order"] = list(order)
    if d.get("engine") == "latex":
        d["advanced"] = {"showUrls": False, **(d.get("advanced") or {})}
    return apply_layout_fonts(d, v.get("fonts"))


def build_layouts(v, defaults):
    """多引擎支持：v.htmlLayout 存在时同时输出 HTML 布局（PDF + HTML 一次构建）"""
    latex = build_layout(v, defaults)
    html = v.get("htmlLayout")
    if html and html.get("template"):
        html_layout = {"engine": "html", "template": html["template"]}
        if isinstance(html.get("typography"), dict):
            html_layout["typography"] = dict(html["typography"])
        order = v.get("sectionOrder") or defaults.get("sectionOrder")
        if order:
            html_layout.setdefault("sections", {})["order"] = list(order)
        return [latex, apply_layout_fonts(html_layout, v.get("fonts"))]
    return [latex]


def compose_variant(name, v, defaults):
    content = {}
    for block, cfg in (v.get("blocks") or {}).items():
        if block == "basics":
            b = compose_basics()
            if b:
                content["basics"] = b
        else:
            items = compose_list(block, cfg)
            if items:
                content[block] = items
    return {
        "content": content,
        "locale": {"language": v.get("locale", defaults.get("locale", "zh-hans"))},
        "layouts": build_layouts(v, defaults),
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
