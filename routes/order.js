/**
 * 订单接口（对应 order 云函数）
 * 权限规则（《云开发配置.md》）：仅创建者或制作者可读写
 * 状态：pending 待处理 | processing 处理中 | completed 已完成 | cancelled 已取消
 */
const express = require('express')
const { db, parseOrder } = require('../db')
const { authRequired } = require('../middleware/auth')

const router = express.Router()
router.use(authRequired)

const MEAL_LABELS = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐' }
const MEAL_ICONS = { breakfast: '🌅', lunch: '🌞', dinner: '🌙' }
const STATUS_LABELS = { pending: '待处理', processing: '处理中', completed: '已完成', cancelled: '已取消' }

function generateOrderNo () {
  const now = new Date()
  const p = n => String(n).padStart(2, '0')
  const rand = String(Math.floor(Math.random() * 1000)).padStart(3, '0')
  return `FY${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}${rand}`
}

function userBrief (id) {
  const u = db.prepare('SELECT nickname, avatar FROM users WHERE id = ?').get(Number(id))
  return u ? { nickname: u.nickname || '未知用户', avatar: u.avatar || '' } : { nickname: '未知用户', avatar: '' }
}

function decorate (order) {
  order.creator = userBrief(order.creatorId)
  order.assignee = userBrief(order.assigneeId)
  order.mealTypeLabel = MEAL_LABELS[order.mealType] || '未知'
  order.mealTypeIcon = MEAL_ICONS[order.mealType] || '🍽️'
  order.statusLabel = STATUS_LABELS[order.status] || '未知'
  return order
}

// 创建订单
router.post('/', (req, res) => {
  const { recipes, assigneeId, mealType, orderDate, orderTime, notes } = (req.body && req.body.orderData) || req.body || {}
  if (!Array.isArray(recipes) || recipes.length === 0) {
    return res.json({ success: false, message: '订单菜谱不能为空' })
  }
  if (!assigneeId) return res.json({ success: false, message: '请选择制作者' })
  if (!mealType) return res.json({ success: false, message: '请选择餐次类型' })

  const assignee = db.prepare('SELECT id FROM users WHERE id = ?').get(Number(assigneeId))
  if (!assignee) return res.json({ success: false, message: '制作者不存在' })

  const estimatedTime = recipes.reduce((t, r) => t + (parseInt(r.preparationTime) || 30), 0)
  const orderNo = generateOrderNo()
  const now = new Date()
  const dateStr = orderDate || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  const info = db.prepare(`INSERT INTO orders
    (order_no, creator_id, assignee_id, meal_type, order_date, order_time, recipes, status, notes, total_recipes, estimated_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`)
    .run(orderNo, req.user.id, Number(assigneeId), mealType, dateStr, orderTime || '',
      JSON.stringify(recipes), notes || '', recipes.length, estimatedTime)

  res.json({ success: true, data: { orderId: String(info.lastInsertRowid), orderNo, message: '订单创建成功' } })
})

// 订单列表
router.get('/', (req, res) => {
  const uid = req.user.id
  const status = req.query.status
  const page = Math.max(1, parseInt(req.query.page) || 1)
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10))
  const searchValue = String(req.query.searchValue || '').trim().toLowerCase()

  let sql = 'SELECT * FROM orders WHERE (creator_id = :uid OR assignee_id = :uid)'
  const params = { uid }
  if (status && status !== 'all') {
    sql += ' AND status = :status'
    params.status = status
  }
  sql += ' ORDER BY datetime(created_at) DESC LIMIT :limit OFFSET :offset'
  params.limit = searchValue ? 500 : limit
  params.offset = searchValue ? 0 : (page - 1) * limit

  let orders = db.prepare(sql).all(params).map(parseOrder).map(decorate)

  // 搜索过滤（订单号 / 昵称 / 菜品名），与云函数一致
  if (searchValue) {
    orders = orders.filter(o =>
      (o.orderNo && o.orderNo.toLowerCase().includes(searchValue)) ||
      (o.assignee.nickname && o.assignee.nickname.toLowerCase().includes(searchValue)) ||
      (o.creator.nickname && o.creator.nickname.toLowerCase().includes(searchValue)) ||
      (o.recipes || []).some(r => r.recipeName && r.recipeName.toLowerCase().includes(searchValue))
    )
  }

  const total = searchValue
    ? orders.length
    : db.prepare(`SELECT COUNT(*) AS c FROM orders WHERE (creator_id = ? OR assignee_id = ?)${status && status !== 'all' ? ' AND status = ?' : ''}`)
        .get(...[uid, uid, ...(status && status !== 'all' ? [status] : [])]).c

  if (searchValue) orders = orders.slice((page - 1) * limit, page * limit)

  res.json({ success: true, data: { orders, total, page, limit, hasMore: page * limit < total } })
})

// 订单统计
router.get('/statistics', (req, res) => {
  const rows = db.prepare('SELECT status, COUNT(*) AS c FROM orders WHERE creator_id = ? OR assignee_id = ? GROUP BY status')
    .all(req.user.id, req.user.id)
  const stats = { total: 0, pending: 0, processing: 0, completed: 0, cancelled: 0 }
  rows.forEach(r => { stats[r.status] = r.c; stats.total += r.c })
  res.json({ success: true, data: stats })
})

// 订单详情（仅创建者或制作者）
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.params.id))
  if (!row) return res.json({ success: false, message: '订单不存在' })
  const order = parseOrder(row)
  if (order.creatorId !== String(req.user.id) && order.assigneeId !== String(req.user.id)) {
    return res.json({ success: false, message: '无权限查看此订单' })
  }
  decorate(order)
  order.creatorName = order.creator.nickname
  order.creatorAvatar = order.creator.avatar
  order.assigneeName = order.assignee.nickname
  order.assigneeAvatar = order.assignee.avatar
  res.json({ success: true, data: order })
})

// 更新订单状态
router.put('/:id/status', (req, res) => {
  const { status } = req.body || {}
  if (!['pending', 'processing', 'completed', 'cancelled'].includes(status)) {
    return res.json({ success: false, message: '无效的订单状态' })
  }
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.params.id))
  if (!row) return res.json({ success: false, message: '订单不存在' })
  if (row.creator_id !== req.user.id && row.assignee_id !== req.user.id) {
    return res.json({ success: false, message: '无权限更新此订单' })
  }
  db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(status, row.id)
  res.json({ success: true, message: '订单状态更新成功' })
})

// 取消订单（仅待处理可取消）
router.post('/:id/cancel', (req, res) => {
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.params.id))
  if (!row) return res.json({ success: false, message: '订单不存在' })
  if (row.creator_id !== req.user.id && row.assignee_id !== req.user.id) {
    return res.json({ success: false, message: '无权限取消此订单' })
  }
  if (row.status !== 'pending') {
    return res.json({ success: false, message: '当前订单状态不允许取消' })
  }
  db.prepare("UPDATE orders SET status = 'cancelled', cancel_time = datetime('now','localtime'), updated_at = datetime('now','localtime') WHERE id = ?").run(row.id)
  res.json({ success: true, message: '订单取消成功' })
})

module.exports = router
