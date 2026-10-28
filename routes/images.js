/**
 * 菜谱配图：搜图 + 审图 + 图片代理
 */
const express = require('express')
const { authRequired } = require('../middleware/auth')
const { searchImages, verifyAll, verifyImage, deepseekKey, signImageUrl, verifyImageSig, isSafeRemoteUrl } = require('../lib/imageSources')

const router = express.Router()

// 简单内存缓存：同一关键词 10 分钟内不重复请求图源与审图（省钱）
const cache = new Map()
const TTL = 10 * 60 * 1000

function cacheGet (key) {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > TTL) { cache.delete(key); return null }
  return hit.value
}
function cacheSet (key, value) {
  if (cache.size > 200) cache.clear()
  cache.set(key, { at: Date.now(), value })
}

// 搜图 + 审图
router.post('/search', authRequired, async (req, res) => {
  const query = String((req.body && req.body.query) || '').trim()
  const count = Math.max(3, Math.min(8, parseInt(req.body && req.body.count) || 5))
  const requirement = String((req.body && req.body.requirement) || query).trim()
  const provider = req.body && req.body.provider
  const verify = req.body && req.body.verify !== false

  if (!query) return res.json({ success: false, message: '请输入搜索关键词' })

  const cacheKey = [query, count, requirement, provider || '', verify].join('|')
  const cached = cacheGet(cacheKey)
  if (cached) return res.json({ success: true, data: { ...cached, cached: true } })

  try {
    const { items, provider: used } = await searchImages(query, count, provider)
    const verdicts = verify
      ? await verifyAll(items.map(i => i.url), requirement)
      : items.map(() => ({ ok: true, match: -1, reason: '未审图' }))

    const data = {
      query,
      provider: used,
      verified: verify && !!deepseekKey(),
      items: items.map((it, i) => ({
        ...it,
        thumb: '/api/images/proxy?url=' + encodeURIComponent(it.url) + '&sig=' + signImageUrl(it.url),
        verdict: verdicts[i]
      }))
    }
    // 审核通过的排前面，失败的排后面，只返回 count 张
    data.items.sort((a, b) => {
      const am = a.verdict.match < 0 ? -0.5 : a.verdict.match
      const bm = b.verdict.match < 0 ? -0.5 : b.verdict.match
      return bm - am
    })
    data.items = data.items.slice(0, count)
    cacheSet(cacheKey, data)
    res.json({ success: true, data })
  } catch (err) {
    res.json({ success: false, message: err.message })
  }
})

// 只审图（给用户自己贴的链接用）
router.post('/verify', authRequired, async (req, res) => {
  const urls = (req.body && req.body.urls) || []
  const requirement = String((req.body && req.body.requirement) || '').trim()
  if (!Array.isArray(urls) || !urls.length) return res.json({ success: false, message: '请提供图片链接' })
  if (!requirement) return res.json({ success: false, message: '请提供审核要求' })
  try {
    const results = await verifyAll(urls.slice(0, 8), requirement)
    res.json({ success: true, data: { requirement, results: urls.map((u, i) => ({ url: u, ...results[i] })) } })
  } catch (err) {
    res.json({ success: false, message: err.message })
  }
})

// 图片代理（防盗链 + 避免前端跨域）。需签名，避免成为开放代理
function refererFor (raw) {
  try {
    const host = new URL(raw).hostname
    if (host.includes('so.com') || host.includes('qhimg.com') || host.includes('sohucs.com')) return 'https://image.so.com/'
    if (host.includes('baidu.com') || host.includes('bdstatic.com')) return 'https://image.baidu.com/'
    if (host.includes('douguo.net')) return 'https://www.douguo.com/'
    return undefined
  } catch (e) {
    return undefined
  }
}

/** 靠魔数判断图片类型（部分图床返回 text/html 或 application/octet-stream） */
function sniffImage (buf) {
  if (buf.length < 12) return null
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg'
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif'
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp'
  return null
}

router.get('/proxy', async (req, res) => {
  const raw = String(req.query.url || '')
  const sig = String(req.query.sig || '')
  if (!verifyImageSig(raw, sig)) return res.status(403).send('invalid signature')
  if (!(await isSafeRemoteUrl(raw))) return res.status(400).send('unsupported url')
  try {
    const upstream = await fetch(raw, {
      headers: { 'User-Agent': 'Mozilla/5.0', ...(refererFor(raw) ? { Referer: refererFor(raw) } : {}) },
      redirect: 'follow'
    })
    if (!upstream.ok) return res.status(upstream.status).send('upstream error')
    const buf = Buffer.from(await upstream.arrayBuffer())
    if (!buf.length) return res.status(502).send('empty body')
    if (buf.length > 8 * 1024 * 1024) return res.status(413).send('image too large')
    const declared = upstream.headers.get('content-type') || ''
    const type = sniffImage(buf) || (/^image\//.test(declared) ? declared.split(';')[0] : null)
    if (!type) return res.status(415).send('not an image')
    res.setHeader('Content-Type', type)
    res.setHeader('Cache-Control', 'public, max-age=86400')
    res.send(buf)
  } catch (err) {
    res.status(502).send('proxy failed')
  }
})

module.exports = router
