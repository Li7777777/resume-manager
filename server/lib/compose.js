// 组合引擎：按 scripts/variants.yml 配方从 data/ 信息全集动态组稿
// 与私有数据仓 templates/private-repo/scripts/compose.py 语义一致（JS 版），
// 数据格式规范见 docs/DATA-FORMAT.md
import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import { readCategory, dataFile, META_KEYS } from './data-store.js'
import { getSettings } from '../config.js'
import { loadStarsCache, parseGithubRepoUrl, formatStarCount } from './github-stars.js'
import { getTypographyFontFamily, normalizeFontSettings } from './font-options.js'

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

function normalizeProjectSummary(summary) {
  const text = toSummaryString(summary)?.trim()
  if (!text) return null
  // 已使用 Markdown 列表时原样保留缩进；旧纯文本按行迁移为顶级项目要点。
  if (/^\s{0,3}(?:[-+*]|\d+[.)])\s+/m.test(text)) return text
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `- ${line}`)
    .join('\n')
}

function normalizeProjectBackground(description) {
  const text = String(description || '').trim()
  if (!text) return null
  return /^项目背景[：:]/.test(text) ? text : `项目背景：${text}`
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

function collectAchievements(entry, wanted) {
  if (!(ACHIEVEMENTS_KEY in entry)) return null
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

function buildSummary(entry, wanted) {
  if (!(ACHIEVEMENTS_KEY in entry)) return entry.summary
  return collectAchievements(entry, wanted)
}

function compactSkills(items) {
  // 按细分方向（tags）分组：每个方向一行“方向：技能、技能”，跨方向技能同时出现在多行。
  const dirOrder = []
  const groups = new Map()
  for (const item of items) {
    const candidates = Array.isArray(item.keywords) && item.keywords.length ? item.keywords : [item.name]
    const names = candidates
      .map((c) => String(c || '').replace(/^(熟悉|掌握)\s*/, '').trim())
      .filter(Boolean)
    if (!names.length) continue
    const tags = Array.isArray(item.tags)
      ? item.tags.filter((t) => typeof t === 'string' && t.trim())
      : []
    const dirs = tags.length ? tags : ['通用']
    for (const dir of dirs) {
      if (!groups.has(dir)) {
        groups.set(dir, [])
        dirOrder.push(dir)
      }
      const list = groups.get(dir)
      for (const n of names) if (!list.includes(n)) list.push(n)
    }
  }
  return dirOrder
    .filter((dir) => (groups.get(dir) || []).length)
    .map((dir) => ({
      name: `${dir}：${groups.get(dir).join('、')}`,
      // schema 要求 level 为合法枚举；构建阶段会移除模板追加的“专家/大师”。
      level: 'Expert',
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

function composeBasics(repo) {
  const b = { ...readCategory(repo, 'basics') }
  // photo 是管理端构建元数据；YAMLResume basics schema 不接受该字段，由渲染后处理注入。
  delete b.photo
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
      // subtitle/source/role/stage 为管理端字段（副标题/来源/职责/阶段），schema 无此字段，不进简历
      if (k !== 'subtitle' && k !== 'source' && k !== 'role' && k !== 'stage' && !META_KEYS.has(k) && !k.startsWith('_') && k !== ACHIEVEMENTS_KEY) item[k] = v
    }
    // 字段别名：work 章节 schema 字段名是 name（数据里用 company 更自然）
    if ('company' in item && !('name' in item)) {
      item.name = item.company
      delete item.company
    }
    if (block === 'projects') {
      // 字段映射：数据 background → schema description；数据 tech → schema keywords
      if ('background' in item) {
        item.description = item.background
        delete item.background
      }
      if ('tech' in item) {
        item.keywords = item.tech
        delete item.tech
      }
      const summary = normalizeProjectSummary(e.summary)
      const achievements = collectAchievements(e, wanted)
      if (summary || achievements) {
        item.summary = [summary, achievements ? `**成果**\n${achievements}` : null].filter(Boolean).join('\n\n')
      } else {
        delete item.summary
      }
      const background = normalizeProjectBackground(item.description)
      if (background) item.description = background
      else delete item.description
    } else {
      const summary = buildSummary(e, wanted)
      if (summary != null) item.summary = toSummaryString(summary)
      else if (ACHIEVEMENTS_KEY in e) delete item.summary
    }
    // 项目背景保留完整原文；项目要点保留 Markdown 层级。
    out.push(item)
  }
  // 技能/兴趣分组需要方向（tags）元数据，因此直接用原始选中条目（含 tags）
  if (block === 'skills') return compactSkills(selected)
  if (block === 'interests') return compactInterests(selected)
  // GitHub star 徽章：正式发布前已刷新缓存，组合时统一读缓存（预览不发起网络请求）
  if (block === 'projects' && getSettings().starsEnabled !== false) injectGithubStars(out)
  return out
}

// 从本地缓存读取 star 数，将「[github|owner/repo|4.2k]」追加到项目名后
// （仅 GitHub 仓库链接且缓存命中；渲染器转为 GitHub Logo + 地址 + stars 徽章）
function injectGithubStars(items) {
  const cache = loadStarsCache()
  for (const it of items) {
    const ownerRepo = parseGithubRepoUrl(it.url)
    const hit = ownerRepo && cache[ownerRepo]
    const count = Number(hit?.count)
    if (!Number.isFinite(count) || count < 0) continue // 无缓存或无效值不显示；0 star 仅显示仓库地址
    const badge = count > 0 ? formatStarCount(count) : ''
    if (count > 0 && !badge) continue
    if (String(it.name || '').includes('[github|')) continue
    it.name = `${it.name} [github|${ownerRepo}|${badge}]`
  }
}

function applyLayoutFonts(layout, fonts) {
  const family = getTypographyFontFamily(layout.engine, layout.template, normalizeFontSettings(fonts))
  if (!family) return layout
  layout.typography = { ...(layout.typography || {}), fontFamily: family }
  return layout
}

function buildLayout(v, defaults) {
  const d = { ...((defaults && defaults.layout) || {}) }
  Object.assign(d, v.layout || {})
  const order = v.sectionOrder || (defaults && defaults.sectionOrder)
  if (Array.isArray(order) && order.length) {
    d.sections = { ...(d.sections || {}), order: [...order] }
  }
  if (d.engine === 'latex') d.advanced = { showUrls: false, ...(d.advanced || {}) }
  return applyLayoutFonts(d, v.fonts)
}

// 多引擎支持：v.htmlLayout（如 {engine:'html', template:'calm'}）存在时，
// 同时输出 HTML 布局 → yamlresume build 会同时产出 PDF 与 HTML
function buildLayouts(v, defaults) {
  const latex = buildLayout(v, defaults)
  const html = v.htmlLayout
  if (html && html.template) {
    const htmlLayout = { engine: 'html', template: html.template }
    if (html.typography && typeof html.typography === 'object') htmlLayout.typography = { ...html.typography }
    // html 引擎章节顺序同样生效
    const order = v.sectionOrder || (defaults && defaults.sectionOrder)
    if (Array.isArray(order) && order.length) {
      htmlLayout.sections = { ...(htmlLayout.sections || {}), order: [...order] }
    }
    return [latex, applyLayoutFonts(htmlLayout, v.fonts)]
  }
  return [latex]
}

export function composeVariant(repo, name, v, defaults) {
  const content = {}
  for (const [block, cfg] of Object.entries(v.blocks || {})) {
    if (block === 'basics') {
      const b = composeBasics(repo)
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
    const fonts = normalizeFontSettings(v.fonts)
    return { name, ...v, fonts: Object.keys(fonts).length ? fonts : undefined, matched: counts }
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
