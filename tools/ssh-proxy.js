#!/usr/bin/env node
/**
 * 通过本地代理（SOCKS5 / HTTP CONNECT）执行远程 SSH 命令
 *
 * 适用场景：目标服务器在本机网络被墙，但本地有代理（如 Clash 的 7897 混合端口）。
 *
 * 用法：
 *   node tools/ssh-proxy.js "uname -a"
 *   node tools/ssh-proxy.js --upload 本地文件 远程路径
 *   echo "key" | node tools/ssh-proxy.js --upload - /root/key.txt
 *
 * 环境变量：
 *   SSH_HOST  目标主机         (默认取 --host 或 206.237.13.101)
 *   SSH_PORT  目标端口         (默认 22)
 *   SSH_USER  用户名           (默认 root)
 *   SSH_PASS  密码
 *   SSH_KEY   私钥路径（可选，优先于密码）
 *   PROXY     代理地址         (默认 127.0.0.1:7897)
 *   PROXY_TYPE socks5 | http   (默认 socks5，失败自动回退 http)
 */
const fs = require('fs')
const net = require('net')
const path = require('path')
const { Client } = require('ssh2')

const args = process.argv.slice(2)
const C = { g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', b: '\x1b[1m', d: '\x1b[2m', x: '\x1b[0m' }

function parseTargets () {
  const argv = [...args]
  const take = (name) => {
    const i = argv.indexOf('--' + name)
    if (i < 0) return null
    const v = argv[i + 1]
    argv.splice(i, 2)
    return v
  }
  const host = take('host') || process.env.SSH_HOST || '206.237.13.101'
  const port = parseInt(take('port') || process.env.SSH_PORT || '22', 10)
  const user = take('user') || process.env.SSH_USER || 'root'
  const pass = take('pass') || process.env.SSH_PASS || ''
  const proxy = take('proxy') || process.env.PROXY || '127.0.0.1:7897'
  const type = take('type') || process.env.PROXY_TYPE || 'socks5'
  const uploadIdx = argv.indexOf('--upload')
  let upload = null
  if (uploadIdx >= 0) {
    const local = argv[uploadIdx + 1]
    const remote = argv[uploadIdx + 2]
    upload = { local, remote }
    argv.splice(uploadIdx, 3)
  }
  const command = upload ? null : argv.join(' ')
  return { host, port, user, pass, proxy, type, upload, command }
}

const cfg = parseTargets()
if (!cfg.command && !cfg.upload) {
  console.error('用法: node tools/ssh-proxy.js "命令"  或  --upload 本地 远程')
  process.exit(1)
}

const [proxyHost, proxyPortStr] = cfg.proxy.split(':')
const proxyPort = parseInt(proxyPortStr || '7897', 10)

/** SOCKS5 握手，返回已连到目标的 socket */
function socks5Connect (targetHost, targetPort, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: proxyHost, port: proxyPort })
    let stage = 0
    const fail = (msg) => { sock.destroy(); reject(new Error('SOCKS5: ' + msg)) }
    sock.setTimeout(timeout, () => fail('超时'))
    sock.on('error', (e) => reject(new Error('SOCKS5 连接失败: ' + (e.code || e.message))))
    sock.on('connect', () => sock.write(Buffer.from([0x05, 0x01, 0x00])))
    let buf = Buffer.alloc(0)
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d])
      if (stage === 0) {
        if (buf.length < 2) return
        if (buf[0] !== 0x05) return fail('不是 SOCKS5 服务')
        if (buf[1] !== 0x00) return fail('需要认证（本工具不支持）')
        buf = buf.subarray(2)
        const hostBuf = Buffer.from(targetHost)
        sock.write(Buffer.concat([
          Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]),
          hostBuf,
          Buffer.from([targetPort >> 8, targetPort & 0xff])
        ]))
        stage = 1
        if (!buf.length) return
      }
      // 解析 CONNECT 回复：VER REP RSV ATYP [ADDR] PORT
      if (buf.length < 5) return
      const rep = buf[1]
      const atyp = buf[3]
      let need = 4
      if (atyp === 0x01) need = 4 + 4 + 2
      else if (atyp === 0x04) need = 4 + 16 + 2
      else if (atyp === 0x03) need = 4 + 1 + buf[4] + 2
      if (buf.length < need) return
      if (rep !== 0x00) return fail('目标拒绝连接，code=' + rep)
      const leftover = buf.subarray(need)
      sock.removeAllListeners('data')
      sock.setTimeout(0)
      // 把与回复同包到达的后续数据回推给消费者
      if (leftover.length) sock.unshift(leftover)
      resolve(sock)
    })
  })
}

