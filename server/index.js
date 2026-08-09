// Resume Manager 服务端入口
// 生产模式：托管前端构建产物（dist/）+ /api 接口
// 开发模式：仅 /api（前端由 Vite dev server 提供，proxy 转发）
import path from 'node:path'
import fs from 'node:fs'
import express from 'express'
import apiRouter from './routes/api.js'

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
