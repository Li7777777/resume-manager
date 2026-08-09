// 全局设置状态（发布-订阅）：保存后立即广播，供所有依赖方热重载。
// 用法：
//   import { loadSettings, patchSettings, subscribeSettings, getSettingsSnapshot } from './settings'
//   loadSettings()                      // 初始化（GET /api/settings）
//   patchSettings({ localPdfBuild: v }) // 保存（PUT /api/settings），成功后广播
//   subscribeSettings(s => ...)         // 订阅变化（返回取消函数）
import { api } from './api'
import type { Settings } from './types'

let snapshot: Settings | null = null
const listeners = new Set<(s: Settings) => void>()

export function getSettingsSnapshot(): Settings | null {
  return snapshot
}

export function subscribeSettings(fn: (s: Settings) => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

function notify() {
  if (!snapshot) return
  for (const fn of listeners) fn(snapshot)
}

export async function loadSettings(): Promise<Settings> {
  const d = await api.get<{ settings: Settings }>('/api/settings')
  snapshot = d.settings
  notify()
  return snapshot
}

/** 保存设置并广播（热重载）；返回保存后的完整设置 */
export async function patchSettings(patch: Partial<Settings>): Promise<Settings> {
  const d = await api.put<{ settings: Settings }>('/api/settings', patch)
  snapshot = d.settings
  notify()
  return snapshot
}
