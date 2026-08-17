// 证件照裁剪端到端测试：临时数据仓、浏览器裁剪、输出格式、安全与原子替换。
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import puppeteer from 'puppeteer-core'
import { buildVariant } from '../server/lib/builder.js'
import { deleteProfilePhoto, recoverProfilePhotoTransactions, replaceProfilePhoto, resolveProfilePhoto } from '../server/lib/profile-photo.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BROWSER_CANDIDATES = [
  process.env.EDGE_PATH,
  process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : null,
  process.platform === 'win32' ? 'C:/Program Files/Microsoft/Edge/Application/msedge.exe' : null,
  process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : null,
  process.platform === 'linux' ? '/usr/bin/microsoft-edge' : null,
  process.platform === 'linux' ? '/usr/bin/google-chrome' : null,
  process.platform === 'linux' ? '/usr/bin/chromium' : null,
  process.platform === 'linux' ? '/usr/bin/chromium-browser' : null,
  process.platform === 'darwin' ? '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' : null,
  process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : null,
].filter(Boolean)
const BROWSER = BROWSER_CANDIDATES.find((candidate) => fs.existsSync(candidate))
if (!BROWSER) throw new Error('未找到 Edge/Chrome/Chromium；可通过 EDGE_PATH 指定浏览器路径')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function availablePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => resolve(address.port))
    })
  })
}

