// 浏览器冒烟测试：应用外壳、类型分支、PDF 时间线、定制/YAML 同步工作区与窄屏布局
import fs from 'node:fs'
import puppeteer from 'puppeteer-core'

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:8787'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new' })
const page = await browser.newPage()
const errors = []
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`[console] ${message.text()}`)
})
page.on('pageerror', (error) => errors.push(`[page] ${String(error)}`))
page.on('response', (response) => {
  if (response.status() >= 400) errors.push(`[http ${response.status()}] ${response.url()}`)
})
await page.setViewport({ width: 1600, height: 950 })

async function visit(hash, screenshot) {
  await page.goto(`${BASE}/#/${hash}`, { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(1000)
  await page.screenshot({ path: `C:/Users/Tech7/AppData/Local/Temp/${screenshot}` })
  return page.evaluate(() => ({
    text: document.body.innerText,
    buttons: [...document.querySelectorAll('button')].map((button) => button.innerText.trim()).filter(Boolean),
    nav: [...document.querySelectorAll('aside nav button')].map((button) => button.getAttribute('aria-label') || button.textContent?.trim() || ''),
    hasMainHeader: !!document.querySelector('main > header'),
    options: [...document.querySelectorAll('option')].map((option) => option.textContent?.trim() || ''),
  }))
}

console.log('=== 应用外壳 ===')
const shell = await visit('dashboard', 'rm-smoke-shell.png')
const customizerIndex = shell.nav.indexOf('简历定制')
const pdfIndex = shell.nav.indexOf('PDF 预览')
const shellOk =
  !shell.hasMainHeader &&
  !shell.nav.includes('YAML 编辑') &&
  customizerIndex >= 0 &&
  pdfIndex === customizerIndex + 1
console.log('外壳:', shellOk)

console.log('=== 简历类型分支 ===')
const types = await visit('variants', 'rm-smoke-types.png')
const typesOk =
  types.text.includes('一个简历类型对应一个独立 Git 分支') &&
  types.text.includes('main') &&
  !types.text.includes('resume/general') &&
  !types.text.includes('resume/frontend') &&
  !types.text.includes('resume/management') &&
  !types.text.includes('简历模板')
console.log('类型页:', typesOk)

console.log('=== PDF 只读时间线 ===')
await visit('pdf', 'rm-smoke-pdf.png')
await page.select('select', 'main')
await page.waitForFunction(() => document.body.innerText.includes('main'), { timeout: 20000 }).catch(() => {})
const pdf = await page.evaluate(() => ({
  text: document.body.innerText,
  actions: [...document.querySelectorAll('main button')].map((button) => button.innerText.trim()).filter(Boolean),
}))
const pdfOk =
  pdf.text.includes('main') &&
  pdf.text.includes('此页面只显示正式版与 Git 版本') &&
  !pdf.text.includes('本地预览') &&
  !pdf.text.includes('定制页本地预览') &&
  !pdf.actions.some((label) => label.includes('本地构建') || label.includes('从 GitHub 同步'))
console.log('PDF 页:', pdfOk)

console.log('=== 信息管理拖拽排序 ===')
const entriesPage = await visit('entries', 'rm-smoke-entries.png')
await page.evaluate(() => {
  const tab = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith('项目经历'))
  if (tab instanceof HTMLButtonElement) tab.click()
})
await sleep(600)
const entriesDrag = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('[data-entry-card]')]
  const indexed = cards.filter((card) => card.getAttribute('data-index') != null).length
  return {
    cards: cards.length,
    indexed,
    hint: document.body.innerText.includes('拖动卡片可调整顺序'),
  }
})
const entriesDragOk = entriesDrag.cards >= 2 && entriesDrag.indexed === entriesDrag.cards && entriesDrag.hint
console.log('信息管理:', entriesDragOk)

console.log('=== 证件照裁剪 ===')
const photoFixture = 'C:/Users/Tech7/AppData/Local/Temp/rm-smoke-photo-crop.png'
const photoData = await page.evaluate(() => {
  const canvas = document.createElement('canvas')
  canvas.width = 900
  canvas.height = 600
  const context = canvas.getContext('2d')
  context.fillStyle = '#2563eb'
  context.fillRect(0, 0, 450, 600)
  context.fillStyle = '#dc2626'
  context.fillRect(450, 0, 450, 600)
  return canvas.toDataURL('image/png').split(',')[1]
})
fs.writeFileSync(photoFixture, Buffer.from(photoData, 'base64'))
await page.evaluate(() => {
  const tab = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim().startsWith('基础信息'))
  if (tab instanceof HTMLButtonElement) tab.click()
})
await sleep(300)
const photoInput = await page.$('input[type="file"]')
await photoInput?.uploadFile(photoFixture)
await page.waitForSelector('[data-photo-crop-dialog]', { timeout: 10000 })
const photoCropUiOk = await page.evaluate(() => (
  document.body.innerText.includes('标准一寸')
  && document.body.innerText.includes('25 × 35 mm')
  && document.body.innerText.includes('295 × 413 px')
  && !!document.querySelector('[aria-label="证件照裁剪区域"]')
  && !!document.querySelector('input[aria-label="照片缩放"]')
))
await page.evaluate(() => {
  const cancel = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === '取消')
  if (cancel instanceof HTMLButtonElement) cancel.click()
})
await page.waitForSelector('[data-photo-crop-dialog]', { hidden: true })
fs.rmSync(photoFixture, { force: true })
console.log('证件照裁剪:', photoCropUiOk)

