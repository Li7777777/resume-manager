// 应用外壳：侧边导航 + 顶栏（含仓库同步状态指示灯）+ 页面切换
import React, { useEffect, useState } from 'react'
import {
  LayoutDashboard,
  Database,
  GitBranch,
  FileCode2,
  FileText,
  GitPullRequestArrow,
  LayoutTemplate,
  Settings,
  ShieldCheck,
  FolderGit2,
  History,
} from 'lucide-react'
import { api } from './api'
import { ToastProvider } from './toast'
import type { ProjectStatus } from './types'
import Dashboard from './pages/Dashboard'
import Entries from './pages/Entries'
import Variants from './pages/Variants'
import YamlPage from './pages/YamlPage'
import PdfPreview from './pages/PdfPreview'
import HistoryPage from './pages/History'
import GitBoard from './pages/GitBoard'
import Templates from './pages/Templates'
import SettingsPage from './pages/Settings'

const NAV = [
  { key: 'dashboard', label: '总览', icon: <LayoutDashboard size={16} /> },
  { key: 'entries', label: '信息管理', icon: <Database size={16} /> },
  { key: 'variants', label: '简历方向', icon: <GitBranch size={16} /> },
  { key: 'yaml', label: 'YAML 编辑', icon: <FileCode2 size={16} /> },
  { key: 'pdf', label: 'PDF 预览', icon: <FileText size={16} /> },
  { key: 'history', label: '历史版本', icon: <History size={16} /> },
  { key: 'git', label: 'Git 同步看板', icon: <GitPullRequestArrow size={16} /> },
  { key: 'templates', label: '模板初始化', icon: <LayoutTemplate size={16} /> },
  { key: 'settings', label: '设置', icon: <Settings size={16} /> },
]

const TITLES: Record<string, [string, string]> = {
  dashboard: ['总览', '数据仓状态与快捷操作'],
  entries: ['信息管理', '按标签分类管理全部个人信息，随时查看删改'],
  variants: ['简历方向', '可视化编辑配方，按标签动态组稿多份简历'],
  yaml: ['YAML 编辑', '直接查看与编辑数据文件（保存时校验语法）'],
  pdf: ['PDF 预览', '构建各方向简历并在线预览'],
  history: ['历史版本', 'GitHub 提交时间轴 + 对应 PDF 与 YAML 快照'],
  git: ['Git 同步看板', '本地与 GitHub 私有仓的可视化同步'],
  templates: ['模板初始化', '按数据格式生成私有数据仓骨架'],
  settings: ['设置', '数据仓路径、GitHub 凭据与提交身份'],
}

function Shell() {
  const [page, setPage] = useState(() => {
    const h = window.location.hash.replace(/^#\/?/, '')
    return NAV.some((n) => n.key === h) ? h : 'dashboard'
  })
  const [status, setStatus] = useState<ProjectStatus | null>(null)

  const go = (p: string) => {
    setPage(p)
    window.location.hash = `/${p}`
  }

  useEffect(() => {
    const onHash = () => {
      const h = window.location.hash.replace(/^#\/?/, '')
      if (NAV.some((n) => n.key === h)) setPage(h)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    const load = () =>
      api.get<ProjectStatus>('/api/project/status').then(setStatus).catch(() => setStatus(null))
    load()
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [])

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

  const [title, desc] = TITLES[page]

  return (
    <div className="flex h-full">
      {/* 侧边栏 */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-zinc-800/80 bg-zinc-950">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-bold text-white shadow-lg shadow-indigo-500/30">
            RM
          </div>
          <div>
            <p className="text-sm font-semibold text-zinc-100">Resume Manager</p>
            <p className="text-[10px] text-zinc-600">简历可视化管理系统</p>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 px-3 py-2">
          {NAV.map((n) => (
            <button
              key={n.key}
              onClick={() => setPage(n.key)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
                page === n.key
                  ? 'bg-indigo-500/15 text-indigo-200'
                  : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200'
              }`}
            >
              {n.icon}
              {n.label}
            </button>
          ))}
        </nav>
        <div className="border-t border-zinc-800/80 px-5 py-4">
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
        <header className="sticky top-0 z-20 border-b border-zinc-800/80 bg-zinc-950/80 px-8 py-4 backdrop-blur">
          <h1 className="text-lg font-semibold text-zinc-100">{title}</h1>
          <p className="text-xs text-zinc-500">{desc}</p>
        </header>
        <div className="p-6 lg:p-8">
          {page === 'dashboard' && <Dashboard go={go} />}
          {page === 'entries' && <Entries />}
          {page === 'variants' && <Variants />}
          {page === 'yaml' && <YamlPage />}
          {page === 'pdf' && <PdfPreview />}
          {page === 'history' && <HistoryPage />}
          {page === 'git' && <GitBoard />}
          {page === 'templates' && <Templates />}
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
