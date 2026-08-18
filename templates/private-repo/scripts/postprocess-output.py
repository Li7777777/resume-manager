#!/usr/bin/env python3
"""Normalize grouped skill rendering after yamlresume generates TeX/HTML."""
from pathlib import Path
import base64
import re

import yaml

from font_options import (
    get_html_font_configuration,
    get_latex_font_families,
    normalize_font_settings,
)

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
FONT_PREFERENCES_MARK = "rm-font-preferences"
GITHUB_BADGE_MARK = "rm-github-badge"
GITHUB_BADGE_TEX = (
    "% " + GITHUB_BADGE_MARK + "\n"
    "\\IfFileExists{fontawesome5.sty}{\\usepackage{fontawesome5}}{"
    "\\providecommand{\\faGithub}{GitHub}\\providecommand{\\faStar}{*}}\n"
    "\\makeatletter\n"
    "\\@ifpackageloaded{xcolor}{\n"
    "  \\definecolor{rmbadgeborder}{HTML}{D0D7DE}\n"
    "  \\definecolor{rmbadgeleft}{HTML}{FFFFFF}\n"
    "  \\definecolor{rmbadgeright}{HTML}{FFFFFF}\n"
    "  \\definecolor{rmbadgetext}{HTML}{24292F}\n"
    "}{\n"
    "  \\definecolor{rmbadgeborder}{rgb}{0.816,0.843,0.867}\n"
    "  \\definecolor{rmbadgeleft}{rgb}{1,1,1}\n"
    "  \\definecolor{rmbadgeright}{rgb}{1,1,1}\n"
    "  \\definecolor{rmbadgetext}{rgb}{0.141,0.161,0.184}\n"
    "}\n"
    "\\makeatother\n"
    '\\newcommand{\\githubbadge}[2]{%\n'
    '  \\leavevmode\\begingroup\\setlength{\\fboxsep}{1pt}\\setlength{\\fboxrule}{0.35pt}%\n'
    '  \\hspace{0.3em}\\raisebox{0.6pt}{%\n'
    '    \\fcolorbox{rmbadgeborder}{rmbadgeleft}{%\n'
    '      \\fontsize{6.5}{6.5}\\selectfont\\strut\n'
    '      \\textcolor{rmbadgetext}{\\faGithub\\ \\texttt{#1}}%\n'
    '      \\if\\relax\\detokenize{#2}\\relax\n'
    '      \\else\n'
    '        \\hspace{0.45em}{\\color{rmbadgeborder}\\vrule width 0.35pt height 1.1ex depth 0.25ex}\\hspace{0.45em}%\n'
    '        \\textcolor{rmbadgetext}{\\faStar\\ #2}%\n'
    '      \\fi\n'
    '    }%\n'
    '  }%\n'
    '  \\hspace{0.2em}\\endgroup}\n'
)


PROFILE_PHOTO_MARK = "rm-profile-photo"
PROFILE_PHOTO_HTML_CSS = f"""
/* {PROFILE_PHOTO_MARK} */
.resume-header {{ position: relative; }}
.rm-profile-photo {{ position: absolute; top: 0; right: 18px; width: 66px; height: 92.4px; object-fit: cover; object-position: center top; border: 1px solid rgba(127,127,127,.35); border-radius: 2px; }}
@media (max-width: 520px) {{
  .rm-profile-photo {{ position: static; display: block; margin: 0 auto 16px; }}
}}
"""


def github_badge_html(repo, stars):
    github_logo = '<svg aria-hidden="true" viewBox="0 0 16 16" width="11" height="11" fill="currentColor" style="vertical-align:middle;margin-right:4px;"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.2.46.46.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>'
    star_logo = '<svg aria-hidden="true" viewBox="0 0 16 16" width="10" height="10" fill="currentColor" style="vertical-align:middle;margin-right:4px;"><path d="m8 0 2.47 5.01 5.53.81-4 3.9.94 5.51L8 12.63l-4.94 2.6L4 9.72 0 5.82l5.53-.81L8 0z"/></svg>'
    repo_part = (
        '<span style="display:inline-flex;align-items:center;padding:2px 5px;">'
        + github_logo + repo + '</span>'
    )
    stars_part = (
        '<span style="display:inline-flex;align-items:center;padding:2px 5px;'
        'border-left:1px solid #d0d7de;">'
        + star_logo + stars + '</span>' if stars else ''
    )
    return (
        '<span style="display:inline-flex;align-items:stretch;margin-left:8px;vertical-align:0.1em;'
        'background:#fff;color:#24292f;border:1px solid #d0d7de;border-radius:3px;overflow:hidden;'
        'font-family:Verdana,Geneva,DejaVu Sans,sans-serif;font-size:10px;line-height:1;'
        'white-space:nowrap;">' + repo_part + stars_part + '</span>'
    )


