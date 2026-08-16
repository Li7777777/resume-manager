"""Font-family validation and cross-platform fallbacks for private-repository builds."""

import re
import unicodedata

LEGACY_FONT_IDS = {
    "cjk": {
        "microsoft-yahei": "Microsoft YaHei",
        "noto-sans-cjk": "Noto Sans CJK SC",
        "noto-serif-cjk": "Noto Serif CJK SC",
        "simsun": "SimSun",
    },
    "latin": {
        "linux-libertine": "Linux Libertine O",
        "arial": "Arial",
        "times-new-roman": "Times New Roman",
        "tex-gyre-heros": "TeX Gyre Heros",
        "consolas": "Consolas",
    },
}

FONT_NAME_PUNCTUATION = set(" .()'_+-&")
MONOSPACE_RE = re.compile(r"mono|code|console|courier|typewriter|fixed|等宽", re.I)
SERIF_RE = re.compile(
    r"serif|times|roman|libertine|garamond|georgia|cambria|book|schoolbook|"
    r"pagella|termes|antiqua|song|sung|sun|mincho|ming|kai|kaiti|fang|"
    r"仿宋|宋体|楷体|明體|明朝",
    re.I,
)


def normalize_font_family_name(value):
    if not isinstance(value, str) or len(value) > 160 or any(char in value for char in "\r\n\t"):
        return None
    family = re.sub(r" {2,}", " ", unicodedata.normalize("NFC", value).strip())
    if not family or len(family) > 160:
        return None
    categories = [unicodedata.category(char)[:1] for char in family]
    if not any(category in ("L", "N") for category in categories):
        return None
    if any(
        char not in FONT_NAME_PUNCTUATION and category not in ("L", "M", "N")
        for char, category in zip(family, categories)
    ):
        return None
    return family


def canonical_font_family(role, value):
    legacy = (LEGACY_FONT_IDS.get(role) or {}).get(value, value)
    return normalize_font_family_name(legacy)


def infer_generic_family(family):
    if MONOSPACE_RE.search(family):
        return "monospace"
    if SERIF_RE.search(family):
        return "serif"
    return "sans-serif"


def unique_families(values):
    result = []
    seen = set()
    for value in values:
        key = value.casefold()
        if key in seen:
            continue
        seen.add(key)
        result.append(value)
    return result


def fallback_families(role, family):
    generic = infer_generic_family(family)
    if role == "cjk":
        fallbacks = (
            ["Noto Serif CJK SC", "SimSun"]
            if generic == "serif"
            else ["Microsoft YaHei", "Noto Sans CJK SC"]
        )
        families = unique_families([family, *fallbacks])
        return {"latex": families, "css": families, "generic": generic}
    if generic == "monospace":
        latex_fallbacks = ["Latin Modern Mono", "Consolas"]
        css_fallbacks = ["Consolas", "Courier New"]
    elif generic == "serif":
        latex_fallbacks = ["TeX Gyre Termes", "Times New Roman"]
        css_fallbacks = ["Times New Roman", "Georgia"]
    else:
        latex_fallbacks = ["TeX Gyre Heros", "Arial"]
        css_fallbacks = ["Arial", "Helvetica"]
    return {
        "latex": unique_families([family, *latex_fallbacks]),
        "css": unique_families([family, *css_fallbacks]),
        "generic": generic,
    }


def normalize_font_settings(value):
    source = value if isinstance(value, dict) else {}
    result = {}
    for role in ("cjk", "latin"):
        family = canonical_font_family(role, source.get(role))
        if family:
            result[role] = family
    return result


def get_font_option(role, font_id):
    if role not in ("cjk", "latin"):
        return None
    family = canonical_font_family(role, font_id)
    if not family:
        return None
    fallback = fallback_families(role, family)
    return {
        "latex": fallback["latex"],
        "css": fallback["css"],
        "generic": fallback["generic"],
    }


def get_latex_font_families(role, font_id):
    option = get_font_option(role, font_id)
    return list(option.get("latex") or []) if option else []


def get_html_font_configuration(fonts, template="calm"):
    selected = normalize_font_settings(fonts)
    if not selected:
        return None
    latin = get_font_option("latin", selected.get("latin"))
    cjk = get_font_option("cjk", selected.get("cjk"))
    latin_families = list(latin.get("css") or []) if latin else (
        ["Consolas", "Monaco", "Courier New"]
        if template == "vscode"
        else ["Segoe UI", "Arial", "Helvetica"]
    )
    cjk_families = list(cjk.get("css") or []) if cjk else [
        "Microsoft YaHei",
        "Noto Sans CJK SC",
    ]
    return {
        "latinFamilies": latin_families,
        "cjkFamilies": cjk_families,
        "generic": (latin or {}).get("generic") or (
            "monospace" if template == "vscode" else "sans-serif"
        ),
    }


def _quote_css_family(family):
    return f'"{family}"'


def get_typography_font_family(engine, template, fonts):
    selected = normalize_font_settings(fonts)
    if engine == "latex":
        latin = get_font_option("latin", selected.get("latin"))
        return ", ".join(latin.get("latex") or []) if latin else None
    if engine == "html":
        config = get_html_font_configuration(selected, template)
        if not config:
            return None
        families = []
        for family in config["latinFamilies"] + config["cjkFamilies"]:
            if family not in families:
                families.append(family)
        return ", ".join([*map(_quote_css_family, families), config["generic"]])
    return None
