// Resume Manager 服务端入口
// 生产模式：托管前端构建产物（dist/）+ /api 接口
// 开发模式：仅 /api（前端由 Vite dev server 提供，proxy 转发）
import path from 'node:path'
import fs from 'node:fs'
import express from 'express'
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici'
import apiRouter from './routes/api.js'

// 系统代理：本机设置了 HTTPS_PROXY/HTTP_PROXY（如 Clash）时，让 fetch 走代理访问外网 LLM
// EnvHttpProxyAgent 自动尊重 NO_PROXY，不影响 localhost 等本机地址
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) {
  try {
    setGlobalDispatcher(new EnvHttpProxyAgent())
  } catch {
    /* 代理初始化失败则回退直连 */
  }
}

const PORT = process.env.PORT || 8787
const HOST = '127.0.0.1' // 仅本机访问，数据不出本机
const app = express()

app.use(express.json({ limit: '5mb' }))

app.use('/api', apiRouter)

// 生产模式托管前端
if (process.env.NODE_ENV === 'production') {
  const dist = path.resolve('dist')
  if (fs.existsSync(dist)) {
    app.use(express.static(dist))
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next()
      res.sendFile(path.join(dist, 'index.html'))
    })
  }
}

app.listen(PORT, HOST, () => {
  console.log(`[resume-manager] 服务已启动: http://${HOST}:${PORT}`)
  if (process.env.NODE_ENV !== 'production') {
    console.log('[resume-manager] 前端开发: http://127.0.0.1:5173 (vite)')
  }
})
