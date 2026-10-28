/**
 * AI 菜谱生成：DeepSeek 搜索网络菜谱 → 综合成结构化菜谱 → 可选自动配图
 */
const fs = require('fs')
const path = require('path')
const config = require('./config')
const { searchImages, verifyAll, isReachable } = require('./imageSources')

const DS_BASE = config.baseUrl
const CHAT_MODEL = config.chatModel

const SCENES = ['daily', 'quick', 'guest', 'light', 'heavy']
const INGREDIENTS = ['meat', 'seafood', 'egg', 'vegetable', 'staple']
const TAGS = [
  'stir_fry', 'steam', 'stew', 'cold_mix', 'soup', 'fry', 'grill', 'boil',
  'sichuan', 'cantonese', 'home_style', 'light', 'spicy', 'sweet', 'sour', 'fresh'
]
const TIMES = [
  { value: '10', label: '10分钟' },
  { value: '30', label: '30分钟' },
  { value: '60', label: '1小时' },
  { value: '120', label: '2小时+' }
]
const DIFFS = [
  { value: 1, label: '简单', color: 'green' },
  { value: 2, label: '中等', color: 'yellow' },
  { value: 3, label: '困难', color: 'red' }
]
const SIZES = [
  { value: '1-2', label: '1-2人' },
  { value: '3-4', label: '3-4人' },
  { value: '5-6', label: '5-6人' },
  { value: '6+', label: '6人以上' }
]

function key () {
  return config.deepseekKey
}

async function dsSearch (query, count = 6) {
  const apiKey = key()
  if (!apiKey) throw new Error('缺少 DeepSeek API Key，无法使用 AI 生成')
  const res = await fetch(`${DS_BASE}/v1/tools/search`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, count, need_content: false })
  })
  if (!res.ok) throw new Error('搜索失败 ' + res.status)
  const json = await res.json()
  return Array.isArray(json.results) ? json.results : []
}

async function dsChat (messages, { temperature = 0.3, maxTokens = 1600 } = {}) {
  const apiKey = key()
  if (!apiKey) throw new Error('缺少 DeepSeek API Key，无法使用 AI 生成')
  const res = await fetch(`${DS_BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: CHAT_MODEL,
      thinking: { type: 'disabled' },
      temperature,
      response_format: { type: 'json_object' },
      max_tokens: maxTokens,
      messages
    })
  })
  const text = await res.text()
  if (!res.ok) throw new Error('生成失败 ' + res.status + ': ' + text.slice(0, 120))
  const json = JSON.parse(text)
  const msg = json.choices && json.choices[0] && json.choices[0].message
  return (msg && msg.content) || ''
}

/** 归一化：把模型输出收敛到项目允许的枚举/结构 */
function normalize (raw, dishName) {
  const pick = (arr, val, fallback) => (arr.some(x => (typeof x === 'string' ? x === val : x.value === val)) ? val : fallback)
  const timeValue = String((raw.preparationTime && raw.preparationTime.value) || '').replace(/[^\d]/g, '')
  const time = TIMES.find(t => t.value === timeValue) || TIMES[1]
  const diffValue = Number(raw.difficulty && raw.difficulty.value)
  const diff = DIFFS.find(d => d.value === diffValue) || DIFFS[0]
  const sizeValue = raw.servingSize && raw.servingSize.value
  const size = SIZES.find(s => s.value === sizeValue) || SIZES[1]

  const ingredients = (Array.isArray(raw.ingredients) ? raw.ingredients : [])
    .map((it, i) => {
      if (typeof it === 'string') {
        const m = it.match(/^(.+?)\s*[（(:：\s]\s*(.+?)[)）]?$/)
        return { id: 'i' + i, name: (m ? m[1] : it).trim().slice(0, 20), amount: (m ? m[2] : '适量').trim().slice(0, 16) }
      }
      return {
        id: 'i' + i,
        name: String(it.name || '').trim().slice(0, 20),
        amount: String(it.amount || '适量').trim().slice(0, 16)
      }
    })
    .filter(x => x.name)
    .slice(0, 12)

  const steps = (Array.isArray(raw.steps) ? raw.steps : [])
    .map((s, i) => {
      const text = typeof s === 'string' ? s : String((s && (s.content || s.text)) || '')
      return { id: 's' + i, content: text.trim().slice(0, 200), image: '' }
    })
    .filter(s => s.content)
    .slice(0, 10)

  const tags = Array.from(new Set((Array.isArray(raw.optionalTags) ? raw.optionalTags : [])
    .map(t => (typeof t === 'string' ? t : t && t.id))
    .filter(t => TAGS.includes(t)))).slice(0, 4)

  const tips = (Array.isArray(raw.tips) ? raw.tips : []).map(t => String(t).trim()).filter(Boolean).slice(0, 3)

  return {
    name: String(raw.name || dishName).trim().slice(0, 30),
    description: String(raw.description || '').trim().slice(0, 60),
    ingredients: ingredients.length ? ingredients : [{ id: 'i0', name: dishName, amount: '适量' }],
    steps: steps.length ? steps : [{ id: 's0', content: '暂无步骤，请手动补充', image: '' }],
    preparationTime: { value: time.value, label: time.label },
    difficulty: { value: diff.value, label: diff.label, color: diff.color },
    servingSize: { value: size.value, label: size.label },
    sceneCategory: pick(SCENES, raw.sceneCategory, 'daily'),
    ingredientCategory: pick(INGREDIENTS, raw.ingredientCategory, 'meat'),
    optionalTags: tags,
    tips
  }
}

/** 自动配图：搜图 + 审图 → 存到 uploads，返回本地路径 */
async function attachImage (dishName, uploadDir) {
  try {
    const { items } = await searchImages(dishName, 4)
    if (!items.length) return null
    const verdicts = await verifyAll(items.map(i => i.url), dishName)
    const scored = items
      .map((it, i) => ({ it, v: verdicts[i] }))
      .filter(x => x.v.match >= 2)
      .sort((a, b) => b.v.match - a.v.match || (b.it.width * b.it.height) - (a.it.width * a.it.height))
    const best = scored[0]
    if (!best) return null

    const img = await fetch(best.it.url, {
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://image.baidu.com/' },
      redirect: 'follow'
    })
    if (!img.ok) return null
    const type = img.headers.get('content-type') || 'image/jpeg'
    if (!/^image\//.test(type)) return null
    const buf = Buffer.from(await img.arrayBuffer())
    if (!buf.length || buf.length > 8 * 1024 * 1024) return null

    const ext = type.includes('png') ? '.png' : type.includes('webp') ? '.webp' : '.jpg'
    const filename = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 7)}${ext}`
    fs.writeFileSync(path.join(uploadDir, filename), buf)
    return { url: '/uploads/' + filename, match: best.v.match, dish: best.v.dish || '' }
  } catch (e) {
    return null
  }
}

