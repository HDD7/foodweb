/* 端到端冒烟测试：node test-smoke.js */
const BASE = 'http://localhost:3000'

async function call (path, { method = 'GET', body, token } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  })
  return res.json()
}

async function main () {
  let pass = 0, fail = 0
  const check = (name, cond, extra = '') => {
    if (cond) { pass++; console.log('✅', name) } else { fail++; console.log('❌', name, extra) }
  }

  // 固定账号（复用，避免每次运行堆积测试用户）
  const U1 = 'smoke_chef'
  const U2 = 'smoke_eater'
  const registerOrLogin = async (username, nickname) => {
    const reg = await call('/api/auth/register', { method: 'POST', body: { username, password: '123456', nickname } })
    if (reg.success) return reg
    return call('/api/auth/login', { method: 'POST', body: { username, password: '123456' } })
  }

  // 1. 注册/登录取两个用户
  const u1 = await registerOrLogin(U1, '小王')
  const u2 = await registerOrLogin(U2, '小李')
  check('注册/登录用户A/B', u1.success && u2.success)
  const t1 = u1.data.token, t2 = u2.data.token
  const code2 = u2.data.user.searchCode

  // 2. 重复注册必须被拒绝
  const dup = await call('/api/auth/register', { method: 'POST', body: { username: U1, password: '123456' } })
  check('重复用户名被拒绝', !dup.success)

  // 3. 登录
  const login = await call('/api/auth/login', { method: 'POST', body: { username: U1, password: '123456' } })
  check('登录', login.success && login.data.token)

  // 4. 创建菜谱（校验必填）
  const bad = await call('/api/recipes', { method: 'POST', token: t1, body: { name: '缺字段' } })
  check('菜谱必填校验', !bad.success)
  const r1 = await call('/api/recipes', { method: 'POST', token: t1, body: {
    name: 'smoke测试菜', description: '香甜软糯', images: [],
    ingredients: [{ id: 'i1', name: '五花肉', amount: '500g' }],
    steps: [{ id: 's1', content: '焯水后小火慢炖', image: '' }],
    preparationTime: { value: '60', label: '1小时' },
    difficulty: { value: 2, label: '中等', color: 'yellow' },
    servingSize: { value: '3-4', label: '3-4人' },
    sceneCategory: 'daily', ingredientCategory: 'meat', optionalTags: ['stew', 'home_style'],
    isPublic: true, status: 'published'
  } })
  check('创建菜谱', r1.success && r1.data.recipeId)
  const rid = r1.data.recipeId

  // 5. 列表 / 筛选 / 预览（无 token）
  const list = await call('/api/recipes?page=1&pageSize=10')
  check('公共列表(预览模式)', list.success && list.data.recipes.some(r => r._id === rid))
  const filtered = await call('/api/recipes?sceneCategories=daily&ingredientCategories=meat&preparationTime=60')
  check('分类筛选', filtered.success && filtered.data.recipes.some(r => r._id === rid))
  const searched = await call('/api/recipes?search=' + encodeURIComponent('smoke测试'))
  check('关键词搜索', searched.success && searched.data.recipes.length >= 1)

  // 6. 详情权限
  const detail = await call('/api/recipes/' + rid)
  check('菜谱详情(公开)', detail.success && detail.data.creator.nickname === '小王')

  // 7. 私密菜谱权限
  const priv = await call('/api/recipes', { method: 'POST', token: t1, body: {
    name: '秘密菜谱', ingredients: [{ name: 'x', amount: 'x' }], steps: [{ content: 'x' }],
    sceneCategory: 'daily', ingredientCategory: 'meat', isPublic: false, status: 'published'
  } })
  const privDetail = await call('/api/recipes/' + priv.data.recipeId) // 未登录
  check('私密菜谱未登录不可见', !privDetail.success)
  const privDetail2 = await call('/api/recipes/' + priv.data.recipeId, { token: t2 })
  check('私密菜谱他人不可见', !privDetail2.success)

  // 8. 更新/删除权限
  const updOther = await call('/api/recipes/' + rid, { method: 'PUT', token: t2, body: { name: 'x' } })
  check('他人不可修改菜谱', !updOther.success)

  // 8.5 重置好友状态（保证脚本可重复运行）
  await call('/api/friends/' + u2.data.user._id, { method: 'DELETE', token: t1 })
  const stale = await call('/api/friends/requests', { token: t2 })
  for (const r of (stale.data?.pendingRequests || [])) {
    await call('/api/friends/requests/' + r.id + '/handle', { method: 'POST', token: t2, body: { accept: false } })
  }
  const staleSent = await call('/api/friends/requests', { token: t1 })
  for (const r of (staleSent.data?.pendingRequests || [])) {
    await call('/api/friends/requests/' + r.id + '/handle', { method: 'POST', token: t1, body: { accept: false } })
  }

  // 9. 好友流程：搜索码搜索 -> 发请求 -> 接受
  const search = await call('/api/user/search?searchCode=' + code2, { token: t1 })
  check('搜索码查找用户', search.success && search.data.user.nickname === '小李')
  const req1 = await call('/api/friends/requests', { method: 'POST', token: t1, body: { targetId: u2.data.user._id, message: '一起吃饭' } })
  check('发送好友请求', req1.success)
  const reqDup = await call('/api/friends/requests', { method: 'POST', token: t1, body: { targetId: u2.data.user._id } })
  check('重复请求被拒绝', !reqDup.success)
  const reqs = await call('/api/friends/requests', { token: t2 })
  check('收到请求列表', reqs.success && reqs.data.pendingRequests.length === 1)
  const accept = await call(`/api/friends/requests/${reqs.data.pendingRequests[0].id}/handle`, { method: 'POST', token: t2, body: { accept: true } })
  check('接受好友请求', accept.success)
  const friends1 = await call('/api/friends', { token: t1 })
  check('好友列表(A视角)', friends1.success && friends1.data.length === 1 && friends1.data[0].nickname === '小李')

  // 10. 点餐：好友菜谱
  const fr = await call('/api/recipes/friends', { token: t2 })
  check('好友菜谱列表', fr.success && fr.data.recipes.some(r => r._id === rid))

  // 11. 创建订单
  const order = await call('/api/orders', { method: 'POST', token: t2, body: { orderData: {
    mealType: 'dinner', orderDate: '2026-10-28', notes: '少油',
    assigneeId: u1.data.user._id,
    recipes: [{ recipeId: rid, recipeName: 'smoke测试菜', authorId: u1.data.user._id, authorName: '小王', authorAvatar: '', image: '', preparationTime: '60分钟', difficulty: '中等', servingSize: '3-4人' }]
  } } })
  check('创建订单', order.success && /^FY\d+$/.test(order.data.orderNo), JSON.stringify(order))
  const oid = order.data.orderId

  // 12. 订单列表 / 详情 / 状态流转
  const ol = await call('/api/orders', { token: t1 })
  check('制作者可见订单', ol.success && ol.data.orders.some(o => o._id === oid))
  const od = await call('/api/orders/' + oid, { token: t2 })
  check('订单详情', od.success && od.data.assigneeName === '小王')
  const st1 = await call(`/api/orders/${oid}/status`, { method: 'PUT', token: t1, body: { status: 'processing' } })
  check('开始制作', st1.success)
  const cancelBad = await call(`/api/orders/${oid}/cancel`, { method: 'POST', token: t1 })
  check('处理中不可取消', !cancelBad.success)
  const st2 = await call(`/api/orders/${oid}/status`, { method: 'PUT', token: t2, body: { status: 'completed' } })
  check('完成订单', st2.success)
  const stats = await call('/api/orders/statistics', { token: t1 })
  check('订单统计', stats.success && stats.data.total >= 1 && stats.data.completed >= 1)

  // 13. 删除好友
  const del = await call('/api/friends/' + u2.data.user._id, { method: 'DELETE', token: t1 })
  check('删除好友', del.success)
  const friends2 = await call('/api/friends', { token: t1 })
  check('删除后列表为空', friends2.data.length === 0)

  // 14. 未授权访问拦截
  const noauth = await call('/api/orders')
  check('未登录访问受限接口被拒', noauth.success === false)

  // 15. 清理：删掉本次测试创建的菜谱（避免污染公共列表）
  const cleanupTargets = [
    [t1, [rid, priv.success ? priv.data.recipeId : null]],
    [t2, []]
  ]
  let cleaned = 0
  for (const [tk, ids] of cleanupTargets) {
    for (const id of ids) {
      if (!id) continue
      const r = await call('/api/recipes/' + id, { method: 'DELETE', token: tk })
      if (r.success) cleaned++
    }
  }
  const allMine = await call('/api/recipes/my?page=1&pageSize=50', { token: t1 })
  for (const r of (allMine.data?.recipes || [])) {
    const del = await call('/api/recipes/' + r._id, { method: 'DELETE', token: t1 })
    if (del.success) cleaned++
  }
  check('测试数据已清理', cleaned >= 2, `清理 ${cleaned} 条`)

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
  process.exit(fail ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
