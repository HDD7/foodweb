/**
 * JWT 认证中间件
 * - authRequired：需要登录的接口（对应小程序中需要登录的页面/功能）
 * - authOptional：预览模式可访问的接口（对应《权限控制规范.md》允许预览的页面）
 */
const jwt = require('jsonwebtoken')
const { db } = require('../db')
const config = require('../lib/config')

const JWT_SECRET = config.jwtSecret

function signToken (user) {
  return jwt.sign({ uid: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' })
}

function getUserById (id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id)
}

function authRequired (req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) {
    return res.status(401).json({ success: false, message: '请先登录', code: 'UNAUTHORIZED' })
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    const user = getUserById(payload.uid)
    if (!user) return res.status(401).json({ success: false, message: '用户不存在', code: 'UNAUTHORIZED' })
    req.user = user
    next()
  } catch (e) {
    return res.status(401).json({ success: false, message: '登录已过期，请重新登录', code: 'UNAUTHORIZED' })
  }
}

function authOptional (req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET)
      req.user = getUserById(payload.uid) || null
    } catch (e) {
      req.user = null
    }
  }
  next()
}

module.exports = { signToken, authRequired, authOptional, JWT_SECRET }
