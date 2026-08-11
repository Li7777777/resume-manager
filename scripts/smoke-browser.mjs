// 浏览器冒烟测试：简历类型分支、PDF 只读时间线、定制页模板合并
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
    options: [...document.querySelectorAll('option')].map((option) => option.textContent?.trim() || ''),
  }))
}

console.log('=== 简历类型分支 ===')
const types = await visit('variants', 'rm-smoke-types.png')
const typesOk =
  types.text.includes('一个简历类型对应一个独立 Git 分支') &&
  types.text.includes('resume/frontend') &&
  types.text.includes('resume/management') &&
  types.text.includes('resume/custom') &&
  !types.text.includes('章节内容（按标签筛选信息全集）') &&
  !types.text.includes('简历模板')
console.log('类型页:', typesOk)

console.log('=== PDF 只读时间线 ===')
await visit('pdf', 'rm-smoke-pdf.png')
await page.select('select', 'frontend')
await sleep(1000)
const pdf = await page.evaluate(() => ({
  text: document.body.innerText,
  actions: [...document.querySelectorAll('main button')].map((button) => button.innerText.trim()).filter(Boolean),
}))
const pdfOk =
  pdf.text.includes('resume/frontend') &&
  pdf.text.includes('此页面只查看已有 PDF') &&
  !pdf.text.includes('构建简历 PDF') &&
  !pdf.actions.some((label) => label.includes('本地构建') || label.includes('从 GitHub 同步'))
console.log('PDF 页:', pdfOk)

console.log('=== 简历定制模板 ===')
const customizer = await visit('customizer', 'rm-smoke-customizer.png')
const templateNames = ['ModernCV Banking', 'ModernCV Casual', 'ModernCV Classic', "Jake's Resume", 'Calm', 'VS Code']
const customizerOk =
  templateNames.every((name) => customizer.text.includes(name)) &&
  customizer.buttons.some((label) => label.includes('保存并预览')) &&
  customizer.text.includes('模板预览')
console.log('定制页:', customizerOk)

if (errors.length) console.log('浏览器错误:', errors.slice(0, 5))
await browser.close()

const ok = typesOk && pdfOk && customizerOk && errors.length === 0
console.log(ok ? 'ALL_RENDER_OK' : 'RENDER_ISSUE')
process.exit(ok ? 0 : 1)
