// 更强大的 PDF 渲染组件：基于 react-pdf（pdf.js 封装）
// 支持：缩放、翻页、加载/错误状态；定制页可按可视区域完整适配单页。
import React, { useEffect, useRef, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { ChevronLeft, ChevronRight, Loader2, ZoomIn, ZoomOut, FileWarning } from 'lucide-react'
import { Button } from './ui'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const MAX_PAGE_WIDTH = 720 // 非全页模式的页面最大渲染宽度（px）
const FIT_PAGE_GAP = 16
const DEFAULT_PAGE_ASPECT = 1 / Math.SQRT2 // A4 宽 / 高

export default function PdfViewer({ url, fitPage = false }: { url: string; fitPage?: boolean }) {
  const [numPages, setNumPages] = useState(0)
  const [pageNumber, setPageNumber] = useState(1)
  const [scale, setScale] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })
  const [toolbarHeight, setToolbarHeight] = useState(0)
  const [pageAspect, setPageAspect] = useState(DEFAULT_PAGE_ASPECT)

  useEffect(() => {
    setNumPages(0)
    setPageNumber(1)
    setError(null)
    setLoaded(false)
    setScale(1)
    setPageAspect(DEFAULT_PAGE_ASPECT)
  }, [url])

  // 响应容器和工具栏尺寸，整页模式据此做 contain 缩放。
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const measure = () => {
      setContainerSize({ width: container.clientWidth, height: container.clientHeight })
      setToolbarHeight(toolbarRef.current?.offsetHeight || 0)
    }
    const ro = new ResizeObserver(measure)
    ro.observe(container)
    if (toolbarRef.current) ro.observe(toolbarRef.current)
    measure()
    return () => ro.disconnect()
  }, [loaded])

  const standardWidth = containerSize.width ? Math.min(containerSize.width, MAX_PAGE_WIDTH) : 640
  const fittedWidth = containerSize.width && containerSize.height
    ? Math.min(
        Math.max(1, containerSize.width - 4),
        Math.max(1, containerSize.height - toolbarHeight - FIT_PAGE_GAP) * pageAspect,
      )
    : standardWidth
  const pageWidth = (fitPage ? fittedWidth : standardWidth) * scale

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/5 py-14 text-sm text-red-300">
        <FileWarning size={28} />
        <p>PDF 渲染失败：{error}</p>
      </div>
    )
  }

  return (
    <div ref={containerRef} className={fitPage ? 'flex h-full min-h-0 flex-col' : ''}>
      {/* 工具栏 */}
      {loaded && numPages > 0 && (
        <div ref={toolbarRef} className="mb-3 flex shrink-0 items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/70 px-3 py-2">
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

      {/* 页面渲染区：定制页整页适配，其余页面维持宽度优先。 */}
      <div
        className={fitPage ? 'flex min-h-0 flex-1 items-center justify-center overflow-auto' : 'mx-auto'}
        style={fitPage ? undefined : { maxWidth: MAX_PAGE_WIDTH + 40 }}
      >
        <Document
          file={url}
          onLoadSuccess={(pdf) => {
            setNumPages(pdf.numPages)
            setLoaded(true)
            void pdf.getPage(1).then((page) => {
              const viewport = page.getViewport({ scale: 1 })
              if (viewport.width > 0 && viewport.height > 0) setPageAspect(viewport.width / viewport.height)
            }).catch(() => {})
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
