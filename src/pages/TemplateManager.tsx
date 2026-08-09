// 模板管理页：载入官网提供的全部模板，一键应用到简历方向并实时切换预览
import React, { useEffect, useState } from 'react'
import { LayoutTemplate, CheckCircle2, ExternalLink, Play, RefreshCw, Loader2 } from 'lucide-react'
import { api } from '../api'
import { useToast } from '../toast'
import { Card, Button, Select, Badge, Spinner, EmptyState } from '../components/ui'

interface Tpl {
  id: string
  engine: string
  name: string
  desc: string
}

export default function TemplateManager({ go }: { go: (p: string) => void }) {
  const toast = useToast()
  const [templates, setTemplates] = useState<Tpl[]>([])
  const [current, setCurrent] = useState<Record<string, string | null>>({})
  const [variants, setVariants] = useState<{ name: string; label?: string }[]>([])
  const [selectedVariant, setSelectedVariant] = useState('')
  const [engineLabels, setEngineLabels] = useState<Record<string, string>>({})
  const [applying, setApplying] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)

  useEffect(() => {
    Promise.all([
      api.get<{ templates: Tpl[]; current: Record<string, string | null>; engineLabels: Record<string, string> }>('/api/templates'),
      api.get<{ variants: { name: string; label?: string }[] }>('/api/variants'),
    ]).then(([t, v]) => {
      setTemplates(t.templates)
      setCurrent(t.current)
      setEngineLabels(t.engineLabels)
      setVariants(v.variants)
      if (v.variants[0]) setSelectedVariant(v.variants[0].name)
    })
  }, [])

  const apply = async (tpl: Tpl) => {
    if (!selectedVariant) return toast('warn', '请先选择目标方向')
    setApplying(tpl.id)
    setPreview(null)
    try {
      const r = await api.post<{ preview: string | null; output?: string }>('/api/template/apply', {
        variant: selectedVariant,
        template: tpl.id,
        engine: tpl.engine,
        build: true,
      })
      setCurrent((c) => ({ ...c, [selectedVariant]: tpl.id }))
      setPreview(r.preview)
      toast('success', `已应用 ${tpl.name} 到「${selectedVariant}」${r.preview ? '，已重新构建' : ''}`)
    } catch (e: any) {
      toast('error', e.message)
    } finally {
      setApplying(null)
    }
  }

  const activeEngine = templates.find((t) => t.id === current[selectedVariant])?.engine || null

  return (
    <div className="space-y-5">
      <Card
        title="模板选择"
        desc="官网提供的模板已全部载入，选择方向后点击卡片即可实时切换（LaTeX 构建 PDF / HTML 构建网页）"
        actions={
          <>
            <Select value={selectedVariant} onChange={(e) => { setSelectedVariant(e.target.value); setPreview(null) }} className="w-44">
              {variants.map((v) => (
                <option key={v.name} value={v.name}>{v.label || v.name}</option>
              ))}
            </Select>
            <Button variant="secondary" size="sm" onClick={() => go('pdf')}>
              <Play size={13} /> 前往预览
            </Button>
          </>
        }
      >
        {templates.length === 0 ? (
          <Spinner />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((tpl) => {
              const isActive = current[selectedVariant] === tpl.id
              return (
                <button
                  key={tpl.id}
                  disabled={applying !== null}
                  onClick={() => apply(tpl)}
                  className={`group relative rounded-xl border p-4 text-left transition ${
                    isActive
                      ? 'border-indigo-500/60 bg-indigo-500/10'
                      : 'border-zinc-800 bg-zinc-900/50 hover:border-indigo-500/40 hover:bg-zinc-900'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <LayoutTemplate size={15} className={isActive ? 'text-indigo-400' : 'text-zinc-500'} />
                      <span className="text-sm font-semibold text-zinc-100">{tpl.name}</span>
                    </div>
                    <Badge tone={tpl.engine === 'html' ? 'sky' : 'zinc'}>{engineLabels[tpl.engine] || tpl.engine}</Badge>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">{tpl.desc}</p>
                  <div className="mt-2.5 flex items-center gap-1.5">
                    {isActive && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400">
                        <CheckCircle2 size={12} /> 当前使用
                      </span>
                    )}
                    {applying === tpl.id && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-indigo-400">
                        <Loader2 size={12} className="animate-spin" /> 正在应用…
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </Card>

      {/* 预览区 */}
      <Card
        title="实时预览"
        desc={`方向「${selectedVariant || '—'}」当前模板：${current[selectedVariant] || '未设置'}（${activeEngine ? engineLabels[activeEngine] : '—'}）`}
        actions={
          preview && (
            <a href={preview} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300">
              <ExternalLink size={12} /> 新窗口打开
            </a>
          )
        }
        pad={false}
      >
        {previewBusy ? (
          <Spinner label="构建中…" />
        ) : preview ? (
          preview.endsWith('.pdf') ? (
            <iframe src={preview} className="h-[70vh] w-full bg-white" title="模板预览" />
          ) : (
            <iframe src={preview} className="h-[70vh] w-full" title="模板预览" />
          )
        ) : (
          <EmptyState
            icon={<RefreshCw size={28} />}
            title="选择模板后自动构建预览"
            desc="点击上方模板卡片，应用后会自动重新构建并在右侧展示。"
          />
        )}
      </Card>
    </div>
  )
}
