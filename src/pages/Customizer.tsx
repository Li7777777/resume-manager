// 简历定制：按当前简历类型组织内容、选择模板，并在本页构建预览
import React, { useEffect, useMemo, useState } from 'react'
import {
  GripVertical,
  Trash2,
  ArrowUp,
  ArrowDown,
  Layers,
  FileCode2,
  Loader2,
  CheckCircle2,
  LayoutTemplate,
  ExternalLink,
  GitBranch,
  Eye,
  RefreshCw,
} from 'lucide-react'
import { api } from '../api'
import type { Entry, Variant } from '../types'
import { useToast } from '../toast'
import { Badge, Button, Card, EmptyState, Input, Select, Spinner, TagChip, Textarea } from '../components/ui'
import PdfViewer from '../components/PdfViewer'
import YamlWorkspace from '../components/YamlWorkspace'

const DEFAULT_CATS: { key: string; label: string }[] = [
  { key: 'basics', label: '基础信息' },
  { key: 'work', label: '工作经历' },
  { key: 'education', label: '教育背景' },
  { key: 'projects', label: '项目经历' },
  { key: 'skills', label: '专业技能' },
  { key: 'certificates', label: '证书资质' },
  { key: 'interests', label: '兴趣爱好' },
]

interface Section {
  key: string
  mode: 'all' | 'ids' | 'tags'
  ids?: string[]
  tags?: string[]
}

interface ResumeType {
  name: string
  label: string
  branch: string
  configured: boolean
  current: boolean
  local: boolean
  remote: boolean
}

interface TemplateItem {
  id: string
  engine: 'latex' | 'html'
  name: string
  desc: string
}

function entryTitle(cat: string, entry: Entry) {
  if (cat === 'work') return (entry.company as string) || (entry.name as string) || '未命名'
  return (entry.name as string) || '未命名'
}

function sectionsFromVariant(variant?: Variant): Section[] {
  if (!variant?.blocks) return []
  return (variant.sectionOrder || Object.keys(variant.blocks))
    .map((key) => {
      const block = variant.blocks?.[key]
      if (!block) return null
      if (block.include === 'all' || block.include === 'true') return { key, mode: 'all' as const }
      if (Array.isArray(block.ids)) return { key, mode: 'ids' as const, ids: [...block.ids] }
      if (Array.isArray(block.tags)) return { key, mode: 'tags' as const, tags: [...block.tags] }
      return null
    })
    .filter(Boolean) as Section[]
}

const DND_MIME = 'application/x-rm-item'