def latex_font_name(family):
    return f"\\detokenize{{{family}}}"


def latex_font_commands(families, commands):
    lines = []
    for family in reversed(families):
        name = latex_font_name(family)
        body = "".join(f"\\{command}{{{name}}}" for command in commands)
        lines.append(f"\\IfFontExistsTF{{{name}}}{{{body}}}{{}}")
    return "\n".join(lines)


def latex_cjk_font_commands(families):
    lines = []
    for family in reversed(families):
        name = latex_font_name(family)
        options = "[AutoFakeBold,AutoFakeSlant]"
        body = (
            f"\\setCJKmainfont{options}{{{name}}}"
            f"\\setCJKsansfont{options}{{{name}}}"
        )
        lines.append(f"\\IfFontExistsTF{{{name}}}{{{body}}}{{}}")
    return "\n".join(lines)


def inject_font_preferences_tex(text, fonts):
    if FONT_PREFERENCES_MARK in text:
        return text
    selected = normalize_font_settings(fonts)
    latin_families = (
        get_latex_font_families("latin", selected.get("latin"))
        if selected.get("latin")
        else []
    )
    # 未选择中文字体时保持原有行为：本机优先微软雅黑，CI 沿用 YAMLResume 的 Noto 回退。
    cjk_families = (
        get_latex_font_families("cjk", selected.get("cjk"))
        if selected.get("cjk")
        else ["Microsoft YaHei"]
    )
    patch = f"% {FONT_PREFERENCES_MARK}\n"
    if latin_families:
        patch += latex_font_commands(latin_families, ["setmainfont", "setsansfont"]) + "\n"
    patch += "\\ifdefined\\setCJKmainfont\\else\n"
    patch += "\\IfFileExists{xeCJK.sty}{\\usepackage{xeCJK}}{}\n"
    patch += "\\fi\n\\ifdefined\\setCJKmainfont\n"
    patch += latex_cjk_font_commands(cjk_families) + "\n"
    patch += "\\fi\n"
    return re.sub(
        r"^(\\begin\{document\})",
        lambda match: patch + match.group(1),
        text,
        count=1,
        flags=re.MULTILINE,
    )


def inject_font_preferences_html(text, fonts, template):
    config = get_html_font_configuration(fonts, template)
    if not config or FONT_PREFERENCES_MARK in text:
        return text

    def local_sources(families):
        return ", ".join(f'local("{family}")' for family in families)

    fallback_families = []
    for family in config["latinFamilies"] + config["cjkFamilies"]:
        if family not in fallback_families:
            fallback_families.append(family)
    fallback = ", ".join(f'"{family}"' for family in fallback_families)
    css = (
        f"\n/* {FONT_PREFERENCES_MARK} */\n"
        '@font-face {\n  font-family: "Resume Manager Selected";\n'
        f'  src: {local_sources(config["latinFamilies"])};\n'
        "  unicode-range: U+0000-024F, U+1E00-1EFF;\n}\n"
        '@font-face {\n  font-family: "Resume Manager Selected";\n'
        f'  src: {local_sources(config["cjkFamilies"])};\n'
        "  unicode-range: U+2E80-2FDF, U+3000-303F, U+31C0-31EF, "
        "U+3400-4DBF, U+4E00-9FFF, U+F900-FAFF, U+FF00-FFEF;\n}\n"
        f':root {{ --text-font-family: "Resume Manager Selected", {fallback}, {config["generic"]}; }}\n'
    )
    return text.replace("</style>", css + "</style>", 1)


