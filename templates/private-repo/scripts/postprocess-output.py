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
STARS_BADGE = re.compile(r"\s*\[stars\|([0-9]+(?:\.[0-9]+)?[km]?)\]")
STARS_BADGE_MARK = "rm-stars-badge"
STARS_BADGE_TEX = (
    "% " + STARS_BADGE_MARK + "\n"
    "\\makeatletter\n"
    "\\@ifpackageloaded{xcolor}{\n"
    "  \\definecolor{rmbadgeleft}{HTML}{555555}\n"
    "  \\definecolor{rmbadgeright}{HTML}{007EC6}\n"
    "}{\n"
    "  \\definecolor{rmbadgeleft}{gray}{0.33}\n"
    "  \\definecolor{rmbadgeright}{rgb}{0.0,0.494,0.776}\n"
    "}\n"
    "\\makeatother\n"
    "\\newcommand{\\starsbadge}[1]{\\leavevmode\\begingroup\\setlength{\\fboxsep}{1pt}"
    "\\raisebox{-1.5pt}{\\colorbox{rmbadgeleft}{\\textcolor{white}{\\ttfamily\\fontsize{6.5}{7}"
    "\\selectfont stars}}\\colorbox{rmbadgeright}{\\textcolor{white}{\\ttfamily\\fontsize{6.5}{7}"
    "\\selectfont #1}}}\\endgroup}\n"
)


def stars_badge_html(value):
    return (
        '<span style="display:inline-block;margin-left:6px;vertical-align:middle;'
        'font-family:Verdana,Geneva,DejaVu Sans,sans-serif;font-size:10px;line-height:10px;'
        'white-space:nowrap;"><span style="display:inline-block;background:#555;color:#fff;'
        'padding:3px 4px;border-radius:2px 0 0 2px;">stars</span>'
        '<span style="display:inline-block;background:#007EC6;color:#fff;padding:3px 4px;'
        'border-radius:0 2px 2px 0;">' + value + '</span></span>'
    )

# ModernCV 补丁：1) cvitem 正文改 raggedright 防长行溢出；2) cventry 名称与时间同一行、时间右对齐。仅 moderncv 文档注入。
CVITEM_PATCH_MARK = "rm-moderncv-patches"
CVITEM_PATCH = (
    "% " + CVITEM_PATCH_MARK + "\n"
    "\\makeatletter\n"
    "\\renewcommand*{\\cvitem}[3][.25em]{%\n"
    "  \\ifstrempty{#2}{}{\\hintstyle{#2}：}\\raggedright#3%\n"
    "  \\par\\addvspace{#1}}\n"
    "\\makeatother\n"
    "% 名称与时间同一行，时间在最右侧右对齐\n"
    "\\renewcommand*{\\cventry}[7][.25em]{%\n"
    "  \\begin{tabular*}{\\maincolumnwidth}{l@{\\extracolsep{\\fill}}r}%\n"
    "    \\ifboolexpr{%\n"
    "      test {\\ifstrempty{#4}}\n"
    "      and\n"
    "      test {\\ifstrempty{#5}}}%\n"
    "      {}%\n"
    "      {{\\bfseries #4} & {\\bfseries #2}\\\\}%\n"
    "    {\\itshape #3\\ifstrempty{#6}{}{, #6}} & {}\\\\%\n"
    "  \\end{tabular*}%\n"
    "  \\ifx&#7&%\n"
    "  \\else{\\\\%\n"
    "    \\begin{minipage}{\\maincolumnwidth}%\n"
    "      \\small#7%\n"
    "    \\end{minipage}}\\fi%\n"
    "  \\par\\addvspace{#1}}\n"
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
    # GitHub star 徽章：[stars|N] → shields 风格双色徽章
    if STARS_BADGE.search(text):
        text = STARS_BADGE.sub(lambda m: r" \starsbadge{" + m.group(1) + "}", text)
        if STARS_BADGE_MARK not in text:
            text = re.sub(
                r"^(\\begin\{document\})",
                lambda m: STARS_BADGE_TEX + m.group(1),
                text,
                flags=re.MULTILINE,
            )
    return text


def normalize_html(text):
    text = HTML_SKILL_LEVEL.sub(r"\1", text)
    # 项目关键字改名为“技术栈”（HTML 中已是独立行）。
    text = HTML_KEYWORDS_LABEL.sub("<span>技术栈</span>", text)
    # GitHub star 徽章：shields.io 风格双色标签（左灰 stars + 右蓝数量）
    return STARS_BADGE.sub(lambda m: stars_badge_html(m.group(1)), text)


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
