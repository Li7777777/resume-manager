// 数据存储：读写私有数据仓 data/*.yml 的信息全集
// 设计见 docs/DATA-FORMAT.md —— 每条条目可携带元数据（id/tags/notes/_*），
// 这些元数据只用于筛选与分类，绝不进入最终简历。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import yaml from 'js-yaml'

export const CATEGORIES = [
  'basics',
  'work',
  'education',
  'projects',
  'skills',
  'certificates',
  'interests',
]

export const CATEGORY_LABELS = {
  basics: '基础信息',
  work: '工作经历',
  education: '教育背景',
  projects: '项目经历',
  skills: '专业技能',
  certificates: '证书资质',
  interests: '兴趣爱好',
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
  for (const cat of CATEGORIES) {
    const entries = readCategory(repoPath, cat)
    out[cat] = entries
    if (cat === 'basics') continue
    for (const e of entries) {
      for (const t of e.tags || []) {
        tagCount[t] = (tagCount[t] || 0) + 1
      }
    }
  }
  return { entries: out, tagCount }
}
