/**
 * 菜谱接口（对应 recipe 云函数）
 * 权限规则（《云开发配置.md》）：
 *   read  -> 公开菜谱或本人菜谱可读
 *   write -> 仅创建者可写
 */
const express = require('express')
const { db, parseRecipe } = require('../db')
const { authRequired, authOptional } = require('../middleware/auth')
const { generateRecipe } = require('../lib/recipeAI')

const router = express.Router()

const DEFAULT_TIME = { value: '30', label: '30分钟' }
const DEFAULT_DIFF = { value: 1, label: '简单', color: 'green' }
const DEFAULT_SIZE = { value: '3-4', label: '3-4人' }

function formatTime (dateStr) {
  const date = new Date(String(dateStr).replace(' ', 'T'))
  const days = Math.floor((Date.now() - date.getTime()) / 86400000)
  if (days <= 0) return '今天'
  if (days === 1) return '昨天'
  if (days < 7) return `${days}天前`
  return String(dateStr).slice(0, 10)
}

function attachCreator (recipe) {
  const u = db.prepare('SELECT nickname, avatar FROM users WHERE id = ?').get(Number(recipe.creatorId))
  recipe.creator = u ? { nickname: u.nickname || '未知用户', avatar: u.avatar || '' } : { nickname: '未知用户', avatar: '' }
  recipe.createTime = formatTime(recipe.createdAt)
  return recipe
}

const ING_NAMES = { 肉类: 'meat', 水产: 'seafood', 蛋类: 'egg', 蔬菜: 'vegetable', 主食: 'staple' }
const SCENE_NAMES = { 家常: 'daily', 日常: 'daily', 快手: 'quick', 宴客: 'guest', 清淡: 'light', 重口: 'heavy' }

/** 构建列表查询条件（与云函数筛选逻辑一致），返回 { where, params } */
function buildListConditions (q, { scope, uid }) {
  const where = []
  const params = {}

  if (q.search && String(q.search).trim()) {
    // 支持菜名 / 描述 / 食材名搜索（对应设计文档「支持菜名、食材搜索」）
    const kwRaw = String(q.search).trim()
    params.kw = `%${kwRaw}%`
    let cond = '(name LIKE :kw OR description LIKE :kw OR ingredients LIKE :kw)'
    // 中文分类词 → 分类 ID（如「肉类」「快手」）
    const ingCats = Object.keys(ING_NAMES).filter(n => kwRaw.includes(n) || n.includes(kwRaw)).map(n => ING_NAMES[n])
    const sceneCats = Object.keys(SCENE_NAMES).filter(n => kwRaw.includes(n) || n.includes(kwRaw)).map(n => SCENE_NAMES[n])
    if (ingCats.length) {
      cond += ` OR ingredient_category IN (${ingCats.map((_, i) => `:ics${i}`).join(',')})`
      ingCats.forEach((v, i) => { params[`ics${i}`] = v })
    }
    if (sceneCats.length) {
      cond += ` OR scene_category IN (${sceneCats.map((_, i) => `:scs${i}`).join(',')})`
      sceneCats.forEach((v, i) => { params[`scs${i}`] = v })
    }
    where.push('(' + cond + ')')
  }
  const parseIds = v => (Array.isArray(v) ? v : String(v || '').split(',')).map(s => s.trim()).filter(Boolean)

  const scenes = parseIds(q.sceneCategories)
  if (scenes.length) {
    where.push(`scene_category IN (${scenes.map((_, i) => `:sc${i}`).join(',')})`)
    scenes.forEach((v, i) => { params[`sc${i}`] = v })
  }
  const ings = parseIds(q.ingredientCategories)
  if (ings.length) {
    where.push(`ingredient_category IN (${ings.map((_, i) => `:ig${i}`).join(',')})`)
    ings.forEach((v, i) => { params[`ig${i}`] = v })
  }
  if (q.preparationTime) {
    where.push("json_extract(preparation_time, '$.value') = :pt")
    params.pt = String(parseInt(q.preparationTime))
  }

  if (scope === 'mine') {
    where.push('creator_id = :uid')
    params.uid = uid
    if (q.status) { where.push('status = :status'); params.status = q.status }
  } else if (scope === 'creator') {
    where.push('creator_id = :cid', "status = 'published'")
    params.cid = Number(q.creatorId)
  } else if (scope === 'friends') {
    // 好友（含自己）的公开已发布菜谱
    const friendIds = getFriendIds(uid)
    friendIds.push(uid)
    where.push(`creator_id IN (${friendIds.map((_, i) => `:f${i}`).join(',')})`)
    friendIds.forEach((v, i) => { params[`f${i}`] = v })
    where.push('is_public = 1', "status = 'published'")
  } else {
    // 公共列表：公开已发布，或本人已发布（登录时）
    if (uid) {
      where.push("((is_public = 1 AND status = 'published') OR (creator_id = :uid AND status = 'published'))")
      params.uid = uid
    } else {
      where.push('is_public = 1', "status = 'published'")
    }
  }
  return { where: where.length ? 'WHERE ' + where.join(' AND ') : '', params, tags: parseIds(q.optionalTags) }
}

