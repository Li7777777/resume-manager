// 证件照存储约定：文件随私有数据仓版本化，basics.yml 只记录仓内相对路径。
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'

const PHOTO_DIR = 'assets'
const PHOTO_BASENAME = 'profile-photo'
const PHOTO_RE = /^assets\/profile-photo\.(jpg|png)$/
const PHOTO_TYPES = {
  jpg: 'image/jpeg',
  png: 'image/png',
}
const MAX_PHOTO_PIXELS = 50_000_000
const MAX_PHOTO_SIDE = 16_000
const JPEG_SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])

function safeRepoFile(repo, relative) {
  const root = path.resolve(repo)
  const absolute = path.resolve(root, relative)
  if (!absolute.startsWith(root + path.sep)) throw new Error('证件照路径不在数据仓内')
  if (!fs.existsSync(root)) throw new Error('数据仓不存在')
  const rootReal = fs.realpathSync(root)
  let current = absolute
  while (current !== root) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      throw new Error('证件照目录不能使用符号链接或目录联接')
    }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  let existing = absolute
  while (!fs.existsSync(existing) && existing !== root) existing = path.dirname(existing)
  const existingReal = fs.realpathSync(existing)
  if (existingReal !== rootReal && !existingReal.startsWith(rootReal + path.sep)) {
    throw new Error('证件照真实路径不在数据仓内')
  }
  return absolute
}

export function detectProfilePhotoType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { extension: 'jpg', mime: PHOTO_TYPES.jpg }
  }
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) {
    return { extension: 'png', mime: PHOTO_TYPES.png }
  }
  return null
}

function readPngDimensions(buffer) {
  let offset = 8
  let width = 0
  let height = 0
  let hasImageData = false
  let hasEnd = false
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const end = offset + 12 + length
    if (end > buffer.length) throw new Error('PNG 图片数据不完整')
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    if (offset === 8 && (type !== 'IHDR' || length !== 13)) throw new Error('PNG 图片头无效')
    if (type === 'IHDR') {
      width = buffer.readUInt32BE(offset + 8)
      height = buffer.readUInt32BE(offset + 12)
    } else if (type === 'IDAT') {
      hasImageData = true
    } else if (type === 'IEND') {
      if (length !== 0) throw new Error('PNG 结束标记无效')
      hasEnd = true
      break
    }
    offset = end
  }
  if (!width || !height || !hasImageData || !hasEnd) throw new Error('PNG 图片数据不完整')
  return { width, height }
}

function readJpegDimensions(buffer) {
  let offset = 2
  let width = 0
  let height = 0
  let hasScan = false
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1
      continue
    }
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1
    if (offset >= buffer.length) break
    const marker = buffer[offset]
    offset += 1
    if (marker === 0xd9) break
    if (marker === 0xda) {
      hasScan = true
      break
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > buffer.length) throw new Error('JPEG 图片数据不完整')
    const length = buffer.readUInt16BE(offset)
    if (length < 2 || offset + length > buffer.length) throw new Error('JPEG 图片数据不完整')
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (length < 7) throw new Error('JPEG 图片尺寸无效')
      height = buffer.readUInt16BE(offset + 3)
      width = buffer.readUInt16BE(offset + 5)
    }
    offset += length
  }
  const hasEnd = buffer.lastIndexOf(Buffer.from([0xff, 0xd9])) >= 2
  if (!width || !height || !hasScan || !hasEnd) throw new Error('JPEG 图片数据不完整')
  return { width, height }
}

function decodeProfilePhoto(buffer, type, dimensions) {
  try {
    const decoded = type.extension === 'png'
      ? PNG.sync.read(buffer, { checkCRC: true })
      : jpeg.decode(buffer, {
          useTArray: true,
          formatAsRGBA: false,
          maxResolutionInMP: 50,
          maxMemoryUsageInMB: 256,
        })
    if (decoded.width !== dimensions.width || decoded.height !== dimensions.height || !decoded.data?.length) {
      throw new Error('图片尺寸与解码结果不一致')
    }
  } catch (error) {
    throw new Error(`${type.extension === 'png' ? 'PNG' : 'JPEG'} 图片无法完整解码：${error.message}`)
  }
}

export function inspectProfilePhoto(buffer) {
  const type = detectProfilePhotoType(buffer)
  if (!type) throw new Error('仅支持有效的 JPEG 或 PNG 图片')
  const dimensions = type.extension === 'png' ? readPngDimensions(buffer) : readJpegDimensions(buffer)
  const { width, height } = dimensions
  if (width > MAX_PHOTO_SIDE || height > MAX_PHOTO_SIDE || width * height > MAX_PHOTO_PIXELS) {
    throw new Error('证件照像素过大，请压缩后重试（最大 50MP）')
  }
  decodeProfilePhoto(buffer, type, dimensions)
  return { ...type, ...dimensions }
}

export function resolveProfilePhoto(repo, relative) {
  const normalized = typeof relative === 'string' ? relative.trim().replace(/\\/g, '/') : ''
  const match = normalized.match(PHOTO_RE)
  if (!match) return null
  const file = safeRepoFile(repo, normalized)
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null
  return { relative: normalized, file, mime: PHOTO_TYPES[match[1]] }
}

