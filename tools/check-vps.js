#!/usr/bin/env node
/**
 * VPS 连通性体检：判断某个 IP 是否被中国大陆网络阻断
 *
 * 用法：node tools/check-vps.js 1.2.3.4 [--proxy 127.0.0.1:7897]
 *
 * 检查项：
 *   1. IP 归属 / ASN / 机房
 *   2. 本机（国内网络）直连 22 / 80 / 443
 *   3. 经本地代理连接（判断服务器是否活着，排除本机网络因素）
 *   4. check-host 全球节点探活
 * 输出判定：✅ 可用 / ⚠️ 端口问题 / ❌ 被墙
 */
const net = require('net')

const args = process.argv.slice(2)
const IP = args.find(a => /^\d+\.\d+\.\d+\.\d+$/.test(a))
const proxyArg = args.indexOf('--proxy')
const PROXY = proxyArg >= 0 ? args[proxyArg + 1] : '127.0.0.1:7897'
if (!IP) {
  console.error('用法: node tools/check-vps.js <IP> [--proxy 127.0.0.1:7897]')
  process.exit(1)
}

const C = { g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', b: '\x1b[1m', d: '\x1b[2m', x: '\x1b[0m' }
const [proxyHost, proxyPort] = PROXY.split(':').map((v, i) => (i === 0 ? v : parseInt(v, 10)))

function tcp (host, port, timeout = 6000) {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const s = net.connect({ host, port, timeout })
    const done = (r) => { s.destroy(); resolve(r) }
    s.on('connect', () => done({ ok: true, ms: Date.now() - t0 }))
    s.on('timeout', () => done({ ok: false, reason: 'timeout' }))
    s.on('error', (e) => done({ ok: false, reason: e.code || 'error' }))
  })
}

function openViaProxy (host, port, timeout = 12000) {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const s = net.connect({ host: proxyHost, port: proxyPort })
    let stage = 0
    let done2 = false
    let buf = Buffer.alloc(0)
    const done = (r) => { if (done2) return; done2 = true; s.destroy(); resolve(r) }
    s.setTimeout(timeout, () => done({ ok: false, reason: 'timeout' }))
    s.on('error', (e) => done({ ok: false, reason: e.code || 'error' }))
    s.on('connect', () => s.write(Buffer.from([5, 1, 0])))
    s.on('data', (d) => {
      buf = Buffer.concat([buf, d])
      if (stage === 0) {
        if (buf.length < 2) return
        if (buf[1] !== 0) return done({ ok: false, reason: 'proxy-auth' })
        buf = buf.subarray(2)
        const h = Buffer.from(host)
        s.write(Buffer.concat([Buffer.from([5, 1, 0, 3, h.length]), h, Buffer.from([port >> 8, port & 255])]))
        stage = 1
        if (!buf.length) return
      }
      if (buf.length < 5) return
      const rep = buf[1]
      const atyp = buf[3]
      const need = atyp === 1 ? 10 : atyp === 4 ? 22 : 4 + 1 + buf[4] + 2
      if (buf.length < need) return
      if (rep !== 0) return done({ ok: false, reason: 'refused(code=' + rep + ')' })
      if (done2) return
      done2 = true
      s.setTimeout(0)
      s.removeAllListeners('data')
      resolve({ ok: true, sock: s, ms: Date.now() - t0 })
    })
  })
}

/** 用 socket 真实探测服务是否响应（避免代理"假成功"） */
function probeService (sock, port, timeout = 8000) {
  return new Promise((resolve) => {
    let done = false
    const finish = (r) => { if (done) return; done = true; try { sock.destroy() } catch {} ; resolve(r) }
    const to = setTimeout(() => finish({ ok: false, reason: '无响应' }), timeout)
    sock.on('error', (e) => { clearTimeout(to); finish({ ok: false, reason: e.code || 'error' }) })
    sock.on('close', () => { clearTimeout(to); finish({ ok: false, reason: '连接被关闭' }) })

    if (port === 443 || port === 8443) {
      const tls = require('tls')
      const t = tls.connect({ socket: sock, servername: undefined, rejectUnauthorized: false, timeout })
      t.on('secureConnect', () => { clearTimeout(to); finish({ ok: true, info: 'TLS 握手成功' }) })
      t.on('error', (e) => { clearTimeout(to); finish({ ok: false, reason: 'TLS ' + (e.code || e.message) }) })
      return
    }
    if (port === 80 || port === 8080) {
      sock.write('HEAD / HTTP/1.0' + '\r' + '\n' + 'Host: probe' + '\r' + '\n' + '\r' + '\n')
    }
    sock.on('data', (d) => {
      clearTimeout(to)
      const text = d.toString('latin1').trim()
      finish({ ok: true, info: JSON.stringify(text.slice(0, 40)) })
    })
  })
}

