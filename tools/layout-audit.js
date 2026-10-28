#!/usr/bin/env node
/**
 * 布局审计 + 批量截图（puppeteer-core 驱动本机 Chrome）
 *
 * 检查项：
 *  - 页面 JS 运行时错误 / console.error
 *  - 横向溢出（scrollWidth > clientWidth 的元素）
 *  - 元素被裁切（内容高度超出容器且 overflow 隐藏）
 *  - 关键文字对比度（WCAG AA 4.5:1）
 *  - 底部导航项数量与位置
 *  - 生成各页面截图
 *
 * 用法：
 *   node tools/layout-audit.js [--out dir] [--width 430] [--height 932] [--user demo] [--pass 123456]
 */
const fs = require('fs')
const path = require('path')
const puppeteer = require('puppeteer-core')

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
]

function arg (name, fallback) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 ? process.argv[i + 1] : fallback
}

const BASE = arg('base', 'http://localhost:3000')
const OUT = arg('out', path.join(__dirname, '..', 'shots'))
const WIDTH = parseInt(arg('width', '430'))
const HEIGHT = parseInt(arg('height', '932'))
const USER = arg('user', 'demo')
const PASS = arg('pass', '123456')

const PAGES = [
  ['01-login', '/login', false],
  ['02-home', '/index', true],
  ['03-list', '/recipe-list', true],
  ['04-detail', '/recipe-detail/{rid}', true],
  ['05-diancan', '/diancan', true],
  ['06-profile', '/profile', true],
  ['07-orderlist', '/order-list', true],
  ['08-friends', '/friends', true],
  ['09-form', '/recipe-form', true],
  ['10-search', '/search', true]
]

const AUDIT_JS = () => {
  const out = { overflow: [], clipped: [], tabbar: null, lowContrast: [] }

  const parseColor = c => {
    const m = c.match(/rgba?\(([^)]+)\)/)
    if (!m) return null
    const p = m[1].split(',').map(Number)
    return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] }
  }
  const lum = ({ r, g, b }) => {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const blend = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1
  })
  const bgOf = el => {
    let node = el
    while (node && node !== document.documentElement) {
      const cs = getComputedStyle(node)
      const c = parseColor(cs.backgroundColor)
      if (c && c.a > 0.5) return c
      const img = cs.backgroundImage
      if (img && img !== 'none' && /gradient/.test(img)) return null
      node = node.parentElement
    }
    const bodyBg = parseColor(getComputedStyle(document.body).backgroundColor)
    return bodyBg && bodyBg.a > 0.5 ? bodyBg : { r: 255, g: 255, b: 255, a: 1 }
  }

  // 横向溢出（跳过横向可滚动容器内部，如 chips 行）
  const inScrollX = el => {
    let node = el.parentElement
    while (node && node !== document.body) {
      const cs = getComputedStyle(node)
      if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') return true
      node = node.parentElement
    }
    return false
  }
  document.querySelectorAll('body *').forEach(el => {
    const r = el.getBoundingClientRect()
    if (r.width === 0) return
    if (r.right > window.innerWidth + 1.5 && !inScrollX(el)) {
      out.overflow.push({
        sel: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''),
        right: Math.round(r.right),
        vw: window.innerWidth
      })
    }
  })

  // 被裁切文本
  document.querySelectorAll('.rc-name, .rc-desc, .rr-name, .fi-name, .oc-meal, .title, .hero-name, .ph-name, .st-num, .btn, .chip').forEach(el => {
    if (el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2) {
      const cs = getComputedStyle(el)
      if (cs.overflow !== 'visible' || cs.textOverflow === 'ellipsis') {
        out.clipped.push({ text: (el.textContent || '').trim().slice(0, 24), w: el.clientWidth, sw: el.scrollWidth })
      }
    }
  })

  // 底部导航
  const tb = document.querySelector('.tabbar')
  if (tb) {
    const r = tb.getBoundingClientRect()
    out.tabbar = {
      items: tb.querySelectorAll('.tabbar-item').length,
      left: Math.round(r.left), right: Math.round(r.right),
      bottom: Math.round(window.innerHeight - r.bottom),
      height: Math.round(r.height),
      withinViewport: r.left >= 0 && r.right <= window.innerWidth + 0.5 && r.bottom <= window.innerHeight + 0.5
    }
  }

  // 对比度（关键文字）
  document.querySelectorAll('.rc-name, .rc-desc, .rr-name, .title, .st-label, .oc-time, .fi-sub, .section-title, .btn-primary, .tabbar-item.active').forEach(el => {
    const cs = getComputedStyle(el)
    const fg = parseColor(cs.color)
    if (!fg) return
    const bg = bgOf(el)
    if (!bg) return
    const fgB = blend(fg, bg)
    const l1 = lum(fgB), l2 = lum(bg)
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
    const size = parseFloat(cs.fontSize)
    const bold = parseInt(cs.fontWeight, 10) >= 600
    const large = size >= 24 || (size >= 18.66 && bold)
    const need = large ? 3 : 4.5
    if (ratio < need) {
      out.lowContrast.push({
        text: (el.textContent || '').trim().slice(0, 20),
        ratio: Math.round(ratio * 100) / 100,
        need,
        color: cs.color
      })
    }
  })

  return out
}