function getFriendIds (uid) {
  const rows = db.prepare(
    "SELECT user_id, friend_id FROM friends WHERE (user_id = ? OR friend_id = ?) AND status = 'accepted'"
  ).all(uid, uid)
  return rows.map(r => (r.user_id === uid ? r.friend_id : r.user_id))
}

function queryList (req, res, scope) {
  const page = Math.max(1, parseInt(req.query.page) || 1)
  const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize) || 10))
  const uid = req.user ? req.user.id : null
  const { where, params, tags } = buildListConditions(req.query, { scope, uid })

  let rows = db.prepare(
    `SELECT * FROM recipes ${where} ORDER BY datetime(created_at) DESC LIMIT :__limit OFFSET :__offset`
  ).all({ ...params, __limit: pageSize + 1, __offset: (page - 1) * pageSize })

  let recipes = rows.map(parseRecipe)
  // 可选标签筛选：至少命中一个（与云函数 _.in 语义一致）
  if (tags.length) recipes = recipes.filter(r => r.optionalTags.some(t => tags.includes(t)))
  const hasMore = recipes.length > pageSize
  recipes = recipes.slice(0, pageSize).map(attachCreator)

  res.json({ success: true, data: { recipes, total: recipes.length, page, pageSize, hasMore } })
}

function validateRecipeData (data) {
  const errors = []
  if (!data.name || !String(data.name).trim()) errors.push('菜谱名称不能为空')
  if (!data.sceneCategory) errors.push('请选择菜谱场景')
  if (!data.ingredientCategory) errors.push('请选择主要食材')
  if (!Array.isArray(data.ingredients) || data.ingredients.length === 0) errors.push('请添加食材清单')
  if (!Array.isArray(data.steps) || data.steps.length === 0) errors.push('请添加制作步骤')
  return errors
}

function recipeColumns (data) {
  return {
    name: String(data.name).trim(),
    description: String(data.description || '').trim(),
    images: JSON.stringify(Array.isArray(data.images) ? data.images : []),
    ingredients: JSON.stringify(data.ingredients || []),
    steps: JSON.stringify(data.steps || []),
    preparation_time: JSON.stringify(data.preparationTime || DEFAULT_TIME),
    difficulty: JSON.stringify(data.difficulty || DEFAULT_DIFF),
    serving_size: JSON.stringify(data.servingSize || DEFAULT_SIZE),
    scene_category: data.sceneCategory,
    ingredient_category: data.ingredientCategory,
    optional_tags: JSON.stringify(Array.isArray(data.optionalTags) ? data.optionalTags : []),
    is_public: data.isPublic === undefined ? 1 : (data.isPublic ? 1 : 0),
    status: data.status || 'published'
  }
}

// AI 自动生成菜谱（按菜名搜索网络菜谱，交给 DeepSeek 综合）
const genUsage = new Map() // 简单限流：每用户每小时 20 次
router.post('/generate', authRequired, async (req, res) => {
  const name = String((req.body && req.body.name) || '').trim()
  if (!name) return res.json({ success: false, message: '请先输入菜名' })

  const now = Date.now()
  const rec = genUsage.get(req.user.id) || { count: 0, since: now }
  if (now - rec.since > 3600 * 1000) { rec.count = 0; rec.since = now }
  if (rec.count >= 20) return res.json({ success: false, message: 'AI 生成次数已达本小时上限（20 次），请稍后再试' })
  rec.count++
  genUsage.set(req.user.id, rec)

  try {
    const uploadDir = process.env.UPLOAD_DIR || require('path').join(__dirname, '..', 'uploads')
    const data = await generateRecipe(name, {
      withImage: (req.body && req.body.withImage) !== false,
      uploadDir
    })
    res.json({ success: true, data })
  } catch (err) {
    res.json({ success: false, message: err.message || '生成失败' })
  }
})

