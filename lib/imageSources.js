/**
 * 图源与审图（服务端）
 * - 有 key 时优先正版图库：Pexels → Pixabay → Unsplash
 * - 都没有则回退百度图片（版权需用户自行核实）
 * - 审图：DeepSeek 视觉（deepseek-flash）
 */
const config = require('./config')

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36'
const DS_BASE = config.baseUrl
const VISION_MODEL = config.visionModel

function deepseekKey () {
  return config.deepseekKey
}

async function fromPexels (query, count) {
  const key = config.pexelsKey
  if (!key) return []
  const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${count}&orientation=landscape`, {
    headers: { Authorization: key }
  })
  if (!res.ok) throw new Error('Pexels ' + res.status)
  const json = await res.json()
  return (json.photos || []).map(p => ({
    url: (p.src && (p.src.large2x || p.src.large)) || '',
    width: p.width, height: p.height, source: 'Pexels', title: p.alt || '',
    license: 'Pexels License（可商用）', page: p.url
  }))
}

async function fromPixabay (query, count) {
  const key = config.pixabayKey
  if (!key) return []
  const res = await fetch(`https://pixabay.com/api/?key=${key}&q=${encodeURIComponent(query)}&image_type=photo&per_page=${Math.max(3, count)}&safesearch=true`)
  if (!res.ok) throw new Error('Pixabay ' + res.status)
  const json = await res.json()
  return (json.hits || []).map(h => ({
    url: h.largeImageURL || h.webformatURL,
    width: h.imageWidth, height: h.imageHeight, source: 'Pixabay', title: h.tags || '',
    license: 'Pixabay License（可商用）', page: h.pageURL
  }))
}

async function fromUnsplash (query, count) {
  const key = config.unsplashKey
  if (!key) return []
  const res = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${count}&orientation=landscape`, {
    headers: { Authorization: 'Client-ID ' + key }
  })
  if (!res.ok) throw new Error('Unsplash ' + res.status)
  const json = await res.json()
  return (json.results || []).map(p => ({
    url: (p.urls && p.urls.regular) || '',
    width: p.width, height: p.height, source: 'Unsplash', title: p.alt_description || '',
    license: 'Unsplash License（可商用）', page: p.links && p.links.html
  }))
}

/** Bing 图片（无需 key；解析 HTML 中的 murl，最稳的免 key 源） */
async function fromBing (query, count) {
  const url = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&form=HDRSC2&first=1`
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
    redirect: 'follow'
  })
  if (!res.ok) throw new Error('Bing ' + res.status)
  const html = await res.text()
  const seen = new Set()
  const out = []
  const re = /murl&quot;:&quot;(.*?)&quot;/g
  let m
  while ((m = re.exec(html)) && out.length < count * 2) {
    const u = m[1]
    if (!u || seen.has(u) || !/^https?:/.test(u)) continue
    seen.add(u)
    out.push({ url: u, source: 'Bing 图片', title: '', license: '来源站点未知，商用需核实版权' })
  }
  if (!out.length) throw new Error('Bing 未解析到图片（页面结构可能变化）')
  return out.slice(0, count)
}

/** 360 图片（无需 key） */
async function from360 (query, count) {
  const url = `https://image.so.com/j?q=${encodeURIComponent(query)}&src=srp&sn=0&pn=${Math.max(12, count * 3)}`
  const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://image.so.com/' } })
  if (!res.ok) throw new Error('360 ' + res.status)
  let json
  try {
    json = await res.json()
  } catch (e) {
    throw new Error('360 返回非 JSON')
  }
  return (json.list || [])
    .map(x => ({
      url: x.img || x.thumb || x.middle || '',
      width: x.width || x.imgwidth,
      height: x.height || x.imgheight,
      source: '360 图片',
      title: String(x.title || x.desc || '').replace(/<[^>]+>/g, ''),
      license: '来源站点未知，商用需核实版权',
      page: x.link || x.page_url
    }))
    .filter(x => x.url)
    .slice(0, count)
}

