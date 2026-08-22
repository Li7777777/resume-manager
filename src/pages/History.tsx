// PDF 预览：按简历类型/Git 分支查看已有版本，不在本页执行构建
import React, { useCallback, useEffect, useState } from 'react'
import {
  GitCommitHorizontal,
  CheckCircle2,
  LoaderCircle,
  RefreshCw,
  FileText,
  FileCode2,
  History,
  GitBranch,
  PackageCheck,
  Cloud,
} from 'lucide-react'
import { api } from '../api'
import { useToast } from '../toast'
import { Badge, Button, Card, EmptyState, Select, Spinner, relativeTime } from '../components/ui'
import PdfViewer from '../components/PdfViewer'
import { YamlEditor } from '../components/YamlEditor'

interface ResumeType {
  name: string
  label: string
  branch: string
  configured: boolean
  current: boolean
  local: boolean
  remote: boolean
}

interface TimelineItem {
  kind: 'release' | 'github'
  id: string
  timestamp: number
  variant?: string
  branch?: string
  oid?: string
  short?: string
  message?: string
  author?: string
  run?: { id: number; run_number: number; status: string; conclusion: string; created_at: string } | null
  sha?: string | null
  headMessage?: string | null
  status?: string
  engine?: 'latex' | 'html'
  artifacts?: string[]
}

const YAML_SNAPSHOT_FILES = [
  { path: 'data/basics.yml', label: '基础信息' },
  { path: 'data/work.yml', label: '工作经历' },
  { path: 'data/education.yml', label: '教育背景' },
  { path: 'data/projects.yml', label: '项目经历' },
  { path: 'data/skills.yml', label: '专业技能' },
  { path: 'scripts/variants.yml', label: '简历类型配置' },
]

