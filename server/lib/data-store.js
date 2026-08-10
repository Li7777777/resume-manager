// 数据存储：读写私有数据仓 data/*.yml 的信息全集
// 设计见 docs/DATA-FORMAT.md —— 每条条目可携带元数据（id/tags/notes/_*），
// 这些元数据只用于筛选与分类，绝不进入最终简历。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import yaml from 'js-yaml'

export const DEFAULT_CATEGORIES = [
  'basics',
  'work',
  'education',
  'projects',
  'skills',
  'certificates',
  'interests',
]

export const DEFAULT_CATEGORY_LABELS = {
  basics: '基础信息',
  work: '工作经历',
  education: '教育背景',
  projects: '项目经历',
  skills: '专业技能',
  certificates: '证书资质',
  interests: '兴趣爱好',
}

export const CATEGORIES = DEFAULT_CATEGORIES

export const CATEGORY_LABELS = DEFAULT_CATEGORY_LABELS

const CATEGORIES_FILE = 'categories.json'
const KEY_RE = /^[a-z][a-z0-9_-]*$/

// 分类定义（私有仓 categories.json）：[{key, label, visible}]
function categoriesFile(repo) {
  return path.join(repo, CATEGORIES_FILE)
}

// 扫描 data/*.yml 自动发现的分类 key（未配置时兜底）
export function scanDataKeys(repo) {
  const dir = path.join(repo, 'data')
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.yml'))
      .map((f) => f.replace(/\.yml$/, ''))
      .filter((k) => KEY_RE.test(k))
  } catch {
    return []
  }
}

// 读取私有仓分类配置（动态）：categories.json + data/*.yml 自动发现合并
// 返回 [{key, label, visible}]（visible 默认 true）
export function getCategories(repo) {
  const list = []
  try {
    const raw = JSON.parse(fs.readFileSync(categoriesFile(repo), 'utf8'))
    if (Array.isArray(raw.categories)) {
      for (const c of raw.categories) {
        if (c && KEY_RE.test(c.key)) {
          list.push({ key: c.key, label: (c.label || c.key), visible: c.visible !== false })
        }
      }
    }
  } catch {
    /* 无配置文件：用默认分类 */
  }
  const keys = new Set(list.map((c) => c.key))
  // 未配置时用默认 7 类兜底
  if (list.length === 0) {
    for (const k of DEFAULT_CATEGORIES) {
      list.push({ key: k, label: DEFAULT_CATEGORY_LABELS[k] || k, visible: true })
      keys.add(k)
    }
  }
  // data/*.yml 自动发现（未在配置中的新分类追加，label 取默认或 key）
  for (const k of scanDataKeys(repo)) {
    if (!keys.has(k)) {
      list.push({ key: k, label: DEFAULT_CATEGORY_LABELS[k] || k, visible: true })
      keys.add(k)
    }
  }
  return list
}

export function saveCategories(repo, categories) {
  fs.mkdirSync(repo, { recursive: true })
  fs.writeFileSync(
    categoriesFile(repo),
    JSON.stringify({ categories }, null, 2) + '\n',
    'utf8',
  )
}
// 元数据键：不进入最终简历
export const META_KEYS = new Set(['id', 'tags', 'notes'])

export function dataFile(repoPath, category) {
  return path.join(repoPath, 'data', `${category}.yml`)
}

export function isMetaKey(key) {
  return META_KEYS.has(key) || key.startsWith('_')
}

export function stripMeta(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry
  const out = {}
  for (const [k, v] of Object.entries(entry)) {
    if (!isMetaKey(k)) out[k] = v
  }
  return out
}

export function genId() {
  return crypto.randomUUID().slice(0, 8)
}

// 读取某个分类的条目；basics 返回单对象，其余返回数组
export function readCategory(repoPath, category) {
  const file = dataFile(repoPath, category)
  if (!fs.existsSync(file)) return category === 'basics' ? {} : []
  const raw = yaml.load(fs.readFileSync(file, 'utf8')) || {}
  if (category === 'basics') return raw
  const list = Array.isArray(raw) ? raw : []
  // 补齐 id 与 tags，保证后续操作稳定
  for (const e of list) {
    if (e && typeof e === 'object') {
      if (!e.id) e.id = genId()
      if (!Array.isArray(e.tags)) e.tags = []
    }
  }
  return list
}

export function writeCategory(repoPath, category, entries) {
  const file = dataFile(repoPath, category)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, yaml.dump(entries, { noRefs: true, lineWidth: -1, sortKeys: false }), 'utf8')
}

export function getEntry(repoPath, category, id) {
  const list = readCategory(repoPath, category)
  if (category === 'basics') return list
  return list.find((e) => e.id === id)
}

export function upsertEntry(repoPath, category, entry) {
  if (category === 'basics') {
    writeCategory(repoPath, category, entry)
    return { ...entry, id: 'basics' }
  }
  const list = readCategory(repoPath, category)
  const id = entry.id || genId()
  const idx = list.findIndex((e) => e.id === id)
  const next = { ...entry, id }
  if (idx >= 0) list[idx] = next
  else list.push(next)
  writeCategory(repoPath, category, list)
  return next
}

export function deleteEntry(repoPath, category, id) {
  const list = readCategory(repoPath, category)
  const idx = list.findIndex((e) => e.id === id)
  if (idx < 0) return false
  list.splice(idx, 1)
  writeCategory(repoPath, category, list)
  return true
}

// 汇总所有条目（用于统计与标签云）
export function allEntries(repoPath) {
  const out = {}
  const tagCount = {}
  for (const cat of getCategories(repoPath)) {
    if (cat.visible === false) continue
    const entries = readCategory(repoPath, cat.key)
    out[cat.key] = entries
    if (cat.key === 'basics') continue
    for (const e of entries) {
      for (const t of e.tags || []) {
        tagCount[t] = (tagCount[t] || 0) + 1
      }
    }
  }
  return { entries: out, tagCount }
}
