import React, { useState } from 'react'
import Cropper, { type Area, type Point } from 'react-easy-crop'
import { Crop, Minus, Plus, RotateCcw } from 'lucide-react'
import { Button, Modal } from './ui'
import { useToast } from '../toast'
import {
  createOneInchPhoto,
  ONE_INCH_PHOTO_ASPECT,
  ONE_INCH_PHOTO_DPI,
  ONE_INCH_PHOTO_HEIGHT,
  ONE_INCH_PHOTO_WIDTH,
} from '../lib/profile-photo-crop'

const MIN_ZOOM = 1
const MAX_ZOOM = 4
const ZOOM_STEP = 0.15

interface ProfilePhotoCropperProps {
  source: string
  uploading: boolean
  onCancel: () => void
  onUpload: (file: File) => Promise<void>
}

export default function ProfilePhotoCropper({ source, uploading, onCancel, onUpload }: ProfilePhotoCropperProps) {
  const toast = useToast()
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [cropPixels, setCropPixels] = useState<Area | null>(null)
  const [exporting, setExporting] = useState(false)
  const processing = uploading || exporting

  const reset = () => {
    setCrop({ x: 0, y: 0 })
    setZoom(1)
  }

  const confirm = async () => {
    if (!cropPixels || processing) return
    setExporting(true)
    try {
      await onUpload(await createOneInchPhoto(source, cropPixels))
    } catch (error) {
      toast('error', error instanceof Error ? error.message : '裁剪照片失败，请重试')
    } finally {
      setExporting(false)
    }
  }

  const setClampedZoom = (value: number) => setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value)))

  return (
    <Modal open title="裁剪证件照" onClose={() => !processing && onCancel()} wide>
      <div className="space-y-4" data-photo-crop-dialog>
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
          <span className="inline-flex items-center gap-1.5 font-medium text-zinc-200">
            <Crop size={14} className="text-indigo-400" /> 标准一寸
          </span>
          <span className="text-zinc-700">/</span>
          <span>25 × 35 mm</span>
          <span className="text-zinc-700">/</span>
          <span>{ONE_INCH_PHOTO_WIDTH} × {ONE_INCH_PHOTO_HEIGHT} px · {ONE_INCH_PHOTO_DPI} DPI</span>
        </div>

        <div
          className="relative h-[46vh] min-h-[300px] max-h-[520px] overflow-hidden rounded-md bg-black sm:h-[56vh]"
          data-photo-crop-viewport
        >
          <Cropper
            image={source}
            crop={crop}
            zoom={zoom}
            aspect={ONE_INCH_PHOTO_ASPECT}
            minZoom={MIN_ZOOM}
            maxZoom={MAX_ZOOM}
            cropShape="rect"
            objectFit="contain"
            showGrid
            restrictPosition
            roundCropAreaPixels
            zoomWithScroll
            zoomSpeed={0.2}
            keyboardStep={2}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={(_area, pixels) => setCropPixels(pixels)}
            mediaProps={{ alt: '待裁剪证件照' }}
            cropperProps={{ 'aria-label': '证件照裁剪区域' }}
            style={{
              containerStyle: { backgroundColor: '#09090b' },
              cropAreaStyle: {
                border: '1px solid rgba(255,255,255,.9)',
                boxShadow: '0 0 0 9999px rgba(0,0,0,.58)',
              },
            }}
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            title="缩小"
            aria-label="缩小照片"
            disabled={processing || zoom <= MIN_ZOOM}
            onClick={() => setClampedZoom(zoom - ZOOM_STEP)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-35"
          >
            <Minus size={15} />
          </button>
          <label className="flex min-w-0 flex-1 items-center gap-3">
            <span className="shrink-0 text-xs text-zinc-500">缩放</span>
            <input
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step="0.01"
              value={zoom}
              disabled={processing}
              aria-label="照片缩放"
              onChange={(event) => setZoom(Number(event.target.value))}
              className="h-1.5 min-w-0 flex-1 cursor-pointer accent-indigo-500 disabled:cursor-not-allowed"
            />
            <span className="w-9 text-right text-xs tabular-nums text-zinc-500">{zoom.toFixed(1)}×</span>
          </label>
          <button
            type="button"
            title="放大"
            aria-label="放大照片"
            disabled={processing || zoom >= MAX_ZOOM}
            onClick={() => setClampedZoom(zoom + ZOOM_STEP)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-35"
          >
            <Plus size={15} />
          </button>
          <button
            type="button"
            title="重置位置和缩放"
            aria-label="重置裁剪"
            disabled={processing || (zoom === 1 && crop.x === 0 && crop.y === 0)}
            onClick={reset}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-35"
          >
            <RotateCcw size={14} />
          </button>
        </div>

        <div className="flex justify-end gap-2 border-t border-zinc-800 pt-4">
          <Button type="button" disabled={processing} onClick={onCancel}>取消</Button>
          <Button type="button" variant="primary" loading={processing} disabled={!cropPixels} onClick={() => void confirm()}>
            <Crop size={14} /> 裁剪并上传
          </Button>
        </div>
      </div>
    </Modal>
  )
}
