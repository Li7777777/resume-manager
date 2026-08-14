// 组合引擎：按 scripts/variants.yml 配方从 data/ 信息全集动态组稿
// 与私有数据仓 templates/private-repo/scripts/compose.py 语义一致（JS 版），
// 数据格式规范见 docs/DATA-FORMAT.md
import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import { readCategory, dataFile, META_KEYS } from './data-store.js'

const ACHIEVEMENTS_KEY = 'achievements'
const VARIANTS_FILE = (repo) => path.join(repo, 'scripts', 'variants.yml')
const OUT_DIR = (repo) => path.join(repo, 'resumes')

const HEADER = [
  '# 本文件由 resume-manager 组合引擎生成，请勿手改。',
  '# 改信息 -> data/；改筛选/模板/章节顺序 -> scripts/variants.yml',
  '---',
  '',
].join('\n')

export function loadVariantsDoc(repo) {
  const file = VARIANTS_FILE(repo)
  if (!fs.existsSync(file)) return { defaults: {}, variants: {} }
  return yaml.load(fs.readFileSync(file, 'utf8')) || { defaults: {}, variants: {} }
}

function toSummaryString(summary) {
  if (summary == null) return null
  if (typeof summary === 'string') return summary
  if (Array.isArray(summary)) {
    const lines = summary.filter(Boolean).map((s) => `- ${s}`)
    return lines.length ? lines.join('\n') : null
  }
  return String(summary)
}

function tagOverlap(itemTags, wanted) {
  if (!wanted || wanted.length === 0) return true
  if (!itemTags || itemTags.length === 0) return false
  return wanted.some((t) => itemTags.includes(t))
}

function selectEntries(entries, cfg) {
  if (!entries || entries.length === 0) return []
  if (!cfg || cfg.include === 'all') return [...entries]
  const ids = cfg.ids
  const tags = cfg.tags
  const result = []
  for (const e of entries) {
    if (Array.isArray(ids)) {
      if (ids.includes(e.id)) result.push(e)
      continue
    }
    if (tagOverlap(e.tags, tags)) result.push(e)
  }
  return result
}

function buildSummary(entry, wanted) {
  if (!(ACHIEVEMENTS_KEY in entry)) return entry.summary
  const items = []
  for (const a of entry[ACHIEVEMENTS_KEY] || []) {
    if (a && typeof a === 'object') {
      // 无标签成就 = 通用，保留；有标签的必须与方向命中
      if (wanted && wanted.length && a.tags && a.tags.length && !tagOverlap(a.tags, wanted)) continue
      if (a.text) items.push(String(a.text))
    } else if (a != null) {
      items.push(String(a))
    }
  }
  return items.length ? items.map((t) => `- ${t}`).join('\n') : null
}

function compactSkills(items) {
  const groups = new Map([['掌握', []], ['熟悉', []]])
  for (const item of items) {
    const label = item.level === 'Master' ? '掌握' : '熟悉'
    const candidates = Array.isArray(item.keywords) && item.keywords.length ? item.keywords : [item.name]
    for (const candidate of candidates) {
      const name = String(candidate || '').replace(/^(熟悉|掌握)\s*/, '').trim()
      if (name && !groups.get(label).includes(name)) groups.get(label).push(name)
    }
  }
  return [...groups.entries()]
    .filter(([, names]) => names.length)
    .map(([label, names]) => ({
      name: `${label} ${names.join('、')}`,
      // schema 要求 level 为合法枚举；构建阶段会隐藏模板自动追加的“大师/专家”。
      level: label === '掌握' ? 'Master' : 'Expert',
      keywords: [],
    }))
}

function compactInterests(items) {
  const names = []
  for (const item of items) {
    const name = String(item.name || '').trim()
    if (name && !names.includes(name)) names.push(name)
  }
  return names.length ? [{ name: names.join('、'), keywords: [] }] : []
}

function composeBasics(repo, overrides) {
  const b = { ...readCategory(repo, 'basics') }
  const ov = (overrides && overrides.basics) || {}
  Object.assign(b, ov)
  b.summary = toSummaryString(b.summary)
  return Object.keys(b).length ? b : null
}

