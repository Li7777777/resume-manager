export const ONE_INCH_PHOTO_WIDTH = 295
export const ONE_INCH_PHOTO_HEIGHT = 413
export const ONE_INCH_PHOTO_DPI = 300
export const ONE_INCH_PHOTO_ASPECT = ONE_INCH_PHOTO_WIDTH / ONE_INCH_PHOTO_HEIGHT
export const MAX_SOURCE_PHOTO_BYTES = 20 * 1024 * 1024
export const MAX_SOURCE_PHOTO_PIXELS = 50_000_000
export const MAX_SOURCE_PHOTO_SIDE = 16_000

const JPEG_SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])

export interface PhotoCropArea {
  x: number
  y: number
  width: number
  height: number
}

function readUint16(bytes: Uint8Array, offset: number) {
  return (bytes[offset] << 8) | bytes[offset + 1]
}

function readUint32(bytes: Uint8Array, offset: number) {
  return ((bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0
}

function inspectPng(bytes: Uint8Array) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < 33 || !signature.every((value, index) => bytes[index] === value)) return null
  let offset = 8
  let width = 0
  let height = 0
  let hasImageData = false
  let hasEnd = false
  while (offset + 12 <= bytes.length) {
    const length = readUint32(bytes, offset)
    const end = offset + 12 + length
    if (end > bytes.length) throw new Error('PNG 图片数据不完整')
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    if (offset === 8 && (type !== 'IHDR' || length !== 13)) throw new Error('PNG 图片头无效')
    if (type === 'IHDR') {
      width = readUint32(bytes, offset + 8)
      height = readUint32(bytes, offset + 12)
    } else if (type === 'IDAT') {
      hasImageData = true
    } else if (type === 'IEND') {
      hasEnd = length === 0
      break
    }
    offset = end
  }
  if (!width || !height || !hasImageData || !hasEnd) throw new Error('PNG 图片数据不完整')
  return { width, height, mime: 'image/png' }
}

function inspectJpeg(bytes: Uint8Array) {
  if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null
  let offset = 2
  let width = 0
  let height = 0
  let hasScan = false
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
    if (offset >= bytes.length) break
    const marker = bytes[offset]
    offset += 1
    if (marker === 0xd9) break
    if (marker === 0xda) {
      hasScan = true
      break
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > bytes.length) throw new Error('JPEG 图片数据不完整')
    const length = readUint16(bytes, offset)
    if (length < 2 || offset + length > bytes.length) throw new Error('JPEG 图片数据不完整')
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (length < 7) throw new Error('JPEG 图片尺寸无效')
      height = readUint16(bytes, offset + 3)
      width = readUint16(bytes, offset + 5)
    }
    offset += length
  }
  let hasEnd = false
  for (let index = bytes.length - 2; index >= 2; index -= 1) {
    if (bytes[index] === 0xff && bytes[index + 1] === 0xd9) {
      hasEnd = true
      break
    }
  }
  if (!width || !height || !hasScan || !hasEnd) throw new Error('JPEG 图片数据不完整')
  return { width, height, mime: 'image/jpeg' }
}

export async function inspectPhotoFile(file: File) {
  if (file.size > MAX_SOURCE_PHOTO_BYTES) throw new Error('原图不能超过 20 MB')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const dimensions = inspectPng(bytes) || inspectJpeg(bytes)
  if (!dimensions) throw new Error('仅支持有效的 JPEG 或 PNG 图片')
  if (dimensions.mime !== file.type) throw new Error('图片内容与文件类型不一致')
  if (
    dimensions.width > MAX_SOURCE_PHOTO_SIDE
    || dimensions.height > MAX_SOURCE_PHOTO_SIDE
    || dimensions.width * dimensions.height > MAX_SOURCE_PHOTO_PIXELS
  ) {
    throw new Error('原图像素过大，请压缩后重试（最大 50MP）')
  }
  return dimensions
}

export function loadPhotoImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) resolve(image)
      else reject(new Error('无法读取图片尺寸'))
    }
    image.onerror = () => reject(new Error('图片无法解码，请重新选择 JPEG 或 PNG 文件'))
    image.src = source
  })
}

function setJpegDensity(bytes: Uint8Array, dpi: number) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('生成的证件照不是有效 JPEG')
  let offset = 2
  while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1]
    if (marker === 0xda || marker === 0xd9) break
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3]
    if (length < 2 || offset + 2 + length > bytes.length) break
    const data = offset + 4
    const jfif = marker === 0xe0
      && length >= 16
      && bytes[data] === 0x4a && bytes[data + 1] === 0x46
      && bytes[data + 2] === 0x49 && bytes[data + 3] === 0x46
      && bytes[data + 4] === 0
    if (jfif) {
      bytes[data + 7] = 1
      bytes[data + 8] = (dpi >> 8) & 0xff
      bytes[data + 9] = dpi & 0xff
      bytes[data + 10] = (dpi >> 8) & 0xff
      bytes[data + 11] = dpi & 0xff
      return bytes
    }
    offset += 2 + length
  }

  const jfif = new Uint8Array([
    0xff, 0xe0, 0x00, 0x10,
    0x4a, 0x46, 0x49, 0x46, 0x00,
    0x01, 0x01, 0x01,
    (dpi >> 8) & 0xff, dpi & 0xff,
    (dpi >> 8) & 0xff, dpi & 0xff,
    0x00, 0x00,
  ])
  const result = new Uint8Array(bytes.length + jfif.length)
  result.set(bytes.subarray(0, 2), 0)
  result.set(jfif, 2)
  result.set(bytes.subarray(2), 2 + jfif.length)
  return result
}

export async function createOneInchPhoto(source: string, crop: PhotoCropArea): Promise<File> {
  const image = await loadPhotoImage(source)
  const x = Math.max(0, Math.min(Math.round(crop.x), image.naturalWidth - 1))
  const y = Math.max(0, Math.min(Math.round(crop.y), image.naturalHeight - 1))
  const width = Math.min(Math.max(1, Math.round(crop.width)), image.naturalWidth - x)
  const height = Math.min(Math.max(1, Math.round(crop.height)), image.naturalHeight - y)
  if (width <= 0 || height <= 0) throw new Error('裁剪区域无效，请重新调整照片')

  const canvas = document.createElement('canvas')
  canvas.width = ONE_INCH_PHOTO_WIDTH
  canvas.height = ONE_INCH_PHOTO_HEIGHT
  const context = canvas.getContext('2d')
  if (!context) throw new Error('当前浏览器不支持照片裁剪')

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, x, y, width, height, 0, 0, canvas.width, canvas.height)

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => result ? resolve(result) : reject(new Error('生成裁剪照片失败')),
      'image/jpeg',
      0.92,
    )
  })
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const jpeg = setJpegDensity(bytes, ONE_INCH_PHOTO_DPI)
  const output = new ArrayBuffer(jpeg.byteLength)
  new Uint8Array(output).set(jpeg)
  return new File([output], 'profile-photo.jpg', { type: 'image/jpeg', lastModified: Date.now() })
}