// 推荐菜谱（首页）
router.get('/recommend', authOptional, (req, res) => {
  const limit = Math.min(20, parseInt(req.query.limit) || 6)
  const rows = db.prepare(
    "SELECT * FROM recipes WHERE is_public = 1 AND status = 'published' ORDER BY datetime(created_at) DESC LIMIT ?"
  ).all(limit)
  res.json({ success: true, data: { recipes: rows.map(parseRecipe).map(attachCreator) } })
})

// 我的菜谱
router.get('/my', authRequired, (req, res) => queryList(req, res, 'mine'))

// 好友菜谱（点餐用）
router.get('/friends', authRequired, (req, res) => queryList(req, res, 'friends'))

// 公共菜谱列表（预览模式可访问）
router.get('/', authOptional, (req, res) => {
  if (req.query.creatorId) return queryList(req, res, 'creator')
  return queryList(req, res, 'public')
})

// 菜谱详情（预览模式可访问公开菜谱）
router.get('/:id', authOptional, (req, res) => {
  const row = db.prepare('SELECT * FROM recipes WHERE id = ?').get(Number(req.params.id))
  if (!row) return res.json({ success: false, message: '菜谱不存在', error: 'RECIPE_NOT_FOUND' })
  const recipe = parseRecipe(row)
  const uid = req.user ? req.user.id : null
  if (!recipe.isPublic && String(uid) !== recipe.creatorId) {
    return res.json({ success: false, message: '没有权限查看此菜谱', error: 'NO_PERMISSION' })
  }
  res.json({ success: true, data: attachCreator(recipe) })
})

// 创建菜谱
router.post('/', authRequired, (req, res) => {
  const data = req.body || {}
  const errors = validateRecipeData(data)
  if (errors.length) return res.json({ success: false, message: errors[0] })
  const cols = recipeColumns(data)
  const info = db.prepare(`INSERT INTO recipes
    (name, description, images, ingredients, steps, preparation_time, difficulty, serving_size,
     scene_category, ingredient_category, optional_tags, is_public, status, creator_id)
    VALUES (@name, @description, @images, @ingredients, @steps, @preparation_time, @difficulty, @serving_size,
     @scene_category, @ingredient_category, @optional_tags, @is_public, @status, @creator_id)`)
    .run({ ...cols, creator_id: req.user.id })
  res.json({ success: true, data: { recipeId: String(info.lastInsertRowid) } })
})

// 更新菜谱（仅创建者）
router.put('/:id', authRequired, (req, res) => {
  const row = db.prepare('SELECT * FROM recipes WHERE id = ?').get(Number(req.params.id))
  if (!row || row.creator_id !== req.user.id) {
    return res.json({ success: false, message: '没有权限修改此菜谱' })
  }
  const data = req.body || {}
  const errors = validateRecipeData(data)
  if (errors.length) return res.json({ success: false, message: errors[0] })
  const cols = recipeColumns(data)
  db.prepare(`UPDATE recipes SET
    name=@name, description=@description, images=@images, ingredients=@ingredients, steps=@steps,
    preparation_time=@preparation_time, difficulty=@difficulty, serving_size=@serving_size,
    scene_category=@scene_category, ingredient_category=@ingredient_category, optional_tags=@optional_tags,
    is_public=@is_public, status=@status, updated_at=datetime('now','localtime')
    WHERE id=@id`).run({ ...cols, id: row.id })
  res.json({ success: true, data: {} })
})

// 删除菜谱（仅创建者）
router.delete('/:id', authRequired, (req, res) => {
  const row = db.prepare('SELECT * FROM recipes WHERE id = ?').get(Number(req.params.id))
  if (!row || row.creator_id !== req.user.id) {
    return res.json({ success: false, message: '没有权限删除此菜谱' })
  }
  db.prepare('DELETE FROM recipes WHERE id = ?').run(row.id)
  res.json({ success: true, data: {} })
})

module.exports = router