export default function Customizer() {
  const toast = useToast()
  const [entries, setEntries] = useState<Record<string, Entry[]>>({})
  const [cats, setCats] = useState<{ key: string; label: string }[]>(DEFAULT_CATS)
  const [cat, setCat] = useState('work')
  const [variants, setVariants] = useState<Variant[]>([])
  const [types, setTypes] = useState<ResumeType[]>([])
  const [selectedType, setSelectedType] = useState('')
  const [templates, setTemplates] = useState<TemplateItem[]>([])
  const [template, setTemplate] = useState('moderncv-banking')
  const [sections, setSections] = useState<Section[]>([])
  const [headline, setHeadline] = useState('')
  const [summary, setSummary] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewEngine, setPreviewEngine] = useState<'latex' | 'html'>('latex')
  const [rendering, setRendering] = useState(false)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [workspaceMode, setWorkspaceMode] = useState<'visual' | 'yaml'>('visual')
  const [yamlDirty, setYamlDirty] = useState(false)
  const [yamlRevision, setYamlRevision] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      api.get<{ entries: Record<string, Entry[]> }>('/api/entries').catch(() => ({ entries: {} })),
      api.get<{ variants: Variant[] }>('/api/variants').catch(() => ({ variants: [] })),
      api.get<{ types: ResumeType[] }>('/api/resume-types').catch(() => ({ types: [] })),
      api.get<{ templates: TemplateItem[] }>('/api/templates').catch(() => ({ templates: [] })),
      api.get<{ categories: { key: string; label: string; visible: boolean }[] }>('/api/categories').catch(() => ({ categories: [] })),
    ])
      .then(([entryData, variantData, typeData, templateData, categoryData]) => {
        setEntries(entryData.entries)
        setVariants(variantData.variants)
        setTypes(typeData.types)
        setTemplates(templateData.templates)
        if (categoryData.categories?.length) {
          setCats(categoryData.categories.filter((item) => item.visible !== false).map((item) => ({ key: item.key, label: item.label })))
        }
        const initial = typeData.types.find((item) => item.current) || typeData.types[0]
        if (initial) {
          setSelectedType(initial.name)
          applyVariant(initial.name, variantData.variants)
        }
      })
      .catch((err) => toast('error', err.message))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const applyVariant = (name: string, source = variants) => {
    const variant = source.find((item) => item.name === name)
    setSections(sectionsFromVariant(variant))
    setHeadline(variant?.overrides?.basics?.headline || '')
    setSummary(
      Array.isArray(variant?.overrides?.basics?.summary)
        ? variant!.overrides!.basics!.summary!.join('\n')
        : '',
    )
    setTemplate(variant?.layout?.template || 'moderncv-banking')
    setPreviewUrl(null)
  }

  const selected = types.find((item) => item.name === selectedType)
  const activeTemplate = templates.find((item) => item.id === template)
  const canCustomize = !!selected?.current && selected.configured
  const canEditVisual = canCustomize && !yamlDirty

  const commit = (next: Section[]) => {
    setSections(next)
    setPreviewUrl(null)
  }

  const onDragStart = (data: { type: 'entry' | 'section'; key: string; id?: string }) => (event: React.DragEvent) => {
    event.dataTransfer.setData(DND_MIME, JSON.stringify(data))
    event.dataTransfer.effectAllowed = 'copy'
  }

  const parseDrop = (event: React.DragEvent) => {
    try {
      return JSON.parse(event.dataTransfer.getData(DND_MIME))
    } catch {
      return null
    }
  }

  const onSectionDrop = (event: React.DragEvent, section: Section) => {
    event.preventDefault()
    event.stopPropagation()
    setDragOver(null)
    const data = parseDrop(event)
    if (!data) return
    if (data.type === 'entry' && data.key === section.key) {
      const ids = [...new Set([...(section.ids || []), data.id])]
      commit(sections.map((item) => (item === section ? { ...item, mode: 'ids', ids } : item)))
    } else if (data.type === 'section' && data.key === section.key) {
      commit(sections.map((item) => (item === section ? { ...item, mode: 'all', ids: undefined, tags: undefined } : item)))
    }
  }

  const onCanvasDrop = (event: React.DragEvent) => {
    event.preventDefault()
    setDragOver(null)
    const data = parseDrop(event)
    if (!data) return
    if (sections.some((item) => item.key === data.key)) {
      return toast('warn', `${cats.find((item) => item.key === data.key)?.label || data.key} 已在布局中`)
    }
    commit([
      ...sections,
      data.type === 'entry' ? { key: data.key, mode: 'ids', ids: [data.id] } : { key: data.key, mode: 'all' },
    ])
  }

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= sections.length) return
    const next = [...sections]
    ;[next[index], next[target]] = [next[target], next[index]]
    commit(next)
  }

  const buildPreview = async () => {
    if (yamlDirty) {
      toast('warn', '请先保存或放弃 YAML 修改')
      return
    }
    if (!selectedType || !activeTemplate || sections.length === 0) return
    setRendering(true)
    try {
      const result = await api.post<{ preview: string | null; engine: 'latex' | 'html'; output?: string }>('/api/custom/layout', {
        variant: selectedType,
        sections,
        template: activeTemplate.id,
        overrides: {
          basics: {
            ...(headline.trim() ? { headline: headline.trim() } : {}),
            ...(summary.trim() ? { summary: summary.split('\n').map((line) => line.trim()).filter(Boolean) } : {}),
          },
        },
      })
      if (!result.preview) throw new Error(result.output || '构建未生成预览')
      setPreviewEngine(result.engine)
      setPreviewUrl(`${result.preview}?t=${Date.now()}`)
      setYamlRevision((value) => value + 1)
      toast('success', `${activeTemplate.name} 模板已保存并生成预览`)
      const refreshed = await api.get<{ variants: Variant[] }>('/api/variants').catch(() => ({ variants }))
      setVariants(refreshed.variants)
    } catch (err: any) {
      toast('error', err.message)
    } finally {
      setRendering(false)
    }
  }

  const refreshFromYaml = async () => {
    const [entryData, variantData, categoryData] = await Promise.all([
      api.get<{ entries: Record<string, Entry[]> }>('/api/entries'),
      api.get<{ variants: Variant[] }>('/api/variants'),
      api.get<{ categories: { key: string; label: string; visible: boolean }[] }>('/api/categories'),
    ])
    setEntries(entryData.entries)
    setVariants(variantData.variants)
    if (categoryData.categories?.length) {
      setCats(categoryData.categories.filter((item) => item.visible !== false).map((item) => ({ key: item.key, label: item.label })))
    }
    applyVariant(selectedType, variantData.variants)
  }

  const previewSavedYaml = async () => {
    if (!selectedType) return
    setRendering(true)
    try {
      await refreshFromYaml()
      if (!canCustomize) {
        toast('warn', 'YAML 已保存；切换到对应类型分支后可同步预览')
        return
      }
      const result = await api.post<{ preview: string | null; engine: 'latex' | 'html'; output?: string }>('/api/custom/preview', {
        variant: selectedType,
      })
      if (!result.preview) throw new Error(result.output || '构建未生成预览')
      setPreviewEngine(result.engine)
      setPreviewUrl(`${result.preview}?t=${Date.now()}`)
      toast('success', 'YAML 与预览已同步')
    } catch (err: any) {
      toast('error', `YAML 已保存，但预览更新失败：${err.message}`)
    } finally {
      setRendering(false)
    }
  }

  const changeType = (name: string) => {
    if (yamlDirty) {
      toast('warn', '请先保存或放弃 YAML 修改')
      return
    }
    setSelectedType(name)
    applyVariant(name)
    setYamlRevision((value) => value + 1)
  }

  const listOf = (key: string): Entry[] => (Array.isArray(entries[key]) ? entries[key] : [])
  const sectionLabel = (key: string) => cats.find((item) => item.key === key)?.label || key
  const categoryCount = (key: string) => (Array.isArray(entries[key]) ? entries[key].length : entries[key] ? 1 : 0)

  const layoutEntries = useMemo(() => {
    const result = new Map<string, Entry>()
    for (const section of sections) {
      for (const entry of listOf(section.key)) result.set(`${section.key}:${entry.id}`, entry)
    }
    return result
  }, [sections, entries])

  if (loading) return <Spinner label="加载简历定制…" />

  return (
    <div className="space-y-4">
      <div className="border-b border-zinc-800 pb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <GitBranch size={15} className="text-zinc-500" />
            <Select
              value={selectedType}
              onChange={(event) => changeType(event.target.value)}
              className="w-52"
            >
              {types.map((type) => (
                <option key={type.name} value={type.name}>{type.label} · {type.branch}</option>
              ))}
            </Select>
          </div>
          {selected?.current ? <Badge tone="emerald">当前分支</Badge> : <Badge tone="amber">未切换到此分支</Badge>}
          <span className="text-xs text-zinc-600">模板、内容和布局均保存到该类型分支。</span>
          {!canCustomize && (
            <Button size="sm" variant="secondary" onClick={() => { window.location.hash = '/variants' }}>
              <GitBranch size={13} /> 前往切换分支
            </Button>
          )}
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {templates.map((item) => {
            const active = template === item.id
            return (
              <button
                key={item.id}
                disabled={!canEditVisual}
                onClick={() => {
                  setTemplate(item.id)
                  setPreviewUrl(null)
                }}
                className={`min-h-[74px] rounded-md border px-3 py-2 text-left transition ${
                  active
                    ? 'border-indigo-500/60 bg-indigo-500/10'
                    : 'border-zinc-800 bg-zinc-950/40 hover:border-zinc-600'
                } disabled:cursor-not-allowed disabled:opacity-50`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-200">
                    <LayoutTemplate size={13} className={active ? 'text-indigo-400' : 'text-zinc-600'} /> {item.name}
                  </span>
                  <Badge tone={item.engine === 'html' ? 'sky' : 'zinc'}>{item.engine === 'html' ? 'HTML' : 'LaTeX'}</Badge>
                </div>
                <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-zinc-600">{item.desc}</p>
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950 p-1" role="tablist" aria-label="定制工作区">
          <button
            type="button"
            role="tab"
            aria-selected={workspaceMode === 'visual'}
            onClick={() => setWorkspaceMode('visual')}
            className={`inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition ${workspaceMode === 'visual' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'}`}
          >
            <Layers size={13} /> 可视化编排
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={workspaceMode === 'yaml'}
            onClick={() => setWorkspaceMode('yaml')}
            className={`inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition ${workspaceMode === 'yaml' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'}`}
          >
            <FileCode2 size={13} /> YAML 源码
          </button>
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          {yamlDirty ? <Badge tone="amber">YAML 未保存</Badge> : <Badge tone="zinc">磁盘已同步</Badge>}
          {previewUrl && !yamlDirty && <Badge tone="emerald">预览已更新</Badge>}
        </div>
      </div>

      <div className="flex min-h-[640px] flex-col gap-4 xl:h-[calc(100vh-245px)] xl:min-h-[620px] xl:flex-row">
        {workspaceMode === 'visual' && (
          <>
        <Card title="简历信息库" desc="拖拽条目或章节到布局" className="w-full shrink-0 xl:w-72" pad={false} fill>
          <div className="flex flex-wrap gap-1 border-b border-zinc-800 p-2">
            {cats.map((item) => (
              <button
                key={item.key}
                onClick={() => setCat(item.key)}
                className={`rounded-md px-2 py-1 text-[11px] transition ${
                  cat === item.key ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {item.label}<span className={`ml-1 ${cat === item.key ? 'text-zinc-400' : 'text-zinc-600'}`}>{categoryCount(item.key)}</span>
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2">
            <div
              draggable={canEditVisual}
              onDragStart={onDragStart({ type: 'section', key: cat })}
              className="mb-2 flex cursor-grab items-center gap-2 rounded-md border border-dashed border-indigo-500/40 bg-indigo-500/5 px-3 py-2 text-xs text-indigo-300"
            >
              <Layers size={13} /> 拖入整个「{sectionLabel(cat)}」章节
            </div>
            {cat === 'basics' ? (
              <div className="rounded-md border border-zinc-800 bg-zinc-950/50 p-3 text-xs text-zinc-400">基础信息作为章节整体拖入布局。</div>
            ) : listOf(cat).length === 0 ? (
              <EmptyState title="暂无条目" />
            ) : (
              listOf(cat).map((entry) => {
                const inLayout = sections.some((section) => section.key === cat && (section.mode === 'all' || section.ids?.includes(entry.id!)))
                return (
                  <div
                    key={entry.id}
                    draggable={canEditVisual}
                    onDragStart={onDragStart({ type: 'entry', key: cat, id: entry.id })}
                    className={`mb-1.5 cursor-grab rounded-md border px-3 py-2 ${
                      inLayout ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-zinc-800 bg-zinc-950/50 hover:border-indigo-500/40'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <GripVertical size={12} className="text-zinc-600" />
                      <span className="truncate text-xs font-medium text-zinc-200">{entryTitle(cat, entry)}</span>
                      {inLayout && <CheckCircle2 size={12} className="ml-auto text-emerald-400" />}
                    </div>
                    {(entry.tags || []).length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1 pl-5">
                        {(entry.tags as string[]).slice(0, 4).map((tag) => <TagChip key={tag} tag={tag} />)}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </Card>

        <Card
          title="内容与布局"
          desc="按当前顺序生成简历"
          className="min-w-0 flex-1"
          pad={false}
          fill
          actions={<Button size="sm" variant="ghost" disabled={!canEditVisual} onClick={() => commit([])}><Trash2 size={12} /> 清空</Button>}
        >
          <div className="space-y-2 border-b border-zinc-800 p-3">
            <Input
              value={headline}
              disabled={!canEditVisual}
              onChange={(event) => { setHeadline(event.target.value); setPreviewUrl(null) }}
              placeholder="针对该类型的职位头衔"
              className="text-xs"
            />
            <Textarea
              value={summary}
              disabled={!canEditVisual}
              onChange={(event) => { setSummary(event.target.value); setPreviewUrl(null) }}
              placeholder="针对该类型的个人简介，每行一条"
              className="min-h-[68px] text-xs"
            />
          </div>
          <div
            className={`min-h-0 flex-1 overflow-auto p-3 ${dragOver === 'canvas' ? 'ring-2 ring-inset ring-indigo-500/40' : ''}`}
            onDragOver={(event) => { if (canEditVisual) { event.preventDefault(); setDragOver('canvas') } }}
            onDragLeave={() => setDragOver(null)}
            onDrop={onCanvasDrop}
          >
            {sections.length === 0 ? (
              <EmptyState icon={<Layers size={30} />} title="布局为空" desc="从左侧拖入信息条目或整个章节。" />
            ) : (
              <div className="space-y-2">
                {sections.map((section, index) => (
                  <div
                    key={section.key}
                    onDragOver={(event) => { if (canEditVisual) { event.preventDefault(); setDragOver(section.key) } }}
                    onDragLeave={() => setDragOver(null)}
                    onDrop={(event) => onSectionDrop(event, section)}
                    className={`rounded-md border p-2.5 ${dragOver === section.key ? 'border-indigo-500/60 bg-indigo-500/5' : 'border-zinc-800 bg-zinc-950/40'}`}
                  >
                    <div className="flex items-center gap-1.5">
                      <GripVertical size={13} className="text-zinc-600" />
                      <span className="text-xs font-semibold text-zinc-200">{sectionLabel(section.key)}</span>
                      <Badge tone={section.mode === 'all' ? 'emerald' : section.mode === 'ids' ? 'sky' : 'indigo'}>
                        {section.mode === 'all' ? '全部' : section.mode === 'ids' ? `${(section.ids || []).length} 条` : `${(section.tags || []).length} 标签`}
                      </Badge>
                      <div className="ml-auto flex gap-0.5">
                        <button disabled={!canEditVisual} className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300" onClick={() => move(index, -1)}><ArrowUp size={12} /></button>
                        <button disabled={!canEditVisual} className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300" onClick={() => move(index, 1)}><ArrowDown size={12} /></button>
                        <button disabled={!canEditVisual} className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-red-400" onClick={() => commit(sections.filter((item) => item !== section))}><Trash2 size={12} /></button>
                      </div>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1 pl-5">
                      {section.mode === 'all' ? (
                        <span className="text-[11px] text-zinc-500">展示该章节全部条目</span>
                      ) : section.mode === 'ids' ? (
                        (section.ids || []).map((id) => {
                          const entry = layoutEntries.get(`${section.key}:${id}`)
                          return (
                            <span key={id} className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-300">
                              {entry ? entryTitle(section.key, entry) : id}
                              <button disabled={!canEditVisual} className="text-zinc-600 hover:text-red-400" onClick={() => commit(sections.map((item) => item === section ? { ...item, ids: (item.ids || []).filter((value) => value !== id) } : item))}><Trash2 size={10} /></button>
                            </span>
                          )
                        })
                      ) : (
                        (section.tags || []).map((tag) => <TagChip key={tag} tag={tag} />)
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
          </>
        )}
        <div className={workspaceMode === 'yaml' ? 'min-h-0 min-w-0 flex-1' : 'hidden'}>
          <YamlWorkspace
            disabled={rendering}
            canPreview={canCustomize}
            revision={yamlRevision}
            onDirtyChange={setYamlDirty}
            onSaved={previewSavedYaml}
          />
        </div>

        <Card
          title="模板预览"
          desc={activeTemplate ? `${activeTemplate.name} · ${activeTemplate.engine === 'html' ? 'HTML' : 'LaTeX PDF'}` : '选择模板'}
          className="min-h-[560px] w-full shrink-0 xl:min-h-0 xl:w-[46%]"
          pad={false}
          fill
          actions={
            <div className="flex items-center gap-1">
              <button
                type="button"
                title="按已保存 YAML 刷新预览"
                aria-label="按已保存 YAML 刷新预览"
                disabled={!canCustomize || rendering || yamlDirty}
                onClick={previewSavedYaml}
                className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-30"
              >
                <RefreshCw size={13} />
              </button>
              {previewUrl && <a href={previewUrl} target="_blank" rel="noreferrer" className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-800 hover:text-indigo-300" title="新窗口打开"><ExternalLink size={13} /></a>}
              {workspaceMode === 'visual' && <Button
                size="sm"
                variant="primary"
                loading={rendering}
                disabled={!canEditVisual || sections.length === 0 || !activeTemplate}
                onClick={buildPreview}
              >
                {rendering ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />} 保存并预览
              </Button>}
            </div>
          }
        >
          <div className="min-h-0 flex-1">
            {rendering ? (
              <div className="flex h-full items-center justify-center"><Spinner label="正在组合并生成预览…" /></div>
            ) : previewUrl ? (
              previewEngine === 'latex' ? <PdfViewer url={previewUrl} /> : <iframe key={previewUrl} src={previewUrl} className="h-full w-full bg-white" title="HTML 简历预览" />
            ) : (
              <div className="flex h-full items-center justify-center">
                <EmptyState icon={<FileCode2 size={30} />} title="选择模板并生成预览" desc="构建只发生在简历定制页；PDF 预览页仅查看历史版本。" />
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}
