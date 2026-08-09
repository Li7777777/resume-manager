// PDF 预览（合并页）：左侧统一时间轴（本地构建记录 + GitHub 提交/CI 运行），右侧对应版本 PDF 与 YAML 数据
import React, { useCallback, useEffect, useState } from 'react'
import {
  Play,
  GitCommitHorizontal,
  CheckCircle2,
  XCircle,
  LoaderCircle,
  CloudDownload,
  RefreshCw,
  FileText,
  FileCode2,
  Hammer,
  ServerCog,
  Clock3,
  History,
  AlertTriangle,
} from 'lucide-react'
import { api } from '../api'
import type { Variant, Settings } from '../types'
import { loadSettings, subscribeSettings } from '../settings'
import { useToast } from '../toast'
import { Card, Badge, Spinner, Button, Select, EmptyState, relativeTime } from '../components/ui'
import PdfViewer from '../components/PdfViewer'
import { YamlEditor } from '../components/YamlEditor'

interface TimelineItem {
  kind: 'local' | 'github'
  id: string
  timestamp: number
  // github
  oid?: string
  short?: string
  message?: string
  author?: string
  run?: { id: number; run_number: number; status: string; conclusion: string; created_at: string } | null
  // local
  variant?: string
  sha?: string | null
  headMessage?: string | null
  status?: string
  pdfs?: string[]
}

const YAML_SNAPSHOT_FILES = [
  { path: 'data/basics.yml', label: '基础信息' },
  { path: 'data/work.yml', label: '工作经历' },
  { path: 'data/education.yml', label: '教育背景' },
  { path: 'data/projects.yml', label: '项目经历' },
  { path: 'data/skills.yml', label: '专业技能' },
  { path: 'scripts/variants.yml', label: '简历方向配方' },
]