/** 主流程：搜索 → 综合 → 归一化 →（可选）配图 */
async function generateRecipe (dishName, { withImage = true, uploadDir } = {}) {
  const name = String(dishName || '').trim().slice(0, 30)
  if (!name) throw new Error('请先填写菜名')

  // 1) 搜索网络菜谱
  const results = await dsSearch(`${name} 家常做法 食材 步骤`, 6)
  if (!results.length) throw new Error('没有搜到相关菜谱，换个菜名试试')

  const sources = results.slice(0, 4).map(r => ({
    title: String(r.title || '').slice(0, 60),
    url: r.url,
    site: r.site_name || '',
    score: typeof r.rerank_score === 'number' ? Math.round(r.rerank_score * 100) / 100 : null
  }))

  const corpus = results.slice(0, 4).map((r, i) => {
    const body = (r.summary || r.snippet || '').replace(/\s+/g, ' ').slice(0, 900)
    return `【资料${i + 1}】${r.title || ''}\n${body}`
  }).join('\n\n')

  // 2) 综合成结构化菜谱
  const system = [
    '你是家常菜菜谱整理助手。请综合用户提供的网络资料，输出一份可以直接下厨的菜谱。',
    '硬性要求：',
    '- 食材清单 4-10 项，每项用量要具体（如「五花肉 600g」「生抽 3勺」），不要写「适量」除非真的少量调味',
    '- 步骤 4-8 步，每步 20-60 字，必须包含关键火候/时间/判断标准',
    '- 描述 15-30 字，突出卖点口感',
    '- 资料不足时，按常规家常做法补全，不要留空、不要说不知道',
    '- 只输出 JSON，不要解释文字',
    'JSON 结构：',
    '{"name":"菜名","description":"描述","ingredients":[{"name":"食材","amount":"用量"}],"steps":["步骤1","步骤2"],' +
      '"preparationTime":{"value":"10|30|60|120","label":"10分钟/30分钟/1小时/2小时+"},' +
      '"difficulty":{"value":1,"label":"简单|中等|困难"},"servingSize":{"value":"1-2|3-4|5-6|6+","label":"3-4人"},' +
      '"sceneCategory":"daily|quick|guest|light|heavy","ingredientCategory":"meat|seafood|egg|vegetable|staple",' +
      '"optionalTags":["stir_fry|steam|stew|cold_mix|soup|fry|grill|boil|sichuan|cantonese|home_style|light|spicy|sweet|sour|fresh"],' +
      '"tips":["小贴士"]}',
    '分类含义：sceneCategory 中 quick=30分钟内快手菜，guest=宴客菜，light=清淡菜，heavy=重口味下饭菜，daily=日常家常菜；' +
      'preparationTime 选最接近的总耗时。'
  ].join('\n')

  const raw = await dsChat([
    { role: 'system', content: system },
    { role: 'user', content: `菜名：${name}\n\n网络资料：\n${corpus}` }
  ])

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    const m = String(raw).match(/\{[\s\S]*\}/)
    if (!m) throw new Error('AI 返回内容格式异常，请重试')
    parsed = JSON.parse(m[0])
  }

  const recipe = normalize(parsed, name)
  const image = withImage && uploadDir ? await attachImage(recipe.name, uploadDir) : null

  return {
    recipe: { ...recipe, images: image ? [image.url] : [] },
    image,
    sources
  }
}

module.exports = { generateRecipe, normalize }