def get_variant_render_settings(name):
    fonts = {}
    template = "calm"
    engines = set()
    try:
        variants_doc = yaml.safe_load((ROOT / "scripts" / "variants.yml").read_text(encoding="utf-8")) or {}
        variants = variants_doc.get("variants") if isinstance(variants_doc, dict) else {}
        variant = (variants or {}).get(name) or {}
        fonts = normalize_font_settings(variant.get("fonts") if isinstance(variant, dict) else {})
    except (OSError, yaml.YAMLError):
        pass
    try:
        generated_doc = yaml.safe_load((OUT_DIR / f"{name}.yml").read_text(encoding="utf-8")) or {}
        layouts = (generated_doc.get("layouts") or []) if isinstance(generated_doc, dict) else []
        engines = {
            layout.get("engine")
            for layout in layouts
            if isinstance(layout, dict) and layout.get("engine") in {"latex", "html"}
        }
        html_layout = next(
            (
                layout
                for layout in layouts
                if isinstance(layout, dict) and layout.get("engine") == "html"
            ),
            None,
        )
        if html_layout and html_layout.get("template"):
            template = html_layout["template"]
    except (OSError, yaml.YAMLError):
        pass
    return fonts, template, engines


def get_profile_photo():
    basics_file = ROOT / "data" / "basics.yml"
    try:
        basics = yaml.safe_load(basics_file.read_text(encoding="utf-8")) or {}
        relative = str(basics.get("photo") or "").replace("\\", "/")
        if not re.fullmatch(r"assets/profile-photo\.(jpg|png)", relative):
            return None
        photo = (ROOT / relative).resolve()
        photo.relative_to(ROOT.resolve())
        if not photo.is_file():
            return None
        mime = "image/png" if photo.suffix.lower() == ".png" else "image/jpeg"
        return photo, relative, mime
    except (OSError, ValueError, yaml.YAMLError):
        return None


def inject_profile_photo_tex(text, photo):
    if not photo or PROFILE_PHOTO_MARK in text:
        return text
    _, relative, _ = photo
    source = r"\detokenize{../" + relative + "}"
    packages = []
    if r"\usepackage{graphicx}" not in text:
        packages.append(r"\usepackage{graphicx}")
    if r"\usepackage{eso-pic}" not in text:
        packages.append(r"\usepackage{eso-pic}")
    if r"\usepackage{trimclip}" not in text and r"\usepackage{adjustbox}" not in text:
        packages.append(r"\usepackage{trimclip}")
    # ModernCV Casual 的姓名原生右对齐，照片放在相反角；其余模板右上角留白更充足。
    horizontal_position = (
        r"\hspace*{0.8cm}%"
        if r"\moderncvstyle{casual}" in text
        else r"\hspace*{\dimexpr\paperwidth-3.3cm\relax}%"
    )
    preamble = ("\n".join(packages) + "\n" if packages else "") + (
        f"% {PROFILE_PHOTO_MARK}\n"
        "\\newsavebox{\\rmprofilephotobox}\n"
        "\\newlength{\\rmprofilephototrim}\n"
        "\\newcommand{\\rmprofilephotoimage}[1]{%\n"
        "  \\sbox{\\rmprofilephotobox}{\\includegraphics[height=2.52cm]{#1}}%\n"
        "  \\ifdim\\wd\\rmprofilephotobox>1.8cm\n"
        "    \\setlength{\\rmprofilephototrim}{\\dimexpr\\wd\\rmprofilephotobox-1.8cm\\relax}%\n"
        "    \\divide\\rmprofilephototrim by 2\n"
        "    \\clipbox{\\the\\rmprofilephototrim{} 0pt \\the\\rmprofilephototrim{} 0pt}{\\usebox{\\rmprofilephotobox}}%\n"
        "  \\else\n"
        "    \\sbox{\\rmprofilephotobox}{\\includegraphics[width=1.8cm]{#1}}%\n"
        "    \\setlength{\\rmprofilephototrim}{\\dimexpr\\ht\\rmprofilephotobox-2.52cm\\relax}%\n"
        "    \\divide\\rmprofilephototrim by 2\n"
        "    \\clipbox{0pt \\the\\rmprofilephototrim{} 0pt \\the\\rmprofilephototrim{}}{\\usebox{\\rmprofilephotobox}}%\n"
        "  \\fi\n"
        "}\n"
        "\\newcommand{\\rmprofilephoto}[1]{%\n"
        "  \\AddToShipoutPictureFG*{%\n"
        "    \\AtPageUpperLeft{%\n"
        "      \\raisebox{-3.2cm}[0pt][0pt]{%\n"
        f"        {horizontal_position}\n"
        "        \\rmprofilephotoimage{#1}%\n"
        "      }%\n"
        "    }%\n"
        "  }%\n"
        "}\n"
    )
    text = re.sub(
        r"^(\\begin\{document\})",
        lambda match: preamble + match.group(1),
        text,
        count=1,
        flags=re.MULTILINE,
    )
    return re.sub(
        r"^(\\begin\{document\})",
        lambda match: match.group(1) + "\n\\rmprofilephoto{" + source + "}",
        text,
        count=1,
        flags=re.MULTILINE,
    )