function composeList(repo, block, cfg) {
  const entries = readCategory(repo, block)
  const selected = selectEntries(entries, cfg)
  if (!selected.length) return null
  const wanted = (cfg && cfg.tags) || []
  const out = []
  for (const e of selected) {
    const item = {}
    for (const [k, v] of Object.entries(e)) {
      // subtitle/stage 为管理端字段（副标题/阶段），schema 无此字段，不进简历
      if (k !== 'subtitle' && k !== 'stage' && !META_KEYS.has(k) && !k.startsWith('_') && k !== ACHIEVEMENTS_KEY) item[k] = v
    }
    // 字段别名：work 章节 schema 字段名是 name（数据里用 company 更自然）
    if ('company' in item && !('name' in item)) {
      item.name = item.company
      delete item.company
    }
    const summary = buildSummary(e, wanted)
    if (summary != null) item.summary = toSummaryString(summary)
    if (block === 'projects' && typeof item.description === 'string' && item.description.length > 40) {
      item.description = `${item.description.slice(0, 39)}…`
    }
    if (Array.isArray(item.summary)) item.summary = toSummaryString(item.summary)
    out.push(item)
  }
  if (block === 'skills') return compactSkills(out)
  if (block === 'interests') return compactInterests(out)
  return out
}

function buildLayout(v, defaults) {
  const d = { ...((defaults && defaults.layout) || {}) }
  Object.assign(d, v.layout || {})
  const order = v.sectionOrder || (defaults && defaults.sectionOrder)
  if (Array.isArray(order) && order.length) {
    d.sections = { ...(d.sections || {}), order: [...order] }
  }
  if (d.engine === 'latex') d.advanced = { showUrls: false, ...(d.advanced || {}) }
  return d
}

// 多引擎支持：v.htmlLayout（如 {engine:'html', template:'calm'}）存在时，
// 同时输出 HTML 布局 → yamlresume build 会同时产出 PDF 与 HTML
function buildLayouts(v, defaults) {
  const latex = buildLayout(v, defaults)
  const html = v.htmlLayout
  if (html && html.template) {
    const htmlLayout = { engine: 'html', template: html.template }
    if (html.typography?.fontSize) htmlLayout.typography = { fontSize: html.typography.fontSize }
    // html 引擎章节顺序同样生效
    const order = v.sectionOrder || (defaults && defaults.sectionOrder)
    if (Array.isArray(order) && order.length) {
      htmlLayout.sections = { ...(htmlLayout.sections || {}), order: [...order] }
    }
    return [latex, htmlLayout]
  }
  return [latex]
}

export function composeVariant(repo, name, v, defaults) {
  const content = {}
  for (const [block, cfg] of Object.entries(v.blocks || {})) {
    if (block === 'basics') {
      const b = composeBasics(repo, v.overrides)
      if (b) content.basics = b
    } else {
      const items = composeList(repo, block, cfg)
      if (items) content[block] = items
    }
  }
  return {
    content,
    locale: { language: v.locale || (defaults && defaults.locale) || 'zh-hans' },
    layouts: buildLayouts(v, defaults),
  }
}

export function listVariants(repo) {
  const doc = loadVariantsDoc(repo)
  const defaults = doc.defaults || {}
  const names = Object.keys(doc.variants || {})
  return names.map((name) => {
    const v = doc.variants[name]
    // 统计每个方向将命中多少条目（预览用）
    const counts = {}
    for (const [block, cfg] of Object.entries(v.blocks || {})) {
      if (block === 'basics') continue
      const n = selectEntries(readCategory(repo, block), cfg).length
      if (n > 0) counts[block] = n
    }
    return { name, ...v, matched: counts }
  })
}

export function saveVariantsDoc(repo, doc) {
  const file = VARIANTS_FILE(repo)
  const clean = structuredClone(doc || { defaults: {}, variants: {} })
  clean.defaults = clean.defaults || {}
  clean.variants = clean.variants || {}
  for (const variant of Object.values(clean.variants)) {
    if (!variant || typeof variant !== 'object') continue
    delete variant.name
    delete variant.label
    delete variant.branch
    delete variant.matched
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, yaml.dump(clean, { noRefs: true, lineWidth: -1, sortKeys: false }), 'utf8')
}

export function generateVariant(repo, name, variant, defaults = {}) {
  if (!variant) return null
  fs.mkdirSync(OUT_DIR(repo), { recursive: true })
  const resume = composeVariant(repo, name, variant, defaults)
  const text = HEADER + yaml.dump(resume, { noRefs: true, lineWidth: -1, sortKeys: false })
    .replace(/: null\s*$/gm, ':')
  fs.writeFileSync(path.join(OUT_DIR(repo), `${name}.yml`), text, 'utf8')
  return name
}

export function generateAll(repo, only) {
  const doc = loadVariantsDoc(repo)
  const defaults = doc.defaults || {}
  const variants = doc.variants || {}
  const names = only ? [only] : Object.keys(variants)
  const generated = []
  for (const name of names) {
    if (generateVariant(repo, name, variants[name], defaults)) generated.push(name)
  }
  return generated
}

export { dataFile }