async function fromBaidu (query, count) {
  const url = 'https://image.baidu.com/search/acjson?tn=resultjson_com&logid=1&ipn=rj&ct=201326592&is=&fp=result' +
    `&word=${encodeURIComponent(query)}&pn=0&rn=${Math.max(10, count * 3)}&gsm=1e`
  const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://image.baidu.com/' } })
  if (!res.ok) throw new Error('Baidu ' + res.status)
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text.replace(/[\u0000-\u001f]+/g, ' '))
  } catch (e) {
    throw new Error('百度图片解析失败（可能触发风控）')
  }
  return (json.data || [])
    .filter(x => x && (x.middleURL || x.thumbURL || x.hoverURL))
    .map(x => ({
      url: x.middleURL || x.hoverURL || x.thumbURL,
      width: x.width, height: x.height, source: '百度图片',
      title: String(x.fromPageTitleEnc || '').replace(/<\/?[^>]+>/g, ''),
      license: '来源站点未知，商用需核实版权',
      page: x.fromURL || x.objURL
    }))
}

async function searchImages (query, count, preferred) {
  const chain = [
    ['pexels', () => fromPexels(query, count)],
    ['pixabay', () => fromPixabay(query, count)],
    ['unsplash', () => fromUnsplash(query, count)],
    ['360', () => from360(query, count)],
    ['baidu', () => fromBaidu(query, count)],
    ['bing', () => fromBing(query, count)]
  ]
  const order = preferred
    ? chain.filter(([n]) => n === preferred).concat(chain.filter(([n]) => n !== preferred))
    : chain

  const errors = []
  const seen = new Set()
  const merged = []
  const usedProviders = []
  // 多源合并：至少凑到 count*2 张候选（最多尝试 3 个可用源），提高命中率
  for (const [name, fn] of order) {
    if (merged.length >= count * 2 || usedProviders.length >= 3) break
    try {
      const items = await fn()
      let added = 0
      for (const it of items) {
        if (!it || !it.url) continue
        const key = it.url.split('?')[0]
        if (seen.has(key)) continue
        seen.add(key)
        merged.push({ ...it, source: it.source || name })
        added++
      }
      if (added > 0) usedProviders.push(name)
    } catch (err) {
      errors.push(name + ': ' + err.message)
    }
  }

  if (!merged.length) throw new Error('图源不可用（' + (errors.join('; ') || '无可用图源') + '）')
  return { items: merged.slice(0, Math.max(count * 2, count)), provider: usedProviders.join('+') || 'unknown' }
}

function parseVerdict (raw) {
  const text = String(raw || '').trim()
  const tryJson = s => {
    try {
      const j = JSON.parse(s)
      if (j && typeof j === 'object') {
        return {
          ok: j.usable === true || j.ok === true,
          match: Math.max(0, Math.min(3, Number(j.match) || 0)),
          reason: String(j.reason || '').slice(0, 60),
          dish: String(j.dish || '').slice(0, 24)
        }
      }
    } catch (e) { /* ignore */ }
    return null
  }
  const direct = tryJson(text)
  if (direct) return direct
  const m = text.match(/\{[\s\S]*\}/)
  if (m) {
    const parsed = tryJson(m[0])
    if (parsed) return parsed
  }
  const ok = /可用|符合|匹配/.test(text) && !/不可用|不符合|无关/.test(text)
  return { ok, match: ok ? 2 : 0, reason: text.slice(0, 60) }
}

/** 图片是否能在"服务器本机"抓到（国内图床常封境外 IP，必须过滤） */
const reachCache = new Map()
async function isReachable (url, timeoutMs = 4500) {
  if (reachCache.has(url)) return reachCache.get(url)
  let ok = false
  for (const headers of [
    { 'User-Agent': UA, Referer: 'https://image.baidu.com/', Range: 'bytes=0-2047' },
    { 'User-Agent': UA }
  ]) {
    try {
      const res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) })
      const type = res.headers.get('content-type') || ''
      if (res.ok && /^image\//.test(type)) { ok = true; break }
    } catch (e) { /* 换一组头再试 */ }
  }
  reachCache.set(url, ok)
  if (reachCache.size > 800) reachCache.clear()
  return ok
}

