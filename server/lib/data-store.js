// 数据存储：读写私有数据仓 data/*.yml 的信息全集。
// id/tags 参与组稿；标签库与分类显示配置随仓版本化（tags.yml / categories.yml），
// notes 等其余管理状态位于 ~/.resume-manager/repos/，不会写入私有仓。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import yaml from 'js-yaml'
import {
  deleteEntryNote,
  getEntryNote,
  getManagerState,
  setEntryNote,
  updateManagerState,
} from './manager-state.js'

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

const KEY_RE = /^[a-z][a-z0-9_-]*$/

// 标签库与分类显示配置随私有仓版本化：打包数据仓交给他人即可直接使用。
const TAGS_FILE = (repo) => path.join(repo, 'tags.yml')
const CATEGORIES_FILE = (repo) => path.join(repo, 'categories.yml')
const TAGS_HEADER =
  '# 管理端标签库：随本仓库版本化，打包分发后直接可用。\n' +
  '# tags=方向标签（参与组稿筛选）；subtags=细分标签（对应条目 keywords，展示用）。\n'
const CATEGORIES_HEADER =
  '# 管理端分类显示配置：随本仓库版本化，打包分发后直接可用。\n' +
  '# 分类名/排序/显隐保存于此；data/<key>.yml 存放分类内容。\n'

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

function readRepoCategories(repo) {
  const file = CATEGORIES_FILE(repo)
  if (!fs.existsSync(file)) return null
  const doc = yaml.load(fs.readFileSync(file, 'utf8')) || {}
  return Array.isArray(doc.categories) ? doc.categories : []
}

// 分类配置：私有仓 categories.yml 为唯一权威来源；
// 首次读取时从本机侧车或旧根目录 categories.json 一次性迁移。
function loadCategoriesConfig(repo) {
  const fromFile = readRepoCategories(repo)
  if (fromFile !== null) return fromFile
  let configured = getManagerState(repo).categories
  if (!Array.isArray(configured)) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(repo, 'categories.json'), 'utf8'))
      configured = Array.isArray(raw.categories) ? raw.categories : []
    } catch {
      configured = []
    }
  }
  saveCategories(repo, configured)
  return configured
}

// 读取私有仓 categories.yml 配置，并与 data/*.yml 自动发现结果合并。
export function getCategories(repo) {
  const configured = loadCategoriesConfig(repo)
  const list = []
  if (Array.isArray(configured)) {
    for (const c of configured) {
      if (c && KEY_RE.test(c.key)) {
        list.push({ key: c.key, label: c.label || c.key, visible: c.visible !== false })
      }
    }
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
  const seen = new Set()
  const clean = (Array.isArray(categories) ? categories : [])
    .filter((c) => {
      if (!c || typeof c.key !== 'string' || !KEY_RE.test(c.key) || seen.has(c.key)) return false
      seen.add(c.key)
      return true
    })
    .map((c) => ({ key: c.key, label: String(c.label || c.key).trim() || c.key, visible: c.visible !== false }))
  fs.mkdirSync(path.dirname(CATEGORIES_FILE(repo)), { recursive: true })
  fs.writeFileSync(CATEGORIES_FILE(repo), CATEGORIES_HEADER + yaml.dump({ categories: clean }, { noRefs: true, lineWidth: -1 }), 'utf8')
  return clean
}

/* ---------- 标签库（私有仓 tags.yml；随 Git 版本化） ---------- */
// 双组结构：tags=方向标签（组稿筛选）、subtags=细分标签（条目 keywords，展示用）
function readRepoTags(repo) {
  const file = TAGS_FILE(repo)
  if (!fs.existsSync(file)) return null
  const doc = yaml.load(fs.readFileSync(file, 'utf8')) || {}
  return {
    tags: Array.isArray(doc.tags) ? doc.tags : [],
    subtags: Array.isArray(doc.subtags) ? doc.subtags : [],
  }
}

function writeRepoTags(repo, doc) {
  fs.mkdirSync(path.dirname(TAGS_FILE(repo)), { recursive: true })
  fs.writeFileSync(TAGS_FILE(repo), TAGS_HEADER + yaml.dump({ tags: doc.tags || [], subtags: doc.subtags || [] }, { noRefs: true, lineWidth: -1 }), 'utf8')
}

function cleanTagList(tags) {
  return [...new Set(tags.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim()))]
}

// 方向标签库：tags.yml 的 tags 为唯一权威来源；首次读取从侧车或旧 tags.json 一次性迁移。
export function libTags(repo) {
  const fromFile = readRepoTags(repo)
  if (fromFile !== null) return fromFile.tags
  let tags = getManagerState(repo).tags
  if (!Array.isArray(tags)) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(repo, 'tags.json'), 'utf8'))
      tags = Array.isArray(raw.tags) ? raw.tags : []
    } catch {
      tags = []
    }
  }
  saveLibTags(repo, tags)
  return readRepoTags(repo).tags
}