function cleanupProfilePhotoBackups(backups) {
  let failures = 0
  for (const { backup } of backups) {
    try {
      fs.rmSync(backup, { force: true })
    } catch {
      failures += 1
    }
  }
  return failures ? [`有 ${failures} 个证件照事务备份未能清理，请检查 assets/.profile-photo-*.bak`] : []
}

function rollbackProfilePhotoTransaction(cause, { installed, staged, backups }) {
  const recoveryErrors = []
  if (installed) {
    try {
      fs.rmSync(installed, { force: true })
    } catch (error) {
      recoveryErrors.push(error)
    }
  }
  if (staged) {
    try {
      fs.rmSync(staged, { force: true })
    } catch (error) {
      recoveryErrors.push(error)
    }
  }
  for (const { original, backup } of [...backups].reverse()) {
    try {
      if (fs.existsSync(backup)) fs.renameSync(backup, original)
    } catch (error) {
      recoveryErrors.push(error)
    }
  }
  if (recoveryErrors.length) {
    throw new AggregateError([cause, ...recoveryErrors], `证件照操作失败且有 ${recoveryErrors.length} 项回滚未完成`)
  }
  throw cause
}

function backupProfilePhotoFiles(repo, token, backups) {
  for (const extension of Object.keys(PHOTO_TYPES)) {
    const original = safeRepoFile(repo, `${PHOTO_DIR}/${PHOTO_BASENAME}.${extension}`)
    if (!fs.existsSync(original)) continue
    const backup = safeRepoFile(repo, `${PHOTO_DIR}/.${PHOTO_BASENAME}-${extension}-${token}.bak`)
    fs.renameSync(original, backup)
    backups.push({ original, backup })
  }
}

export function recoverProfilePhotoTransactions(repo, activeRelative) {
  const dir = safeRepoFile(repo, PHOTO_DIR)
  if (!fs.existsSync(dir)) return
  const entries = fs.readdirSync(dir)
  const hasTmp = entries.some((name) => name.startsWith(`.${PHOTO_BASENAME}-`) && name.endsWith('.tmp'))
  const baks = entries.filter((name) => /^\.profile-photo-(jpg|png)-.+\.bak$/.test(name))
  if (!hasTmp && baks.length === 0) return

  const activeExtension = typeof activeRelative === 'string'
    ? activeRelative.replace(/\\/g, '/').match(PHOTO_RE)?.[1] || null
    : null

  for (const name of entries) {
    if (name.startsWith(`.${PHOTO_BASENAME}-`) && name.endsWith('.tmp')) {
      fs.rmSync(path.join(dir, name), { force: true })
    }
  }
  for (const name of baks) {
    const match = name.match(/^\.profile-photo-(jpg|png)-/)
    if (!match) continue
    const extension = match[1]
    const live = path.join(dir, `profile-photo.${extension}`)
    const backup = path.join(dir, name)
    if (activeExtension === extension && !fs.existsSync(live)) {
      fs.renameSync(backup, live)
    } else {
      fs.rmSync(backup, { force: true })
    }
  }
  for (const extension of Object.keys(PHOTO_TYPES)) {
    if (activeExtension && extension === activeExtension) continue
    fs.rmSync(path.join(dir, `profile-photo.${extension}`), { force: true })
  }
}

export function replaceProfilePhoto(repo, buffer, persist) {
  const type = inspectProfilePhoto(buffer)
  const dir = safeRepoFile(repo, PHOTO_DIR)
  fs.mkdirSync(dir, { recursive: true })

  const token = crypto.randomUUID()
  const staged = safeRepoFile(repo, `${PHOTO_DIR}/.${PHOTO_BASENAME}-${token}.tmp`)
  const relative = `${PHOTO_DIR}/${PHOTO_BASENAME}.${type.extension}`
  const file = safeRepoFile(repo, relative)
  const backups = []
  let installed = false

  try {
    fs.writeFileSync(staged, buffer, { flag: 'wx' })
    backupProfilePhotoFiles(repo, token, backups)
    fs.renameSync(staged, file)
    installed = true
    const photo = { relative, file, mime: type.mime, width: type.width, height: type.height }
    const result = persist(photo)
    const warnings = cleanupProfilePhotoBackups(backups)
    return { photo, result, warnings }
  } catch (error) {
    rollbackProfilePhotoTransaction(error, { installed: installed ? file : null, staged, backups })
  }
}

export function writeProfilePhoto(repo, buffer) {
  return replaceProfilePhoto(repo, buffer, () => null).photo
}

export function deleteProfilePhoto(repo, persist) {
  const token = crypto.randomUUID()
  const backups = []
  try {
    backupProfilePhotoFiles(repo, token, backups)
    const result = persist()
    const warnings = cleanupProfilePhotoBackups(backups)
    return { result, warnings }
  } catch (error) {
    rollbackProfilePhotoTransaction(error, { installed: null, staged: null, backups })
  }
}

export function deleteProfilePhotoFiles(repo) {
  for (const extension of Object.keys(PHOTO_TYPES)) {
    const file = safeRepoFile(repo, `${PHOTO_DIR}/${PHOTO_BASENAME}.${extension}`)
    if (fs.existsSync(file)) fs.unlinkSync(file)
  }
}