def inject_profile_photo_html(text, photo):
    if not photo or PROFILE_PHOTO_MARK in text:
        return text
    photo_path, _, mime = photo
    encoded = base64.b64encode(photo_path.read_bytes()).decode("ascii")
    image = f'<!-- {PROFILE_PHOTO_MARK} --><img class="rm-profile-photo" src="data:{mime};base64,{encoded}" alt="证件照">'
    if "</style>" in text:
        text = text.replace("</style>", PROFILE_PHOTO_HTML_CSS + "</style>", 1)
    else:
        text = text.replace("</head>", f"<style>{PROFILE_PHOTO_HTML_CSS}</style>\n</head>", 1)
    return text.replace('<header class="resume-header">', '<header class="resume-header">\n      ' + image, 1)


# ModernCV 补丁：正文 raggedright；名称/日期同排；背景/职位使用可换行正文。
CVITEM_PATCH_MARK = "rm-moderncv-patches"
CVITEM_PATCH = (
    "% " + CVITEM_PATCH_MARK + "\n"
    "\\usepackage{tabularx}\n"
    "\\makeatletter\n"
    "\\renewcommand*{\\cvitem}[3][.25em]{%\n"
    "  \\ifstrempty{#2}{}{\\hintstyle{#2}：}\\raggedright#3%\n"
    "  \\par\\addvspace{#1}}\n"
    "\\makeatother\n"
    "% 名称与时间同一行；背景/职位移出表格，以正文宽度自然换行\n"
    "\\renewcommand*{\\cventry}[7][.25em]{%\n"
    "  \\begin{tabularx}{\\maincolumnwidth}{@{}>{\\raggedright\\arraybackslash}Xr@{}}%\n"
    "    \\ifboolexpr{%\n"
    "      test {\\ifstrempty{#4}}\n"
    "      and\n"
    "      test {\\ifstrempty{#5}}}%\n"
    "      {}%\n"
    "      {{\\bfseries #4} & {\\bfseries #2}\\\\}%\n"
    "  \\end{tabularx}\\par%\n"
    "  \\ifboolexpr{%\n"
    "    test {\\ifstrempty{#3}}\n"
    "    and\n"
    "    test {\\ifstrempty{#6}}}%\n"
    "    {}%\n"
    "    {\\begin{minipage}{\\maincolumnwidth}%\n"
    "      \\raggedright\\itshape #3\\ifstrempty{#6}{}{, #6}%\n"
    "    \\end{minipage}\\par}%\n"
    "  \\ifx&#7&%\n"
    "  \\else\n"
    "    \\noindent\\begin{minipage}{\\maincolumnwidth}%\n"
    "      \\small#7%\n"
    "    \\end{minipage}%\n"
    "  \\fi%\n"
    "  \\par\\addvspace{#1}}\n"
)