async function waitForServer(base) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/health`)
      if (response.ok) return
    } catch {
      // Server is still starting.
    }
    await sleep(250)
  }
  throw new Error('测试服务启动超时')
}

function jpegDensity(buffer) {
  let offset = 2
  while (offset + 16 <= buffer.length && buffer[offset] === 0xff) {
    const marker = buffer[offset + 1]
    const length = (buffer[offset + 2] << 8) | buffer[offset + 3]
    const data = offset + 4
    if (marker === 0xe0 && buffer.subarray(data, data + 5).toString('binary') === 'JFIF\0') {
      return {
        unit: buffer[data + 7],
        x: (buffer[data + 8] << 8) | buffer[data + 9],
        y: (buffer[data + 10] << 8) | buffer[data + 11],
      }
    }
    if (length < 2) break
    offset += 2 + length
  }
  return null
}

function oversizedPng() {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const chunk = (type, data) => {
    const result = Buffer.alloc(12 + data.length)
    result.writeUInt32BE(data.length, 0)
    result.write(type, 4, 4, 'ascii')
    data.copy(result, 8)
    return result
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(16_001, 0)
  ihdr.writeUInt32BE(10, 4)
  ihdr.set([8, 2, 0, 0, 0], 8)
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', Buffer.alloc(0)), chunk('IEND', Buffer.alloc(0))])
}

function malformedPng() {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const chunk = (type, data) => {
    const result = Buffer.alloc(12 + data.length)
    result.writeUInt32BE(data.length, 0)
    result.write(type, 4, 4, 'ascii')
    data.copy(result, 8)
    return result
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(1, 0)
  ihdr.writeUInt32BE(1, 4)
  ihdr.set([8, 2, 0, 0, 0], 8)
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', Buffer.alloc(0)), chunk('IEND', Buffer.alloc(0))])
}

function malformedJpeg() {
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
    0xff, 0xd9,
  ])
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-manager-photo-crop-'))
const repo = path.join(temp, 'repo')
const home = path.join(temp, 'home')
const fixture = path.join(temp, 'source.png')
const portraitFixture = path.join(temp, 'portrait.png')
const invalidFixture = path.join(temp, 'invalid.jpg')
const oversizedFixture = path.join(temp, 'oversized.png')
const tooLargeFixture = path.join(temp, 'too-large.png')
const log = path.join(temp, 'server.log')
let browser
let server

try {
  fs.cpSync(path.join(ROOT, 'templates/private-repo'), repo, { recursive: true })
  fs.mkdirSync(path.join(home, '.resume-manager'), { recursive: true })
  fs.writeFileSync(path.join(home, '.resume-manager/settings.json'), JSON.stringify({
    repoPath: repo,
    localPdfBuild: true,
    githubPdfBuild: false,
    gitSyncEnabled: false,
    starsEnabled: false,
  }, null, 2))

  const port = await availablePort()
  const base = `http://127.0.0.1:${port}`
  const logFd = fs.openSync(log, 'w')
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, HOME: home, USERPROFILE: home, NODE_ENV: 'production', PORT: String(port) },
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
  })
  fs.closeSync(logFd)
  await waitForServer(base)

  browser = await puppeteer.launch({ executablePath: BROWSER, headless: 'new' })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(`[page] ${String(error)}`))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`[console] ${message.text()}`) })

  await page.goto('about:blank')
  const sourceData = await page.evaluate(() => {
    const encode = (width, height, draw) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      draw(context)
      return canvas.toDataURL('image/png').split(',')[1]
    }
    const landscape = encode(1200, 800, (context) => {
      context.fillStyle = '#2b6cb0'
      context.fillRect(0, 120, 600, 680)
      context.fillStyle = '#c53030'
      context.fillRect(600, 120, 600, 680)
      context.fillStyle = '#f7fafc'
      context.beginPath()
      context.arc(600, 315, 180, 0, Math.PI * 2)
      context.fill()
      context.fillStyle = '#2d3748'
      context.fillRect(455, 500, 290, 260)
    })
    const portrait = encode(600, 1200, (context) => {
      context.fillStyle = '#166534'
      context.fillRect(0, 0, 600, 600)
      context.fillStyle = '#b91c1c'
      context.fillRect(0, 600, 600, 600)
    })
    return { landscape, portrait }
  })
  fs.writeFileSync(fixture, Buffer.from(sourceData.landscape, 'base64'))
  fs.writeFileSync(portraitFixture, Buffer.from(sourceData.portrait, 'base64'))
  fs.writeFileSync(invalidFixture, Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00,
  ]))
  fs.writeFileSync(oversizedFixture, oversizedPng())
  fs.writeFileSync(tooLargeFixture, Buffer.alloc(20 * 1024 * 1024 + 1))

  await page.setViewport({ width: 1440, height: 950 })
  await page.goto(`${base}/#/entries`, { waitUntil: 'networkidle2', timeout: 60_000 })
  await page.evaluate(() => {
    const tab = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim().startsWith('基础信息'))
    if (tab instanceof HTMLButtonElement) tab.click()
  })
  await page.waitForSelector('input[type="file"]')

  const uploadFixture = async (file) => {
    const input = await page.$('input[type="file"]')
    await input.uploadFile(file)
  }
  const openCropper = async () => {
    await uploadFixture(fixture)
    await page.waitForSelector('[data-photo-crop-dialog]', { timeout: 10_000 })
  }

  await openCropper()
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '关闭弹窗')
  await page.keyboard.down('Shift')
  await page.keyboard.press('Tab')
  await page.keyboard.up('Shift')
  const wrapsToEnd = await page.evaluate(() => document.activeElement?.textContent?.includes('裁剪并上传') || false)
  await page.keyboard.press('Tab')
  const wrapsToStart = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === '关闭弹窗')
  const initial = await page.evaluate((focusTrap) => ({
    standard: document.body.innerText.includes('标准一寸')
      && document.body.innerText.includes('25 × 35 mm')
      && document.body.innerText.includes('295 × 413 px · 300 DPI'),
    dialog: document.querySelector('[role="dialog"]')?.getAttribute('aria-modal') === 'true',
    cropper: !!document.querySelector('[aria-label="证件照裁剪区域"]'),
    slider: !!document.querySelector('input[aria-label="照片缩放"]'),
    closeName: !!document.querySelector('button[aria-label="关闭弹窗"]'),
    focusTrap,
  }), wrapsToEnd && wrapsToStart)
  await page.evaluate(() => {
    const cancel = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === '取消')
    if (cancel instanceof HTMLButtonElement) cancel.click()
  })
  await page.waitForSelector('[data-photo-crop-dialog]', { hidden: true })
  const cancelPreserved = !fs.existsSync(path.join(repo, 'assets/profile-photo.jpg'))

  await openCropper()
  const viewports = []
  for (const viewport of [{ width: 390, height: 844 }, { width: 1024, height: 768 }, { width: 1440, height: 950 }]) {
    await page.setViewport(viewport)
    await sleep(200)
    viewports.push(await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]')?.getBoundingClientRect()
      const crop = document.querySelector('[data-photo-crop-viewport]')?.getBoundingClientRect()
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        dialogInside: !!dialog && dialog.left >= 0 && dialog.right <= innerWidth,
        cropInside: !!crop && crop.left >= 0 && crop.right <= innerWidth,
      }
    }))
  }

  await page.$eval('input[aria-label="照片缩放"]', (input) => {
    input.value = '1.65'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  const cropper = await page.$('[aria-label="证件照裁剪区域"]')
  const box = await cropper.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 - 65, box.y + box.height / 2 + 30, { steps: 8 })
  await page.mouse.up()
  const cropRatio = await page.$eval('.reactEasyCrop_CropArea', (element) => {
    const rect = element.getBoundingClientRect()
    return rect.width / rect.height
  })
  await page.evaluate(() => {
    const confirm = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('裁剪并上传'))
    if (confirm instanceof HTMLButtonElement) confirm.click()
  })
  await page.waitForSelector('img[alt="证件照预览"]', { timeout: 30_000 })
  await page.waitForFunction(() => !document.querySelector('[data-photo-crop-dialog]'), { timeout: 30_000 })

  const uploaded = await page.evaluate(async () => {
    const response = await fetch('/api/entries/basics/photo')
    const blob = await response.blob()
    const bitmap = await createImageBitmap(blob)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    context.drawImage(bitmap, 0, 0)
    const corner = [...context.getImageData(0, 0, 1, 1).data]
    const preview = document.querySelector('img[alt="证件照预览"]')?.parentElement?.getBoundingClientRect()
    const result = {
      status: response.status,
      type: blob.type,
      size: blob.size,
      width: bitmap.width,
      height: bitmap.height,
      corner,
      previewRatio: preview ? preview.width / preview.height : 0,
    }
    bitmap.close()
    return result
  })

  const stored = path.join(repo, 'assets/profile-photo.jpg')
  const savedPhoto = fs.readFileSync(stored)
  const basics = yaml.load(fs.readFileSync(path.join(repo, 'data/basics.yml'), 'utf8'))
  const density = jpegDensity(savedPhoto)

  await uploadFixture(invalidFixture)
  await page.waitForFunction(() => document.body.innerText.includes('JPEG 图片数据不完整'), { timeout: 10_000 })
  const invalidPreserved = savedPhoto.equals(fs.readFileSync(stored)) && !await page.$('[data-photo-crop-dialog]')
  await uploadFixture(oversizedFixture)
  await page.waitForFunction(() => document.body.innerText.includes('最大 50MP'), { timeout: 10_000 })
  const oversizedPreserved = savedPhoto.equals(fs.readFileSync(stored)) && !await page.$('[data-photo-crop-dialog]')
  await uploadFixture(tooLargeFixture)
  await page.waitForFunction(() => document.body.innerText.includes('原图不能超过 20 MB'), { timeout: 10_000 })
  const tooLargePreserved = savedPhoto.equals(fs.readFileSync(stored)) && !await page.$('[data-photo-crop-dialog]')

  const spoofResponse = await fetch(`${base}/api/entries/basics/photo`, {
    method: 'POST',
    headers: { 'content-type': 'image/jpeg' },
    body: Buffer.from('not-a-jpeg'),
  })
  const malformedPngResponse = await fetch(`${base}/api/entries/basics/photo`, {
    method: 'POST',
    headers: { 'content-type': 'image/png' },
    body: malformedPng(),
  })
  const malformedJpegResponse = await fetch(`${base}/api/entries/basics/photo`, {
    method: 'POST',
    headers: { 'content-type': 'image/jpeg' },
    body: malformedJpeg(),
  })
  const overLimitResponse = await fetch(`${base}/api/entries/basics/photo`, {
    method: 'POST',
    headers: { 'content-type': 'image/jpeg' },
    body: Buffer.alloc(4 * 1024 * 1024 + 1),
  })
  const endpointPreserved = savedPhoto.equals(fs.readFileSync(stored))

  const renderLegacyPhoto = async (file, template) => {
    const uploadResponse = await fetch(`${base}/api/entries/basics/photo`, {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: fs.readFileSync(file),
    })
    if (!uploadResponse.ok) return false
    fs.writeFileSync(path.join(repo, 'scripts/variants.yml'), yaml.dump({
      defaults: { locale: 'zh-hans' },
      variants: {
        main: {
          layout: { engine: 'latex', template, typography: { fontSize: '11pt' } },
          sectionOrder: ['skills', 'work', 'education'],
          blocks: {
            basics: { include: true },
            work: { tags: ['general'] },
            skills: { tags: ['general'] },
            education: { include: 'all' },
          },
        },
      },
    }, { noRefs: true, lineWidth: -1 }))
    const build = await buildVariant(repo, 'main')
    const tex = fs.readFileSync(path.join(repo, 'resumes/main.tex'), 'utf8')
    return build.ok
      && fs.existsSync(path.join(repo, 'resumes/main.pdf'))
      && tex.includes('\\usepackage{trimclip}')
      && tex.includes('\\rmprofilephotoimage')
      && tex.includes('\\clipbox')
  }
  const landscapeCover = await renderLegacyPhoto(fixture, 'moderncv-banking')
  const portraitCover = await renderLegacyPhoto(portraitFixture, 'jake-original')
  const restoreResponse = await fetch(`${base}/api/entries/basics/photo`, {
    method: 'POST',
    headers: { 'content-type': 'image/jpeg' },
    body: savedPhoto,
  })
  const legacyRenderRestored = restoreResponse.ok && savedPhoto.equals(fs.readFileSync(stored))

  let rollbackWorked = false
  try {
    replaceProfilePhoto(repo, fs.readFileSync(fixture), () => { throw new Error('simulated metadata failure') })
  } catch (error) {
    rollbackWorked = error.message === 'simulated metadata failure'
      && savedPhoto.equals(fs.readFileSync(stored))
      && !fs.existsSync(path.join(repo, 'assets/profile-photo.png'))
  }

  let deleteRollbackWorked = false
  try {
    deleteProfilePhoto(repo, () => { throw new Error('simulated delete metadata failure') })
  } catch (error) {
    deleteRollbackWorked = error.message === 'simulated delete metadata failure'
      && savedPhoto.equals(fs.readFileSync(stored))
  }

  const deleteResponse = await fetch(`${base}/api/entries/basics/photo`, { method: 'DELETE' })
  const basicsAfterDelete = yaml.load(fs.readFileSync(path.join(repo, 'data/basics.yml'), 'utf8'))
  const deleteCommitted = deleteResponse.status === 200
    && !fs.existsSync(stored)
    && !fs.existsSync(path.join(repo, 'assets/profile-photo.png'))
    && !basicsAfterDelete.photo

  const noStagedFiles = fs.readdirSync(path.join(repo, 'assets')).every((name) => !name.startsWith('.profile-photo-'))

  // 事务恢复：模拟「备份完成但新照片尚未安装」的中断，根据 basics.photo 恢复旧照片并清理临时文件。
  const assetsDir = path.join(repo, 'assets')
  fs.writeFileSync(path.join(assetsDir, '.profile-photo-jpg-crash.bak'), savedPhoto)
  fs.writeFileSync(path.join(assetsDir, '.profile-photo-crash.tmp'), savedPhoto)
  recoverProfilePhotoTransactions(repo, 'assets/profile-photo.jpg')
  const recoveredPhoto = fs.readFileSync(path.join(assetsDir, 'profile-photo.jpg'))
  const recoveryWorked = recoveredPhoto.equals(savedPhoto)
    && !fs.existsSync(path.join(assetsDir, '.profile-photo-jpg-crash.bak'))
    && !fs.existsSync(path.join(assetsDir, '.profile-photo-crash.tmp'))
  fs.rmSync(path.join(assetsDir, 'profile-photo.jpg'), { force: true })

  // 仓路径包含：把 assets 替换为目录联接后，读取与写入都必须拒绝。
  const assetsBackup = path.join(repo, 'assets.real')
  const outside = path.join(temp, 'outside-assets')
  fs.mkdirSync(outside)
  fs.writeFileSync(path.join(outside, 'profile-photo.jpg'), savedPhoto)
  fs.renameSync(assetsDir, assetsBackup)
  let symlinkRejected = false
  let symlinkSkipped = false
  try {
    fs.symlinkSync(outside, assetsDir, 'junction')
    try {
      resolveProfilePhoto(repo, 'assets/profile-photo.jpg')
      symlinkRejected = false
    } catch (error) {
      symlinkRejected = /符号链接|symlink|link/i.test(error.message)
    }
  } catch {
    symlinkSkipped = true
  } finally {
    try { fs.rmSync(assetsDir, { recursive: true, force: true }) } catch {}
    if (fs.existsSync(assetsBackup)) fs.renameSync(assetsBackup, assetsDir)
  }

  const result = {
    initial,
    cancelPreserved,
    viewports,
    cropRatio,
    uploaded,
    density,
    storedPath: basics.photo,
    invalidPreserved,
    oversizedPreserved,
    tooLargePreserved,
    spoofStatus: spoofResponse.status,
    malformedPngStatus: malformedPngResponse.status,
    malformedJpegStatus: malformedJpegResponse.status,
    overLimitStatus: overLimitResponse.status,
    endpointPreserved,
    landscapeCover,
    portraitCover,
    legacyRenderRestored,
    rollbackWorked,
    deleteRollbackWorked,
    deleteCommitted,
    noStagedFiles,
    recoveryWorked,
    symlinkRejected,
    symlinkSkipped,
    errors,
  }
  console.log(JSON.stringify(result, null, 2))

  const passed = Object.values(initial).every(Boolean)
    && cancelPreserved
    && viewports.every((item) => !item.overflow && item.dialogInside && item.cropInside)
    && Math.abs(cropRatio - 5 / 7) < 0.01
    && uploaded.status === 200 && uploaded.type === 'image/jpeg'
    && uploaded.width === 295 && uploaded.height === 413 && uploaded.size < 4 * 1024 * 1024
    && uploaded.corner.slice(0, 3).every((value) => value >= 250)
    && Math.abs(uploaded.previewRatio - 5 / 7) < 0.01
    && density?.unit === 1 && density.x === 300 && density.y === 300
    && basics.photo === 'assets/profile-photo.jpg'
    && invalidPreserved && oversizedPreserved && tooLargePreserved
    && spoofResponse.status === 400
    && malformedPngResponse.status === 400 && malformedJpegResponse.status === 400
    && overLimitResponse.status === 413 && endpointPreserved
    && landscapeCover && portraitCover && legacyRenderRestored
    && rollbackWorked && deleteRollbackWorked && deleteCommitted && noStagedFiles
    && recoveryWorked && (symlinkRejected || symlinkSkipped)
    && errors.length === 0
  if (!passed) throw new Error('证件照裁剪验收失败')
  console.log('PHOTO_CROP_E2E_OK')
} finally {
  if (browser) await browser.close().catch(() => {})
  if (server && !server.killed) {
    server.kill()
    await Promise.race([
      new Promise((resolve) => server.once('exit', resolve)),
      sleep(2000),
    ])
  }
  fs.rmSync(temp, { recursive: true, force: true })
}
