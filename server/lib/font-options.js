import { getSystemFontCatalog, normalizeFontFamilyName } from './system-fonts.js'

const LEGACY_FONT_IDS = {
  cjk: {
    'microsoft-yahei': 'Microsoft YaHei',
    'noto-sans-cjk': 'Noto Sans CJK SC',
    'noto-serif-cjk': 'Noto Serif CJK SC',
    simsun: 'SimSun',
  },
  latin: {
    'linux-libertine': 'Linux Libertine O',
    arial: 'Arial',
    'times-new-roman': 'Times New Roman',
    'tex-gyre-heros': 'TeX Gyre Heros',
    consolas: 'Consolas',
  },
}

const FONT_GROUPS = [
  {
    key: 'cjk',
    label: '中文字体',
    sample: '中文排版示例',
    description: '控制中文、标点和全角字符',
    preferredDefaults: ['Microsoft YaHei', 'Noto Sans CJK SC', 'SimSun'],
  },
  {
    key: 'latin',
    label: '英文字体',
    sample: 'Typography Aa 123',
    description: '控制英文、数字和半角符号',
    preferredDefaults: ['Arial', 'Times New Roman', 'Consolas'],
  },
]

const GROUP_BY_KEY = new Map(FONT_GROUPS.map((group) => [group.key, group]))
const MONOSPACE_RE = /(mono|code|console|courier|typewriter|fixed|等宽)/i
const SERIF_RE = /(serif|times|roman|libertine|garamond|georgia|cambria|book|schoolbook|pagella|termes|antiqua|song|sung|sun|mincho|ming|kai|kaiti|fang|仿宋|宋体|楷体|明體|明朝)/i

const quoteCssFamily = (family) => `"${family}"`

function canonicalFontFamily(role, value) {
  if (typeof value !== 'string') return null
  const legacy = LEGACY_FONT_IDS[role]?.[value]
  return normalizeFontFamilyName(legacy || value)
}

function uniqueFamilies(values) {
  const seen = new Set()
  return values.filter((value) => {
    const key = value.toLocaleLowerCase('en-US')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function inferGenericFamily(family) {
  if (MONOSPACE_RE.test(family)) return 'monospace'
  if (SERIF_RE.test(family)) return 'serif'
  return 'sans-serif'
}

function fallbackFamilies(role, family) {
  const generic = inferGenericFamily(family)
  if (role === 'cjk') {
    const families = uniqueFamilies([
      family,
      ...(generic === 'serif'
        ? ['Noto Serif CJK SC', 'SimSun']
        : ['Microsoft YaHei', 'Noto Sans CJK SC']),
    ])
    return { generic, latex: families, css: families }
  }
  const latexFallbacks = generic === 'monospace'
    ? ['Latin Modern Mono', 'Consolas']
    : generic === 'serif'
      ? ['TeX Gyre Termes', 'Times New Roman']
      : ['TeX Gyre Heros', 'Arial']
  const cssFallbacks = generic === 'monospace'
    ? ['Consolas', 'Courier New']
    : generic === 'serif'
      ? ['Times New Roman', 'Georgia']
      : ['Arial', 'Helvetica']
  return {
    generic,
    latex: uniqueFamilies([family, ...latexFallbacks]),
    css: uniqueFamilies([family, ...cssFallbacks]),
  }
}

function fontDescription(family) {
  const generic = inferGenericFamily(family)
  if (generic === 'monospace') return '系统等宽字体'
  if (generic === 'serif') return '系统衬线字体'
  return '系统无衬线字体'
}

function findInstalledFamily(families, preferred) {
  const byName = new Map(families.map((family) => [family.toLocaleLowerCase('en-US'), family]))
  for (const family of preferred) {
    const installed = byName.get(family.toLocaleLowerCase('en-US'))
    if (installed) return installed
  }
  return families[0] || ''
}

export function normalizeFontSettings(value) {
  const input = value && typeof value === 'object' ? value : {}
  const result = {}
  for (const group of FONT_GROUPS) {
    const family = canonicalFontFamily(group.key, input[group.key])
    if (family) result[group.key] = family
  }
  return result
}

export function getFontOption(role, id) {
  if (!GROUP_BY_KEY.has(role)) return null
  const family = canonicalFontFamily(role, id)
  if (!family) return null
  const fallback = fallbackFamilies(role, family)
  return {
    id: family,
    label: family,
    description: fontDescription(family),
    latexFamilies: fallback.latex,
    cssFamilies: fallback.css,
    generic: fallback.generic,
  }
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

export async function getFontOptionsPayload({ refresh = false } = {}) {
  const catalog = await getSystemFontCatalog({ refresh })
  return FONT_GROUPS.map((group) => {
    const families = group.key === 'cjk' ? catalog.cjkFamilies : catalog.latinFamilies
    const defaultId = findInstalledFamily(families, group.preferredDefaults)
    return {
      kind: group.key,
      label: group.label,
      description: group.description,
      defaultId,
      source: catalog.source,
      detectedAt: catalog.detectedAt,
      systemCount: catalog.families.length,
      options: families.map((family) => {
        const option = getFontOption(group.key, family)
        return {
          id: option.id,
          label: option.label,
          description: option.description,
          sample: group.sample,
          cssFamilies: [...option.cssFamilies.map(quoteCssFamily), option.generic],
        }
      }),
    }
  })
}
