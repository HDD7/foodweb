#!/usr/bin/env node
/**
 * 菜品播种脚本：搜图 → DeepSeek 审图 → 下载存本地 → 创建菜谱
 *
 * 用法：
 *   node tools/seed-dishes.js                 # 默认用户 demo/123456
 *   node tools/seed-dishes.js --user x --pass y
 *   node tools/seed-dishes.js --skip-images   # 不搜图，只建菜谱
 *   node tools/seed-dishes.js --base http://localhost:3000
 */
const BASE = (() => {
  const i = process.argv.indexOf('--base')
  return i >= 0 ? process.argv[i + 1] : 'http://localhost:3000'
})()
const arg = (name, def) => {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 ? process.argv[i + 1] : def
}
const USER = arg('user', 'demo')
const PASS = arg('pass', '123456')
const SKIP_IMAGES = process.argv.includes('--skip-images')

const DISHES = [
  {
    name: '红烧肉',
    description: '焦糖油亮、入口即化，米饭杀手',
    scene: 'heavy', ing: 'meat', tags: ['stew', 'home_style'],
    time: ['60', '1小时'], diff: [2, '中等', 'yellow'], size: ['3-4', '3-4人'],
    ingredients: [['五花肉', '600g'], ['冰糖', '30g'], ['生抽', '3勺'], ['老抽', '1勺'], ['姜片', '4片']],
    steps: [
      '五花肉切 3cm 方块，冷水下锅焯 3 分钟去浮沫，捞出擦干。',
      '锅中放冰糖小火炒至枣红色，下肉块翻炒上色。',
      '加生抽、老抽、姜片和没过肉的热水，小火炖 40 分钟。',
      '开大火收汁至汤汁浓稠挂肉，出锅前撒少许葱花。'
    ]
  },
  {
    name: '宫保鸡丁',
    description: '鸡丁滑嫩、花生酥脆，酸甜微辣超下饭',
    scene: 'quick', ing: 'meat', tags: ['stir_fry', 'sichuan', 'spicy'],
    time: ['30', '30分钟'], diff: [2, '中等', 'yellow'], size: ['3-4', '3-4人'],
    ingredients: [['鸡腿肉', '350g'], ['油炸花生米', '80g'], ['干辣椒', '8个'], ['花椒', '1小把'], ['葱段', '适量']],
    steps: [
      '鸡腿肉切丁，用生抽、料酒、淀粉抓匀腌 15 分钟。',
      '调碗汁：生抽 2 勺、香醋 1 勺、糖 1 勺、淀粉半勺、清水 3 勺。',
      '热油滑炒鸡丁至变色盛出；下干辣椒花椒炝香，回锅倒碗汁快速翻炒。',
      '收汁后关火拌入花生米，撒葱段装盘。'
    ]
  },
  {
    name: '清蒸鲈鱼',
    description: '鲜嫩无腥，粤式家常头牌',
    scene: 'guest', ing: 'seafood', tags: ['steam', 'cantonese', 'light'],
    time: ['30', '30分钟'], diff: [2, '中等', 'yellow'], size: ['3-4', '3-4人'],
    ingredients: [['鲈鱼', '1条(约600g)'], ['姜丝', '适量'], ['葱段', '适量'], ['蒸鱼豉油', '3勺'], ['料酒', '1勺']],
    steps: [
      '鲈鱼两面划斜刀，抹薄盐和料酒，鱼腹塞姜片腌 10 分钟。',
      '水开后大火蒸 8 分钟，倒掉盘中的腥水。',
      '铺葱丝姜丝，淋热油激香，最后沿盘边淋蒸鱼豉油。'
    ]
  },
  {
    name: '麻婆豆腐',
    description: '麻辣鲜香，豆腐嫩滑不碎',
    scene: 'heavy', ing: 'vegetable', tags: ['stir_fry', 'sichuan', 'spicy'],
    time: ['30', '30分钟'], diff: [1, '简单', 'green'], size: ['2-3', '1-2人'],
    ingredients: [['嫩豆腐', '1盒'], ['牛肉末', '100g'], ['郫县豆瓣酱', '1勺'], ['花椒粉', '适量'], ['蒜苗', '2根']],
    steps: [
      '豆腐切方块，淡盐水中浸泡 5 分钟去豆腥。',
      '热油炒牛肉末至酥香，下豆瓣酱炒出红油。',
      '加半碗水烧开，滑入豆腐小火煮 3 分钟，分两次勾薄芡。',
      '出锅撒花椒粉和蒜苗末。'
    ]
  },
  {
    name: '番茄炒蛋',
    description: '酸甜多汁，十分钟搞定的国民家常菜',
    scene: 'quick', ing: 'egg', tags: ['stir_fry', 'home_style', 'sour'],
    time: ['10', '10分钟'], diff: [1, '简单', 'green'], size: ['2-3', '1-2人'],
    ingredients: [['番茄', '2个'], ['鸡蛋', '3个'], ['白糖', '1小勺'], ['葱花', '适量'], ['盐', '适量']],
    steps: [
      '鸡蛋加少许盐打散；番茄切块。',
      '热油倒入蛋液，稍凝固就划散盛出，保持嫩滑。',
      '原锅下番茄炒出汁水，加糖和盐，回倒鸡蛋翻匀，撒葱花出锅。'
    ]
  },
  {
    name: '可乐鸡翅',
    description: '甜咸挂汁，皮糯肉嫩，小孩最爱',
    scene: 'daily', ing: 'meat', tags: ['stew', 'sweet'],
    time: ['30', '30分钟'], diff: [1, '简单', 'green'], size: ['3-4', '3-4人'],
    ingredients: [['鸡中翅', '10个'], ['可乐', '330ml'], ['生抽', '2勺'], ['老抽', '半勺'], ['姜片', '3片']],
    steps: [
      '鸡翅两面划刀，冷水下锅焯水后擦干。',
      '少油煎至两面金黄，下姜片炒香。',
      '倒入可乐和生抽老抽，小火焖 15 分钟，大火收汁至粘稠。'
    ]
  },
  {
    name: '蒜蓉油麦菜',
    description: '蒜香扑鼻，脆嫩清口',
    scene: 'quick', ing: 'vegetable', tags: ['stir_fry', 'light'],
    time: ['10', '10分钟'], diff: [1, '简单', 'green'], size: ['2-3', '1-2人'],
    ingredients: [['油麦菜', '400g'], ['大蒜', '5瓣'], ['盐', '适量'], ['油', '2勺']],
    steps: [
      '油麦菜洗净切长段，蒜切末。',
      '热锅冷油下蒜末小火煸香。',
      '转大火下菜段快炒 40 秒，加盐翻匀立刻出锅（防止出水发黄）。'
    ]
  },
  {
    name: '冬瓜排骨汤',
    description: '清甜解腻，汤色清亮不油腻',
    scene: 'light', ing: 'meat', tags: ['soup', 'home_style', 'light'],
    time: ['60', '1小时'], diff: [1, '简单', 'green'], size: ['3-4', '3-4人'],
    ingredients: [['排骨', '500g'], ['冬瓜', '400g'], ['姜片', '3片'], ['枸杞', '10粒'], ['盐', '适量']],
    steps: [
      '排骨冷水下锅焯水，撇净浮沫后捞出冲洗。',
      '排骨加姜片和足量清水，大火烧开转小火炖 40 分钟。',
      '下冬瓜块再炖 15 分钟，出锅前加盐和枸杞。'
    ]
  },
  {
    name: '扬州炒饭',
    description: '粒粒分明，虾仁火腿蛋香十足',
    scene: 'daily', ing: 'staple', tags: ['stir_fry', 'home_style'],
    time: ['30', '30分钟'], diff: [1, '简单', 'green'], size: ['2-3', '1-2人'],
    ingredients: [['隔夜米饭', '2碗'], ['虾仁', '100g'], ['火腿丁', '50g'], ['鸡蛋', '2个'], ['青豆', '40g']],
    steps: [
      '虾仁用盐和淀粉略腌；鸡蛋打散炒成蛋碎盛出。',
      '热油炒虾仁、火腿丁、青豆至断生。',
      '下米饭大火翻炒打散，加盐调味，回倒蛋碎炒匀出锅。'
    ]
  },
  {
    name: '糖醋排骨',
    description: '酸甜油亮，外酥里嫩，老少通吃',
    scene: 'guest', ing: 'meat', tags: ['stir_fry', 'sweet', 'home_style'],
    time: ['60', '1小时'], diff: [2, '中等', 'yellow'], size: ['3-4', '3-4人'],
    ingredients: [['肋排', '600g'], ['冰糖', '40g'], ['香醋', '3勺'], ['生抽', '2勺'], ['白芝麻', '适量']],
    steps: [
      '排骨切段，冷水焯水去浮沫后沥干。',
      '少油煎至表面微焦，加冰糖炒出糖色裹匀。',
      '加香醋、生抽和热水没过排骨，小火焖 30 分钟。',
      '大火收汁至浓稠油亮，撒白芝麻出锅。'
    ]
  },
  {
    name: '酸辣土豆丝',
    description: '酸辣脆爽，配粥下饭都绝',
    scene: 'quick', ing: 'vegetable', tags: ['stir_fry', 'sour', 'spicy'],
    time: ['10', '10分钟'], diff: [1, '简单', 'green'], size: ['2-3', '1-2人'],
    ingredients: [['土豆', '2个'], ['干辣椒', '4个'], ['白醋', '2勺'], ['蒜末', '适量'], ['盐', '适量']],
    steps: [
      '土豆切细丝，清水冲洗两遍去淀粉，泡 5 分钟后沥干。',
      '热油下干辣椒和蒜末炝香。',
      '大火下土豆丝快炒 1 分钟，沿锅边淋白醋，加盐炒匀出锅。'
    ]
  }
]

