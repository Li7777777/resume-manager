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
GITHUB_BADGE = re.compile(
    r"\s*\[github\|([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)\|([0-9]+(?:\.[0-9]+)?[km]?)?\]"
)
CJK_FONT_PATCH_MARK = "rm-microsoft-yahei-font"
CJK_FONT_PATCH_TEX = (
    "% " + CJK_FONT_PATCH_MARK + "\n"
    "\\IfFontExistsTF{Microsoft YaHei}{\\setCJKmainfont{Microsoft YaHei}}{}\n"
    "\\IfFontExistsTF{Microsoft YaHei}{\\setCJKsansfont{Microsoft YaHei}}{}\n"
)
GITHUB_BADGE_MARK = "rm-github-badge"
GITHUB_BADGE_TEX = (
    "% " + GITHUB_BADGE_MARK + "\n"
    "\\IfFileExists{fontawesome5.sty}{\\usepackage{fontawesome5}}{"
    "\\providecommand{\\faGithub}{GitHub}\\providecommand{\\faStar}{*}}\n"
    "\\makeatletter\n"
    "\\@ifpackageloaded{xcolor}{\n"
    "  \\definecolor{rmbadgeleft}{HTML}{24292F}\n"
    "  \\definecolor{rmbadgeright}{HTML}{FFFFFF}\n"
    "}{\n"
    "  \\definecolor{rmbadgeleft}{rgb}{0.141,0.161,0.184}\n"
    "  \\definecolor{rmbadgeright}{rgb}{1,1,1}\n"
    "}\n"
    "\\makeatother\n"
    '\\newcommand{\\githubbadge}[2]{\\leavevmode\\begingroup\\setlength{\\fboxsep}{1.6pt}\\hspace{0.35em}\\raisebox{1pt}{\\colorbox{rmbadgeleft}{\\textcolor{white}{\\fontsize{6.8}{8}\\selectfont\\faGithub\\ \\texttt{#1}}}\\if\\relax\\detokenize{#2}\\relax\\else\\colorbox{rmbadgeright}{\\textcolor{black}{\\fontsize{7}{8.2}\\selectfont\\faStar\\ #2}}\\fi}\\hspace{0.25em}\\endgroup}\n'
)


def github_badge_html(repo, stars):
    github_logo = '<svg aria-hidden="true" viewBox="0 0 16 16" width="11" height="11" fill="currentColor" style="vertical-align:middle;margin-right:4px;"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.2.46.46.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>'
    star_logo = '<svg aria-hidden="true" viewBox="0 0 16 16" width="10" height="10" fill="currentColor" style="vertical-align:middle;margin-right:4px;"><path d="m8 0 2.47 5.01 5.53.81-4 3.9.94 5.51L8 12.63l-4.94 2.6L4 9.72 0 5.82l5.53-.81L8 0z"/></svg>'
    right = (
        '<span style="display:inline-block;background:#fff;color:#000;padding:4px 6px;'
        'border:1px solid #d0d7de;border-left:0;border-radius:0 3px 3px 0;">'
        + star_logo + stars + '</span>' if stars else ''
    )
    return (
        '<span style="display:inline-block;margin-left:8px;vertical-align:0.1em;'
        'font-family:Verdana,Geneva,DejaVu Sans,sans-serif;font-size:10px;line-height:1;'
        'white-space:nowrap;"><span style="display:inline-block;background:#24292f;'
        'color:#fff;padding:4px 6px;border-radius:3px 0 0 3px;">'
        + github_logo + repo + '</span>' + right + '</span>'
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
    if CJK_FONT_PATCH_MARK not in text:
        text = re.sub(
            r"^(\\begin\{document\})",
            lambda m: CJK_FONT_PATCH_TEX + m.group(1),
            text,
            flags=re.MULTILINE,
        )
    text = MODERNCV_SKILL.sub(r"\\cvline{}{\1}", text)
    # 项目关键字：改名为“技术栈”并另起一行（必须先于 JAKE_SKILL 执行，避免被其误删）。
    # 用 \\leavevmode\\ 强制换行：cventry 是非 long 宏（参数禁 \\par），且摘要可能是 itemize（\\newline 会报错）。
    text = KEYWORDS_LABEL.sub(r"\\leavevmode\\\\\\textbf{技术栈}", text)
    text = JAKE_SKILL.sub(r"\1", text)
    text = JAKE_INTEREST.sub(r"\1", text)
    # ModernCV：正文列改 raggedright，避免长技能行因两端对齐产生 Overfull \\hbox。
    if "moderncv" in text and CVITEM_PATCH_MARK not in text:
        text = re.sub(r"^(\\begin\{document\})", lambda m: CVITEM_PATCH + m.group(1), text, flags=re.MULTILINE)
    # GitHub 仓库徽章：[github|owner/repo|N] → Logo + 地址 + stars 数
    if GITHUB_BADGE.search(text):
        text = GITHUB_BADGE.sub(lambda m: r" \githubbadge{" + m.group(1) + "}{" + m.group(2) + "}", text)
        if GITHUB_BADGE_MARK not in text:
            text = re.sub(
                r"^(\\begin\{document\})",
                lambda m: GITHUB_BADGE_TEX + m.group(1),
                text,
                flags=re.MULTILINE,
            )
    return text


def normalize_html(text):
    text = HTML_SKILL_LEVEL.sub(r"\1", text)
    # HTML 输出优先使用 Windows 中文字体，其他系统通过 sans-serif 回退。
    text = re.sub(
        r"--text-default-font-family:\s*[^;]+;",
        '--text-default-font-family: "Microsoft YaHei", sans-serif;',
        text,
    )
    # 项目关键字改名为“技术栈”（HTML 中已是独立行）。
    text = HTML_KEYWORDS_LABEL.sub("<span>技术栈</span>", text)
    # GitHub 仓库徽章：Logo + owner/repo + stars 数
    return GITHUB_BADGE.sub(lambda m: github_badge_html(m.group(1), m.group(2) or ""), text)


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