// 细分标签库：tags.yml 的 subtags；首次读取从现有条目 keywords 聚合生成。
export function libSubTags(repo) {
  const fromFile = readRepoTags(repo)
  if (fromFile !== null) return fromFile.subtags
  const seen = new Set()
  for (const cat of getCategories(repo)) {
    if (cat.key === 'basics') continue
    for (const e of readCategory(repo, cat.key)) {
      for (const k of e.keywords || []) if (typeof k === 'string' && k.trim()) seen.add(k.trim())
    }
  }
  const subtags = [...seen]
  saveLibSubTags(repo, subtags)
  return subtags
}

export function saveLibTags(repo, tags) {
  const clean = cleanTagList(tags)
  const doc = readRepoTags(repo) || { tags: [], subtags: [] }
  writeRepoTags(repo, { ...doc, tags: clean })
  return clean
}

export function saveLibSubTags(repo, subtags) {
  const clean = cleanTagList(subtags)
  const doc = readRepoTags(repo) || { tags: [], subtags: [] }
  writeRepoTags(repo, { ...doc, subtags: clean })
  return clean
}

// 全条目重命名标签（from → to，合并去重），返回受影响条目数
export function renameTag(repo, from, to) {
  let affected = 0
  for (const cat of getCategories(repo)) {
    const entries = readCategory(repo, cat.key)
    if (cat.key === 'basics') continue
    let changed = false
    for (const e of entries) {
      if (Array.isArray(e.tags) && e.tags.includes(from)) {
        e.tags = [...new Set(e.tags.map((t) => (t === from ? to : t)))]
        changed = true
      }
    }
    if (changed) {
      writeCategory(repo, cat.key, entries)
      affected += entries.length
    }
  }
  // 更新标签库
  const lib = libTags(repo)
  if (lib.includes(from)) {
    saveLibTags(repo, lib.map((t) => (t === from ? to : t)))
  }
  return affected
}

// 全条目删除标签，返回受影响条目数
export function deleteTag(repo, tag) {
  let affected = 0
  for (const cat of getCategories(repo)) {
    const entries = readCategory(repo, cat.key)
    if (cat.key === 'basics') continue
    let changed = false
    for (const e of entries) {
      if (Array.isArray(e.tags) && e.tags.includes(tag)) {
        e.tags = e.tags.filter((t) => t !== tag)
        changed = true
      }
    }
    if (changed) {
      writeCategory(repo, cat.key, entries)
      affected += entries.length
    }
  }
  saveLibTags(repo, libTags(repo).filter((t) => t !== tag))
  return affected
}

// 全条目重命名细分标签（同步 keywords），返回受影响条目数
// 细分标签对应条目 keywords 字段（展示用，不参与组稿筛选）
export function renameSubTag(repo, from, to) {
  let affected = 0
  for (const cat of getCategories(repo)) {
    const entries = readCategory(repo, cat.key)
    if (cat.key === 'basics') continue
    let changed = false
    for (const e of entries) {
      if (Array.isArray(e.keywords) && e.keywords.includes(from)) {
        e.keywords = [...new Set(e.keywords.map((k) => (k === from ? to : k)))]
        changed = true
      }
    }
    if (changed) {
      writeCategory(repo, cat.key, entries)
      affected += entries.length
    }
  }
  const lib = libSubTags(repo)
  if (lib.includes(from)) {
    saveLibSubTags(repo, lib.map((k) => (k === from ? to : k)))
  }
  return affected
}

// 全条目删除细分标签（同步 keywords），返回受影响条目数
export function deleteSubTag(repo, tag) {
  let affected = 0
  for (const cat of getCategories(repo)) {
    const entries = readCategory(repo, cat.key)
    if (cat.key === 'basics') continue
    let changed = false
    for (const e of entries) {
      if (Array.isArray(e.keywords) && e.keywords.includes(tag)) {
        e.keywords = e.keywords.filter((k) => k !== tag)
        changed = true
      }
    }
    if (changed) {
      writeCategory(repo, cat.key, entries)
      affected += entries.length
    }
  }
  saveLibSubTags(repo, libSubTags(repo).filter((k) => k !== tag))
  return affected
}
// 组稿时剥除的键；notes 仅用于兼容迁移前数据。
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
  if (category === 'basics') {
    const note = getEntryNote(repoPath, category, 'basics')
    delete raw.notes
    return note ? { ...raw, notes: note } : raw
  }
  const list = Array.isArray(raw) ? raw : []
  // 补齐 id/tags 并从本机侧车恢复备注，保证后续操作稳定
  let idAdded = false
  for (const e of list) {
    if (e && typeof e === 'object') {
      if (!e.id) {
        e.id = genId()
        idAdded = true
      }
      if (!Array.isArray(e.tags)) e.tags = []
      const note = getEntryNote(repoPath, category, e.id)
      if (note) e.notes = note
      else delete e.notes
    }
  }
  // 持久化新补的 id：避免每次读取生成不同随机 id，导致按 id 删除/编辑失效
  if (idAdded) writeCategory(repoPath, category, list)
  return list
}