async function api (path, { method = 'GET', body, token, formData } = {}) {
  const headers = {}
  if (token) headers.Authorization = 'Bearer ' + token
  let payload
  if (formData) {
    payload = formData
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const res = await fetch(BASE + path, { method, headers, body: payload })
  return res.json()
}

/** 搜图 + 审图，取最佳候选并下载存到本地 uploads（避免外链防盗链失效） */
async function pickImage (name, token) {
  const search = await api('/api/images/search', {
    method: 'POST',
    token,
    body: { query: name, count: 6, requirement: name, verify: true }
  })
  if (!search.success) throw new Error(search.message)

  const items = search.data.items || []
  const best = items
    .filter(i => i.verdict.match >= 2)
    .sort((a, b) => b.verdict.match - a.verdict.match || (b.width * b.height) - (a.width * a.height))[0]

  if (!best) return { url: '', note: `无合格候选（${items.map(i => i.verdict.match).join('/')}）` }

  // 通过代理下载（自带签名）
  const imgRes = await fetch(BASE + best.thumb)
  if (!imgRes.ok) return { url: '', note: '下载失败 ' + imgRes.status }
  const buf = Buffer.from(await imgRes.arrayBuffer())

  const fd = new FormData()
  fd.append('file', new Blob([buf], { type: imgRes.headers.get('content-type') || 'image/jpeg' }), name + '.jpg')
  const up = await api('/api/upload', { method: 'POST', token, formData: fd })
  if (!up.success) return { url: '', note: '上传失败 ' + up.message }
  return { url: up.data.url, note: `匹配度 ${best.verdict.match}/3 · 识别为「${best.verdict.dish || '?'}」` }
}

/** 把老菜谱的外链图换成本地实拍图 */
async function refreshImages (token) {
  const mine = await api('/api/recipes/my?page=1&pageSize=100', { token })
  const list = (mine.data?.recipes || []).filter(r => !String((r.images || [])[0] || '').startsWith('/uploads/'))
  if (!list.length) return console.log('没有需要换图的老菜谱')
  for (const r of list) {
    const full = await api('/api/recipes/' + r._id, { token })
    if (!full.success) continue
    const rc = full.data
    let image = { url: '', note: '搜图失败' }
    try { image = await pickImage(rc.name, token) } catch (e) { image = { url: '', note: e.message } }
    if (!image.url) { console.log(`⚠️  ${rc.name} 换图失败：${image.note}`); continue }
    const put = await api('/api/recipes/' + r._id, {
      method: 'PUT',
      token,
      body: {
        name: rc.name, description: rc.description, images: [image.url],
        ingredients: rc.ingredients, steps: rc.steps,
        preparationTime: rc.preparationTime, difficulty: rc.difficulty, servingSize: rc.servingSize,
        sceneCategory: rc.sceneCategory, ingredientCategory: rc.ingredientCategory,
        optionalTags: rc.optionalTags, isPublic: rc.isPublic, status: rc.status
      }
    })
    console.log(put.success ? `🖼  换图成功：${rc.name}（${image.note}）` : `❌ ${rc.name}：${put.message}`)
  }
}

async function main () {
  let login = await api('/api/auth/login', { method: 'POST', body: { username: USER, password: PASS } })
  if (!login.success) {
    login = await api('/api/auth/register', { method: 'POST', body: { username: USER, password: PASS, nickname: '阿猪' } })
    if (!login.success) throw new Error('登录/注册失败：' + login.message)
    console.log(`已创建用户 ${USER}`)
  }
  const token = login.data.token

  if (process.argv.includes('--refresh-images')) {
    await refreshImages(token)
    return
  }

  const mine = await api('/api/recipes/my?page=1&pageSize=50', { token })
  const existing = new Set((mine.data?.recipes || []).map(r => r.name))

  let created = 0
  let skipped = 0
  for (const d of DISHES) {
    if (existing.has(d.name)) {
      console.log(`⏭  跳过（已存在）：${d.name}`)
      skipped++
      continue
    }
    let image = { url: '', note: '跳过搜图' }
    if (!SKIP_IMAGES) {
      try {
        image = await pickImage(d.name, token)
      } catch (err) {
        image = { url: '', note: '搜图失败：' + err.message }
      }
    }
    const res = await api('/api/recipes', {
      method: 'POST',
      token,
      body: {
        name: d.name,
        description: d.description,
        images: image.url ? [image.url] : [],
        ingredients: d.ingredients.map((v, i) => ({ id: 'i' + i, name: v[0], amount: v[1] })),
        steps: d.steps.map((s, i) => ({ id: 's' + i, content: s, image: '' })),
        preparationTime: { value: d.time[0], label: d.time[1] },
        difficulty: { value: d.diff[0], label: d.diff[1], color: d.diff[2] },
        servingSize: { value: d.size[0], label: d.size[1] },
        sceneCategory: d.scene,
        ingredientCategory: d.ing,
        optionalTags: d.tags,
        isPublic: true,
        status: 'published'
      }
    })
    if (res.success) {
      created++
      console.log(`✅ ${d.name}  (${image.note})`)
    } else {
      console.log(`❌ ${d.name}  创建失败：${res.message}`)
    }
  }
  console.log(`\n完成：新增 ${created} 道，跳过 ${skipped} 道，共 ${DISHES.length} 道`)
}

main().catch(e => { console.error('❌', e.message); process.exit(1) })