async function geo () {
  try {
    const r = await fetch(`http://ip-api.com/json/${IP}?fields=country,regionName,city,isp,org,as,query`, { signal: AbortSignal.timeout(8000) })
    return await r.json()
  } catch { return null }
}

async function checkHost (port) {
  try {
    const init = await fetch(`https://check-host.net/check-tcp?host=${IP}:${port}&max_nodes=3`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15000)
    }).then(r => r.json())
    if (!init.request_id) return null
    await new Promise(r => setTimeout(r, 9000))
    const res = await fetch(`https://check-host.net/check-result/${init.request_id}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15000)
    }).then(r => r.json())
    const nodes = Object.entries(res || {})
    const okCount = nodes.filter(([, v]) => Array.isArray(v) && v[0] && v[0].time).length
    return { ok: okCount, total: nodes.length }
  } catch { return null }
}

const pad = (s, n) => String(s).padEnd(n)

;(async () => {
  console.log(`\n${C.b}=== VPS 连通性体检: ${IP} ===${C.x}\n`)

  const g = await geo()
  if (g && g.country) {
    console.log(`${C.b}1) 归属${C.x}`)
    console.log(`   ${g.country} ${g.regionName || ''} ${g.city || ''}`)
    console.log(`   ${C.d}${g.isp || ''} · ${g.as || ''}${C.x}\n`)
  }

  console.log(`${C.b}2) 本机直连（国内网络）${C.x}`)
  const ports = [22, 80, 443]
  const direct = {}
  for (const p of ports) {
    const r = await tcp(IP, p, 5000)
    direct[p] = r
    console.log(`   ${pad('端口 ' + p, 10)} ${r.ok ? C.g + '✅ 通 ' + r.ms + 'ms' + C.x : C.r + '❌ ' + r.reason + C.x}`)
  }

  console.log(`\n${C.b}3) 经代理 ${PROXY}（参考项：Clash 可能"假成功"，仅供参考）${C.x}`)
  const proxied = {}
  for (const p of ports) {
    const t = await openViaProxy(IP, p)
    if (!t.ok) {
      proxied[p] = { ok: false, reason: '隧道 ' + t.reason }
      console.log(`   ${pad('端口 ' + p, 10)} ${C.y}⚠ 隧道 ${t.reason}${C.x}`)
      continue
    }
    const svc = await probeService(t.sock, p)
    proxied[p] = svc
    console.log(`   ${pad('端口 ' + p, 10)} ${svc.ok ? C.g + '✅ 服务响应 ' + svc.info + C.x : C.y + '⚠ 隧道通但' + svc.reason + C.x}`)
  }

  console.log(`\n${C.b}4) check-host 全球节点（22 端口）${C.x}`)
  const ch = await checkHost(22)
  if (ch) {
    const color = ch.ok === ch.total ? C.g : ch.ok === 0 ? C.r : C.y
    console.log(`   ${color}${ch.ok}/${ch.total} 个境外节点可连${C.x}`)
  } else {
    console.log(`   ${C.d}查询失败${C.x}`)
  }

  // 判定
  const directOk = ports.filter(p => direct[p].ok)
  const proxyOk = ports.filter(p => proxied[p].ok)
  console.log(`\n${C.b}=== 结论 ===${C.x}`)
  if (directOk.length) {
    console.log(`   ${C.g}✅ 可用${C.x}：本机直连已通（端口 ${directOk.join('/')}），可以部署`)
  } else if (ch && ch.ok > 0) {
    console.log(`   ${C.r}❌ 被墙${C.x}：国内直连全部超时，但 ${ch.ok}/${ch.total} 个境外节点可连 → 服务器活着、IP 被封`)
    console.log(`   ${C.d}建议：找商家换到不同 /24 网段的 IP，或换一家${C.x}`)
  } else if (proxyOk.length) {
    console.log(`   ${C.y}⚠️ 待确认${C.x}：国内和代理都不通，但境外节点可连 → 可能是服务器防火墙未放行`)
  } else {
    console.log(`   ${C.r}❌ 服务器无响应${C.x}：境内、代理、境外全部失败，检查是否开机/服务是否在跑`)
  }
  console.log()
})()