console.log('=== 简历定制与 YAML ===')
const customizer = await visit('customizer', 'rm-smoke-customizer.png')
await page.evaluate(() => {
  const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('可视化编排'))
  if (button instanceof HTMLButtonElement) button.click()
})
await sleep(400)
const templateNames = ['ModernCV Banking', 'ModernCV Casual', 'ModernCV Classic', "Jake's Resume", 'Jake 原版', 'Calm', 'VS Code']
const sectionsDraggable = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('[data-section-key]')]
  return cards.length >= 1 && cards.every((card) => card.getAttribute('draggable') === 'true')
})
console.log('章节可拖拽:', sectionsDraggable)
await page.evaluate(() => {
  const category = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim().startsWith('字体'))
  if (category instanceof HTMLButtonElement) category.click()
})
await sleep(300)
const fontLibraryOk = await page.evaluate(async () => {
  const components = [...document.querySelectorAll('[data-font-library]')]
  const response = await fetch('/api/font-options')
  const data = await response.json()
  const groups = data.groups || []
  return components.length === 2
    && ['cjk', 'latin'].every((kind) => components.some((component) => component.getAttribute('data-font-library') === kind))
    && groups.length === 2
    && groups.every((group) => group.options.length > 0
      && group.systemCount >= group.options.length
      && group.options.some((option) => option.id === group.defaultId)
      && new Set(group.options.map((option) => option.id)).size === group.options.length)
})
console.log('字体组件库:', fontLibraryOk)
// 字体下拉必须完整列出系统字体（此前原生 datalist 只显示少数匹配项）
const fontComboboxOk = await (async () => {
  const data = await page.evaluate(async () => (await (await fetch('/api/font-options')).json()))
  const latinGroup = (data.groups || []).find((group) => group.kind === 'latin')
  const expected = latinGroup?.options.length || 0
  const existed = await page.$('[data-font-component="latin"]')
  if (!existed) {
    await page.click('[data-font-library="latin"]')
    await page.waitForSelector('[data-font-component="latin"]', { timeout: 5000 })
  }
  await page.click('[data-font-component="latin"] [data-font-picker="latin"]')
  await page.waitForSelector('[role="listbox"]', { timeout: 5000 })
  const count = await page.evaluate(() => [...document.querySelectorAll('[role="listbox"] [role="option"]')].length)
  await page.keyboard.press('Escape')
  await sleep(200)
  if (!existed) {
    await page.evaluate(() => {
      const remove = [...document.querySelectorAll('[data-font-component="latin"] button')]
        .find((button) => button.getAttribute('aria-label')?.includes('移除'))
      if (remove instanceof HTMLButtonElement) remove.click()
    })
    await sleep(300)
  }
  return count === expected && expected > 0
})()
console.log('字体下拉完整列表:', fontComboboxOk)
await page.evaluate(() => {
  const category = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim().startsWith('项目经历'))
  if (category instanceof HTMLButtonElement) category.click()
})
await sleep(300)
const selectionBefore = await page.$eval('[data-library-bulk-action]', (element) => element.textContent?.trim() || '')
const firstLibraryEntry = await page.$('[data-library-entry]')
let selectionFlow = { available: !!firstLibraryEntry, selected: false, restored: false }
if (firstLibraryEntry) {
  await page.$eval('[data-library-entry]', (element) => element.click())
  await page.waitForFunction(() => document.querySelector('[data-library-bulk-action]')?.textContent?.includes('拖入选中'), { timeout: 5000 })
  selectionFlow.selected = await page.$eval('[data-library-bulk-action]', (element) => element.textContent?.includes('拖入选中') || false)
  await page.$eval('[data-library-entry]', (element) => element.click())
  await page.waitForFunction(() => document.querySelector('[data-library-bulk-action]')?.textContent?.includes('拖入所有'), { timeout: 5000 })
  selectionFlow.restored = await page.$eval('[data-library-bulk-action]', (element) => element.textContent?.includes('拖入所有') || false)
}
console.log('信息库选择:', selectionBefore.includes('拖入所有') && selectionFlow.available && selectionFlow.selected && selectionFlow.restored)
const fontStateBeforeYaml = await page.evaluate(() => [...document.querySelectorAll('[data-customizer-canvas] [data-font-component], [data-customizer-canvas] [data-section-key]')].map((element) => ({
  id: element.hasAttribute('data-font-component') ? `font:${element.getAttribute('data-font-component')}` : `section:${element.getAttribute('data-section-key')}`,
  value: element.querySelector('[data-font-picker]')?.value || null,
})))
const releasesBeforePreview = await page.evaluate(async () => {
  const result = await (await fetch('/api/history?variant=main&limit=50')).json()
  return (result.items || []).filter((item) => item.kind === 'release').length
})
await page.evaluate(() => {
  const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === '预览')
  if (button instanceof HTMLButtonElement) button.click()
})
await page.waitForFunction(() => document.body.innerText.includes('预览已更新'), { timeout: 180000 })
const releasesAfterPreview = await page.evaluate(async () => {
  const result = await (await fetch('/api/history?variant=main&limit=50')).json()
  return (result.items || []).filter((item) => item.kind === 'release').length
})
const previewDidNotPublish = releasesAfterPreview === releasesBeforePreview
await page.evaluate(() => {
  const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('YAML 源码'))
  if (button instanceof HTMLButtonElement) button.click()
})
await sleep(800)
const yamlWorkspace = await page.evaluate(() => ({
  text: document.body.innerText,
  hasEditor: !!document.querySelector('.cm-editor'),
  hasVariantsFile: [...document.querySelectorAll('button')].some((button) => button.textContent?.includes('scripts/variants.yml')),
}))
await page.click('.cm-content')
await page.keyboard.down('Control')
await page.keyboard.press('End')
await page.keyboard.up('Control')
await page.keyboard.type('\n# smoke-unsaved-draft')
await page.evaluate(() => {
  const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('可视化编排'))
  if (button instanceof HTMLButtonElement) button.click()
})
await page.evaluate(() => {
  const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('YAML 源码'))
  if (button instanceof HTMLButtonElement) button.click()
})
const draftPreserved = await page.$eval('.cm-content', (element) => element.textContent?.includes('smoke-unsaved-draft') || false)
await page.click('button[aria-label="放弃修改"]')
await page.evaluate(() => {
  const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('可视化编排'))
  if (button instanceof HTMLButtonElement) button.click()
})
await sleep(400)
const fontStateAfterYaml = await page.evaluate(() => [...document.querySelectorAll('[data-customizer-canvas] [data-font-component], [data-customizer-canvas] [data-section-key]')].map((element) => ({
  id: element.hasAttribute('data-font-component') ? `font:${element.getAttribute('data-font-component')}` : `section:${element.getAttribute('data-section-key')}`,
  value: element.querySelector('[data-font-picker]')?.value || null,
})))
const fontStatePreserved = JSON.stringify(fontStateAfterYaml) === JSON.stringify(fontStateBeforeYaml)
console.log('YAML 往返保留字体:', fontStatePreserved)
const customizerOk =
  templateNames.every((name) => customizer.text.includes(name)) &&
  customizer.buttons.some((label) => label === '预览') &&
  customizer.buttons.some((label) => label.includes('保存发布正式版')) &&
  !customizer.buttons.some((label) => label.includes('保存并预览')) &&
  previewDidNotPublish &&
  customizer.text.includes('模板预览') &&
  customizer.text.includes('YAML 源码') &&
  yamlWorkspace.hasEditor &&
  yamlWorkspace.hasVariantsFile &&
  yamlWorkspace.text.includes('模板预览') &&
  draftPreserved &&
  sectionsDraggable &&
  fontLibraryOk &&
  fontStatePreserved
