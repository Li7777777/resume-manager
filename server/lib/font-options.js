const FONT_GROUPS = [
  {
    key: 'cjk',
    label: '中文字体',
    defaultId: 'microsoft-yahei',
    sample: '中文排版示例',
    options: [
      {
        id: 'microsoft-yahei',
        label: '微软雅黑',
        description: '现代无衬线，适合屏幕阅读',
        latexFamilies: ['Microsoft YaHei', 'Noto Sans CJK SC'],
        cssFamilies: ['Microsoft YaHei', 'Noto Sans CJK SC'],
        generic: 'sans-serif',
      },
      {
        id: 'noto-sans-cjk',
        label: 'Noto Sans CJK',
        description: '跨平台无衬线，字形覆盖完整',
        latexFamilies: ['Noto Sans CJK SC', 'Microsoft YaHei'],
        cssFamilies: ['Noto Sans CJK SC', 'Microsoft YaHei'],
        generic: 'sans-serif',
      },
      {
        id: 'noto-serif-cjk',
        label: 'Noto Serif CJK',
        description: '稳重衬线，适合正式简历',
        latexFamilies: ['Noto Serif CJK SC', 'SimSun'],
        cssFamilies: ['Noto Serif CJK SC', 'SimSun'],
        generic: 'serif',
      },
      {
        id: 'simsun',
        label: '宋体',
        description: '传统中文正文风格',
        latexFamilies: ['SimSun', 'Noto Serif CJK SC'],
        cssFamilies: ['SimSun', 'Noto Serif CJK SC'],
        generic: 'serif',
      },
    ],
  },
  {
    key: 'latin',
    label: '英文字体',
    defaultId: 'linux-libertine',
    sample: 'Typography Aa 123',
    options: [
      {
        id: 'linux-libertine',
        label: 'Linux Libertine',
        description: '经典开源衬线，当前 PDF 默认',
        latexFamilies: ['Linux Libertine O', 'Linux Libertine', 'TeX Gyre Termes'],
        cssFamilies: ['Linux Libertine O', 'Linux Libertine', 'Georgia'],
        generic: 'serif',
      },
      {
        id: 'arial',
        label: 'Arial',
        description: '简洁通用的无衬线字体',
        latexFamilies: ['Arial', 'TeX Gyre Heros'],
        cssFamilies: ['Arial', 'Helvetica'],
        generic: 'sans-serif',
      },
      {
        id: 'times-new-roman',
        label: 'Times New Roman',
        description: '传统正式的衬线字体',
        latexFamilies: ['Times New Roman', 'TeX Gyre Termes'],
        cssFamilies: ['Times New Roman', 'Times'],
        generic: 'serif',
      },
      {
        id: 'tex-gyre-heros',
        label: 'TeX Gyre Heros',
        description: '跨平台 Helvetica 风格无衬线',
        latexFamilies: ['TeX Gyre Heros', 'Arial'],
        cssFamilies: ['TeX Gyre Heros', 'Arial', 'Helvetica'],
        generic: 'sans-serif',
      },
      {
        id: 'consolas',
        label: 'Consolas',
        description: '等宽字体，适合技术岗位',
        latexFamilies: ['Consolas', 'Latin Modern Mono'],
        cssFamilies: ['Consolas', 'Monaco', 'Courier New'],
        generic: 'monospace',
      },
    ],
  },
]

const GROUP_BY_KEY = new Map(FONT_GROUPS.map((group) => [group.key, group]))

const quoteCssFamily = (family) => (/\s/.test(family) ? `"${family}"` : family)

export function normalizeFontSettings(value) {
  const input = value && typeof value === 'object' ? value : {}
  const result = {}
  for (const group of FONT_GROUPS) {
    const id = input[group.key]
    if (typeof id === 'string' && group.options.some((option) => option.id === id)) result[group.key] = id
  }
  return result
}

export function getFontOption(role, id) {
  const group = GROUP_BY_KEY.get(role)
  return group?.options.find((option) => option.id === id) || null
}

export function getLatexFontFamilies(role, id) {
  return getFontOption(role, id)?.latexFamilies || []
}

export function getHtmlFontConfiguration(fonts, template = 'calm') {
  const selected = normalizeFontSettings(fonts)
  if (Object.keys(selected).length === 0) return null
  const latin = getFontOption('latin', selected.latin)
  const cjk = getFontOption('cjk', selected.cjk)
  const latinFamilies = latin?.cssFamilies || (template === 'vscode'
    ? ['Consolas', 'Monaco', 'Courier New']
    : ['Segoe UI', 'Arial', 'Helvetica'])
  const cjkFamilies = cjk?.cssFamilies || ['Microsoft YaHei', 'Noto Sans CJK SC']
  return {
    latinFamilies,
    cjkFamilies,
    generic: latin?.generic || (template === 'vscode' ? 'monospace' : 'sans-serif'),
  }
}

export function getTypographyFontFamily(engine, template, fonts) {
  const selected = normalizeFontSettings(fonts)
  if (engine === 'latex') {
    const latin = getFontOption('latin', selected.latin)
    return latin ? latin.latexFamilies.join(', ') : null
  }
  if (engine === 'html') {
    const config = getHtmlFontConfiguration(selected, template)
    if (!config) return null
    return [...config.latinFamilies, ...config.cjkFamilies]
      .filter((family, index, list) => list.indexOf(family) === index)
      .map(quoteCssFamily)
      .concat(config.generic)
      .join(', ')
  }
  return null
}

export function getFontOptionsPayload() {
  return FONT_GROUPS.map((group) => ({
    kind: group.key,
    label: group.label,
    description: group.key === 'cjk' ? '控制中文、标点和全角字符' : '控制英文、数字和半角符号',
    defaultId: group.defaultId,
    options: group.options.map((option) => ({
      id: option.id,
      label: option.label,
      description: option.description,
      sample: group.sample,
      cssFamilies: [...option.cssFamilies, option.generic],
    })),
  }))
}