export default function HistoryPage() {
  const toast = useToast()
  const [types, setTypes] = useState<ResumeType[]>([])
  const [selectedType, setSelectedType] = useState('')
  const [branch, setBranch] = useState('')
  const [branchExists, setBranchExists] = useState(false)
  const [items, setItems] = useState<TimelineItem[]>([])
  const [selected, setSelected] = useState<TimelineItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingPdf, setLoadingPdf] = useState(false)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [artifactEngine, setArtifactEngine] = useState<'latex' | 'html'>('latex')
  const [pdfInfo, setPdfInfo] = useState<{ runNumber?: number; cached?: boolean; note?: string } | null>(null)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [tab, setTab] = useState<'pdf' | 'yaml'>('pdf')
  const [yamlFile, setYamlFile] = useState(YAML_SNAPSHOT_FILES[0].path)
  const [yamlContent, setYamlContent] = useState<string | null>(null)
  const [yamlLoading, setYamlLoading] = useState(false)
  const [onlyReleases, setOnlyReleases] = useState(false)

  const selectItem = async (item: TimelineItem, typeName = selectedType) => {
    setSelected(item)
    setPdfUrl(null)
    setPdfInfo(null)
    setPdfError(null)
    setYamlContent(null)
    setTab('pdf')
    setLoadingPdf(true)
    try {
      if (item.kind === 'release') {
        const file = item.artifacts?.[0]
        if (!file) throw new Error('该正式版没有归档产物')
        setArtifactEngine(item.engine === 'html' ? 'html' : 'latex')
        setPdfUrl(`/api/release/history/${encodeURIComponent(file)}`)
        setPdfInfo({ note: '本机正式版' })
      } else {
        setArtifactEngine('latex')
        if (!item.run || item.run.conclusion !== 'success') {
          setPdfError(
            !item.run
              ? '该提交没有对应的 CI 运行或 PDF 产物'
              : `该提交的 CI 状态为 ${item.run.status}/${item.run.conclusion || '未知'}，没有可查看的 PDF`,
          )
          return
        }
        const result = await api.get<{ pdfs: string[]; runNumber?: number; cached?: boolean }>(
          `/api/github/history/pdf?sha=${item.oid}&variant=${encodeURIComponent(typeName)}`,
        )
        if (!result.pdfs[0]) throw new Error(`该运行没有 ${typeName}.pdf 产物`)
        setPdfUrl(`/api/pdf/history/${encodeURIComponent(result.pdfs[0])}`)
        setPdfInfo({ runNumber: result.runNumber, cached: result.cached })
      }
    } catch (err: any) {
      setPdfError(err.message)
    } finally {
      setLoadingPdf(false)
    }
  }

  const loadHistory = useCallback(async (typeName: string, keepSelection = false) => {
    if (!typeName) return
    setLoading(true)
    try {
      const result = await api.get<{ items: TimelineItem[]; branch: string; branchExists: boolean }>(
        `/api/history?variant=${encodeURIComponent(typeName)}&limit=40`,
      )
      setItems(result.items)
      setBranch(result.branch)
      setBranchExists(result.branchExists)
      if (keepSelection && selected) {
        const current = result.items.find((item) => item.id === selected.id)
        if (current) await selectItem(current, typeName)
        else {
          setSelected(null)
          setPdfUrl(null)
        }
      } else if (result.items[0]) {
        await selectItem(result.items[0], typeName)
      } else {
        setSelected(null)
        setPdfUrl(null)
        setPdfError(null)
      }
    } catch (err: any) {
      toast('error', err.message)
      setItems([])
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  useEffect(() => {
    api
      .get<{ types: ResumeType[] }>('/api/resume-types')
      .then(async (result) => {
        setTypes(result.types)
        const initial = result.types.find((item) => item.current) || result.types[0]
        if (initial) {
          setSelectedType(initial.name)
          await loadHistory(initial.name)
        } else {
          setLoading(false)
        }
      })
      .catch((err) => {
        toast('error', err.message)
        setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadYamlSnapshot = async (file: string) => {
    if (!selected) return
    setYamlFile(file)
    setYamlLoading(true)
    try {
      const sha = selected.kind === 'github' ? selected.oid : selected.sha
      const result = sha
        ? await api.get<{ content: string }>(`/api/git/file-at?sha=${sha}&path=${encodeURIComponent(file)}`)
        : await api.get<{ content: string }>(`/api/yaml?path=${encodeURIComponent(file)}`)
      setYamlContent(result.content)
    } catch (err: any) {
      setYamlContent(`# ${err.message}`)
    } finally {
      setYamlLoading(false)
    }
  }

  const nodeIcon = (item: TimelineItem) => {
    if (item.kind === 'release') return <PackageCheck size={12} className="text-indigo-400" />
    if (item.run?.conclusion === 'success') return <CheckCircle2 size={12} className="text-emerald-400" />
    if (item.run?.status === 'in_progress') return <LoaderCircle size={12} className="animate-spin text-sky-400" />
    return <GitCommitHorizontal size={12} className="text-zinc-500" />
  }

  const itemBadge = (item: TimelineItem) => {
    if (item.kind === 'release') return <Badge tone="indigo">正式版</Badge>
    if (!item.run) return <Badge tone="zinc">仅提交</Badge>
    if (item.run.conclusion === 'success') return <Badge tone="emerald">CI #{item.run.run_number}</Badge>
    if (item.run.status === 'in_progress') return <Badge tone="sky">CI 运行中</Badge>
    return <Badge tone="red">CI 失败</Badge>
  }

  if (types.length === 0 && !loading) {
    return <EmptyState icon={<GitBranch size={32} />} title="还没有简历类型" desc="请先在「简历类型」页创建类型与分支。" />
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-800 pb-4">
        <GitBranch size={15} className="text-zinc-500" />
        <Select
          value={selectedType}
          onChange={(event) => {
            const name = event.target.value
            setSelectedType(name)
            setSelected(null)
            setPdfUrl(null)
            loadHistory(name)
          }}
          className="w-60"
        >
          {types.map((type) => <option key={type.name} value={type.name}>{type.label}</option>)}
        </Select>
        <code className="text-xs text-indigo-300">{branch || '—'}</code>
        <Badge tone={branchExists ? 'emerald' : 'amber'}>{branchExists ? '分支时间线' : '分支尚未创建'}</Badge>
        <span className="text-xs text-zinc-600">此页面只显示正式版与 Git 版本；临时预览不会进入时间轴。</span>
        <label className="ml-auto flex cursor-pointer select-none items-center gap-1.5 text-xs text-zinc-400 transition hover:text-zinc-200">
          <input
            type="checkbox"
            checked={onlyReleases}
            onChange={(e) => setOnlyReleases(e.target.checked)}
            className="h-3.5 w-3.5 accent-indigo-500"
          />
          <PackageCheck size={13} className="text-indigo-400" />
          只看正式发布版
        </label>
        <Button size="sm" variant="ghost" onClick={() => loadHistory(selectedType, true)} title="刷新时间线">
          <RefreshCw size={13} />
        </Button>
      </div>

      <div className="flex gap-5">
        <div className="w-80 shrink-0">
          <Card title="版本时间轴" desc={branch || '按类型分支分类'} pad={false}>
            {loading ? (
              <Spinner label="加载分支时间线…" />
            ) : !branchExists ? (
              <EmptyState title="类型分支尚未创建" desc="在「简历类型」页创建该类型分支后，这里会显示独立时间线。" />
            ) : (onlyReleases ? items.filter((item) => item.kind === 'release') : items).length === 0 ? (
              <EmptyState title={onlyReleases ? '暂无正式发布版' : '该分支暂无版本记录'} />
            ) : (
              <ol className="max-h-[calc(100vh-260px)] overflow-auto p-3">
                {(onlyReleases ? items.filter((item) => item.kind === 'release') : items).map((item, index) => {
                  const active = selected?.id === item.id
                  const title = item.kind === 'release' ? '本机正式版' : item.short || ''
                  const desc = item.kind === 'release' ? item.headMessage : item.message
                  return (
                    <li key={item.id} className="relative flex gap-3 pb-4 pl-1">
                      {index < items.length - 1 && <span className="absolute left-[13px] top-6 h-full w-px bg-zinc-800" />}
                      <button onClick={() => selectItem(item)} className="relative mt-0.5 shrink-0">
                        <span className={`flex h-6 w-6 items-center justify-center rounded-full border ${active ? 'border-indigo-400 bg-indigo-500/20' : 'border-zinc-700 bg-zinc-900'}`}>
                          {nodeIcon(item)}
                        </span>
                      </button>
                      <button
                        onClick={() => selectItem(item)}
                        className={`min-w-0 flex-1 rounded-md px-2.5 py-1.5 text-left transition ${active ? 'bg-indigo-500/10 ring-1 ring-indigo-500/30' : 'hover:bg-zinc-900'}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[11px] font-medium text-zinc-300">{title}</span>
                          {itemBadge(item)}
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500">{desc || '—'}</p>
                        <p className="mt-0.5 text-[10px] text-zinc-600">{item.kind === 'release' ? '本机发布' : item.author} · {relativeTime(item.timestamp * 1000)}</p>
                      </button>
                    </li>
                  )
                })}
              </ol>
            )}
          </Card>
        </div>

        <div className="min-w-0 flex-1">
          <Card
            title="版本详情"
            desc={selected ? (selected.kind === 'release' ? `${branch} · 正式版` : `${selected.short} · ${selected.message}`) : '从左侧时间轴选择版本'}
          >
            <div className="mb-3 flex items-center gap-2 border-b border-zinc-800 pb-3">
              <button
                onClick={() => setTab('pdf')}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm ${
                  tab === 'pdf'
                    ? 'bg-indigo-500/15 text-indigo-100'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <FileText size={14} /> 版本文件
              </button>
              <button
                onClick={() => { setTab('yaml'); if (selected) loadYamlSnapshot(yamlFile) }}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm ${
                  tab === 'yaml'
                    ? 'bg-indigo-500/15 text-indigo-100'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <FileCode2 size={14} /> 数据快照
              </button>
              <span className="ml-auto flex items-center gap-1.5 text-[11px] text-zinc-600">
                {selected?.kind === 'github' ? <Cloud size={12} /> : <PackageCheck size={12} />}
                {selected ? (selected.kind === 'github' ? `提交 ${selected.short}` : `正式版 · HEAD ${selected.sha?.slice(0, 7) || '—'}`) : '—'}
                {pdfInfo?.runNumber && <Badge tone="sky">CI #{pdfInfo.runNumber}</Badge>}
                {pdfInfo?.note && <Badge tone="indigo">{pdfInfo.note}</Badge>}
              </span>
            </div>

            {tab === 'pdf' ? (
              loadingPdf ? (
                <Spinner label="加载版本文件…" />
              ) : pdfError ? (
                <EmptyState icon={<FileText size={32} />} title="该版本没有可用产物" desc={pdfError} />
              ) : pdfUrl ? (
                artifactEngine === 'html'
                  ? <iframe src={pdfUrl} className="h-[72vh] w-full bg-white" title="HTML 正式版" />
                  : <PdfViewer url={pdfUrl} />
              ) : (
                <EmptyState title="请选择一个已有版本" />
              )
            ) : (
              <div className="flex gap-3">
                <div className="w-44 shrink-0 space-y-1">
                  {YAML_SNAPSHOT_FILES.map((file) => (
                    <button
                      key={file.path}
                      onClick={() => selected && loadYamlSnapshot(file.path)}
                      className={`block w-full truncate rounded-md px-2.5 py-1.5 text-left text-xs transition ${
                        yamlFile === file.path
                          ? 'bg-indigo-500/15 text-indigo-100'
                          : 'text-zinc-500 hover:bg-zinc-900'
                      }`}
                    >
                      <span className="font-mono">{file.path}</span>
                      <span className="ml-1 text-[10px] text-zinc-600">{file.label}</span>
                    </button>
                  ))}
                  <p className="mt-2 border-t border-zinc-800 pt-2 text-[10px] leading-relaxed text-zinc-600">数据快照与当前分支时间线中的提交对应。</p>
                </div>
                <div className="min-w-0 flex-1">
                  {yamlLoading ? (
                    <Spinner label="读取快照…" />
                  ) : yamlContent !== null ? (
                    <div className="overflow-hidden rounded-md border border-zinc-800"><div className="h-[60vh]"><YamlEditor value={yamlContent} readOnly /></div></div>
                  ) : (
                    <EmptyState icon={<History size={28} />} title="选择文件查看数据快照" />
                  )}
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
