/**
 * 认证接口：注册 / 登录
 * Web 版以「账号密码」替代微信小程序一键登录，登录后签发 JWT。
 */
const express = require('express')
const bcrypt = require('bcryptjs')
const { db, parseUser } = require('../db')
const { signToken } = require('../middleware/auth')

const router = express.Router()

/** 生成唯一搜索码：FY + 6位随机字符（对应 user 云函数 generateSearchCode） */
function generateSearchCode () {
  for (let i = 0; i < 20; i++) {
    const code = 'FY' + Math.random().toString(36).substr(2, 6).toUpperCase()
    const exist = db.prepare('SELECT id FROM users WHERE search_code = ?').get(code)
    if (!exist) return code
  }
  return 'FY' + Date.now().toString(36).toUpperCase()
}

router.post('/register', (req, res) => {
  const { username, password, nickname } = req.body || {}
  if (!username || !/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return res.json({ success: false, message: '用户名需为 3-20 位字母、数字或下划线' })
  }
  if (!password || password.length < 6) {
    return res.json({ success: false, message: '密码至少 6 位' })
  }
  const exist = db.prepare('SELECT id FROM users WHERE username = ?').get(username)
  if (exist) {
    return res.json({ success: false, message: '用户名已被注册' })
  }
  const hash = bcrypt.hashSync(password, 10)
  const info = db.prepare(
    'INSERT INTO users (username, password_hash, nickname, search_code) VALUES (?, ?, ?, ?)'
  ).run(username, hash, (nickname || '').trim() || username, generateSearchCode())

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)
  res.json({
    success: true,
    message: '注册成功',
    data: { token: signToken(user), user: parseUser(user, { full: true }) }
  })
})

router.post('/login', (req, res) => {
  const { username, password } = req.body || {}
  if (!username || !password) {
    return res.json({ success: false, message: '请输入用户名和密码' })
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username)
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.json({ success: false, message: '用户名或密码错误' })
  }
  // 老用户无搜索码则补发
  if (!user.search_code) {
    db.prepare('UPDATE users SET search_code = ? WHERE id = ?').run(generateSearchCode(), user.id)
    user.search_code = db.prepare('SELECT search_code FROM users WHERE id = ?').get(user.id).search_code
  }
  res.json({
    success: true,
    message: '登录成功',
    data: { token: signToken(user), user: parseUser(user, { full: true }) }
  })
})

module.exports = router
