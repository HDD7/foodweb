#!/usr/bin/env node
/**
 * DeepSeek 视觉评审工具
 *
 * 用 DeepSeek Files API 上传截图，再用 deepseek-flash 做多模态评审。
 * 用法：
 *   node tools/vision-review.js <图片路径...> [--prompt "自定义提示词"]
 *
 * Key 读取顺序：DEEPSEEK_API_KEY 环境变量 → ~/.pi/agent/auth.json 的 deepseek.key
 */
const fs = require('fs')
const os = require('os')
const path = require('path')

const BASE = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
const MODEL = process.env.DEEPSEEK_VISION_MODEL || 'deepseek-flash'

function getKey () {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY
  for (const p of [path.join(os.homedir(), '.pi', 'agent', 'auth.json')]) {
    try {
      const auth = JSON.parse(fs.readFileSync(p, 'utf8'))
      const k = auth?.deepseek?.key || auth?.deepseek
      if (typeof k === 'string' && k) return k
    } catch { /* ignore */ }
  }
  throw new Error('未找到 DeepSeek API Key（DEEPSEEK_API_KEY 或 auth.json）')
}

const DEFAULT_PROMPT = `你是资深移动端 UI/UX 设计师，正在评审一个家庭菜谱 App 的界面截图。
请按下面结构给出简洁、可执行的评审（每条不超过 80 字）：
1. 配色与"食欲感"：主色/辅色是否协调，是否高级
2. 层次与留白：视觉动线是否清晰，是否有拥挤或空洞
3. 卡片与图文：圆角、阴影、图片比例、信息密度是否合理
4. 字体与可读性：字号层级、对比度、截断问题
5. 组件细节：按钮、标签、底部导航、状态标签
6. 具体缺陷：对齐错误、内容截断、元素溢出、对比度不足（请指出大致位置）
7. 优先修复的 3 件事`

async function upload (key, file) {
  const buf = fs.readFileSync(file)
  const fd = new FormData()
  fd.append('file', new Blob([buf], { type: 'image/png' }), path.basename(file))
  fd.append('purpose', 'user_data')
  const res = await fetch(`${BASE}/v1/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: fd
  })
  const json = await res.json()
  if (!res.ok || !json.id) throw new Error(`上传失败 ${res.status}: ${JSON.stringify(json).slice(0, 300)}`)
  return json.id
}

async function review (key, fileId, prompt) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      thinking: { type: 'disabled' },
      max_tokens: 1600,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'file', file_id: fileId }
        ]
      }]
    })
  })
  const json = await res.json()
  if (!res.ok) throw new Error(`评审失败 ${res.status}: ${JSON.stringify(json).slice(0, 300)}`)
  return json.choices?.[0]?.message?.content || '(空响应)'
}

async function main () {
  const args = process.argv.slice(2)
  const promptIdx = args.indexOf('--prompt')
  let prompt = DEFAULT_PROMPT
  if (promptIdx >= 0) {
    prompt = args[promptIdx + 1]
    args.splice(promptIdx, 2)
  }
  const files = args.filter(a => !a.startsWith('--'))
  if (!files.length) {
    console.error('用法：node tools/vision-review.js <图片...> [--prompt "..."]')
    process.exit(1)
  }
  const key = getKey()
  for (const file of files) {
    console.log(`\n${'='.repeat(70)}\n📷 ${path.basename(file)}\n${'='.repeat(70)}`)
    try {
      const id = await upload(key, file)
      const text = await review(key, id, prompt)
      console.log(text.trim())
    } catch (err) {
      console.error('❌', err.message)
    }
  }
}

main()
