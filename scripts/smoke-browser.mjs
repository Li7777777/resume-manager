// 浏览器冒烟测试：应用外壳、类型分支、PDF 时间线、定制/YAML 同步工作区与窄屏布局
import puppeteer from 'puppeteer-core'

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const BASE = 'http://127.0.0.1:8787'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new' })
const page = await browser.newPage()
const errors = []
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`[console] ${message.text()}`)
})
page.on('pageerror', (error) => errors.push(`[page] ${String(error)}`))
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
  types.text.includes('resume/general') &&
  !types.text.includes('resume/frontend') &&
  !types.text.includes('resume/management') &&
  !types.text.includes('简历模板')
console.log('类型页:', typesOk)

console.log('=== PDF 只读时间线 ===')
await visit('pdf', 'rm-smoke-pdf.png')
await page.select('select', 'general')
await page.waitForFunction(() => document.body.innerText.includes('resume/general'), { timeout: 20000 }).catch(() => {})
const pdf = await page.evaluate(() => ({
  text: document.body.innerText,
  actions: [...document.querySelectorAll('main button')].map((button) => button.innerText.trim()).filter(Boolean),
}))
const pdfOk =
  pdf.text.includes('resume/general') &&
  pdf.text.includes('此页面只查看已有 PDF') &&
  !pdf.text.includes('构建简历 PDF') &&
  !pdf.actions.some((label) => label.includes('本地构建') || label.includes('从 GitHub 同步'))
console.log('PDF 页:', pdfOk)

console.log('=== 简历定制与 YAML ===')
const customizer = await visit('customizer', 'rm-smoke-customizer.png')
const templateNames = ['ModernCV Banking', 'ModernCV Casual', 'ModernCV Classic', "Jake's Resume", 'Calm', 'VS Code']
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
const customizerOk =
  templateNames.every((name) => customizer.text.includes(name)) &&
  customizer.buttons.some((label) => label.includes('保存并预览')) &&
  customizer.text.includes('模板预览') &&
  customizer.text.includes('YAML 源码') &&
  yamlWorkspace.hasEditor &&
  yamlWorkspace.hasVariantsFile &&
  yamlWorkspace.text.includes('模板预览') &&
  draftPreserved
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

const ok = shellOk && typesOk && pdfOk && customizerOk && legacyOk && mobileOk && errors.length === 0
console.log(ok ? 'ALL_RENDER_OK' : 'RENDER_ISSUE')
process.exit(ok ? 0 : 1)