console.log('定制页:', customizerOk)

console.log('=== 旧 YAML 路由兼容 ===')
await page.goto(`${BASE}/#/yaml`, { waitUntil: 'networkidle2', timeout: 60000 })
await sleep(500)
const legacyOk = await page.evaluate(() => window.location.hash === '#/customizer' && document.body.innerText.includes('YAML 源码'))
console.log('旧路由:', legacyOk)

console.log('=== 窄屏布局 ===')
await page.setViewport({ width: 390, height: 844 })
await page.goto(`${BASE}/#/customizer`, { waitUntil: 'networkidle2', timeout: 60000 })
await sleep(800)
await page.screenshot({ path: 'C:/Users/Tech7/AppData/Local/Temp/rm-smoke-customizer-mobile.png', fullPage: true })
const mobileOk = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && !document.querySelector('main > header'))
console.log('窄屏:', mobileOk)

if (errors.length) console.log('浏览器错误:', errors.slice(0, 5))
await browser.close()

const ok = shellOk && typesOk && pdfOk && entriesDragOk && photoCropUiOk && customizerOk && fontComboboxOk && selectionFlow.available && selectionFlow.selected && selectionFlow.restored && legacyOk && mobileOk && errors.length === 0
console.log(ok ? 'ALL_RENDER_OK' : 'RENDER_ISSUE')
process.exit(ok ? 0 : 1)
