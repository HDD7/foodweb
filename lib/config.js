/**
 * 统一配置：服务端独立配置文件（config.json）+ 环境变量覆盖
 *
 * 优先级：环境变量 > config.json > 本机 pi 凭证（仅本地开发兜底，VPS 上不会有）
 * 配置文件路径：默认 <项目根>/config.json，可用 FOOD_CONFIG 环境变量覆盖
 */
const fs = require('fs')
const os = require('os')
const path = require('path')

const CONFIG_PATH = process.env.FOOD_CONFIG || path.join(__dirname, '..', 'config.json')

let fileConfig = {}
let fileError = null
try {
  fileConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
} catch (err) {
  if (err.code !== 'ENOENT') fileError = err.message
}

const str = v => (typeof v === 'string' && v.trim() ? v.trim() : null)
const num = (v, def) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : def
}

/** 仅本地开发兜底：读 pi 的凭证文件 */
function fromPiAuth (provider) {
  try {
    const auth = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.pi', 'agent', 'auth.json'), 'utf8'))
    const entry = auth && auth[provider]
    const key = typeof entry === 'string' ? entry : entry && entry.key
    return str(key)
  } catch (e) {
    return null
  }
}

// ---- DeepSeek（兼容两种写法：deepseekKey 或 deepseek.key）----
const deepseekKey =
  str(process.env.DEEPSEEK_API_KEY) ||
  str(fileConfig.deepseekKey) ||
  str(fileConfig.deepseek && fileConfig.deepseek.key) ||
  fromPiAuth('deepseek')

const deepseekKeySource =
  str(process.env.DEEPSEEK_API_KEY) ? '环境变量 DEEPSEEK_API_KEY'
    : (str(fileConfig.deepseekKey) || str(fileConfig.deepseek && fileConfig.deepseek.key)) ? '配置文件 config.json'
      : deepseekKey ? '本机 pi 凭证（仅开发用）'
        : '未配置'

const config = {
  path: CONFIG_PATH,
  fileLoaded: Object.keys(fileConfig).length > 0,
  fileError,

  // 密钥
  deepseekKey,
  deepseekKeySource,
  pexelsKey: str(process.env.PEXELS_API_KEY) || str(fileConfig.pexelsKey),
  pixabayKey: str(process.env.PIXABAY_API_KEY) || str(fileConfig.pixabayKey),
  unsplashKey: str(process.env.UNSPLASH_ACCESS_KEY) || str(fileConfig.unsplashKey),

  // 服务
  port: num(process.env.PORT, num(fileConfig.port, 3000)),
  host: str(process.env.HOST) || str(fileConfig.host) || '0.0.0.0',
  jwtSecret: str(process.env.JWT_SECRET) || str(fileConfig.jwtSecret) || 'food-yun-dev-secret-change-me',
  dataDir: str(process.env.DATA_DIR) || str(fileConfig.dataDir) || path.join(__dirname, '..', 'data'),
  uploadDir: str(process.env.UPLOAD_DIR) || str(fileConfig.uploadDir) || path.join(__dirname, '..', 'uploads'),

  // 模型
  chatModel: str(process.env.DEEPSEEK_CHAT_MODEL) || str(fileConfig.deepseekModel) || 'deepseek-flash',
  visionModel: str(process.env.DEEPSEEK_VISION_MODEL) || str(fileConfig.deepseekVisionModel) || 'deepseek-flash',
  baseUrl: str(process.env.DEEPSEEK_BASE_URL) || str(fileConfig.deepseekBaseUrl) || 'https://api.deepseek.com',

  // 功能开关
  aiGenerate: fileConfig.aiGenerate !== false,
  imageSearch: fileConfig.imageSearch !== false
}

/** 图片图源清单（按优先级） */
config.imageProviders = [
  config.pexelsKey && 'pexels',
  config.pixabayKey && 'pixabay',
  config.unsplashKey && 'unsplash',
  '360',
  'baidu'
].filter(Boolean)

/** 能力状态（供 /api/meta 与启动自检使用，不含密钥） */
config.status = () => ({
  aiGenerate: config.aiGenerate && !!config.deepseekKey,
  imageSearch: config.imageSearch && config.imageProviders.length > 0,
  imageVerify: !!config.deepseekKey,
  deepseek: {
    configured: !!config.deepseekKey,
    source: config.deepseekKeySource,
    chatModel: config.chatModel,
    visionModel: config.visionModel
  },
  imageProviders: config.imageProviders,
  configFile: { path: CONFIG_PATH, loaded: config.fileLoaded, error: config.fileError }
})

/** 启动时打印一行自检 */
config.logSummary = () => {
  const s = config.status()
  const mark = ok => (ok ? '✅' : '⚠️ ')
  console.log(`[config] 文件: ${CONFIG_PATH} ${config.fileLoaded ? '(已加载)' : '(不存在，使用默认值/环境变量)'}`)
  if (config.fileError) console.log(`[config] ⚠️  解析失败: ${config.fileError}`)
  console.log(`[config] ${mark(s.aiGenerate)} AI 生成菜谱　DeepSeek key: ${config.deepseekKeySource}`)
  console.log(`[config] ${mark(s.imageSearch)} 搜图（审图 ${s.imageVerify ? '开' : '关'}）　图源: ${config.imageProviders.join(', ')}`)
  if (!s.aiGenerate) {
    console.log('[config] 提示：在 config.json 里填 deepseekKey（或设置环境变量 DEEPSEEK_API_KEY）即可启用 AI 功能')
  }
}

module.exports = config