export function writeCategory(repoPath, category, entries) {
  const file = dataFile(repoPath, category)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const persisted = Array.isArray(entries)
    ? entries.map((entry) => {
        if (!entry || typeof entry !== 'object') return entry
        const { notes, ...resumeData } = entry
        return resumeData
      })
    : entries && typeof entries === 'object'
      ? Object.fromEntries(Object.entries(entries).filter(([key]) => key !== 'notes'))
      : entries
  fs.writeFileSync(file, yaml.dump(persisted, { noRefs: true, lineWidth: -1, sortKeys: false }), 'utf8')
}

export function getEntry(repoPath, category, id) {
  const list = readCategory(repoPath, category)
  if (category === 'basics') return list
  return list.find((e) => e.id === id)
}

export function upsertEntry(repoPath, category, entry) {
  if (category === 'basics') {
    const current = readCategory(repoPath, category)
    const { notes, id: ignoredId, ...resumeData } = entry
    const { notes: ignoredCurrentNotes, id: ignoredCurrentId, ...currentResumeData } = current
    setEntryNote(repoPath, category, 'basics', notes)
    if (JSON.stringify(currentResumeData) !== JSON.stringify(resumeData)) {
      writeCategory(repoPath, category, resumeData)
    }
    return { ...resumeData, ...(notes ? { notes } : {}), id: 'basics' }
  }
  const list = readCategory(repoPath, category)
  const id = entry.id || genId()
  const idx = list.findIndex((e) => e.id === id)
  const { notes, ...resumeData } = entry
  const next = { ...resumeData, id }
  setEntryNote(repoPath, category, id, notes)
  if (idx >= 0) {
    const { notes: ignoredCurrentNotes, ...currentResumeData } = list[idx]
    list[idx] = next
    if (JSON.stringify(currentResumeData) !== JSON.stringify(next)) writeCategory(repoPath, category, list)
  } else {
    list.push(next)
    writeCategory(repoPath, category, list)
  }
  // 条目中新出现的标签自动加入标签库（方向→tags、细分→subtags）
  syncEntryTagsToLibrary(repoPath, entry)
  return { ...next, ...(notes ? { notes } : {}) }
}

// 条目保存后，把不在库中的方向标签/细分标签自动加入标签库
function syncEntryTagsToLibrary(repoPath, entry) {
  if (!entry || typeof entry !== 'object') return
  const dirTags = Array.isArray(entry.tags) ? entry.tags.filter((t) => typeof t === 'string' && t.trim()) : []
  if (dirTags.length) {
    const lib = libTags(repoPath)
    const missing = dirTags.filter((t) => !lib.includes(t))
    if (missing.length) saveLibTags(repoPath, [...lib, ...missing])
  }
  const subTags = Array.isArray(entry.keywords) ? entry.keywords.filter((k) => typeof k === 'string' && k.trim()) : []
  if (subTags.length) {
    const lib = libSubTags(repoPath)
    const missing = subTags.filter((k) => !lib.includes(k))
    if (missing.length) saveLibSubTags(repoPath, [...lib, ...missing])
  }
}

// 按 id 顺序重排分类条目（未列出的 id 保持原相对顺序追加在末尾）
export function reorderEntries(repoPath, category, ids) {
  if (category === 'basics') throw new Error('基础信息不支持排序')
  const list = readCategory(repoPath, category)
  const byId = new Map(list.filter((e) => e && e.id).map((e) => [e.id, e]))
  const next = []
  for (const id of ids) {
    const e = byId.get(id)
    if (e) {
      next.push(e)
      byId.delete(id)
    }
  }
  for (const e of list) {
    if (e && byId.has(e.id)) next.push(e)
  }
  writeCategory(repoPath, category, next)
  return next
}

export function deleteEntry(repoPath, category, id) {
  const list = readCategory(repoPath, category)
  const idx = list.findIndex((e) => e.id === id)
  if (idx < 0) return false
  list.splice(idx, 1)
  deleteEntryNote(repoPath, category, id)
  writeCategory(repoPath, category, list)
  return true
}

// 汇总所有条目（用于统计与标签云）
export function allEntries(repoPath) {
  const out = {}
  const tagCount = {}
  const subTagCount = {}
  for (const cat of getCategories(repoPath)) {
    if (cat.visible === false) continue
    const entries = readCategory(repoPath, cat.key)
    out[cat.key] = entries
    if (cat.key === 'basics') continue
    for (const e of entries) {
      for (const t of e.tags || []) {
        tagCount[t] = (tagCount[t] || 0) + 1
      }
      for (const k of e.keywords || []) {
        subTagCount[k] = (subTagCount[k] || 0) + 1
      }
    }
  }
  return { entries: out, tagCount, subTagCount }
}
