// 历史版本页：GitHub 提交时间轴（左） + 该提交 CI 构建的 PDF（右） + YAML 快照匹配
import React, { useCallback, useEffect, useState } from 'react'
import {
  GitCommitHorizontal,
  GitBranch,
  FileText,
  FileCode2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  LoaderCircle,
  CloudDownload,
  History,
} from 'lucide-react'
import { api } from '../api'
import { useToast } from '../toast'
import { Card, Badge, Spinner, Button, EmptyState, relativeTime } from '../components/ui'
import PdfViewer from '../components/PdfViewer'
import { YamlEditor } from '../components/YamlEditor'

interface CommitItem {
  oid: string
  short: string
  message: string
  author: string
  timestamp: number
  run: {
    id: number
    run_number: number
    status: string
    conclusion: string
    created_at: string
  } | null
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
  const [commits, setCommits] = useState<CommitItem[]>([])
  const [selected, setSelected] = useState<CommitItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingPdf, setLoadingPdf] = useState(false)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [pdfInfo, setPdfInfo] = useState<{ runNumber?: number; cached?: boolean } | null>(null)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [tab, setTab] = useState<'pdf' | 'yaml'>('pdf')
  const [yamlFile, setYamlFile] = useState(YAML_SNAPSHOT_FILES[0].path)
  const [yamlContent, setYamlContent] = useState<string | null>(null)
  const [yamlLoading, setYamlLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await api.get<{ commits: CommitItem[] }>('/api/github/history?limit=30')
      setCommits(d.commits)
      if (!selected && d.commits[0]) selectCommit(d.commits[0])
    } catch (e: any) {
      toast('error', e.message)
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const selectCommit = async (c: CommitItem) => {
    setSelected(c)
    setPdfUrl(null)
    setPdfInfo(null)
    setPdfError(null)
    setTab('pdf')
    if (!c.run || c.run.conclusion !== 'success') {
      setPdfError(
        !c.run
          ? '该提交没有对应的 CI 运行（GitHub 编译可能未开启或推送时未触发）'
          : `该提交的 CI 运行状态：${c.run.status}/${c.run.conclusion || '未知'}，无可用产物`,
      )
      return
    }
    setLoadingPdf(true)
    try {
      const r = await api.get<{ pdfs: string[]; runNumber?: number; cached?: boolean }>(
        `/api/github/history/pdf?sha=${c.oid}`,
      )
      const target = r.pdfs.find((f) => f.endsWith(`${c.short}-${selectedVariant()}${extOf(f)}`)) || r.pdfs[0]
      setPdfUrl(`/api/pdf/history/${encodeURIComponent(target)}`)
      setPdfInfo({ runNumber: r.runNumber, cached: r.cached })
    } catch (e: any) {
      setPdfError(e.message)
    } finally {
      setLoadingPdf(false)
    }
  }

  // 历史产物文件名形如 <short>-<variant>.pdf，取首个即可预览该提交的完整产物集（含多方向）
  const selectedVariant = () => 'frontend'
  const extOf = (f: string) => (f.toLowerCase().endsWith('.pdf') ? '.pdf' : '')

  const loadYamlSnapshot = async (path: string) => {
    if (!selected) return
    setYamlFile(path)
    setYamlLoading(true)
    try {
      const d = await api.get<{ content: string }>(`/api/git/file-at?sha=${selected.oid}&path=${encodeURIComponent(path)}`)
      setYamlContent(d.content)
    } catch (e: any) {
      setYamlContent(`# ${e.message}`)
    } finally {
      setYamlLoading(false)
    }
  }

  const runTone = (c: CommitItem) => {
    if (!c.run) return 'zinc'
    if (c.run.conclusion === 'success') return 'emerald'
    if (c.run.status === 'in_progress') return 'sky'
    return 'red'
  }

  const runLabel = (c: CommitItem) => {
    if (!c.run) return '无运行'
    if (c.run.conclusion === 'success') return `✓ #${c.run.run_number}`
    if (c.run.status === 'in_progress') return `⋯ #${c.run.run_number}`
    return `✗ #${c.run.run_number}`
  }

  if (loading) return <Spinner label="加载提交历史…" />

  return (
    <div className="flex gap-5">
      {/* 左：提交时间轴 */}
      <div className="w-80 shrink-0 space-y-3">
        <Card
          title="GitHub 提交历史"
          desc="每个提交 = 一个历史版本（对应当时的数据与 CI 产物）"
          actions={
            <Button size="sm" variant="ghost" onClick={load}>
              <RefreshCw size={13} />
            </Button>
          }
          pad={false}
        >
          {commits.length === 0 ? (
            <EmptyState title="暂无提交历史" />
          ) : (
            <ol className="max-h-[calc(100vh-280px)] overflow-auto p-3">
              {commits.map((c, i) => {
                const active = selected?.oid === c.oid
                return (
                  <li key={c.oid} className="relative flex gap-3 pb-4 pl-1">
                    {i < commits.length - 1 && <span className="absolute left-[13px] top-6 h-full w-px bg-zinc-800" />}
                    <button onClick={() => selectCommit(c)} className="relative mt-0.5 shrink-0">
                      <span
                        className={`flex h-6 w-6 items-center justify-center rounded-full border ${
                          active ? 'border-indigo-400 bg-indigo-500/20' : 'border-zinc-700 bg-zinc-900'
                        }`}
                      >
                        {c.run?.conclusion === 'success' ? (
                          <CheckCircle2 size={12} className="text-emerald-400" />
                        ) : c.run?.status === 'in_progress' ? (
                          <LoaderCircle size={12} className="animate-spin text-sky-400" />
                        ) : (
                          <GitCommitHorizontal size={12} className="text-zinc-500" />
                        )}
                      </span>
                    </button>
                    <button
                      onClick={() => selectCommit(c)}
                      className={`min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-left transition ${
                        active ? 'bg-indigo-500/10 ring-1 ring-indigo-500/30' : 'hover:bg-zinc-900'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-mono text-[11px] text-indigo-300/80">{c.short}</span>
                        <Badge tone={runTone(c) as any}>{runLabel(c)}</Badge>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-xs font-medium text-zinc-200">{c.message}</p>
                      <p className="mt-0.5 text-[10px] text-zinc-600">
                        {c.author} · {relativeTime(c.timestamp)}
                      </p>
                    </button>
                  </li>
                )
              })}
            </ol>
          )}
        </Card>
      </div>

      {/* 右：PDF / YAML 快照 */}
      <div className="min-w-0 flex-1 space-y-3">
        <Card title="历史版本详情" desc={selected ? `${selected.short} · ${selected.message}` : '从左侧选择一个提交'}>
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
              <FileCode2 size={14} /> YAML 快照
            </button>
            <span className="ml-auto flex items-center gap-1.5 text-[11px] text-zinc-600">
              <GitBranch size={12} />
              {selected ? `提交 ${selected.short}` : '—'}
              {pdfInfo?.runNumber && <Badge tone="sky">CI 运行 #{pdfInfo.runNumber}</Badge>}
            </span>
          </div>

          {tab === 'pdf' ? (
            loadingPdf ? (
              <Spinner label="拉取该提交的 CI 产物…" />
            ) : pdfError ? (
              <EmptyState
                icon={<CloudDownload size={32} />}
                title="该提交没有可用 PDF"
                desc={pdfError}
              />
            ) : pdfUrl ? (
              <PdfViewer url={pdfUrl} />
            ) : (
              <EmptyState title="请从左侧选择提交" />
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
                {selected && (
                  <p className="mt-2 border-t border-zinc-800 pt-2 text-[10px] leading-relaxed text-zinc-600">
                    展示提交 <code className="text-zinc-400">{selected.short}</code> 时的数据文件快照，与左侧 PDF 一一对应。
                  </p>
                )}
              </div>
              <div className="min-w-0 flex-1">
                {yamlLoading ? (
                  <Spinner label="读取该版本 YAML…" />
                ) : yamlContent !== null ? (
                  <div className="overflow-hidden rounded-lg border border-zinc-800">
                    <div className="h-[60vh]">
                      <YamlEditor value={yamlContent} readOnly />
                    </div>
                  </div>
                ) : (
                  <EmptyState
                    icon={<History size={28} />}
                    title="选择左侧提交后点击 YAML 快照查看该版本的 data 数据"
                  />
                )}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
