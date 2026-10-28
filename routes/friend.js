/**
 * 好友接口（对应 friend 云函数）
 * 权限规则（《云开发配置.md》）：仅关系双方可读写
 */
const express = require('express')
const { db } = require('../db')
const { authRequired } = require('../middleware/auth')

const router = express.Router()
router.use(authRequired)

function formatTime (dateStr) {
  const date = new Date(String(dateStr).replace(' ', 'T'))
  const diff = Date.now() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  if (hours < 24) return `${hours}小时前`
  if (days < 7) return `${days}天前`
  return String(dateStr).slice(0, 10)
}

function userBrief (id) {
  return db.prepare('SELECT id, nickname, avatar FROM users WHERE id = ?').get(Number(id))
}

function areFriends (a, b) {
  return !!db.prepare(
    "SELECT id FROM friends WHERE ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)) AND status = 'accepted'"
  ).get(a, b, b, a)
}

// 好友列表
router.get('/', (req, res) => {
  const uid = req.user.id
  const rows = db.prepare(
    "SELECT * FROM friends WHERE (user_id = ? OR friend_id = ?) AND status = 'accepted' ORDER BY datetime(created_at) DESC"
  ).all(uid, uid)
  const friends = []
  for (const r of rows) {
    const fid = r.user_id === uid ? r.friend_id : r.user_id
    const u = userBrief(fid)
    if (!u) continue
    const recipeCount = db.prepare(
      "SELECT COUNT(*) AS c FROM recipes WHERE creator_id = ? AND is_public = 1 AND status = 'published'"
    ).get(fid).c
    friends.push({
      id: String(u.id),
      openid: String(u.id),
      nickname: u.nickname || '未知用户',
      avatar: u.avatar || '',
      recipeCount,
      statusText: '在线',
      statusClass: 'online',
      addTime: r.created_at
    })
  }
  res.json({ success: true, data: friends })
})

// 直接添加好友（保留云函数 addFriend 语义）
router.post('/', (req, res) => {
  const friendId = Number(req.body && (req.body.friendId || req.body.friendOpenid))
  if (!friendId || !userBrief(friendId)) return res.json({ success: false, message: '用户不存在' })
  if (friendId === req.user.id) return res.json({ success: false, message: '不能添加自己为好友' })
  if (areFriends(req.user.id, friendId)) return res.json({ success: false, message: '已经是好友关系' })
  db.prepare("INSERT INTO friends (user_id, friend_id, status) VALUES (?, ?, 'accepted')").run(req.user.id, friendId)
  res.json({ success: true, message: '添加好友成功' })
})

// 删除好友
router.delete('/:friendId', (req, res) => {
  const fid = Number(req.params.friendId)
  db.prepare('DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)')
    .run(req.user.id, fid, fid, req.user.id)
  res.json({ success: true, message: '删除好友成功' })
})

// 好友请求列表（待处理 + 已发送）
router.get('/requests', (req, res) => {
  const uid = req.user.id
  const pending = db.prepare(
    "SELECT * FROM friend_requests WHERE to_user_id = ? AND status = 'pending' ORDER BY datetime(created_at) DESC"
  ).all(uid)
  const sent = db.prepare(
    "SELECT * FROM friend_requests WHERE from_user_id = ? AND status = 'pending' ORDER BY datetime(created_at) DESC"
  ).all(uid)

  const pendingRequests = pending.map(r => {
    const u = userBrief(r.from_user_id) || {}
    return {
      id: String(r.id), fromOpenid: String(r.from_user_id),
      nickname: u.nickname || '未知用户', avatar: u.avatar || '',
      message: r.message || '', time: formatTime(r.created_at)
    }
  })
  const sentRequests = sent.map(r => {
    const u = userBrief(r.to_user_id) || {}
    return {
      id: String(r.id), targetOpenid: String(r.to_user_id),
      nickname: u.nickname || '未知用户', avatar: u.avatar || '',
      time: formatTime(r.created_at), status: '待确认'
    }
  })
  res.json({ success: true, data: { pendingRequests, sentRequests } })
})

// 发送好友请求
router.post('/requests', (req, res) => {
  const targetId = Number(req.body && (req.body.targetId || req.body.targetOpenid))
  const message = String((req.body && req.body.message) || '')
  if (!targetId || !userBrief(targetId)) return res.json({ success: false, message: '用户不存在' })
  if (targetId === req.user.id) return res.json({ success: false, message: '不能向自己发送好友请求' })
  if (areFriends(req.user.id, targetId)) return res.json({ success: false, message: '已经是好友关系' })
  const exist = db.prepare(
    "SELECT id FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'"
  ).get(req.user.id, targetId)
  if (exist) return res.json({ success: false, message: '已经发送过好友请求，请等待对方处理' })
  // 对方已向我发过请求则直接成为好友
  const reverse = db.prepare(
    "SELECT id FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'"
  ).get(targetId, req.user.id)
  if (reverse) {
    db.prepare("UPDATE friend_requests SET status = 'accepted', handled_at = datetime('now','localtime') WHERE id = ?").run(reverse.id)
    db.prepare("INSERT INTO friends (user_id, friend_id, status) VALUES (?, ?, 'accepted')").run(targetId, req.user.id)
    return res.json({ success: true, message: '对方已向你发送过请求，已自动成为好友' })
  }
  db.prepare("INSERT INTO friend_requests (from_user_id, to_user_id, message) VALUES (?, ?, ?)").run(req.user.id, targetId, message)
  res.json({ success: true, message: '好友请求发送成功' })
})

// 处理好友请求（接受 / 拒绝）
router.post('/requests/:id/handle', (req, res) => {
  const row = db.prepare('SELECT * FROM friend_requests WHERE id = ?').get(Number(req.params.id))
  if (!row || row.to_user_id !== req.user.id) {
    return res.json({ success: false, message: '请求不存在或无权限' })
  }
  if (row.status !== 'pending') {
    return res.json({ success: false, message: '该请求已处理' })
  }
  const accept = !!(req.body && req.body.accept)
  if (accept && !areFriends(row.from_user_id, row.to_user_id)) {
    db.prepare("INSERT INTO friends (user_id, friend_id, status) VALUES (?, ?, 'accepted')").run(row.from_user_id, row.to_user_id)
  }
  db.prepare("UPDATE friend_requests SET status = ?, handled_at = datetime('now','localtime') WHERE id = ?")
    .run(accept ? 'accepted' : 'rejected', row.id)
  res.json({ success: true, message: accept ? '已接受好友请求' : '已拒绝好友请求' })
})

module.exports = router
