// 证件照存储约定：文件随私有数据仓版本化，basics.yml 只记录仓内相对路径。
import fs from 'node:fs'
import path from 'node:path'

const PHOTO_DIR = 'assets'
const PHOTO_BASENAME = 'profile-photo'
const PHOTO_RE = /^assets\/profile-photo\.(jpg|png)$/
const PHOTO_TYPES = {
  jpg: 'image/jpeg',
  png: 'image/png',
}

function safeRepoFile(repo, relative) {
  const root = path.resolve(repo)
  const absolute = path.resolve(root, relative)
  if (!absolute.startsWith(root + path.sep)) throw new Error('证件照路径不在数据仓内')
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

export function resolveProfilePhoto(repo, relative) {
  const normalized = typeof relative === 'string' ? relative.trim().replace(/\\/g, '/') : ''
  const match = normalized.match(PHOTO_RE)
  if (!match) return null
  const file = safeRepoFile(repo, normalized)
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null
  return { relative: normalized, file, mime: PHOTO_TYPES[match[1]] }
}

export function writeProfilePhoto(repo, buffer) {
  const type = detectProfilePhotoType(buffer)
  if (!type) throw new Error('仅支持有效的 JPEG 或 PNG 图片')
  const dir = safeRepoFile(repo, PHOTO_DIR)
  fs.mkdirSync(dir, { recursive: true })
  deleteProfilePhotoFiles(repo)
  const relative = `${PHOTO_DIR}/${PHOTO_BASENAME}.${type.extension}`
  const file = safeRepoFile(repo, relative)
  fs.writeFileSync(file, buffer)
  return { relative, file, mime: type.mime }
}

export function deleteProfilePhotoFiles(repo) {
  for (const extension of Object.keys(PHOTO_TYPES)) {
    const file = safeRepoFile(repo, `${PHOTO_DIR}/${PHOTO_BASENAME}.${extension}`)
    if (fs.existsSync(file)) fs.unlinkSync(file)
  }
}
