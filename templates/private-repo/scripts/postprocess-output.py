#!/usr/bin/env python3
"""Normalize grouped skill rendering after yamlresume generates TeX/HTML."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "resumes"

MODERNCV_SKILL = re.compile(
    r"^\\cvline\{([^{}\r\n]+)\}\{[^{}\r\n]*\}$",
    re.MULTILINE,
)
JAKE_SKILL = re.compile(
    r"^\\textbf\{([^{}\r\n]*：[^{}\r\n]*)\}[:：][^{}\r\n]*$",
    re.MULTILINE,
)
JAKE_INTEREST = re.compile(
    r"^\\textbf\{([^{}\r\n]*、[^{}\r\n]*)\}$",
    re.MULTILINE,
)
KEYWORDS_LABEL = re.compile(r"\\textbf\{关键字\}")
HTML_KEYWORDS_LABEL = re.compile(r"<span>关键字</span>")
HTML_SKILL_LEVEL = re.compile(
    r'(<div class="resume-skill-name">[^<]*)'
    r'<span class="resume-skill-level">[^<]*</span>'
)

# ModernCV 正文列补丁：保留 yamlresume 的段落式 cvitem（含 CJK 冒号适配），正文改 raggedright 避免长行溢出（仅 moderncv 文档注入）
CVITEM_PATCH_MARK = "rm-moderncv-raggedright"
CVITEM_PATCH = (
    "% " + CVITEM_PATCH_MARK + "\n"
    "\\makeatletter\n"
    "\\renewcommand*{\\cvitem}[3][.25em]{%\n"
    "  \\ifstrempty{#2}{}{\\hintstyle{#2}：}\\raggedright#3%\n"
    "  \\par\\addvspace{#1}}\n"
    "\\makeatother\n"
)


def rewrite(path, transform):
    original = path.read_text(encoding="utf-8")
    normalized = transform(original)
    if normalized == original:
        return False
    path.write_text(normalized, encoding="utf-8")
    print(f"normalized {path.relative_to(ROOT)}")
    return True


def normalize_tex(text):
    text = MODERNCV_SKILL.sub(r"\\cvline{}{\1}", text)
    # 项目关键字：改名为“技术栈”并另起一行（必须先于 JAKE_SKILL 执行，避免被其误删）。
    # 用 \\leavevmode\\ 强制换行：cventry 是非 long 宏（参数禁 \\par），且摘要可能是 itemize（\\newline 会报错）。
    text = KEYWORDS_LABEL.sub(r"\\leavevmode\\\\\\textbf{技术栈}", text)
    text = JAKE_SKILL.sub(r"\1", text)
    text = JAKE_INTEREST.sub(r"\1", text)
    # ModernCV：正文列改 raggedright，避免长技能行因两端对齐产生 Overfull \\hbox。
    if "moderncv" in text and CVITEM_PATCH_MARK not in text:
        text = re.sub(r"^(\\begin\{document\})", lambda m: CVITEM_PATCH + m.group(1), text, flags=re.MULTILINE)
    return text


def normalize_html(text):
    text = HTML_SKILL_LEVEL.sub(r"\1", text)
    # 项目关键字改名为“技术栈”（HTML 中已是独立行）。
    return HTML_KEYWORDS_LABEL.sub("<span>技术栈</span>", text)


def main():
    changed_tex = []
    for path in sorted(OUT_DIR.glob("*.tex")):
        if rewrite(path, normalize_tex):
            changed_tex.append(path.name)
    for path in sorted(OUT_DIR.glob("*.html")):
        rewrite(path, normalize_html)
    print("changed-tex=" + " ".join(changed_tex))


if __name__ == "__main__":
    main()
