#!/usr/bin/env python3
"""Normalize grouped skill rendering after yamlresume generates TeX/HTML."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "resumes"

MODERNCV_SKILL = re.compile(
    r"^\\cvline\{((?:掌握|熟悉) [^{}\r\n]*)\}\{[^{}\r\n]*\}$",
    re.MULTILINE,
)
JAKE_SKILL = re.compile(
    r"^\\textbf\{((?:掌握|熟悉) [^{}\r\n]*)\}[:：][^\r\n]*$",
    re.MULTILINE,
)
HTML_SKILL_LEVEL = re.compile(
    r'(<div class="resume-skill-name">(?:掌握|熟悉) [^<]*)'
    r'<span class="resume-skill-level">[^<]*</span>'
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
    text = JAKE_SKILL.sub(r"\1", text)
    text = re.sub(r"^\\cvline\{([^{}\r\n]*、[^{}\r\n]*)\}\{\}$", r"\\cvline{}{\1}", text, flags=re.MULTILINE)
    return re.sub(r"^\\textbf\{([^{}\r\n]*、[^{}\r\n]*)\}$", r"\1", text, flags=re.MULTILINE)


def normalize_html(text):
    return HTML_SKILL_LEVEL.sub(r"\1", text)


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