export default function HistoryPage() {
  const toast = useToast()
  const [items, setItems] = useState<TimelineItem[]>([])
  const [variants, setVariants] = useState<Variant[]>([])
  const [selectedVariant, setSelectedVariant] = useState('')
  const [selected, setSelected] = useState<TimelineItem | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [env, setEnv] = useState<{ yamlresume: string | null } | null>(null)
  const [loading, setLoading] = useState(true)
  const [building, setBuilding] = useState(false)
  const [githubSyncing, setGithubSyncing] = useState(false)
  const [loadingPdf, setLoadingPdf] = useState(false)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [pdfInfo, setPdfInfo] = useState<{ runNumber?: number; cached?: boolean; note?: string } | null>(null)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [tab, setTab] = useState<'pdf' | 'yaml'>('pdf')
  const [yamlFile, setYamlFile] = useState(YAML_SNAPSHOT_FILES[0].path)
  const [yamlContent, setYamlContent] = useState<string | null>(null)
  const [yamlLoading, setYamlLoading] = useState(false)

  const load = useCallback(async (keepSelection = true) => {
    setLoading(true)
    try {
      const [h, v, s, e] = await Promise.all([
        api.get<{ items: TimelineItem[] }>('/api/history?limit=30').catch(() => ({ items: [] })),
        api.get<{ variants: Variant[] }>('/api/variants').catch(() => ({ variants: [] })),
        api.get<{ settings: Settings }>('/api/settings').catch(() => ({ settings: {} })),
        api.get<{ yamlresume: string | null }>('/api/health').catch(() => ({ yamlresume: null })),
      ])
      setItems(h.items)
      setVariants(v.variants)
      setSettings(s.settings)
      setEnv(e)
      if (!selectedVariant && v.variants[0]) setSelectedVariant(v.variants[0].name)
      if (!selected && h.items[0]) selectItem(h.items[0])
      else if (keepSelection && selected) {
        // 保留当前选中（刷新后按 id 重新定位）
        const cur = h.items.find((x) => x.id === selected.id)
        if (cur) selectItem(cur)
      }
    } catch (err: any) {
      toast('error', err.message)
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    load(false)
    const unsub = subscribeSettings((s) => setSettings(s))
    loadSettings().catch(() => {})
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 选中时间轴条目 → 加载对应版本 PDF
  const selectItem = async (item: TimelineItem) => {
    setSelected(item)
    setPdfUrl(null)
    setPdfInfo(null)
    setPdfError(null)
    setYamlContent(null)
    setTab('pdf')
    setLoadingPdf(true)
    try {
      if (item.kind === 'local') {
        // 本地构建记录：直接预览本地产物
        const f = (item.pdfs?.[0]) || `${item.variant}.pdf`
        setPdfUrl(`/api/pdf/${encodeURIComponent(f)}`)
        setPdfInfo({ note: `本地构建 ${item.variant}` })
      } else {
        // GitHub 提交：拉取该提交 CI 构建的 PDF
        if (!item.run || item.run.conclusion !== 'success') {
          setPdfError(
            !item.run
              ? '该提交没有对应的 CI 运行（GitHub 编译可能未开启或推送时未触发）'
              : `该提交的 CI 运行状态：${item.run.status}/${item.run.conclusion || '未知'}，无可用产物`,
          )
          setLoadingPdf(false)
          return
        }
        const r = await api.get<{ pdfs: string[]; runNumber?: number; cached?: boolean }>(
          `/api/github/history/pdf?sha=${item.oid}`,
        )
        const target = r.pdfs[0]
        setPdfUrl(`/api/pdf/history/${encodeURIComponent(target)}`)
        setPdfInfo({ runNumber: r.runNumber, cached: r.cached })
      }
    } catch (e: any) {
      setPdfError(e.message)
    } finally {
      setLoadingPdf(false)
    }
  }

  // 本地构建（成功后时间轴新增一条本地记录）
  const buildLocal = async () => {
    if (!selectedVariant) return
    setBuilding(true)
    try {
      const r = await api.post<{ pdf: string }>('/api/build', { variant: selectedVariant })
      toast('success', '本地构建成功，已记录到时间轴')
      setPdfUrl(r.pdf)
      setTab('pdf')
      const h = await api.get<{ items: TimelineItem[] }>('/api/history?limit=30').catch(() => ({ items: [] }))
      setItems(h.items)
      const fresh = h.items.find((x) => x.kind === 'local' && x.variant === selectedVariant)
      if (fresh) selectItem(fresh)
      else {
        setPdfInfo({ note: `本地构建 ${selectedVariant}` })
        setPdfError(null)
      }
    } catch (e: any) {
      toast('error', e.message)
    } finally {
      setBuilding(false)
    }
  }

  // 从 GitHub CI 同步产物（github 编译方式）
  const syncFromGithub = async () => {
    setGithubSyncing(true)
    try {
      const r = await api.post<{ pdfs: string[]; runNumber?: number }>('/api/github/pdf-sync', {})
      setPdfUrl(`/api/pdf/${encodeURIComponent(selectedVariant || 'frontend')}.pdf`)
      setPdfInfo({ runNumber: r.runNumber })
      setPdfError(null)
      setTab('pdf')
      toast('success', `已同步 CI 产物（运行 #${r.runNumber}）`)
    } catch (e: any) {
      toast('error', e.message)
    } finally {
      setGithubSyncing(false)
    }
  }

  // YAML 快照：github 提交 → 该提交的数据；本地记录 → 当前工作区数据
  const loadYamlSnapshot = async (path: string) => {
    if (!selected) return
    setYamlFile(path)
    setYamlLoading(true)
    try {
      const d =
        selected.kind === 'github'
          ? await api.get<{ content: string }>(`/api/git/file-at?sha=${selected.oid}&path=${encodeURIComponent(path)}`)
          : await api.get<{ content: string }>(`/api/yaml?path=${encodeURIComponent(path)}`)
      setYamlContent(d.content)
    } catch (e: any) {
      setYamlContent(`# ${e.message}`)
    } finally {
      setYamlLoading(false)
    }
  }

  const localBuildEnabled = settings?.localPdfBuild !== false
  const githubBuildEnabled = settings?.githubPdfBuild === true
  const canBuild = env?.yamlresume != null && localBuildEnabled

  const nodeIcon = (item: TimelineItem) => {
    if (item.kind === 'local') return <Hammer size={12} className="text-indigo-400" />
    if (item.run?.conclusion === 'success') return <CheckCircle2 size={12} className="text-emerald-400" />
    if (item.run?.status === 'in_progress') return <LoaderCircle size={12} className="animate-spin text-sky-400" />
    return <GitCommitHorizontal size={12} className="text-zinc-500" />
  }

  const itemBadge = (item: TimelineItem) => {
    if (item.kind === 'local') {
      return <Badge tone="indigo">本地构建</Badge>
    }
    if (!item.run) return <Badge tone="zinc">无运行</Badge>
    if (item.run.conclusion === 'success') return <Badge tone="emerald">✓ CI #{item.run.run_number}</Badge>
    if (item.run.status === 'in_progress') return <Badge tone="sky">⋯ CI #{item.run.run_number}</Badge>
    return <Badge tone="red">✗ CI #{item.run.run_number}</Badge>
  }

  return (
    <div className="flex gap-5">
      {/* 左：统一时间轴（本地构建 + GitHub 提交） */}
      <div className="w-80 shrink-0 space-y-3">
        <Card
          title="版本时间轴"
          desc="本地构建与 GitHub 提交均记录于此"
          actions={
            <Button size="sm" variant="ghost" onClick={() => load(false)}>
              <RefreshCw size={13} />
            </Button>
          }
          pad={false}
        >
          {loading ? (
            <Spinner label="加载时间轴…" />
          ) : items.length === 0 ? (
            <EmptyState title="暂无版本记录" />
          ) : (
            <ol className="max-h-[calc(100vh-300px)] overflow-auto p-3">
              {items.map((item, i) => {
                const active = selected?.id === item.id
                const title = item.kind === 'local' ? `本地构建 · ${item.variant}` : (item.short || '')
                const desc = item.kind === 'local' ? item.headMessage : item.message
                return (
                  <li key={item.id} className="relative flex gap-3 pb-4 pl-1">
                    {i < items.length - 1 && <span className="absolute left-[13px] top-6 h-full w-px bg-zinc-800" />}
                    <button onClick={() => selectItem(item)} className="relative mt-0.5 shrink-0">
                      <span
                        className={`flex h-6 w-6 items-center justify-center rounded-full border ${
                          active ? 'border-indigo-400 bg-indigo-500/20' : 'border-zinc-700 bg-zinc-900'
                        }`}
                      >
                        {nodeIcon(item)}
                      </span>
                    </button>
                    <button
                      onClick={() => selectItem(item)}
                      className={`min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-left transition ${
                        active ? 'bg-indigo-500/10 ring-1 ring-indigo-500/30' : 'hover:bg-zinc-900'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[11px] font-medium text-zinc-300">{title}</span>
                        {itemBadge(item)}
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500">{desc || '—'}</p>
                      <p className="mt-0.5 text-[10px] text-zinc-600">
                        {item.kind === 'local' ? '本地' : item.author} · {relativeTime(item.timestamp * 1000)}
                      </p>
                    </button>
                  </li>
                )
              })}
            </ol>
          )}
        </Card>
      </div>

      {/* 右：构建工具条 + 版本详情 */}
      <div className="min-w-0 flex-1 space-y-3">
        {/* 构建工具条 */}
        <Card title="构建简历 PDF" desc={githubBuildEnabled ? 'GitHub 编译已开启：可从 CI 同步，也可本地构建' : '本地构建（需 yamlresume）或从 CI 同步'}>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={selectedVariant} onChange={(e) => setSelectedVariant(e.target.value)} className="w-44">
              {variants.map((v) => (
                <option key={v.name} value={v.name}>{v.label || v.name}</option>
              ))}
            </Select>
            <Button variant="primary" loading={building} disabled={!selectedVariant || !canBuild} onClick={buildLocal}>
              <Play size={15} /> 本地构建
            </Button>
            <Button variant="secondary" loading={githubSyncing} disabled={!githubBuildEnabled} onClick={syncFromGithub}>
              <CloudDownload size={15} /> 从 GitHub 同步
            </Button>
            <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
              <Badge tone={localBuildEnabled ? 'emerald' : 'zinc'}><Hammer size={11} />本地 {localBuildEnabled ? '开' : '关'}</Badge>
              <Badge tone={githubBuildEnabled ? 'sky' : 'zinc'}><ServerCog size={11} />GitHub {githubBuildEnabled ? '开' : '关'}</Badge>
              {!canBuild && localBuildEnabled && (
                <span className="flex items-center gap-1 text-amber-400"><AlertTriangle size={12} />未检测到 yamlresume</span>
              )}
            </div>
          </div>
        </Card>

        <Card title="版本详情" desc={selected ? (selected.kind === 'local' ? `本地构建 · ${selected.variant}` : `${selected.short} · ${selected.message}`) : '从左侧时间轴选择一个版本'}>
          <div className="mb-3 flex items-center gap-2 border-b border-zinc-800 pb-3">
            <button
              onClick={() => setTab('pdf')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm ${
                tab === 'pdf' ? 'bg-indigo-500/15 text-indigo-200' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <FileText size={14} /> 对应 PDF
            </button>
            <button
              onClick={() => {
                setTab('yaml')
                if (selected) loadYamlSnapshot(yamlFile)
              }}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm ${
                tab === 'yaml' ? 'bg-indigo-500/15 text-indigo-200' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <FileCode2 size={14} /> YAML 数据
            </button>
            <span className="ml-auto flex items-center gap-1.5 text-[11px] text-zinc-600">
              <History size={12} />
              {selected ? (selected.kind === 'local' ? `HEAD ${selected.sha?.slice(0, 7) || '—'}` : `提交 ${selected.short}`) : '—'}
              {pdfInfo?.runNumber && <Badge tone="sky">CI #{pdfInfo.runNumber}</Badge>}
              {pdfInfo?.note && <Badge tone="indigo">{pdfInfo.note}</Badge>}
            </span>
          </div>

          {tab === 'pdf' ? (
            loadingPdf ? (
              <Spinner label="加载该版本的 PDF…" />
            ) : pdfError ? (
              <EmptyState icon={<CloudDownload size={32} />} title="该版本没有可用 PDF" desc={pdfError} />
            ) : pdfUrl ? (
              <PdfViewer url={pdfUrl} />
            ) : (
              <EmptyState title="请从左侧时间轴选择版本" />
            )
          ) : (
            <div className="flex gap-3">
              <div className="w-44 shrink-0 space-y-1">
                {YAML_SNAPSHOT_FILES.map((f) => (
                  <button
                    key={f.path}
                    onClick={() => selected && loadYamlSnapshot(f.path)}
                    className={`block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
                      yamlFile === f.path ? 'bg-indigo-500/15 text-indigo-200' : 'text-zinc-500 hover:bg-zinc-900'
                    }`}
                  >
                    <span className="font-mono">{f.path}</span>
                    <span className="ml-1 text-[10px] text-zinc-600">{f.label}</span>
                  </button>
                ))}
                <p className="mt-2 border-t border-zinc-800 pt-2 text-[10px] leading-relaxed text-zinc-600">
                  {selected?.kind === 'github'
                    ? `展示提交 ${selected.short} 时的数据快照，与左侧 PDF 一一对应。`
                    : '展示当前工作区数据（与本地构建时基本一致）。'}
                </p>
              </div>
              <div className="min-w-0 flex-1">
                {yamlLoading ? (
                  <Spinner label="读取 YAML…" />
                ) : yamlContent !== null ? (
                  <div className="overflow-hidden rounded-lg border border-zinc-800">
                    <div className="h-[55vh]">
                      <YamlEditor value={yamlContent} readOnly />
                    </div>
                  </div>
                ) : (
                  <EmptyState icon={<History size={28} />} title="选择左侧版本后查看其 YAML 数据" />
                )}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
