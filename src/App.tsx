// 应用外壳：响应式侧边导航 + 页面切换（仓库状态位于侧栏底部）
import React, { useEffect, useState } from 'react'
import {
  LayoutDashboard,
  Database,
  GitBranch,
  FileText,
  GitPullRequestArrow,
  Settings,
  FolderGit2,
  DraftingCompass,
} from 'lucide-react'
import { api } from './api'
import { ToastProvider } from './toast'
import type { ProjectStatus } from './types'
import Dashboard from './pages/Dashboard'
import Entries from './pages/Entries'
import Variants from './pages/Variants'
import HistoryPage from './pages/History'
import GitBoard from './pages/GitBoard'
import Customizer from './pages/Customizer'
import SettingsPage from './pages/Settings'

const NAV = [
  { key: 'dashboard', label: '总览', icon: <LayoutDashboard size={16} /> },
  { key: 'entries', label: '信息管理', icon: <Database size={16} /> },
  { key: 'variants', label: '简历类型', icon: <GitBranch size={16} /> },
  { key: 'customizer', label: '简历定制', icon: <DraftingCompass size={16} /> },
  { key: 'pdf', label: 'PDF 预览', icon: <FileText size={16} /> },
  { key: 'git', label: 'Git 同步看板', icon: <GitPullRequestArrow size={16} /> },
  { key: 'settings', label: '设置', icon: <Settings size={16} /> },
]

const normalizePage = (value: string) => value === 'yaml' ? 'customizer' : value

function Shell() {
  const [page, setPage] = useState(() => {
    const h = normalizePage(window.location.hash.replace(/^#\/?/, ''))
    return NAV.some((n) => n.key === h) ? h : 'dashboard'
  })
  const [status, setStatus] = useState<ProjectStatus | null>(null)

  const go = (p: string) => {
    setPage(p)
    window.location.hash = `/${p}`
  }

  useEffect(() => {
    const onHash = () => {
      const raw = window.location.hash.replace(/^#\/?/, '')
      const h = normalizePage(raw)
      if (raw === 'yaml') window.history.replaceState(null, '', '#/customizer')
      if (NAV.some((n) => n.key === h)) setPage(h)
    }
    onHash()
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    const load = () =>
      api.get<ProjectStatus>('/api/project/status').then(setStatus).catch(() => setStatus(null))
    load()
    const t = setInterval(load, 15000)
    const onSaved = () => load()
    window.addEventListener('rm-settings-saved', onSaved)
    return () => {
      clearInterval(t)
      window.removeEventListener('rm-settings-saved', onSaved)
    }
  }, [])

  // Git 同步开关：关闭时隐藏看板入口；未加载到状态时按默认（开启）处理
  const gitSyncOn = status?.gitSyncEnabled !== false

  const syncTone = !status?.configured
    ? 'zinc'
    : !status.isRepo
      ? 'zinc'
      : (status.behind || 0) > 0
        ? 'red'
        : (status.ahead || 0) > 0 || (status.dirty || 0) > 0
          ? 'amber'
          : 'emerald'

  const toneCls: Record<string, string> = {
    zinc: 'bg-zinc-600',
    red: 'bg-red-500',
    amber: 'bg-amber-400',
    emerald: 'bg-emerald-400',
  }

  return (
    <div className="flex h-full">
      {/* 侧边栏 */}
      <aside className="flex w-16 shrink-0 flex-col border-r border-zinc-800/80 bg-zinc-950 lg:w-60">
        <div className="flex items-center justify-center px-3 py-4 lg:justify-start lg:gap-2.5 lg:px-5 lg:py-5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500 text-sm font-bold text-white shadow-lg shadow-black/30">
            RM
          </div>
          <div className="hidden lg:block">
            <p className="text-sm font-semibold text-zinc-100">Resume Manager</p>
            <p className="text-[10px] text-zinc-600">简历可视化管理系统</p>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 px-2 py-2 lg:px-3">
          {NAV.filter((n) => n.key !== 'git' || gitSyncOn).map((n) => (
            <button
              key={n.key}
              title={n.label}
              aria-label={n.label}
              onClick={() => go(n.key)}
              className={`flex min-h-10 w-full items-center justify-center gap-2.5 rounded-lg px-2 py-2 text-sm transition lg:justify-start lg:px-3 ${
                page === n.key
                  ? 'bg-indigo-500/15 text-indigo-200'
                  : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200'
              }`}
            >
              {n.icon}
              <span className="hidden lg:inline">{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="hidden border-t border-zinc-800/80 px-5 py-4 lg:block">
          <div className="flex items-center gap-2 text-[11px] text-zinc-600">
            <span className={`h-2 w-2 rounded-full ${toneCls[syncTone]} ${syncTone === 'emerald' ? 'animate-pulse' : ''}`} />
            {status?.configured ? (
              <span className="truncate">{status.isRepo ? `${status.branch || '?'} · ${status.dirty || 0} 改动` : '非 git 仓库'}</span>
            ) : (
              <span className="flex items-center gap-1"><FolderGit2 size={11} /> 未配置数据仓</span>
            )}
          </div>
        </div>
      </aside>

      {/* 主内容 */}
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className={`p-4 sm:p-6 lg:p-8 ${page === 'customizer' ? 'h-full' : ''}`}>
          {page === 'dashboard' && <Dashboard go={go} />}
          {page === 'entries' && <Entries />}
          {page === 'variants' && <Variants />}
          {page === 'customizer' && <Customizer />}
          {page === 'pdf' && <HistoryPage />}
          {page === 'git' && gitSyncOn && <GitBoard />}
          {page === 'git' && !gitSyncOn && (
            <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
              <GitPullRequestArrow size={36} className="text-zinc-700" />
              <div>
                <p className="text-base font-semibold text-zinc-300">Git 同步已关闭</p>
                <p className="mt-1 text-sm text-zinc-500">请在「设置」页开启「Git 同步」后使用同步看板。</p>
              </div>
            </div>
          )}
          {page === 'settings' && <SettingsPage />}
        </div>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  )
}
