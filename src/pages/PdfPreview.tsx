// PDF 预览页：构建各方向简历并在线渲染 PDF
import React, { useEffect, useRef, useState } from 'react'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { Play, RefreshCw, Download, ZoomIn, ZoomOut, FileText, AlertTriangle, CheckCircle2, Hammer } from 'lucide-react'
import { api } from '../api'
import type { Variant } from '../types'
import { useToast } from '../toast'
import { Card, Button, Select, Spinner, Badge } from '../components/ui'

GlobalWorkerOptions.workerSrc = workerUrl

export default function PdfPreview() {
  const toast = useToast()
  const [variants, setVariants] = useState<Variant[]>([])
  const [selected, setSelected] = useState('')
  const [env, setEnv] = useState<{ yamlresume: string | null; xelatex: string | null } | null>(null)
  const [building, setBuilding] = useState(false)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [output, setOutput] = useState('')
  const [numPages, setNumPages] = useState(0)
  const [scale, setScale] = useState(1.3)
  const [settings, setSettings] = useState<{ localPdfBuild?: boolean }>({})

  useEffect(() => {
    Promise.all([
      api.get<{ variants: Variant[] }>('/api/variants').catch(() => ({ variants: [] })),
      api.get<{ yamlresume: string | null; xelatex: string | null }>('/api/health').catch(() => null),
      api.get<{ settings: { localPdfBuild?: boolean } }>('/api/settings').catch(() => ({ settings: {} })),
    ]).then(([v, h, s]) => {
      setVariants(v.variants)
      if (v.variants[0]) setSelected(v.variants[0].name)
      setEnv(h)
      setSettings(s.settings)
    })
  }, [])

  const build = async () => {
    if (!selected) return
    setBuilding(true)
    setOutput('')
    try {
      const r = await api.post<{ pdf: string; output: string }>('/api/build', { variant: selected })
      setPdfUrl(r.pdf)
      setOutput(r.output)
      toast('success', '构建成功')
    } catch (e: any) {
      toast('error', e.message)
    } finally {
      setBuilding(false)
    }
  }

  // 本地编译开关（默认开启）
  const localBuildEnabled = settings.localPdfBuild !== false
  const canBuild = env?.yamlresume != null && localBuildEnabled

  return (
    <div className="space-y-5">
      {/* 本地编译关闭提示 */}
      {!localBuildEnabled && (
        <div className="flex items-start gap-2.5 rounded-xl border border-zinc-700 bg-zinc-900/60 p-4 text-sm text-zinc-300">
          <Hammer size={16} className="mt-0.5 shrink-0 text-zinc-500" />
          <div>
            <p className="font-medium">本地 PDF 编译已在设置中关闭</p>
            <p className="mt-1 text-xs text-zinc-500">
              到「设置」页开启「本地编译 PDF」后即可在此构建预览。
            </p>
          </div>
        </div>
      )}

      {/* 环境提示 */}
      {localBuildEnabled && !env?.yamlresume && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-200">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">未检测到本地构建环境</p>
            <p className="mt-1 text-xs text-amber-200/70">
              安装 yamlresume 命令行：
              <a className="underline decoration-dotted" href="https://www.npmjs.com/package/yamlresume" target="_blank" rel="noreferrer">npm install -g yamlresume</a>
              ，并安装 XeTeX/Tectonic 排版引擎。也可在「设置」中开启 GitHub 编译，push 后由 CI 自动构建。
            </p>
          </div>
        </div>
      )}

      <Card
        title="构建简历 PDF"
        desc="先按方向配方组合 data/ 信息，再调用本地 yamlresume 生成"
        actions={
          <>
            <Select value={selected} onChange={(e) => setSelected(e.target.value)} className="w-44">
              {variants.map((v) => (
                <option key={v.name} value={v.name}>{v.label || v.name}</option>
              ))}
            </Select>
            <Button variant="primary" loading={building} disabled={!selected || !canBuild} onClick={build}>
              <Play size={15} /> 构建
            </Button>
          </>
        }
      >
        {env && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge tone={env.yamlresume ? 'emerald' : 'red'}>
              {env.yamlresume ? <span className="inline-flex items-center gap-1"><CheckCircle2 size={11} />yamlresume</span> : 'yamlresume 缺失'}
            </Badge>
            <Badge tone={env.xelatex ? 'emerald' : 'red'}>
              {env.xelatex ? <span className="inline-flex items-center gap-1"><CheckCircle2 size={11} />XeTeX</span> : 'XeTeX 缺失'}
            </Badge>
          </div>
        )}
        {output && <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-black/40 p-3 text-[11px] text-zinc-400">{output}</pre>}
      </Card>

      {/* PDF 渲染 */}
      {pdfUrl ? (
        <div className="flex gap-4">
          <div className="min-w-0 flex-1">
            <PdfViewer url={pdfUrl} pageCount={(n) => setNumPages(n)} scale={scale} />
          </div>
          <div className="w-44 shrink-0 space-y-3">
            <Card title="预览控制" pad>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-zinc-400">
                  <span>页数</span><span>{numPages}</span>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" onClick={() => setScale((s) => Math.max(0.5, s - 0.2))}><ZoomOut size={13} /></Button>
                  <Button size="sm" onClick={() => setScale((s) => Math.min(3, s + 0.2))}><ZoomIn size={13} /></Button>
                  <a href={pdfUrl} download className="flex-1">
                    <Button size="sm" variant="success" className="w-full"><Download size={13} /> 下载</Button>
                  </a>
                </div>
              </div>
            </Card>
          </div>
        </div>
      ) : (
        <div className="flex h-[50vh] items-center justify-center">
          <div className="text-center text-zinc-600">
            <FileText size={40} className="mx-auto mb-3 opacity-40" />
            <p className="text-sm">选择方向并点击「构建」生成 PDF 预览</p>
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------- PDF 渲染组件 ---------- */
function PdfViewer({ url, pageCount, scale }: { url: string; pageCount: (n: number) => void; scale: number }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [rendering, setRendering] = useState(true)

  useEffect(() => {
    let cancelled = false
    let doc: any = null
    setRendering(true)
    const load = async () => {
      try {
        doc = await getDocument(url).promise
        if (cancelled) return
        pageCount(doc.numPages)
        const container = containerRef.current!
        container.innerHTML = ''
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i)
          const viewport = page.getViewport({ scale })
          const canvas = document.createElement('canvas')
          canvas.width = viewport.width
          canvas.height = viewport.height
          canvas.style.width = '100%'
          canvas.style.height = 'auto'
          const ctx = canvas.getContext('2d')!
          await page.render({ canvasContext: ctx, viewport }).promise
          const wrap = document.createElement('div')
          wrap.className = 'mb-4 overflow-hidden rounded-lg border border-zinc-800 bg-white shadow-2xl shadow-black/40'
          wrap.appendChild(canvas)
          container.appendChild(wrap)
        }
      } catch (e) {
        containerRef.current!.innerHTML = '<p class="p-6 text-center text-sm text-red-400">PDF 渲染失败</p>'
      } finally {
        if (!cancelled) setRendering(false)
      }
    }
    load()
    return () => {
      cancelled = true
      doc?.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, scale])

  return (
    <div className="relative">
      {rendering && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-950/60">
          <div className="flex items-center gap-2 text-sm text-zinc-400"><RefreshCw size={15} className="animate-spin" />渲染中…</div>
        </div>
      )}
      <div ref={containerRef} className="min-h-[40vh]" />
    </div>
  )
}