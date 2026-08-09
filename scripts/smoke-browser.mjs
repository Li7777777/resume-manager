// 浏览器冒烟测试：驱动系统 Edge 验证 History 页（react-pdf 渲染）与 PdfPreview 页
import puppeteer from 'puppeteer-core'

const EDGE =
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const BASE = 'http://127.0.0.1:8787'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function checkPdfRender(page, label) {
  // 等待 react-pdf 渲染出 canvas（真实等待，不依赖虚拟时间）
  try {
    await page.waitForSelector('canvas', { timeout: 60000 })
    await sleep(1500)
    // 验证 canvas 有实际像素（PDF 已绘制）
    const info = await page.evaluate(() => {
      const c = document.querySelector('canvas')
      if (!c) return { ok: false, reason: 'no canvas' }
      const ctx = c.getContext('2d')
      const d = ctx.getImageData(0, 0, Math.min(c.width, 400), Math.min(c.height, 60)).data
      let white = 0
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240) white++
      }
      return { ok: white > d.length / 4 / 4, whiteRatio: (white / (d.length / 4)).toFixed(2), canvas: `${c.width}x${c.height}` }
    })
    console.log(`[${label}] canvas:`, JSON.stringify(info))
    await page.screenshot({ path: `C:/Users/Tech7/AppData/Local/Temp/rm-${label}.png` })
    return info.ok
  } catch (e) {
    console.log(`[${label}] 渲染失败:`, String(e.message).slice(0, 120))
    // 抓取页面上的错误提示
    const body = await page.evaluate(() => document.body.innerText.slice(0, 400))
    console.log('  页面文本:', body.replace(/\n+/g, ' | ').slice(0, 300))
    return false
  }
}

const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new' })
const page = await browser.newPage()
page.on('console', (m) => m.type() === 'error' && console.log('  [console.error]', m.text().slice(0, 150)))
page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 150)))

// 1. History 页
console.log('=== History 页 ===')
await page.goto(`${BASE}/#history`, { waitUntil: 'networkidle2', timeout: 60000 })
await sleep(3000)
const timeline = await page.evaluate(() => {
  const el = document.querySelector('main')
  return (el?.innerText || '').includes('GitHub 提交历史') && (el?.innerText || '').includes('历史版本详情')
})
console.log('时间轴渲染:', timeline)
const ok1 = await checkPdfRender(page, 'history')

// 2. PdfPreview 页（本地构建产物预览）
console.log('=== PdfPreview 页 ===')
await page.goto(`${BASE}/#pdf`, { waitUntil: 'networkidle2', timeout: 60000 })
await sleep(2000)
// 点击「本地构建」触发构建
const clicked = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')]
  const b = btns.find((x) => x.innerText.includes('本地构建'))
  if (b) { b.click(); return true }
  return false
})
console.log('点击本地构建:', clicked)
if (clicked) {
  // 等待构建完成（yamlresume + xelatex 约 15s），轮询页面出现预览卡片
  for (let i = 0; i < 30; i++) {
    await sleep(3000)
    const has = await page.evaluate(() => !!document.querySelector('canvas') || document.body.innerText.includes('构建成功'))
    if (has) break
  }
}
const ok2 = await checkPdfRender(page, 'pdf')

await browser.close()
console.log(ok1 && ok2 ? 'ALL_RENDER_OK' : 'RENDER_ISSUE')
process.exit(ok1 && ok2 ? 0 : 1)
