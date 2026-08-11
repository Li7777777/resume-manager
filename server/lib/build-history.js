// 本机正式版历史：只记录用户显式发布的版本；临时预览不进入时间轴。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const FILE = path.join(os.homedir(), '.resume-manager', 'builds.json')

export function listBuilds(repoPath, limit = 50) {
  try {
    const arr = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    if (!Array.isArray(arr)) return []
    return arr.filter((b) => !repoPath || b.repoPath === repoPath).slice(0, limit)
  } catch {
    return []
  }
}

export function recordBuild(entry) {
  try {
    const list = listBuilds(null, 1000)
    list.unshift({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, ...entry })
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    fs.writeFileSync(FILE, JSON.stringify(list.slice(0, 200), null, 2))
    return list[0]
  } catch {
    return entry
  }
}
