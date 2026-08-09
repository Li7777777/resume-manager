// 配置管理：所有运行时配置存放在用户主目录（.resume-manager/settings.json）
// 绝不写入项目目录 —— 公开仓库里不含任何用户数据与令牌。
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

const CONFIG_DIR = path.join(os.homedir(), '.resume-manager')
const SETTINGS_FILE = path.join(CONFIG_DIR, 'settings.json')

export function getSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) || {}
  } catch {
    return {}
  }
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch }
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2))
  return next
}

export function getRepoPath() {
  const p = getSettings().repoPath
  return p ? path.resolve(p) : null
}

export const CONFIG_DIR_PATH = CONFIG_DIR
