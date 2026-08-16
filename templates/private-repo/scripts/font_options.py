"""Shared font presets for private-repository composition and postprocessing."""

FONT_GROUPS = {
    "cjk": {
        "options": {
            "microsoft-yahei": {
                "latex": ["Microsoft YaHei", "Noto Sans CJK SC"],
                "css": ["Microsoft YaHei", "Noto Sans CJK SC"],
                "generic": "sans-serif",
            },
            "noto-sans-cjk": {
                "latex": ["Noto Sans CJK SC", "Microsoft YaHei"],
                "css": ["Noto Sans CJK SC", "Microsoft YaHei"],
                "generic": "sans-serif",
            },
            "noto-serif-cjk": {
                "latex": ["Noto Serif CJK SC", "SimSun"],
                "css": ["Noto Serif CJK SC", "SimSun"],
                "generic": "serif",
            },
            "simsun": {
                "latex": ["SimSun", "Noto Serif CJK SC"],
                "css": ["SimSun", "Noto Serif CJK SC"],
                "generic": "serif",
            },
        },
    },
    "latin": {
        "options": {
            "linux-libertine": {
                "latex": ["Linux Libertine O", "Linux Libertine", "TeX Gyre Termes"],
                "css": ["Linux Libertine O", "Linux Libertine", "Georgia"],
                "generic": "serif",
            },
            "arial": {
                "latex": ["Arial", "TeX Gyre Heros"],
                "css": ["Arial", "Helvetica"],
                "generic": "sans-serif",
            },
            "times-new-roman": {
                "latex": ["Times New Roman", "TeX Gyre Termes"],
                "css": ["Times New Roman", "Times"],
                "generic": "serif",
            },
            "tex-gyre-heros": {
                "latex": ["TeX Gyre Heros", "Arial"],
                "css": ["TeX Gyre Heros", "Arial", "Helvetica"],
                "generic": "sans-serif",
            },
            "consolas": {
                "latex": ["Consolas", "Latin Modern Mono"],
                "css": ["Consolas", "Monaco", "Courier New"],
                "generic": "monospace",
            },
        },
    },
}


def normalize_font_settings(value):
    source = value if isinstance(value, dict) else {}
    result = {}
    for role, group in FONT_GROUPS.items():
        font_id = source.get(role)
        if isinstance(font_id, str) and font_id in group["options"]:
            result[role] = font_id
    return result


def get_font_option(role, font_id):
    group = FONT_GROUPS.get(role) or {}
    return (group.get("options") or {}).get(font_id)


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
    return f'"{family}"' if any(char.isspace() for char in family) else family


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