JAKE_SUBHEADING_PATCH_MARK = "rm-jake-subheading-patch"
JAKE_SUBHEADING_PATCH = (
    f"% {JAKE_SUBHEADING_PATCH_MARK}\n"
    "\\usepackage{tabularx}\n"
    "% 名称与时间同一行；项目背景/机构移出不可换行的表格列\n"
    "\\renewcommand{\\resumeSubheading}[4]{%\n"
    "  \\begin{tabularx}{\\textwidth}[t]{@{}>{\\raggedright\\arraybackslash}Xr@{}}%\n"
    "    \\textbf{#1} & #2 \\\\%\n"
    "  \\end{tabularx}\\par%\n"
    "  \\begin{minipage}{\\textwidth}%\n"
    "    \\raggedright\\itshape #3%\n"
    "    \\ifx&#4&\\else\\hfill #4\\fi%\n"
    "  \\end{minipage}\\par\n"
    "}\n"
)


def rewrite(path, transform):
    original = path.read_text(encoding="utf-8")
    normalized = transform(original)
    if normalized == original:
        return False
    path.write_text(normalized, encoding="utf-8")
    print(f"normalized {path.relative_to(ROOT)}")
    return True


def normalize_tex(text, photo=None, fonts=None):
    text = inject_font_preferences_tex(text, fonts or {})
    text = MODERNCV_SKILL.sub(r"\\cvline{}{\1}", text)
    # 项目关键字：改名为“技术栈”并另起一行（必须先于 JAKE_SKILL 执行，避免被其误删）。
    # 用 \\leavevmode\\ 强制换行：cventry 是非 long 宏（参数禁 \\par），且摘要可能是 itemize（\\newline 会报错）。
    text = KEYWORDS_LABEL.sub(r"\\leavevmode\\\\\\textbf{技术栈}", text)
    text = JAKE_SKILL.sub(r"\1", text)
    text = JAKE_INTEREST.sub(r"\1", text)
    # ModernCV：正文列改 raggedright，名称/日期同排，背景和职位移出不可换行的表格列。
    if "moderncv" in text and CVITEM_PATCH_MARK not in text:
        text = re.sub(r"^(\\begin\{document\})", lambda m: CVITEM_PATCH + m.group(1), text, flags=re.MULTILINE)
    # YAMLResume Jake 同样把副标题放在 l 列，长项目背景需改为表格后的普通段落。
    if (
        "moderncv" not in text
        and r"\newcommand{\resumeSubheading}" in text
        and JAKE_SUBHEADING_PATCH_MARK not in text
    ):
        text = re.sub(
            r"^(\\begin\{document\})",
            lambda m: JAKE_SUBHEADING_PATCH + m.group(1),
            text,
            flags=re.MULTILINE,
        )
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
    return inject_profile_photo_tex(text, photo)


def normalize_html(text, photo=None, fonts=None, template="calm"):
    text = HTML_SKILL_LEVEL.sub(r"\1", text)
    # HTML 输出优先使用 Windows 中文字体，其他系统通过 sans-serif 回退。
    text = re.sub(
        r"--text-default-font-family:\s*[^;]+;",
        '--text-default-font-family: "Microsoft YaHei", sans-serif;',
        text,
    )
    text = inject_font_preferences_html(text, fonts or {}, template)
    # 项目关键字改名为“技术栈”（HTML 中已是独立行）。
    text = HTML_KEYWORDS_LABEL.sub("<span>技术栈</span>", text)
    # GitHub 仓库徽章：Logo + owner/repo + stars 数
    text = GITHUB_BADGE.sub(lambda m: github_badge_html(m.group(1), m.group(2) or ""), text)
    return inject_profile_photo_html(text, photo)


def main():
    photo = get_profile_photo()
    changed_tex = []
    for path in sorted(OUT_DIR.glob("*.tex")):
        fonts, _, engines = get_variant_render_settings(path.stem)
        if "latex" in engines and rewrite(
            path, lambda text, fonts=fonts: normalize_tex(text, photo, fonts)
        ):
            changed_tex.append(path.name)
    for path in sorted(OUT_DIR.glob("*.html")):
        fonts, template, engines = get_variant_render_settings(path.stem)
        if "html" in engines:
            rewrite(
                path,
                lambda text, fonts=fonts, template=template: normalize_html(
                    text, photo, fonts, template
                ),
            )
    print("changed-tex=" + " ".join(changed_tex))


if __name__ == "__main__":
    main()