async function main () {
  const exe = CHROME_CANDIDATES.find(p => fs.existsSync(p))
  if (!exe) throw new Error('未找到 Chrome/Edge，可设置 CHROME_PATH')
  fs.mkdirSync(OUT, { recursive: true })

  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || exe,
    headless: 'new',
    args: ['--disable-gpu', '--hide-scrollbars', '--no-sandbox']
  })
  const page = await browser.newPage()
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 2 })

  // 登录拿 token
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS })
  }).then(r => r.json())
  if (!login.success) throw new Error('登录失败：' + JSON.stringify(login))
  const { token, user } = login.data

  const list = await fetch(`${BASE}/api/recipes?pageSize=1`).then(r => r.json())
  const rid = list.data.recipes[0] && list.data.recipes[0]._id

  const errors = []
  page.on('pageerror', e => errors.push('pageerror: ' + e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

  // 准备登录态：设置 localStorage 后硬刷新，避免内存 state 过期
  async function applyAuth (authed) {
    await page.goto(BASE + '/#/login', { waitUntil: 'domcontentloaded' })
    await page.evaluate((t, u, isAuthed) => {
      if (isAuthed) {
        localStorage.setItem('fy_token', t)
        localStorage.setItem('fy_user', u)
        localStorage.removeItem('fy_preview')
      } else {
        localStorage.removeItem('fy_token')
        localStorage.removeItem('fy_user')
        localStorage.removeItem('fy_preview')
      }
    }, token, JSON.stringify(user), authed)
    await page.reload({ waitUntil: 'networkidle2' })
  }

  const report = []
  let currentAuth = null
  for (const [name, route, authed] of PAGES) {
    const target = route.replace('{rid}', rid || '1')
    errors.length = 0
    if (currentAuth !== authed) {
      await applyAuth(authed)
      currentAuth = authed
    }
    await page.goto(`${BASE}/#${target}`, { waitUntil: 'networkidle2' })
    // 等页面渲染出主容器（hash 路由是异步渲染的）
    await page.waitForFunction(
      () => !!document.querySelector('.page, .login-page, .empty'),
      { timeout: 15000 }
    ).catch(() => {})
    await page.evaluate(() => window.scrollTo(0, 0))
    await new Promise(r => setTimeout(r, 900)) // 等图片/动效稳定

    const audit = await page.evaluate(AUDIT_JS)
    await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: false })
    report.push({ name, route: target, errors: [...errors], ...audit })
  }

  await browser.close()

  // 输出报告
  let issues = 0
  for (const r of report) {
    const flags = []
    if (r.errors.length) { flags.push(`JS错误×${r.errors.length}`); issues++ }
    if (r.overflow.length) { flags.push(`横向溢出×${r.overflow.length}`); issues++ }
    if (r.clipped.length) { flags.push(`文本截断×${r.clipped.length}`); issues++ }
    if (r.lowContrast.length) { flags.push(`对比度不足×${r.lowContrast.length}`); issues++ }
    if (r.tabbar && (!r.tabbar.withinViewport || r.tabbar.items !== 5)) { flags.push('导航异常'); issues++ }
    console.log(`${flags.length ? '⚠️ ' : '✅ '}${r.name.padEnd(12)} ${r.route.padEnd(22)} ${flags.join(' | ') || '正常'}`)
    r.errors.slice(0, 3).forEach(e => console.log('     · ' + e.slice(0, 160)))
    r.overflow.slice(0, 4).forEach(o => console.log(`     · 溢出 ${o.sel} right=${o.right} > vw=${o.vw}`))
    r.clipped.slice(0, 4).forEach(c => console.log(`     · 截断「${c.text}」 w=${c.w} sw=${c.sw}`))
    r.lowContrast.slice(0, 5).forEach(c => console.log(`     · 对比度「${c.text}」 ${c.ratio}:1 < ${c.need}`))
    if (r.tabbar) console.log(`     · tabbar items=${r.tabbar.items} h=${r.tabbar.height} bottom=${r.tabbar.bottom} inViewport=${r.tabbar.withinViewport}`)
  }
  fs.writeFileSync(path.join(OUT, 'audit.json'), JSON.stringify(report, null, 2))
  console.log(`\n截图与报告已输出：${OUT}`)
  console.log(`问题项：${issues}`)
}

main().catch(e => { console.error('❌', e.message); process.exit(1) })