/** HTTP CONNECT 隧道 */
function httpConnect (targetHost, targetPort, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: proxyHost, port: proxyPort })
    let buf = ''
    sock.setTimeout(timeout, () => { sock.destroy(); reject(new Error('HTTP CONNECT 超时')) })
    sock.on('error', (e) => reject(new Error('HTTP CONNECT 失败: ' + (e.code || e.message))))
    sock.on('connect', () => {
      sock.write(`CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n\r\n`)
    })
    sock.on('data', function onData (d) {
      buf += d.toString('latin1')
      if (buf.includes('\r\n\r\n')) {
        const status = buf.split('\r\n')[0]
        if (!/200/.test(status)) { sock.destroy(); return reject(new Error('代理拒绝: ' + status)) }
        sock.removeListener('data', onData)
        sock.setTimeout(0)
        resolve(sock)
      }
    })
  })
}

async function openTunnel () {
  if (/^(none|direct|off)$/i.test(proxyHost)) {
    console.log(`${C.g}✓${C.x} 直连模式（不使用代理）→ ${cfg.host}:${cfg.port}`)
    return undefined // ssh2 用默认 socket
  }
  const order = cfg.type === 'http' ? ['http', 'socks5'] : ['socks5', 'http']
  let lastErr
  for (const kind of order) {
    try {
      const sock = kind === 'socks5'
        ? await socks5Connect(cfg.host, cfg.port)
        : await httpConnect(cfg.host, cfg.port)
      console.log(`${C.g}✓${C.x} 已通过 ${kind.toUpperCase()} 代理 ${cfg.proxy} 建立隧道 → ${cfg.host}:${cfg.port}`)
      return sock
    } catch (e) {
      lastErr = e
      console.log(`${C.y}!${C.x} ${kind} 失败: ${e.message}`)
    }
  }
  throw lastErr
}

function connect (sock) {
  return new Promise((resolve, reject) => {
    const conn = new Client()
    conn.on('ready', () => resolve(conn))
    conn.on('error', (e) => reject(new Error('SSH: ' + e.message)))
    const opts = {
      ...(sock ? { sock } : { host: cfg.host, port: cfg.port }),
      username: cfg.user,
      hostVerifier: () => true, // 首次连接接受未知主机指纹
      readyTimeout: 30000,
      keepaliveInterval: 10000
    }
    if (process.env.SSH_KEY) opts.privateKey = fs.readFileSync(process.env.SSH_KEY)
    else opts.password = cfg.pass
    conn.connect(opts)
  })
}

function exec (conn, command, { quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) return reject(err)
      let code = 0
      stream.on('close', (c) => { code = c; resolve(code) })
      stream.on('data', (d) => process.stdout.write(d))
      if (!quiet) stream.stderr.on('data', (d) => process.stderr.write(d))
    })
  })
}

/** 兼容 git-bash 的 /c/... 与 Windows 的 C:/... 及相对路径 */
/** git-bash(MSYS) 会把 /root/x 转成 C:/Program Files/Git/root/x，这里还原 */
function normalizeRemotePath (input) {
  if (!input) return input
  return input
    .replace(/^[A-Za-z]:[\/]Program Files[\/]Git[\/]?/i, '/')
}


function normalizeLocalPath (input) {
  if (!input || input === '-') return input
  if (fs.existsSync(input)) return input
  const m = /^\/([a-zA-Z])\/(.*)$/.exec(input)
  if (m) {
    const win = m[1].toUpperCase() + ':/' + m[2]
    if (fs.existsSync(win)) return win
  }
  const abs = path.resolve(input)
  if (fs.existsSync(abs)) return abs
  return input
}

function sftpUpload (conn, localInput, remoteInput) {
  const remote = normalizeRemotePath(remoteInput)
  const local = normalizeLocalPath(localInput)
  if (local !== '-' && !fs.existsSync(local)) {
    return Promise.reject(new Error(`本地文件不存在: ${localInput}`))
  }
  const size = local === '-' ? 'stdin' : (fs.statSync(local).size / 1024).toFixed(1) + ' KB'
  console.log(`  ${C.d}上传 ${local} → ${remote} (${size})${C.x}`)
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err)
      const read = local === '-' ? process.stdin : fs.createReadStream(local)
      const write = sftp.createWriteStream(remote)
      write.on('close', () => resolve())
      write.on('error', reject)
      read.on('error', reject)
      read.pipe(write)
    })
  })
}

;(async () => {
  const sock = await openTunnel()
  const conn = await connect(sock)
  console.log(`${C.g}✓${C.x} SSH 登录成功 (${cfg.user}@${cfg.host})`)
  try {
    if (cfg.upload) {
      await sftpUpload(conn, cfg.upload.local, cfg.upload.remote)
      console.log(`${C.g}✓${C.x} 已上传 ${cfg.upload.local} → ${cfg.upload.remote}`)
    } else {
      const code = await exec(conn, cfg.command)
      conn.end()
      process.exit(code)
    }
  } finally {
    conn.end()
  }
})().catch((e) => {
  console.error(`${C.r}✗${C.x} ${e.message}`)
  process.exit(1)
})