/** 先自己下载图片再送审：绕开防盗链/403，DeepSeek 拿到稳定的 base64 */
async function toVisionPayload (url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Referer: 'https://image.baidu.com/' },
      redirect: 'follow'
    })
    if (res.ok) {
      const type = res.headers.get('content-type') || 'image/jpeg'
      if (/^image\//.test(type)) {
        const buf = Buffer.from(await res.arrayBuffer())
        if (buf.length > 0 && buf.length <= 5 * 1024 * 1024) {
          return { url: `data:${type};base64,${buf.toString('base64')}`, downloaded: true }
        }
      }
    }
  } catch (e) {
    /* 回退到直接传 URL */
  }
  return { url, downloaded: false }
}

async function verifyImage (url, requirement) {
  const key = deepseekKey()
  if (!key) return { ok: true, match: -1, reason: '未配置 DeepSeek Key，跳过审图' }
  const prompt = [
    `你要为「${requirement}」审核配图，判断这张图能不能直接当它的菜谱封面。`,
    '评分规则（必须严格执行）：',
    `- 3 分：图中菜品就是「${requirement}」这道菜，成品特写，画面干净适合做封面。`,
    '- 2 分：同一道菜，但构图/画质一般，或画面有多道菜但主体是该菜。',
    '- 1 分：同菜系/相近食材，但不是这道菜。',
    '- 0 分：完全不是这道菜（别的菜、无关图），或不符合封面要求（生食材、菜单截图、包装、人物、文字海报）。',
    '特别注意：菜品不同即不得给 2 分以上。例如目标是「宫保鸡丁」而图是「小龙虾」，必须给 0-1 分。',
    '只输出 JSON，不要解释：{"dish":"你识别到的菜名","match":0,"usable":false,"reason":"20字以内"}',
    'usable 仅在 match>=2 时为 true。'
  ].join('\n')

  const payload = await toVisionPayload(url)

  const res = await fetch(`${DS_BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: VISION_MODEL,
      thinking: { type: 'disabled' },
      temperature: 0,
      response_format: { type: 'json_object' },
      max_tokens: 220,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: payload.url } }
        ]
      }]
    })
  })
  if (!res.ok) return { ok: false, match: -1, reason: '审图失败 ' + res.status }
  const json = await res.json()
  const msg = json.choices && json.choices[0] && json.choices[0].message
  return parseVerdict(msg && msg.content)
}

async function verifyAll (urls, requirement, concurrency = 4) {
  const results = new Array(urls.length)
  let cursor = 0
  const worker = async () => {
    while (cursor < urls.length) {
      const i = cursor++
      try {
        results[i] = await verifyImage(urls[i], requirement)
      } catch (err) {
        results[i] = { ok: false, match: 0, reason: '审图异常: ' + err.message.slice(0, 40) }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker))
  return results
}

/* ---------- 图片代理所需：签名 + SSRF 防护 ---------- */
const crypto = require('crypto')
const dns = require('dns').promises
const net = require('net')

const PROXY_SECRET = config.jwtSecret

function signImageUrl (url) {
  return crypto.createHmac('sha256', PROXY_SECRET).update(url).digest('hex').slice(0, 16)
}
function verifyImageSig (url, sig) {
  if (!sig || typeof sig !== 'string') return false
  const expected = signImageUrl(url)
  if (sig.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
}

/** 拒绝内网/环回/保留地址，防 SSRF */
function isPrivateIp (ip) {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number)
    return (
      p[0] === 10 || p[0] === 127 || p[0] === 0 ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168) ||
      (p[0] === 169 && p[1] === 254) ||
      (p[0] === 100 && p[1] >= 64 && p[1] <= 127)
    )
  }
  const lower = ip.toLowerCase()
  return lower === '::1' || lower === '::' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80')
}

async function isSafeRemoteUrl (raw) {
  let u
  try {
    u = new URL(raw)
  } catch (e) {
    return false
  }
  if (!/^https?:$/.test(u.protocol)) return false
  if (!u.hostname || u.hostname === 'localhost') return false
  try {
    const addrs = await dns.lookup(u.hostname, { all: true })
    if (!addrs.length) return false
    return addrs.every(a => !isPrivateIp(a.address))
  } catch (e) {
    return false
  }
}

module.exports = {
  searchImages,
  isReachable,
  verifyAll,
  verifyImage,
  deepseekKey,
  signImageUrl,
  verifyImageSig,
  isSafeRemoteUrl
}
