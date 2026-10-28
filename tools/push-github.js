#!/usr/bin/env node
/**
 * 通过 GitHub REST API 推送代码（绕开被墙的 github.com:443，只用 api.github.com）
 *
 * 用法：
 *   GITHUB_TOKEN=ghp_xxx node tools/push-github.js HDD7/foodweb
 *   GITHUB_TOKEN=ghp_xxx node tools/push-github.js HDD7/foodweb --dry-run
 *
 * 说明：把 Food-web 目录内容推到仓库根目录；自动排除 node_modules/data/uploads/shots/
 *      .tmp/config.json/*.log/backups，并在推送前扫描是否有密钥泄漏。
 */
const fs = require('fs')
const path = require('path')

const API = 'https://api.github.com'
const ROOT = path.join(__dirname, '..') // Food-web 目录

const EXCLUDE_DIRS = new Set(['node_modules', 'data', 'uploads', 'shots', '.tmp', 'backups', '.git'])
const EXCLUDE_FILES = new Set(['config.json', 'config.local.json', 'package-lock.json.bak'])
const EXCLUDE_PATTERNS = [/\.log$/i, /^\.env$/]

const [, , repoArg, ...flags] = process.argv
const DRY = flags.includes('--dry-run')
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN

if (!repoArg || !repoArg.includes('/')) {
  console.error('用法: GITHUB_TOKEN=xxx node tools/push-github.js <owner>/<repo> [--dry-run]')
  process.exit(1)
}

function walk (dir, base = '') {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue
      out.push(...walk(path.join(dir, entry.name), rel))
    } else {
      if (EXCLUDE_FILES.has(entry.name)) continue
      if (EXCLUDE_PATTERNS.some(p => p.test(entry.name))) continue
      out.push(rel)
    }
  }
  return out
}

/** 扫描密钥泄漏 */
function scanSecrets (files) {
  const hits = []
  const patterns = [
    [/sk-[a-zA-Z0-9]{20,}/, '疑似 DeepSeek/OpenAI key'],
    [/ghp_[a-zA-Z0-9]{20,}/, '疑似 GitHub token'],
    [/AKIA[0-9A-Z]{16}/, '疑似 AWS key'],
    [/-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----/, '私钥'],
    [/"jwtSecret"\s*:\s*"(?!请改|随机|food-yun-dev)[^"]{20,}"/, '疑似真实 JWT 密钥']
  ]
  for (const rel of files) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8')
    for (const [re, label] of patterns) {
      if (re.test(text)) hits.push(`${rel} → ${label}`)
    }
  }
  return hits
}

async function gh (pathname, { method = 'GET', body } = {}) {
  const res = await fetch(API + pathname, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'azhu-deploy',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  let json
  try { json = text ? JSON.parse(text) : {} } catch { json = { raw: text.slice(0, 300) } }
  if (!res.ok) {
    const msg = json.message || JSON.stringify(json).slice(0, 300)
    throw new Error(`${method} ${pathname} → ${res.status} ${msg}`)
  }
  return json
}

;(async () => {
  const [owner, repo] = repoArg.split('/')
  const files = walk(ROOT).sort()
  console.log(`准备推送 ${files.length} 个文件 → ${owner}/${repo}`)
  files.slice(0, 60).forEach(f => console.log('  ' + f))
  if (files.length > 60) console.log(`  … 其余 ${files.length - 60} 个`)

  const leaks = scanSecrets(files)
  if (leaks.length) {
    console.error('\n❌ 检测到可能的密钥，已中止：')
    leaks.forEach(l => console.error('   ' + l))
    process.exit(1)
  }
  console.log('\n✅ 密钥扫描通过（无 sk-/token/私钥 泄漏）')

  if (DRY) {
    console.log('\n[dry-run] 未推送。去掉 --dry-run 即执行。')
    return
  }
  if (!TOKEN) {
    console.error('\n❌ 缺少 GITHUB_TOKEN')
    process.exit(1)
  }

  // 0) 空仓库需要先用 Contents API 引导一次，否则 Git Data API 会返回 409
  let parents = []
  let baseTree
  try {
    const ref = await gh(`/repos/${owner}/${repo}/git/ref/heads/main`)
    parents = [ref.object.sha]
    const c = await gh(`/repos/${owner}/${repo}/git/commits/${ref.object.sha}`)
    baseTree = c.tree.sha
    console.log(`\n[0/3] 已有提交，父提交: ${ref.object.sha.slice(0, 7)}`)
  } catch (e) {
    console.log('\n[0/3] 空仓库，先用 Contents API 引导初始提交…')
    const seed = files.includes('README.md') ? 'README.md' : files[0]
    const seeded = await gh(`/repos/${owner}/${repo}/contents/${encodeURI(seed)}`, {
      method: 'PUT',
      body: {
        message: 'chore: 初始化仓库',
        content: Buffer.from(fs.readFileSync(path.join(ROOT, seed), 'utf8'), 'utf8').toString('base64')
      }
    })
    parents = [seeded.commit.sha]
    baseTree = seeded.commit.tree.sha
    console.log(`      初始提交: ${seeded.commit.sha.slice(0, 7)}`)
  }

  // 1) 创建 tree（基于已有 tree 增量覆盖）
  console.log('[1/3] 上传文件树…')
  const tree = await gh(`/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    body: {
      base_tree: baseTree,
      tree: files.map(rel => ({
        path: rel,
        mode: '100644',
        type: 'blob',
        content: fs.readFileSync(path.join(ROOT, rel), 'utf8')
      }))
    }
  })
  console.log(`      tree: ${tree.sha}`)

  // 2) 创建 commit

  console.log('[2/3] 创建 commit…')
  const commit = await gh(`/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    body: {
      message: 'feat: 阿猪餐厅 Web 版（家庭菜谱管理 · Express + SQLite + 原生 SPA）\n\n' +
        '- 菜谱 CRUD、分类筛选、搜索（支持食材/分类词）\n' +
        '- 点餐购物车、订单状态流转、再次点餐\n' +
        '- 好友搜索码 / 请求双向确认\n' +
        '- AI 自动生成菜谱（DeepSeek 搜索 + 综合）\n' +
        '- 搜图 + DeepSeek 视觉审图\n' +
        '- systemd 一键部署脚本 + 每日备份\n' +
        '- 设计系统 v2（玫瑰粉 + 奶油白 + 微交互动效）',
      tree: tree.sha,
      parents
    }
  })
  console.log(`      commit: ${commit.sha}`)

  // 3) 更新或创建 main 分支引用
  console.log('[3/3] 更新 main 分支…')
  await gh(`/repos/${owner}/${repo}/git/refs/heads/main`, {
    method: 'PATCH',
    body: { sha: commit.sha, force: true }
  })

  console.log(`\n🎉 推送完成: https://github.com/${owner}/${repo}`)
  console.log(`   commit: ${commit.sha.slice(0, 7)} | 文件: ${files.length}`)
})().catch(err => {
  console.error('\n❌ 失败:', err.message)
  process.exit(1)
})
