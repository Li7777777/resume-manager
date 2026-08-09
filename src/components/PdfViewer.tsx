// 更强大的 PDF 渲染组件：基于 react-pdf（pdf.js 封装）
// 支持：缩放、翻页、加载/错误状态；页面宽度自适应容器并限制最大宽度（避免过宽）
import React, { useEffect, useRef, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { ChevronLeft, ChevronRight, Loader2, ZoomIn, ZoomOut, FileWarning } from 'lucide-react'
import { Button } from './ui'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const MAX_PAGE_WIDTH = 720 // 页面最大渲染宽度（px），避免 PDF 过宽

export default function PdfViewer({ url }: { url: string }) {
  const [numPages, setNumPages] = useState(0)
  const [pageNumber, setPageNumber] = useState(1)
  const [scale, setScale] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)

  useEffect(() => {
    setNumPages(0)
    setPageNumber(1)
    setError(null)
    setLoaded(false)
  }, [url])

  // 响应容器宽度（页面适配 + 限宽）
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setContainerWidth(e.contentRect.width)
    })
    ro.observe(el)
    setContainerWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // 页面渲染宽度：容器测量后限宽适配；未测量时用合理默认宽度（避免初始过小）
  const pageWidth = (containerWidth ? Math.min(containerWidth, MAX_PAGE_WIDTH) : 640) * scale

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/5 py-14 text-sm text-red-300">
        <FileWarning size={28} />
        <p>PDF 渲染失败：{error}</p>
      </div>
    )
  }

  return (
    <div ref={containerRef}>
      {/* 工具栏 */}
      {loaded && numPages > 0 && (
        <div className="mb-3 flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/70 px-3 py-2">
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" disabled={pageNumber <= 1} onClick={() => setPageNumber((p) => Math.max(1, p - 1))}>
              <ChevronLeft size={14} />
            </Button>
            <span className="min-w-[64px] text-center text-xs text-zinc-400">
              {pageNumber} / {numPages}
            </span>
            <Button size="sm" variant="ghost" disabled={pageNumber >= numPages} onClick={() => setPageNumber((p) => Math.min(numPages, p + 1))}>
              <ChevronRight size={14} />
            </Button>
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => setScale((s) => Math.max(0.6, +(s - 0.2).toFixed(2)))}>
              <ZoomOut size={14} />
            </Button>
            <span className="min-w-[44px] text-center text-xs text-zinc-400">{Math.round(scale * 100)}%</span>
            <Button size="sm" variant="ghost" onClick={() => setScale((s) => Math.min(2.2, +(s + 0.2).toFixed(2)))}>
              <ZoomIn size={14} />
            </Button>
          </div>
        </div>
      )}

      {/* 页面渲染区：限宽居中 */}
      <div className="mx-auto" style={{ maxWidth: MAX_PAGE_WIDTH + 40 }}>
        <Document
          file={url}
          onLoadSuccess={({ numPages: n }) => {
            setNumPages(n)
            setLoaded(true)
          }}
          onLoadError={(e) => setError(String(e?.message || e))}
          loading={
            <div className="flex items-center justify-center gap-2 py-14 text-sm text-zinc-500">
              <Loader2 size={16} className="animate-spin" /> PDF 加载中…
            </div>
          }
          noData={<div className="py-14 text-center text-sm text-zinc-600">暂无 PDF</div>}
          error={<div className="py-14 text-center text-sm text-red-400">PDF 加载失败</div>}
        >
          <Page
            pageNumber={pageNumber}
            width={pageWidth}
            renderTextLayer={false}
            renderAnnotationLayer={false}
            loading={
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-500">
                <Loader2 size={16} className="animate-spin" /> 渲染第 {pageNumber} 页…
              </div>
            }
            className="mx-auto overflow-hidden rounded-lg border border-zinc-800 bg-white shadow-2xl shadow-black/40"
          />
        </Document>
      </div>
    </div>
  )
}
