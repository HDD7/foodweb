/**
 * 阿猪餐厅 Web - 服务入口
 * 技术栈：Express + SQLite(better-sqlite3) + JWT
 * 部署：node server.js / PM2 / Docker（见 README.md）
 */
const path = require('path')
const fs = require('fs')
const express = require('express')
const multer = require('multer')

const { authRequired } = require('./middleware/auth')
const config = require('./lib/config')

const app = express()
const PORT = config.port
const HOST = config.host

app.use(express.json({ limit: '2mb' }))
app.use(express.urlencoded({ extended: true }))

// ---- 图片上传（对应小程序云存储，目录：uploads/）----
const UPLOAD_DIR = config.uploadDir
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true })

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '.jpg').toLowerCase()
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`)
  }
})
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true)
    else cb(new Error('仅支持图片文件'))
  }
})

app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }))

app.post('/api/upload', authRequired, upload.single('file'), (req, res) => {
  if (!req.file) return res.json({ success: false, message: '未接收到文件' })
  res.json({ success: true, data: { url: `/uploads/${req.file.filename}` } })
})

// ---- API 路由 ----
app.use('/api/auth', require('./routes/auth'))
app.use('/api/user', require('./routes/user'))
app.use('/api/recipes', require('./routes/recipe'))
app.use('/api/orders', require('./routes/order'))
app.use('/api/friends', require('./routes/friend'))
app.use('/api/images', require('./routes/images'))

app.get('/api/health', (req, res) => res.json({ success: true, data: { status: 'ok', time: new Date().toISOString() } }))

// 能力状态：前端据此决定是否展示 AI / 搜图入口（不含任何密钥）
app.get('/api/meta', (req, res) => res.json({ success: true, data: config.status() }))

// ---- 前端静态资源 ----
app.use(express.static(path.join(__dirname, 'public')))
// SPA 兜底：非 /api、非 /uploads 的 GET 一律返回 index.html
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next()
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

// ---- 统一错误处理 ----
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('服务器错误:', err)
  res.status(err.status || 500).json({ success: false, message: err.message || '服务器错误' })
})

app.listen(PORT, HOST, () => {
  console.log(`🐷 阿猪餐厅 Web 已启动: http://${HOST}:${PORT}`)
  config.logSummary()
})
