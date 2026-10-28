/**
 * 用户接口：资料 / 搜索 / 搜索码（对应 user 云函数）
 */
const express = require('express')
const { db, parseUser } = require('../db')
const { authRequired } = require('../middleware/auth')

const router = express.Router()
router.use(authRequired)

// 获取用户资料
router.get('/profile', (req, res) => {
  res.json({ success: true, data: { user: parseUser(req.user, { full: true }) } })
})

// 更新用户资料（昵称 / 头像）
router.put('/profile', (req, res) => {
  const { nickname, avatar } = req.body || {}
  if (nickname !== undefined && !String(nickname).trim()) {
    return res.json({ success: false, message: '昵称不能为空' })
  }
  db.prepare("UPDATE users SET nickname = COALESCE(?, nickname), avatar = COALESCE(?, avatar), updated_at = datetime('now','localtime') WHERE id = ?")
    .run(nickname !== undefined ? String(nickname).trim() : null, avatar !== undefined ? avatar : null, req.user.id)
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)
  res.json({ success: true, data: { user: parseUser(user, { full: true }) } })
})

// 通过搜索码查找用户（对应 searchUser）
router.get('/search', (req, res) => {
  const searchCode = String(req.query.searchCode || '').trim().toUpperCase()
  if (!searchCode) return res.json({ success: false, message: '请输入搜索码' })
  const user = db.prepare('SELECT * FROM users WHERE search_code = ?').get(searchCode)
  if (!user) return res.json({ success: false, message: '用户不存在' })
  res.json({ success: true, data: { user: parseUser(user) } })
})

// 重新生成搜索码（对应 generateSearchCode / updateSearchCode）
router.post('/searchCode', (req, res) => {
  let code
  for (let i = 0; i < 20; i++) {
    code = 'FY' + Math.random().toString(36).substr(2, 6).toUpperCase()
    if (!db.prepare('SELECT id FROM users WHERE search_code = ? AND id != ?').get(code, req.user.id)) break
  }
  db.prepare("UPDATE users SET search_code = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(code, req.user.id)
  res.json({ success: true, data: { searchCode: code } })
})

module.exports = router
