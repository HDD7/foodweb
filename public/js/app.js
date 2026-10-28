/**
 * 阿猪餐厅 Web - 前端 SPA（原生 JS + Hash Router）
 * 页面与权限遵循《产品设计文档.md》《权限控制规范.md》
 * 分类数据遵循《家庭菜品分类设计文档-简化版.md》（tagData.js）
 */
(function () {
  'use strict'

  const TD = window.TagData

  /* ================= 全局状态 ================= */
  const state = {
    token: localStorage.getItem('fy_token') || '',
    user: JSON.parse(localStorage.getItem('fy_user') || 'null'),
    previewMode: localStorage.getItem('fy_preview') === '1' // 预览模式（权限控制规范）
  }

  function setAuth (token, user) {
    state.token = token
    state.user = user
    state.previewMode = false
    localStorage.setItem('fy_token', token)
    localStorage.setItem('fy_user', JSON.stringify(user))
    localStorage.removeItem('fy_preview')
  }
  function clearAuth () {
    state.token = ''
    state.user = null
    localStorage.removeItem('fy_token')
    localStorage.removeItem('fy_user')
  }
  function enterPreview () {
    state.previewMode = true
    localStorage.setItem('fy_preview', '1')
  }
  const isLoggedIn = () => !!state.token && !!state.user

  /* ================= API 封装 ================= */
  async function api (path, { method = 'GET', body, formData } = {}) {
    const headers = {}
    if (state.token) headers.Authorization = 'Bearer ' + state.token
    let payload
    if (formData) {
      payload = formData
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      payload = JSON.stringify(body)
    }
    let res
    try {
      res = await fetch(path, { method, headers, body: payload })
    } catch (e) {
      toast('网络错误，请稍后重试')
      throw e
    }
    const json = await res.json().catch(() => ({ success: false, message: '响应解析失败' }))
    if (res.status === 401) {
      clearAuth()
      toast(json.message || '请先登录')
      go('/login')
      throw new Error(json.message || 'unauthorized')
    }
    return json
  }

  async function uploadImage (file) {
    const fd = new FormData()
    fd.append('file', file)
    const res = await api('/api/upload', { method: 'POST', formData: fd })
    if (!res.success) throw new Error(res.message || '上传失败')
    return res.data.url
  }

  /* ================= UI 工具 ================= */
  const $app = document.getElementById('app')
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

  function toast (msg, ms = 1800) {
    const root = document.getElementById('toast-root')
    root.innerHTML = `<div class="toast">${esc(msg)}</div>`
    clearTimeout(toast._t)
    toast._t = setTimeout(() => { root.innerHTML = '' }, ms)
  }

  function modal (html, { center = false, onClose } = {}) {
    const root = document.getElementById('modal-root')
    root.innerHTML = `<div class="modal-mask ${center ? 'center' : ''}"><div class="modal-box">${html}</div></div>`
    const mask = root.firstElementChild
    mask.addEventListener('click', e => { if (e.target === mask) closeModal() })
    modal._onClose = onClose
    return mask
  }
  function closeModal () {
    document.getElementById('modal-root').innerHTML = ''
    if (modal._onClose) { modal._onClose(); modal._onClose = null }
  }
  function confirmBox (content, { title = '提示', confirmText = '确定', danger = false } = {}) {
    return new Promise(resolve => {
      modal(`
        <div class="modal-title">${esc(title)}</div>
        <div style="text-align:center;color:var(--text-2);font-size:14px;">${esc(content)}</div>
        <div class="modal-actions">
          <button class="btn btn-plain" id="m-cancel">取消</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="m-ok">${esc(confirmText)}</button>
        </div>`, { center: true, onClose: () => resolve(false) })
      document.getElementById('m-cancel').onclick = () => { closeModal() }
      document.getElementById('m-ok').onclick = () => { document.getElementById('modal-root').innerHTML = ''; modal._onClose = null; resolve(true) }
    })
  }

  /* ---------- 组件渲染 ---------- */
  function avatarHtml (url, name, cls = 'avatar') {
    if (url) return `<img class="${cls}" src="${esc(url)}" alt="">`
    const ch = (name || '食')[0]
    return `<div class="${cls} avatar-placeholder">${esc(ch)}</div>`
  }

  function recipeImgHtml (images, cls, phCls, emoji = '🍲') {
    const url = Array.isArray(images) ? images[0] : images
    if (url) return `<img class="${cls}" src="${esc(url)}" alt="" loading="lazy">`
    return `<div class="${cls} ${phCls}">${emoji}</div>`
  }

  function sceneTag (id) {
    const c = TD.getSceneCategoryById(id)
    return c ? `<span class="tag tag-scene">${c.emoji} ${c.shortName || c.name}</span>` : ''
  }
  function ingTag (id) {
    const c = TD.getIngredientCategoryById(id)
    return c ? `<span class="tag tag-ing">${c.emoji} ${c.name}</span>` : ''
  }
  function optTag (id) {
    const t = TD.getOptionalTags().find(x => x.id === id)
    if (!t) return ''
    const isFlavor = TD.flavorTypes.some(f => f.id === id)
    return `<span class="tag tag-opt ${isFlavor ? 'flavor' : ''}">${t.emoji} ${t.name}</span>`
  }

  function recipeCardHtml (r) {
    return `
      <div class="recipe-card" onclick="App.go('/recipe-detail/${r._id}')">
        ${recipeImgHtml(r.images, 'rc-img', 'rc-img-placeholder')}
        <div class="rc-body">
          <div class="rc-name">${esc(r.name)}</div>
          <div class="rc-desc">${esc(r.description || '')}</div>
          <div class="rc-meta">
            <span class="rc-creator">${avatarHtml(r.creator && r.creator.avatar, r.creator && r.creator.nickname)} ${esc((r.creator && r.creator.nickname) || '')}</span>
            <span>⏰${esc((r.preparationTime && r.preparationTime.label) || '')}</span>
          </div>
        </div>
      </div>`
  }

  function statusPill (status) {
    const st = TD.getOrderStatusByValue(status)
    if (!st) return ''
    return `<span class="status-pill" style="background:${st.bgColor};color:${st.textColor}">${st.emoji} ${st.label}</span>`
  }

  function previewBarHtml () {
    if (isLoggedIn() || !state.previewMode) return ''
    return `<div class="preview-bar">👀 预览模式 · 部分功能受限 <span class="login-link" onclick="App.go('/login')">立即登录 →</span></div>`
  }

  function tabbarHtml (active, cartCount = 0) {
    const tabs = [
      { path: '/index', icon: '🏠', label: '首页' },
      { path: '/recipe-list', icon: '📖', label: '菜品' },
      { path: '/diancan', icon: '🛒', label: '点餐', badge: cartCount },
      { path: '/order-list', icon: '📋', label: '订单' },
      { path: '/profile', icon: '👤', label: '我的' }
    ]
    return `<div class="tabbar">${tabs.map(t => `
      <div class="tabbar-item ${active === t.path ? 'active' : ''}" onclick="App.tabGo('${t.path}')">
        <span class="tab-icon">${t.icon}</span><span>${t.label}</span>
        ${t.badge ? `<span class="badge">${t.badge}</span>` : ''}
      </div>`).join('')}</div>`
  }

  function headerHtml (title, { back = true, action = '' } = {}) {
    return `<div class="page-header">
      ${back ? '<button class="back-btn" onclick="App.back()">←</button>' : '<span style="width:32px"></span>'}
      <div class="title">${esc(title)}</div>
      <div class="header-action">${action}</div>
    </div>`
  }

  const emptyHtml = (icon, text, extra = '') =>
    `<div class="empty"><div class="empty-icon">${icon}</div><div>${esc(text)}</div>${extra}</div>`

  /* 骨架屏（模拟真实卡片结构，带 shimmer） */
  const loadingHtml = () => `
    <div class="skeleton-grid">${Array.from({ length: 4 }).map(() => `
      <div class="sk-card">
        <div class="sk-box sk-img"></div>
        <div class="sk-box sk-line"></div>
        <div class="sk-box sk-line short"></div>
      </div>`).join('')}</div>`

  /* ---------- 动效：滚动揭示 / 交错延迟 / 涟漪 / 计数 ---------- */
  function initMotion (root = document) {
    const targets = root.querySelectorAll(
      '.recipe-card, .recipe-row, .order-card, .order-recipe-card, .form-section, .friend-item,' +
      '.detail-section, .stat-row, .menu-list, .quick-item, .meal-tabs, .info-grid, .card'
    )
    const io = 'IntersectionObserver' in window
      ? new IntersectionObserver(entries => {
          entries.forEach(entry => {
            if (entry.isIntersecting) {
              entry.target.classList.add('in')
              io.unobserve(entry.target)
            }
          })
        }, { rootMargin: '0px 0px -6% 0px', threshold: 0.05 })
      : null

    // 横向滚动的 chips 行：有更多内容时右侧渐隐
    root.querySelectorAll('.chip-row').forEach(row => {
      const update = () => {
        const more = row.scrollWidth - row.clientWidth - row.scrollLeft > 4
        row.classList.toggle('has-more', more)
      }
      if (!row.dataset.scrollBound) {
        row.dataset.scrollBound = '1'
        row.addEventListener('scroll', update, { passive: true })
      }
      update()
    })

    targets.forEach((el, i) => {
      if (el.dataset.motionDone) return
      el.dataset.motionDone = '1'
      el.classList.add('reveal')
      el.style.setProperty('--d', Math.min(i, 10) * 42 + 'ms')
      if (io) io.observe(el)
      else el.classList.add('in')
    })
  }

  /* 空状态垂直居中：按「容器顶 → 底栏顶」的真实可用高度撑开 */
  function centerEmptyStates () {
    const tabbar = document.querySelector('.tabbar')
    const viewportBottom = window.innerHeight
    document.querySelectorAll('.empty').forEach(el => {
      const parent = el.parentElement
      if (!parent) return
      const top = parent.getBoundingClientRect().top + window.scrollY
      const bottom = tabbar ? tabbar.getBoundingClientRect().top + window.scrollY : viewportBottom + window.scrollY
      const available = bottom - top
      if (!Number.isFinite(available) || available < 160) return
      const px = Math.max(200, available - 12) + 'px'
      if (el.style.minHeight !== px) el.style.minHeight = px
    })
  }

  /* 数字滚动（个人中心统计） */
  function animateCounts () {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    document.querySelectorAll('.st-num').forEach(el => {
      const target = parseInt(el.textContent, 10)
      if (!Number.isFinite(target) || target <= 0) return
      const duration = 820
      const started = performance.now()
      el.textContent = '0'
      const tick = now => {
        const p = Math.min(1, (now - started) / duration)
        el.textContent = String(Math.round(target * (1 - Math.pow(1 - p, 3))))
        if (p < 1) requestAnimationFrame(tick)
        else el.textContent = String(target)
      }
      requestAnimationFrame(tick)
    })
  }

  /* 按钮涟漪 */
  document.addEventListener('pointerdown', e => {
    const btn = e.target.closest && e.target.closest('.btn, .cart-btn, .add-btn, .icon-btn')
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    const size = Math.max(rect.width, rect.height)
    const span = document.createElement('span')
    span.className = 'ripple'
    span.style.width = span.style.height = `${size}px`
    span.style.left = `${e.clientX - rect.left - size / 2}px`
    span.style.top = `${e.clientY - rect.top - size / 2}px`
    btn.appendChild(span)
    setTimeout(() => span.remove(), 640)
  })

  /* 加入购物车：飞入底栏动画 */
  function flyToCart (fromEl) {
    const cartTab = document.querySelector('.tabbar-item:nth-child(3)')
    if (!fromEl || !cartTab) return
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const a = fromEl.getBoundingClientRect()
    const b = cartTab.getBoundingClientRect()
    const dot = document.createElement('div')
    dot.className = 'fly-dot'
    dot.textContent = '🍽️'
    dot.style.left = `${a.left + a.width / 2 - 13}px`
    dot.style.top = `${a.top + a.height / 2 - 13}px`
    document.body.appendChild(dot)
    const dx = b.left + b.width / 2 - (a.left + a.width / 2)
    const dy = b.top + b.height / 2 - (a.top + a.height / 2)
    requestAnimationFrame(() => {
      dot.style.transition = 'transform .74s cubic-bezier(.42,0,.58,1), opacity .74s ease-in'
      dot.style.transform = `translate(${dx}px, ${dy}px) scale(.3)`
      dot.style.opacity = '.15'
    })
    setTimeout(() => dot.remove(), 800)
  }

  /* ---------- 权限守卫（权限控制规范） ---------- */
  // 允许预览：首页 / 菜谱列表 / 菜谱详情 / 搜索
  const PREVIEW_PATHS = ['/index', '/recipe-list', '/recipe-detail', '/search']
  // 需要登录：个人中心 / 好友 / 好友请求 / 点餐 / 订单 / 发布菜谱
  const AUTH_PATHS = ['/profile', '/friends', '/friend-requests', '/diancan', '/order', '/order-list', '/order-detail', '/recipe-form', '/my-recipe']

  function guard (path) {
    if (isLoggedIn()) return true
    const needAuth = AUTH_PATHS.some(p => path === p || path.startsWith(p + '/') || path.startsWith(p + '?'))
    if (!needAuth) return true
    if (state.previewMode) {
      // 预览模式下访问受限功能：弹窗引导登录
      modal(`
        <div class="modal-title">提示</div>
        <div style="text-align:center;color:var(--text-2);font-size:14px;">该功能需要登录后使用</div>
        <div class="modal-actions">
          <button class="btn btn-plain" onclick="App.closeModal()">再逛逛</button>
          <button class="btn btn-primary" onclick="App.closeModal();App.go('/login')">立即登录</button>
        </div>`, { center: true })
      return false
    }
    go('/login')
    return false
  }

  /* ---------- 购物车（本地存储，对应 cartManager） ---------- */
  const Cart = {
    key: 'fy_cart',
    get () {
      try { return JSON.parse(localStorage.getItem(this.key)) || { mealType: '', recipes: [] } } catch (e) { return { mealType: '', recipes: [] } }
    },
    save (c) { localStorage.setItem(this.key, JSON.stringify(c)) },
    add (recipe, mealType) {
      const c = this.get()
      if (mealType) c.mealType = mealType
      if (!c.recipes.some(r => r._id === recipe._id)) {
        c.recipes.push({
          _id: recipe._id,
          name: recipe.name,
          creatorId: recipe.creatorId,
          creator: recipe.creator || { nickname: '', avatar: '' },
          images: recipe.images || [],
          preparationTime: recipe.preparationTime || { label: '30分钟' },
          difficulty: recipe.difficulty || { label: '简单' },
          servingSize: recipe.servingSize || { label: '3-4人' }
        })
        this.save(c)
        return true
      }
      return false
    },
    remove (id) {
      const c = this.get()
      c.recipes = c.recipes.filter(r => r._id !== id)
      this.save(c)
    },
    clear () { this.save({ mealType: '', recipes: [] }) },
    count () { return this.get().recipes.length },
    has (id) { return this.get().recipes.some(r => r._id === id) }
  }

  /* ================= 页面渲染 ================= */
  const Pages = {}

  /* ---------- 登录 / 注册 ---------- */
  Pages.login = {
    render () {
      return `
      <div class="login-page">
        <div class="login-logo">🐷</div>
        <div class="login-title">阿猪餐厅</div>
        <div class="login-sub">家里的味道 · 好友分享 · 一起点餐</div>
        <div class="login-form">
          <div class="login-tabs">
            <div class="login-tab ${this.mode === 'login' ? 'active' : ''}" onclick="App.loginTab('login')">登录</div>
            <div class="login-tab ${this.mode === 'register' ? 'active' : ''}" onclick="App.loginTab('register')">注册</div>
          </div>
          <input class="input" id="lg-username" placeholder="用户名（3-20位字母数字）" autocomplete="username">
          <input class="input" id="lg-password" type="password" placeholder="密码（至少6位）" autocomplete="${this.mode === 'login' ? 'current-password' : 'new-password'}">
          ${this.mode === 'register' ? '<input class="input" id="lg-nickname" placeholder="昵称（选填）">' : ''}
          <button class="btn btn-primary btn-lg btn-block" onclick="App.submitAuth()">${this.mode === 'login' ? '登 录' : '注 册'}</button>
          <div class="preview-entry">不想注册？<span onclick="App.enterPreviewMode()">暂不登录，先看看 →</span></div>
        </div>
      </div>`
    },
    mode: 'login',
    mount () {
      const input = document.getElementById('lg-password')
      if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') App.submitAuth() })
    }
  }

  /* ---------- 首页 ---------- */
  Pages.index = {
    async render () {
      $app.innerHTML = previewBarHtml() + `
        <div class="page">
          <div class="home-hero">
            <div class="hero-brand">🐷 阿猪餐厅</div>
            <div class="hero-title">今天吃什么？</div>
            <div class="hero-sub">家里的味道 · 与好友一起点餐</div>
          </div>
          <div class="home-search" onclick="App.go('/search')">🔍 搜索菜谱、食材…</div>
          <div class="section-title">快捷分类</div>
          <div class="quick-grid">
            ${TD.sceneCategories.map(c => `
              <div class="quick-item" onclick="App.go('/recipe-list?scene=${c.id}')">
                <div class="qi-icon">${c.emoji}</div><span>${c.shortName}</span>
              </div>`).join('')}
          </div>
          <div class="section-title">最新菜谱 <span class="more" onclick="App.go('/recipe-list')">查看全部 →</span></div>
          <div class="recipe-grid" id="recommend-list">${loadingHtml()}</div>
        </div>
        ${tabbarHtml('/index', Cart.count())}`
      const res = await api('/api/recipes/recommend?limit=6')
      const el = document.getElementById('recommend-list')
      if (!el) return
      if (res.success && res.data.recipes.length) {
        el.innerHTML = res.data.recipes.map(recipeCardHtml).join('')
      } else {
        el.innerHTML = emptyHtml('🍽️', '还没有菜谱，去创建第一道吧', isLoggedIn() ? '<div style="margin-top:16px"><button class="btn btn-primary btn-sm" onclick="App.go(\'/recipe-form\')">创建菜谱</button></div>' : '')
      }
      return ''
    },
    autoHtml: true
  }

  /* ---------- 菜谱列表 ---------- */
  Pages['recipe-list'] = {
    async render (params) {
      this.filters = {
        search: '', sceneCategories: params.scene ? [params.scene] : [],
        ingredientCategories: [], preparationTime: '', creatorId: params.creator || '',
        creatorName: '', page: 1, hasMore: true, list: []
      }
      $app.innerHTML = previewBarHtml() + `
        <div class="page">
          ${headerHtml('菜品', { back: false, action: isLoggedIn() ? '<span onclick="App.go(\'/recipe-form\')">＋ 发布</span>' : '' })}
          <div class="search-bar-row">
            <input class="input" id="rl-search" placeholder="🔍 搜索菜谱名称、描述">
            <button class="icon-btn" onclick="App.rlSearch()">🔍</button>
          </div>
          <div class="chip-row" id="rl-scene">
            <div class="chip active" data-v="" onclick="App.rlFilter('scene','')">全部</div>
            ${TD.sceneCategories.map(c => `<div class="chip" data-v="${c.id}" onclick="App.rlFilter('scene','${c.id}')">${c.emoji} ${c.name}</div>`).join('')}
          </div>
          <div class="chip-row" id="rl-ing">
            <div class="chip active" data-v="" onclick="App.rlFilter('ing','')">全部食材</div>
            ${TD.ingredientCategories.map(c => `<div class="chip" data-v="${c.id}" onclick="App.rlFilter('ing','${c.id}')">${c.emoji} ${c.name}</div>`).join('')}
            ${TD.preparationTimes.map(t => `<div class="chip" data-v="t${t.value}" onclick="App.rlFilter('time','${t.value}')">⏰ ${t.label}</div>`).join('')}
          </div>
          <div class="recipe-grid" id="rl-list"></div>
          <div class="load-more" id="rl-more"></div>
        </div>
        ${tabbarHtml('/recipe-list', Cart.count())}`
      document.getElementById('rl-search').addEventListener('keydown', e => { if (e.key === 'Enter') App.rlSearch() })
      // 初始选中场景 chip
      if (params.scene) {
        document.querySelectorAll('#rl-scene .chip').forEach(ch => ch.classList.toggle('active', ch.dataset.v === params.scene))
      }
      await this.load()
      return ''
    },
    autoHtml: true,
    async load (append) {
      const f = this.filters
      const qs = new URLSearchParams()
      qs.set('page', f.page); qs.set('pageSize', 10)
      if (f.search) qs.set('search', f.search)
      if (f.sceneCategories.length) qs.set('sceneCategories', f.sceneCategories.join(','))
      if (f.ingredientCategories.length) qs.set('ingredientCategories', f.ingredientCategories.join(','))
      if (f.preparationTime) qs.set('preparationTime', f.preparationTime)
      if (f.creatorId) qs.set('creatorId', f.creatorId)
      const res = await api('/api/recipes?' + qs.toString())
      const listEl = document.getElementById('rl-list')
      const moreEl = document.getElementById('rl-more')
      if (!listEl) return
      if (!res.success) { listEl.innerHTML = emptyHtml('😵', res.message || '加载失败'); return }
      f.list = append ? f.list.concat(res.data.recipes) : res.data.recipes
      f.hasMore = res.data.hasMore
      listEl.innerHTML = f.list.length ? f.list.map(recipeCardHtml).join('') : emptyHtml('🍽️', '暂无相关菜谱')
      moreEl.innerHTML = f.hasMore
        ? '<button class="btn btn-plain btn-sm" onclick="App.rlMore()">加载更多</button>'
        : (f.list.length ? '— 已经到底啦 —' : '')
    }
  }

  /* ---------- 菜谱详情 ---------- */
  Pages['recipe-detail'] = {
    async render (params, id) {
      $app.innerHTML = `<div class="page no-tabbar">${loadingHtml()}</div>`
      const res = await api('/api/recipes/' + id)
      if (!res.success) {
        $app.innerHTML = `<div class="page no-tabbar">${headerHtml('菜谱详情')}${emptyHtml('😵', res.message || '菜谱不存在')}</div>`
        return ''
      }
      const r = res.data
      const isOwner = isLoggedIn() && String(state.user._id) === r.creatorId
      $app.innerHTML = previewBarHtml() + `
      <div class="page no-tabbar">
        <div class="detail-hero">
          ${recipeImgHtml(r.images, '', 'hero-placeholder', '🍲')}
          <div class="hero-mask"></div>
          <div class="hero-nav">
            <button class="hero-nav-btn" onclick="App.back()">←</button>
            ${isOwner ? `<button class="hero-nav-btn" onclick="App.go('/recipe-form?id=${r._id}')">✏️</button>` : ''}
          </div>
          <div class="hero-info">
            <div class="hero-name">${esc(r.name)}</div>
            <div style="font-size:13px;opacity:.9;margin-top:4px;display:flex;align-items:center;gap:6px;">
              ${avatarHtml(r.creator.avatar, r.creator.nickname)} ${esc(r.creator.nickname)} · ${esc(r.createTime || '')}
            </div>
          </div>
        </div>
        <div class="detail-content">
          <div class="detail-tags">${sceneTag(r.sceneCategory)}${ingTag(r.ingredientCategory)}${(r.optionalTags || []).map(optTag).join('')}</div>
          ${r.description ? `<div class="detail-section"><div style="color:var(--text-2);font-size:14px;line-height:1.7;">${esc(r.description)}</div></div>` : ''}
          <div class="info-grid">
            <div class="info-cell"><div class="ic-value">⏰ ${esc((r.preparationTime && r.preparationTime.label) || '-')}</div><div class="ic-label">制作时间</div></div>
            <div class="info-cell"><div class="ic-value">${esc((r.difficulty && r.difficulty.label) || '-')}</div><div class="ic-label">难度</div></div>
            <div class="info-cell"><div class="ic-value">🍽️ ${esc((r.servingSize && r.servingSize.label) || '-')}</div><div class="ic-label">适合人数</div></div>
          </div>
          <div class="detail-section">
            <div class="ds-title">🥬 食材清单
              <span style="font-size:12px;color:var(--primary);font-weight:400" onclick="App.toggleCheckMode()">${this.checkMode ? '完成' : '勾选模式'}</span>
            </div>
            <div id="ing-list">${(r.ingredients || []).map((ing, i) => `
              <div class="ingredient-item" data-i="${i}" onclick="App.checkIngredient(this)">
                <span>${this.checkMode ? '☐ ' : ''}${esc(ing.name)}</span><span class="ing-amount">${esc(ing.amount)}</span>
              </div>`).join('')}</div>
          </div>
          <div class="detail-section">
            <div class="ds-title">👨‍🍳 制作步骤</div>
            ${(r.steps || []).map((s, i) => `
              <div class="step-item">
                <div class="step-num">${i + 1}</div>
                <div class="step-body">${esc(s.content)}${s.image ? `<img class="step-img" src="${esc(s.image)}" loading="lazy">` : ''}</div>
              </div>`).join('')}
          </div>
        </div>
        <div class="detail-actions">
          ${isOwner
            ? `<button class="btn btn-danger-outline" style="flex:1" onclick="App.deleteRecipe('${r._id}')">删除</button>
               <button class="btn btn-primary" style="flex:2" onclick="App.go('/recipe-form?id=${r._id}')">编辑菜谱</button>`
            : `<button class="btn btn-primary btn-block" onclick="App.addToCart('${r._id}')">🛒 加入点餐</button>`}
        </div>
      </div>`
      this.recipe = r
      return ''
    },
    autoHtml: true,
    checkMode: false
  }

  /* ---------- 菜谱创建 / 编辑 ---------- */
  Pages['recipe-form'] = {
    async render (params) {
      const editId = params.id || null
      let r = null
      if (editId) {
        $app.innerHTML = `<div class="page no-tabbar">${loadingHtml()}</div>`
        const res = await api('/api/recipes/' + editId)
        if (!res.success) { toast(res.message || '加载失败'); go('/my-recipe'); return '' }
        r = res.data
        if (String(state.user._id) !== r.creatorId) { toast('没有权限编辑此菜谱'); go('/recipe-list'); return '' }
      }
      this.editId = editId
      this.form = {
        name: r ? r.name : '',
        description: r ? r.description : '',
        images: r ? [...r.images] : [],
        ingredients: r && r.ingredients.length ? r.ingredients.map(x => ({ ...x })) : [{ id: 'ing_1', name: '', amount: '' }],
        steps: r && r.steps.length ? r.steps.map(x => ({ ...x })) : [{ id: 'step_1', content: '', image: '' }],
        preparationTime: r ? r.preparationTime : { value: '30', label: '30分钟' },
        difficulty: r ? r.difficulty : { value: 1, label: '简单', color: 'green' },
        servingSize: r ? r.servingSize : { value: '3-4', label: '3-4人' },
        sceneCategory: r ? r.sceneCategory : '',
        ingredientCategory: r ? r.ingredientCategory : '',
        optionalTags: r ? [...(r.optionalTags || [])] : [],
        isPublic: r ? r.isPublic : true
      }
      $app.innerHTML = `
      <div class="page no-tabbar">
        ${headerHtml(editId ? '编辑菜谱' : '创建菜谱')}
        <div class="form-section">
          <div class="fs-title">📝 基本信息</div>
          <div class="form-item">
            <label style="display:flex;align-items:center;justify-content:space-between">
              <span>菜谱名称 <span class="required">*</span></span>
              <button class="ai-btn" id="rf-ai-btn" onclick="App.rfAIGenerate()">✨ AI 自动生成</button>
            </label>
            <input class="input" id="rf-name" placeholder="例如：红烧肉" value="${esc(this.form.name)}">
            <div style="font-size:11.5px;color:var(--text-3);margin-top:6px">填入菜名后点「AI 自动生成」，会搜索网络菜谱并综合成食材清单与做法</div>
          </div>
          <div id="rf-ai-sources"></div>
          <div class="form-item"><label>菜谱描述</label>
            <textarea class="textarea" id="rf-desc" placeholder="简单介绍一下这道菜…">${esc(this.form.description)}</textarea></div>
          <div class="form-item"><label>菜谱图片（最多3张）</label>
            <div class="img-upload-grid" id="rf-images"></div>
            <div style="display:flex;gap:8px;margin-top:10px">
              <button class="btn btn-outline btn-sm" onclick="App.rfPickImage()">🖼️ 上传本地图片</button>
              <button class="btn btn-outline btn-sm" id="rf-img-search-btn" onclick="App.rfSearchImage()">🔍 搜索配图</button>
            </div>
            <div style="font-size:11.5px;color:var(--text-3);margin-top:6px">搜图后会用 DeepSeek 视觉审核图片是否确实是这道菜</div>
            <input type="file" accept="image/*" class="hidden-input" id="rf-file">
          </div>
        </div>
        <div class="form-section">
          <div class="fs-title">🏷️ 分类（必选）</div>
          <div class="form-item"><label>场景分类 <span class="required">*</span></label>
            <div class="option-grid" id="rf-scene">
              ${TD.sceneCategories.map(c => `<div class="option-item" data-v="${c.id}" onclick="App.rfSelect('sceneCategory','${c.id}',this)">${c.emoji} ${c.name}</div>`).join('')}
            </div></div>
          <div class="form-item"><label>主要食材 <span class="required">*</span></label>
            <div class="option-grid" id="rf-ing">
              ${TD.ingredientCategories.map(c => `<div class="option-item" data-v="${c.id}" onclick="App.rfSelect('ingredientCategory','${c.id}',this)">${c.emoji} ${c.name}</div>`).join('')}
            </div></div>
          <div class="form-item"><label>烹饪方式 / 口味（可选，可多选）</label>
            <div class="option-grid" id="rf-tags">
              ${TD.getOptionalTags().map(t => `<div class="option-item" data-v="${t.id}" onclick="App.rfToggleTag('${t.id}',this)">${t.emoji} ${t.name}</div>`).join('')}
            </div></div>
        </div>
        <div class="form-section">
          <div class="fs-title">⚙️ 制作信息</div>
          <div class="form-item"><label>制作时间</label>
            <div class="option-grid" id="rf-time">
              ${TD.preparationTimes.map(t => `<div class="option-item" data-v="${t.value}" onclick="App.rfSelectTime('${t.value}',this)">${t.label}</div>`).join('')}
            </div></div>
          <div class="form-item"><label>难度</label>
            <div class="option-grid" id="rf-diff">
              ${TD.difficultyLevels.map(d => `<div class="option-item" data-v="${d.value}" onclick="App.rfSelectDiff(${d.value},this)">${d.label}</div>`).join('')}
            </div></div>
          <div class="form-item"><label>适合人数</label>
            <div class="option-grid" id="rf-size">
              ${TD.servingSizes.map(s => `<div class="option-item" data-v="${s.value}" onclick="App.rfSelectSize('${s.value}',this)">${s.label}</div>`).join('')}
            </div></div>
        </div>
        <div class="form-section">
          <div class="fs-title">🥬 食材清单 <span class="required">*</span></div>
          <div id="rf-ings"></div>
          <button class="add-item-btn" onclick="App.rfAddIngredient()">＋ 添加食材</button>
        </div>
        <div class="form-section">
          <div class="fs-title">👨‍🍳 制作步骤 <span class="required">*</span></div>
          <div id="rf-steps"></div>
          <button class="add-item-btn" onclick="App.rfAddStep()">＋ 添加步骤</button>
        </div>
        <div class="form-section">
          <div class="switch-row">
            <div><div style="font-weight:600;font-size:14px;">公开给好友</div>
            <div style="font-size:12px;color:var(--text-3);margin-top:2px;">关闭后仅自己可见</div></div>
            <div class="switch ${this.form.isPublic ? 'on' : ''}" id="rf-public" onclick="App.rfTogglePublic()"></div>
          </div>
        </div>
        <div style="padding: 0 16px; display:flex; gap:12px;">
          <button class="btn btn-plain" style="flex:1" onclick="App.rfSubmit('draft')">存草稿</button>
          <button class="btn btn-primary" style="flex:2" onclick="App.rfSubmit('published')">${editId ? '保存修改' : '发布菜谱'}</button>
        </div>
      </div>`
      this.refreshDynamic()
      this.applyCapabilities()
      return ''
    },
    autoHtml: true,
    /** 根据服务端配置决定 AI / 搜图入口是否可用 */
    async applyCapabilities () {
      let meta = null
      try {
        const res = await api('/api/meta')
        if (res.success) meta = res.data
      } catch (e) { /* 忽略 */ }
      if (!meta) return
      const gate = (btn, enabled, reason) => {
        if (!btn || enabled) return
        btn.classList.add('disabled')
        btn.title = reason
        btn.onclick = () => toast(reason)
      }
      gate(document.getElementById('rf-ai-btn'), meta.aiGenerate,
        'AI 生成未启用：请在服务端 config.json 填入 deepseekKey')
      gate(document.getElementById('rf-img-search-btn'), meta.imageSearch,
        '搜图未启用：请在服务端 config.json 中开启 imageSearch')
    },
    refreshDynamic () {
      // 选中态
      const sel = (id, v) => document.querySelectorAll(`#${id} .option-item`).forEach(el => el.classList.toggle('selected', el.dataset.v === String(v)))
      sel('rf-scene', this.form.sceneCategory)
      sel('rf-ing', this.form.ingredientCategory)
      sel('rf-time', this.form.preparationTime.value)
      sel('rf-diff', this.form.difficulty.value)
      sel('rf-size', this.form.servingSize.value)
      document.querySelectorAll('#rf-tags .option-item').forEach(el => el.classList.toggle('selected', this.form.optionalTags.includes(el.dataset.v)))
      // 图片
      document.getElementById('rf-images').innerHTML =
        this.form.images.map((u, i) => `<div class="img-upload-item"><img src="${esc(u)}"><div class="del" onclick="App.rfDelImage(${i})">×</div></div>`).join('') +
        (this.form.images.length < 3 ? '<div class="img-upload-add" onclick="App.rfPickImage()"><span class="plus">＋</span><span>上传图片</span></div>' : '')
      // 食材
      document.getElementById('rf-ings').innerHTML = this.form.ingredients.map((ing, i) => `
        <div class="list-edit-item">
          <input class="input" placeholder="食材名称" value="${esc(ing.name)}" oninput="App.rfIng(${i},'name',this.value)">
          <input class="input" placeholder="用量" value="${esc(ing.amount)}" oninput="App.rfIng(${i},'amount',this.value)">
          <button class="remove-btn" onclick="App.rfDelIngredient(${i})">×</button>
        </div>`).join('')
      // 步骤
      document.getElementById('rf-steps').innerHTML = this.form.steps.map((s, i) => `
        <div class="list-edit-item">
          <div style="flex:1">
            <textarea class="textarea" style="min-height:56px" placeholder="步骤 ${i + 1}" oninput="App.rfStep(${i},this.value)">${esc(s.content)}</textarea>
          </div>
          <button class="remove-btn" onclick="App.rfDelStep(${i})">×</button>
        </div>`).join('')
    }
  }

  /* ---------- 搜索 ---------- */
  Pages.search = {
    render () {
      const history = JSON.parse(localStorage.getItem('fy_search_history') || '[]')
      return previewBarHtml() + `
      <div class="page no-tabbar">
        ${headerHtml('搜索')}
        <div class="search-bar-row">
          <input class="input" id="s-input" placeholder="🔍 搜索菜谱名称、食材" autofocus>
          <button class="icon-btn" onclick="App.doSearch()">🔍</button>
        </div>
        <div id="s-history">
          ${history.length ? `<div class="section-title">搜索历史 <span class="more" onclick="App.clearHistory()">清空</span></div>
          <div class="history-tags">${history.map(h => `<div class="chip" onclick="App.searchWord('${esc(h)}')">${esc(h)}</div>`).join('')}</div>` : ''}
        </div>
        <div id="s-result"></div>
      </div>`
    },
    mount () {
      document.getElementById('s-input').addEventListener('keydown', e => { if (e.key === 'Enter') App.doSearch() })
    }
  }

  /* ---------- 我的菜谱 ---------- */
  Pages['my-recipe'] = {
    async render () {
      this.filter = { status: '', page: 1, list: [], hasMore: false }
      $app.innerHTML = `
      <div class="page no-tabbar">
        ${headerHtml('我的菜谱', { action: '<span onclick="App.go(\'/recipe-form\')">＋ 新建</span>' })}
        <div class="chip-row">
          <div class="chip active" data-v="" onclick="App.mrFilter('')">全部</div>
          <div class="chip" data-v="published" onclick="App.mrFilter('published')">已发布</div>
          <div class="chip" data-v="draft" onclick="App.mrFilter('draft')">草稿</div>
        </div>
        <div id="mr-list"></div>
        <div class="load-more" id="mr-more"></div>
      </div>`
      await this.load()
      return ''
    },
    autoHtml: true,
    async load () {
      const qs = new URLSearchParams({ page: this.filter.page, pageSize: 10 })
      if (this.filter.status) qs.set('status', this.filter.status)
      const res = await api('/api/recipes/my?' + qs)
      const el = document.getElementById('mr-list')
      if (!el) return
      if (!res.success) { el.innerHTML = emptyHtml('😵', res.message); return }
      this.filter.list = this.filter.page === 1 ? res.data.recipes : this.filter.list.concat(res.data.recipes)
      this.filter.hasMore = res.data.hasMore
      el.innerHTML = this.filter.list.length ? this.filter.list.map(r => `
        <div class="recipe-row" onclick="App.go('/recipe-detail/${r._id}')">
          ${recipeImgHtml(r.images, 'rr-img', 'rr-img-placeholder')}
          <div class="rr-body">
            <div class="rr-name">${esc(r.name)} ${r.status === 'draft' ? '<span class="tag tag-opt">草稿</span>' : ''} ${!r.isPublic ? '<span class="tag tag-opt flavor">🔒 私密</span>' : ''}</div>
            <div class="rr-desc">${esc(r.description || '')}</div>
            <div class="rr-meta">${sceneTag(r.sceneCategory)}${ingTag(r.ingredientCategory)}<span>${esc(r.createTime)}</span></div>
          </div>
        </div>`).join('')
        : emptyHtml('📝', '还没有菜谱', '<div style="margin-top:16px"><button class="btn btn-primary btn-sm" onclick="App.go(\'/recipe-form\')">创建第一道菜谱</button></div>')
      document.getElementById('mr-more').innerHTML = this.filter.hasMore
        ? '<button class="btn btn-plain btn-sm" onclick="App.mrMore()">加载更多</button>' : ''
    }
  }

  /* ---------- 点餐 ---------- */
  Pages.diancan = {
    async render () {
      this.mealType = Cart.get().mealType || this.suggestMealType()
      this.filters = { search: '', sceneCategories: [], ingredientCategories: [], preparationTime: '', page: 1, list: [], hasMore: false }
      $app.innerHTML = `
      <div class="page with-cart">
        ${headerHtml('点餐', { back: false, action: '<span onclick="App.openCart()">🛒 购物车</span>' })}
        <div class="meal-tabs">
          ${TD.mealTimes.map(m => `<div class="meal-tab ${this.mealType === m.value ? 'active' : ''}" data-v="${m.value}" onclick="App.dcMeal('${m.value}')">${m.emoji} ${m.label}</div>`).join('')}
        </div>
        <div class="search-bar-row">
          <input class="input" id="dc-search" placeholder="🔍 搜索好友菜谱">
          <button class="icon-btn" onclick="App.dcSearch()">🔍</button>
        </div>
        <div class="chip-row" id="dc-chips">
          ${TD.sceneCategories.map(c => `<div class="chip" data-g="scene" data-v="${c.id}" onclick="App.dcChip(this)">${c.emoji} ${c.name}</div>`).join('')}
          ${TD.ingredientCategories.map(c => `<div class="chip" data-g="ing" data-v="${c.id}" onclick="App.dcChip(this)">${c.emoji} ${c.name}</div>`).join('')}
          ${TD.preparationTimes.map(t => `<div class="chip" data-g="time" data-v="${t.value}" onclick="App.dcChip(this)">⏰ ${t.label}</div>`).join('')}
        </div>
        <div id="dc-list"></div>
        <div class="load-more" id="dc-more"></div>
        <div class="bottom-bar" id="dc-cart-bar"></div>
      </div>
      ${tabbarHtml('/diancan', Cart.count())}`
      document.getElementById('dc-search').addEventListener('keydown', e => { if (e.key === 'Enter') App.dcSearch() })
      this.refreshCartBar()
      await this.load()
      return ''
    },
    autoHtml: true,
    suggestMealType () {
      const h = new Date().getHours()
      if (h < 10) return 'breakfast'
      if (h < 16) return 'lunch'
      return 'dinner'
    },
    async load (append) {
      const f = this.filters
      const qs = new URLSearchParams({ page: f.page, pageSize: 10 })
      if (f.search) qs.set('search', f.search)
      if (f.sceneCategories.length) qs.set('sceneCategories', f.sceneCategories.join(','))
      if (f.ingredientCategories.length) qs.set('ingredientCategories', f.ingredientCategories.join(','))
      if (f.preparationTime) qs.set('preparationTime', f.preparationTime)
      const res = await api('/api/recipes/friends?' + qs)
      const el = document.getElementById('dc-list')
      if (!el) return
      if (!res.success) { el.innerHTML = emptyHtml('😵', res.message); return }
      f.list = append ? f.list.concat(res.data.recipes) : res.data.recipes
      f.hasMore = res.data.hasMore
      el.innerHTML = f.list.length ? f.list.map(r => `
        <div class="order-recipe-card">
          <div onclick="App.go('/recipe-detail/${r._id}')">${recipeImgHtml(r.images, '', 'img-ph')}</div>
          <div class="orc-body" onclick="App.go('/recipe-detail/${r._id}')">
            <div class="orc-name">${esc(r.name)}</div>
            <div class="orc-meta">👤 ${esc(r.creator.nickname)} · ⏰${esc((r.preparationTime && r.preparationTime.label) || '-')} · ${esc((r.difficulty && r.difficulty.label) || '-')}</div>
            <div class="orc-meta">${esc(r.description || '')}</div>
          </div>
          <button class="add-btn ${Cart.has(r._id) ? 'added' : ''}" id="dc-add-${r._id}" onclick='App.dcToggle(${JSON.stringify(r._id)})'>${Cart.has(r._id) ? '✓ 已添加' : '＋ 添加'}</button>
        </div>`).join('')
        : emptyHtml('👥', '暂无好友菜谱', '<div style="margin-top:8px;font-size:12px">去「我的-好友」添加好友，或发布自己的菜谱</div>')
      document.getElementById('dc-more').innerHTML = f.hasMore
        ? '<button class="btn btn-plain btn-sm" onclick="App.dcMore()">加载更多</button>' : ''
    },
    refreshCartBar () {
      const bar = document.getElementById('dc-cart-bar')
      if (!bar) return
      const n = Cart.count()
      bar.innerHTML = n
        ? `<button class="cart-btn" onclick="App.openCart()">🛒 提交订单（${n} 道菜）</button>`
        : `<button class="cart-btn" style="background:#d1d5db;box-shadow:none" onclick="App.openCart()">🛒 购物车是空的</button>`
      // 同步 tabbar 角标
      const badge = document.querySelector('.tabbar-item:nth-child(3) .badge')
      if (badge) badge.textContent = n
    }
  }

  /* ---------- 订单列表 ---------- */
  Pages['order-list'] = {
    async render () {
      this.filter = { status: 'all', searchValue: '', page: 1, list: [], hasMore: false }
      $app.innerHTML = `
      <div class="page">
        ${headerHtml('我的订单', { back: false })}
        <div class="status-tabs">
          ${TD.orderStatusTabs.map(t => `<div class="status-tab ${t.value === 'all' ? 'active' : ''}" data-v="${t.value}" onclick="App.olTab('${t.value}')">${t.label}</div>`).join('')}
        </div>
        <div class="search-bar-row">
          <input class="input" id="ol-search" placeholder="🔍 搜索订单号 / 菜品 / 昵称">
          <button class="icon-btn" onclick="App.olSearch()">🔍</button>
        </div>
        <div id="ol-list"></div>
        <div class="load-more" id="ol-more"></div>
      </div>
      ${tabbarHtml('/order-list', Cart.count())}`
      document.getElementById('ol-search').addEventListener('keydown', e => { if (e.key === 'Enter') App.olSearch() })
      await this.load()
      return ''
    },
    autoHtml: true,
    async load (append) {
      const f = this.filter
      const qs = new URLSearchParams({ page: f.page, limit: 10 })
      if (f.status !== 'all') qs.set('status', f.status)
      if (f.searchValue) qs.set('searchValue', f.searchValue)
      const res = await api('/api/orders?' + qs)
      const el = document.getElementById('ol-list')
      if (!el) return
      if (!res.success) { el.innerHTML = emptyHtml('😵', res.message); return }
      f.list = append ? f.list.concat(res.data.orders) : res.data.orders
      f.hasMore = res.data.hasMore
      el.innerHTML = f.list.length ? f.list.map(o => `
        <div class="order-card" onclick="App.go('/order-detail/${o._id}')">
          <div class="oc-head">
            <span class="oc-meal">${o.mealTypeIcon} ${o.mealTypeLabel}订单</span>
            ${statusPill(o.status)}
          </div>
          ${(o.recipes || []).slice(0, 3).map(r => `
            <div class="oc-recipe">
              ${r.image ? `<img src="${esc(r.image)}">` : '<div class="mini-ph">🍲</div>'}
              <span>${esc(r.recipeName)} <span style="color:var(--text-3)">(${esc(r.authorName || '')})</span></span>
              <span class="ocr-time">⏰${esc(r.preparationTime || '')}</span>
            </div>`).join('')}
          ${(o.recipes || []).length > 3 ? `<div style="font-size:12px;color:var(--text-3);padding:2px 0">…共 ${o.totalRecipes} 道菜</div>` : ''}
          <div class="oc-foot">
            <span class="oc-time">${esc(o.orderDate)} ${esc(o.orderTime || '')} · 制作：${esc(o.assignee.nickname)}</span>
          </div>
        </div>`).join('')
        : emptyHtml('📋', '暂无订单', '<div style="margin-top:16px"><button class="btn btn-primary btn-sm" onclick="App.go(\'/diancan\')">去点餐</button></div>')
      document.getElementById('ol-more').innerHTML = f.hasMore
        ? '<button class="btn btn-plain btn-sm" onclick="App.olMore()">加载更多</button>' : ''
    }
  }

  /* ---------- 订单详情 ---------- */
  Pages['order-detail'] = {
    async render (params, id) {
      $app.innerHTML = `<div class="page no-tabbar">${loadingHtml()}</div>`
      const res = await api('/api/orders/' + id)
      if (!res.success) {
        $app.innerHTML = `<div class="page no-tabbar">${headerHtml('订单详情')}${emptyHtml('😵', res.message)}</div>`
        return ''
      }
      const o = res.data
      this.order = o
      const canOperate = o.status === 'pending' || o.status === 'processing'
      $app.innerHTML = `
      <div class="page no-tabbar">
        ${headerHtml('订单详情')}
        <div class="form-section">
          <div class="oc-head" style="display:flex;justify-content:space-between;align-items:center">
            <span style="font-weight:700;font-size:17px">${o.mealTypeIcon} ${o.mealTypeLabel}订单</span>
            ${statusPill(o.status)}
          </div>
          <div style="font-size:12px;color:var(--text-3);margin-top:6px">订单号：${esc(o.orderNo)}</div>
        </div>
        <div class="form-section">
          <div class="fs-title">🍽️ 菜品详情（${o.totalRecipes} 道 · 预计 ${o.estimatedTime} 分钟）</div>
          ${(o.recipes || []).map(r => `
            <div class="oc-recipe" style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
              ${r.image ? `<img src="${esc(r.image)}" style="width:48px;height:48px;border-radius:8px;object-fit:cover">` : '<div class="mini-ph" style="width:48px;height:48px;border-radius:8px;background:linear-gradient(135deg,#fef3c7,#fde68a);display:flex;align-items:center;justify-content:center">🍲</div>'}
              <div style="flex:1">
                <div style="font-weight:600;font-size:14px">${esc(r.recipeName)}</div>
                <div style="font-size:12px;color:var(--text-3);margin-top:2px">👤 ${esc(r.authorName || '')} · ⏰${esc(r.preparationTime || '-')} · ${esc(r.difficulty || '-')}</div>
              </div>
              ${r.recipeId ? `<button class="btn btn-outline btn-sm" onclick="App.go('/recipe-detail/${r.recipeId}')">做法</button>` : ''}
            </div>`).join('')}
        </div>
        <div class="form-section">
          <div class="fs-title">📄 订单信息</div>
          <div style="font-size:14px;line-height:2;color:var(--text-2)">
            <div>点餐人：${avatarHtml(o.creatorAvatar, o.creatorName)} ${esc(o.creatorName)}</div>
            <div>制作者：${avatarHtml(o.assigneeAvatar, o.assigneeName)} ${esc(o.assigneeName)}</div>
            <div>用餐日期：${esc(o.orderDate)} ${esc(o.orderTime || '')}</div>
            <div>创建时间：${esc(o.createdAt)}</div>
            ${o.notes ? `<div>备注：${esc(o.notes)}</div>` : ''}
          </div>
        </div>
        <div style="padding:0 16px;display:flex;gap:10px;flex-wrap:wrap">
          ${o.status === 'pending' ? `<button class="btn btn-primary" style="flex:1" onclick="App.odStatus('processing')">👨‍🍳 开始制作</button>` : ''}
          ${o.status === 'processing' ? `<button class="btn btn-primary" style="flex:1" onclick="App.odStatus('completed')">✅ 完成</button>` : ''}
          ${canOperate ? `<button class="btn btn-danger-outline" style="flex:1" onclick="App.odCancel()">取消订单</button>` : ''}
          <button class="btn btn-outline" style="flex:1" onclick="App.odReorder()">🔁 再次点餐</button>
        </div>
      </div>`
      return ''
    },
    autoHtml: true
  }

  /* ---------- 好友 ---------- */
  Pages.friends = {
    async render () {
      $app.innerHTML = `
      <div class="page no-tabbar">
        ${headerHtml('我的好友', { action: '<span onclick="App.go(\'/friend-requests\')">＋ 添加</span>' })}
        <div class="search-bar-row">
          <input class="input" id="fr-search" placeholder="🔍 搜索好友昵称" oninput="App.frFilter(this.value)">
        </div>
        <div id="fr-list">${loadingHtml()}</div>
      </div>`
      const res = await api('/api/friends')
      const el = document.getElementById('fr-list')
      if (!el) return ''
      if (!res.success) { el.innerHTML = emptyHtml('😵', res.message); return '' }
      this.list = res.data
      this.renderList()
      return ''
    },
    autoHtml: true,
    renderList (kw = '') {
      const el = document.getElementById('fr-list')
      if (!el) return
      const list = kw ? this.list.filter(f => f.nickname.toLowerCase().includes(kw.toLowerCase())) : this.list
      el.innerHTML = list.length ? `<div class="card" style="margin:0 16px">${list.map(f => `
        <div class="friend-item">
          ${avatarHtml(f.avatar, f.nickname, 'avatar avatar-lg')}
          <div class="fi-body" onclick="App.go('/recipe-list?creator=${f.id}')">
            <div class="fi-name">${esc(f.nickname)}</div>
            <div class="fi-sub">${f.recipeCount} 道公开菜谱 · ${formatAddTime(f.addTime)} 成为好友</div>
          </div>
          <button class="btn btn-outline btn-sm" onclick="App.go('/recipe-list?creator=${f.id}')">看菜谱</button>
          <button class="btn btn-danger-outline btn-sm" onclick="App.delFriend('${f.id}','${esc(f.nickname)}')">删除</button>
        </div>`).join('')}</div>`
        : emptyHtml('👥', kw ? '没有匹配的好友' : '还没有好友', kw ? '' : '<div style="margin-top:16px"><button class="btn btn-primary btn-sm" onclick="App.go(\'/friend-requests\')">通过搜索码添加</button></div>')
    }
  }

  function formatAddTime (t) {
    return String(t || '').slice(0, 10)
  }

  /* ---------- 好友请求 ---------- */
  Pages['friend-requests'] = {
    async render () {
      $app.innerHTML = `
      <div class="page no-tabbar">
        ${headerHtml('添加好友')}
        <div class="form-section">
          <div class="fs-title">🔍 通过搜索码添加</div>
          <div style="display:flex;gap:8px">
            <input class="input" id="frq-code" placeholder="输入好友的搜索码（如 FYABC123）" style="flex:1">
            <button class="icon-btn" onclick="App.frqSearch()">🔍</button>
          </div>
          <div id="frq-result" style="margin-top:10px"></div>
        </div>
        <div class="form-section">
          <div class="fs-title">📥 收到的请求</div>
          <div id="frq-pending">${loadingHtml()}</div>
        </div>
        <div class="form-section">
          <div class="fs-title">📤 我发送的请求</div>
          <div id="frq-sent">${loadingHtml()}</div>
        </div>
      </div>`
      document.getElementById('frq-code').addEventListener('keydown', e => { if (e.key === 'Enter') App.frqSearch() })
      await this.load()
      return ''
    },
    autoHtml: true,
    async load () {
      const res = await api('/api/friends/requests')
      if (!res.success) return
      const { pendingRequests, sentRequests } = res.data
      const pe = document.getElementById('frq-pending')
      const se = document.getElementById('frq-sent')
      if (pe) pe.innerHTML = pendingRequests.length ? pendingRequests.map(r => `
        <div class="friend-item" style="padding:10px 0">
          ${avatarHtml(r.avatar, r.nickname, 'avatar avatar-lg')}
          <div class="fi-body">
            <div class="fi-name">${esc(r.nickname)}</div>
            <div class="fi-sub">${esc(r.message || '想加你为好友')} · ${esc(r.time)}</div>
          </div>
          <button class="btn btn-primary btn-sm" onclick="App.frqHandle('${r.id}',true)">接受</button>
          <button class="btn btn-plain btn-sm" onclick="App.frqHandle('${r.id}',false)">拒绝</button>
        </div>`).join('') : '<div style="color:var(--text-3);font-size:13px;padding:8px 0">暂无待处理请求</div>'
      if (se) se.innerHTML = sentRequests.length ? sentRequests.map(r => `
        <div class="friend-item" style="padding:10px 0">
          ${avatarHtml(r.avatar, r.nickname, 'avatar avatar-lg')}
          <div class="fi-body">
            <div class="fi-name">${esc(r.nickname)}</div>
            <div class="fi-sub">${esc(r.status)} · ${esc(r.time)}</div>
          </div>
        </div>`).join('') : '<div style="color:var(--text-3);font-size:13px;padding:8px 0">暂无已发送请求</div>'
    }
  }

  /* ---------- 个人中心 ---------- */
  Pages.profile = {
    async render () {
      const u = state.user
      let stats = null
      try {
        const res = await api('/api/orders/statistics')
        if (res.success) stats = res.data
      } catch (e) { /* 忽略 */ }
      let recipeCount = 0
      try {
        const res = await api('/api/recipes/my?page=1&pageSize=1')
        if (res.success) recipeCount = res.data.total || res.data.recipes.length
      } catch (e) { /* 忽略 */ }
      return `
      <div class="page">
        <div class="profile-hero">
          ${avatarHtml(u.avatar, u.nickname, 'avatar avatar-xl')}
          <div style="flex:1">
            <div class="ph-name">${esc(u.nickname)}</div>
            <div class="ph-code">搜索码：${esc(u.searchCode || '生成中…')} <span style="text-decoration:underline" onclick="App.copyCode('${esc(u.searchCode || '')}')">复制</span> · <span style="text-decoration:underline" onclick="App.refreshCode()">刷新</span></div>
          </div>
          <button class="hero-nav-btn" onclick="App.editProfile()">✏️</button>
        </div>
        <div class="stat-row">
          <div class="stat-cell"><div class="st-num">${recipeCount}</div><div class="st-label">我的菜谱</div></div>
          <div class="stat-cell"><div class="st-num">${stats ? stats.total : '-'}</div><div class="st-label">全部订单</div></div>
          <div class="stat-cell"><div class="st-num">${stats ? stats.pending : '-'}</div><div class="st-label">待处理</div></div>
          <div class="stat-cell"><div class="st-num">${stats ? stats.completed : '-'}</div><div class="st-label">已完成</div></div>
        </div>
        <div class="menu-list">
          <div class="menu-item" onclick="App.go('/my-recipe')"><span class="mi-icon">🍱</span>我的菜谱<span class="mi-arrow">›</span></div>
          <div class="menu-item" onclick="App.go('/recipe-form')"><span class="mi-icon">➕</span>发布菜谱<span class="mi-arrow">›</span></div>
          <div class="menu-item" onclick="App.go('/friends')"><span class="mi-icon">👥</span>我的好友<span class="mi-arrow">›</span></div>
          <div class="menu-item" onclick="App.go('/friend-requests')"><span class="mi-icon">📬</span>好友请求<span class="mi-arrow">›</span></div>
          <div class="menu-item" onclick="App.go('/order-list')"><span class="mi-icon">📋</span>我的订单<span class="mi-arrow">›</span></div>
        </div>
        <div style="padding:0 16px">
          <button class="btn btn-danger-outline btn-block" onclick="App.logout()">退出登录</button>
        </div>
        <div style="text-align:center;color:var(--text-3);font-size:12px;margin-top:24px">阿猪餐厅 Web 版 v1.0</div>
      </div>
      ${tabbarHtml('/profile', Cart.count())}`
    }
  }

  /* ================= 路由 ================= */
  function parseHash () {
    const hash = location.hash.slice(1) || '/index'
    const [pathPart, queryPart] = hash.split('?')
    const params = {}
    if (queryPart) queryPart.split('&').forEach(kv => { const [k, v] = kv.split('='); params[k] = decodeURIComponent(v || '') })
    return { path: pathPart, params }
  }

  function go (path) { location.hash = '#' + path }
  function back () {
    if (history.length > 1) history.back()
    else go('/index')
  }

  async function route () {
    const { path, params } = parseHash()
    closeModal()
    // 未登录且非预览模式 → 登录页
    if (!isLoggedIn() && !state.previewMode && path !== '/login') { go('/login'); return }
    if (isLoggedIn() && path === '/login') { go('/index'); return }
    // 权限守卫
    if (path !== '/login' && !guard(path)) return

    // 匹配页面（Pages 的 key 不带前导斜杠）
    const key = path.replace(/^\//, '')
    let page = Pages[key]
    let arg = null
    if (!page) {
      const m = path.match(/^\/(recipe-detail|order-detail)\/(.+)$/)
      if (m) { page = Pages[m[1]]; arg = m[2] }
    }
    if (!page) { go('/index'); return }

    window.scrollTo(0, 0)
    try {
      if (page.autoHtml) {
        await page.render(params, arg) // 页面自行操作 $app
      } else {
        $app.innerHTML = await page.render(params, arg)
      }
      if (page.mount) page.mount(params, arg)
      initMotion()
      centerEmptyStates()
      animateCounts()
    } catch (e) {
      console.error('页面渲染失败:', e)
      $app.innerHTML = `<div class="page no-tabbar">${emptyHtml('😵', '页面加载失败：' + (e.message || e), '<div style="margin-top:16px"><button class="btn btn-primary btn-sm" onclick="App.go(\'/index\')">返回首页</button></div>')}</div>`
    }
  }

  // 空状态可能在异步加载后才出现，用 MutationObserver 兜住
  const emptyObserver = new MutationObserver(() => {
    if (!document.querySelector('.empty')) return
    clearTimeout(emptyObserver._t)
    emptyObserver._t = setTimeout(centerEmptyStates, 60)
  })
  emptyObserver.observe(document.getElementById('app'), { childList: true, subtree: true })

  window.addEventListener('hashchange', route)

  /* ================= App 全局方法 ================= */
  window.App = {
    go, back, closeModal, toast,

    tabGo (path) {
      if (path === parseHash().path) return
      go(path)
    },

    /* ---- 登录 ---- */
    loginTab (mode) {
      Pages.login.mode = mode
      if (parseHash().path === '/login') $app.innerHTML = Pages.login.render(), Pages.login.mount()
    },
    async submitAuth () {
      const mode = Pages.login.mode
      const username = document.getElementById('lg-username').value.trim()
      const password = document.getElementById('lg-password').value
      const nicknameEl = document.getElementById('lg-nickname')
      if (!username || !password) return toast('请输入用户名和密码')
      const res = await api(`/api/auth/${mode}`, {
        method: 'POST',
        body: { username, password, nickname: nicknameEl ? nicknameEl.value.trim() : undefined }
      })
      if (!res.success) return toast(res.message)
      setAuth(res.data.token, res.data.user)
      toast(res.message || '欢迎回来')
      go('/index')
    },
    enterPreviewMode () {
      enterPreview()
      toast('已进入预览模式')
      go('/index')
    },
    logout () {
      confirmBox('确定退出登录吗？').then(ok => {
        if (!ok) return
        clearAuth()
        Cart.clear()
        go('/login')
      })
    },

    /* ---- 菜谱列表 ---- */
    rlSearch () {
      Pages['recipe-list'].filters.search = document.getElementById('rl-search').value.trim()
      Pages['recipe-list'].filters.page = 1
      Pages['recipe-list'].load()
    },
    rlFilter (type, v) {
      const f = Pages['recipe-list'].filters
      if (type === 'scene') {
        f.sceneCategories = v ? [v] : []
        document.querySelectorAll('#rl-scene .chip').forEach(ch => ch.classList.toggle('active', ch.dataset.v === v))
      } else if (type === 'ing') {
        f.ingredientCategories = v ? [v] : []
        f.preparationTime = ''
        document.querySelectorAll('#rl-ing .chip').forEach(ch => ch.classList.toggle('active', ch.dataset.v === v))
      } else if (type === 'time') {
        f.preparationTime = v
        f.ingredientCategories = []
        document.querySelectorAll('#rl-ing .chip').forEach(ch => ch.classList.toggle('active', ch.dataset.v === 't' + v))
      }
      f.page = 1
      Pages['recipe-list'].load()
    },
    rlMore () { Pages['recipe-list'].filters.page++; Pages['recipe-list'].load(true) },

    /* ---- 菜谱详情 ---- */
    toggleCheckMode () {
      const p = Pages['recipe-detail']
      p.checkMode = !p.checkMode
      p.render({}, p.recipe._id)
    },
    checkIngredient (el) {
      if (!Pages['recipe-detail'].checkMode) return
      el.classList.toggle('checked')
    },
    async deleteRecipe (id) {
      const ok = await confirmBox('确定删除该菜谱吗？删除后不可恢复', { danger: true, confirmText: '删除' })
      if (!ok) return
      const res = await api('/api/recipes/' + id, { method: 'DELETE' })
      toast(res.message || (res.success ? '已删除' : '删除失败'))
      if (res.success) go('/my-recipe')
    },
    async addToCart (recipeId) {
      if (!isLoggedIn()) {
        if (state.previewMode) {
          modal(`<div class="modal-title">提示</div>
            <div style="text-align:center;color:var(--text-2);font-size:14px;">登录后即可点餐</div>
            <div class="modal-actions">
              <button class="btn btn-plain" onclick="App.closeModal()">再逛逛</button>
              <button class="btn btn-primary" onclick="App.closeModal();App.go('/login')">立即登录</button>
            </div>`, { center: true })
          return
        }
        return go('/login')
      }
      const res = await api('/api/recipes/' + recipeId)
      if (!res.success) return toast(res.message)
      const added = Cart.add(res.data)
      toast(added ? '已加入点餐购物车' : '该菜已在购物车中')
    },

    /* ---- 菜谱表单 ---- */
    rfSelect (field, v, el) {
      Pages['recipe-form'].form[field] = v
      el.parentElement.querySelectorAll('.option-item').forEach(x => x.classList.remove('selected'))
      el.classList.add('selected')
    },
    rfToggleTag (id, el) {
      const tags = Pages['recipe-form'].form.optionalTags
      const i = tags.indexOf(id)
      if (i >= 0) tags.splice(i, 1); else tags.push(id)
      el.classList.toggle('selected')
    },
    rfSelectTime (v, el) {
      const t = TD.preparationTimes.find(x => x.value === v)
      Pages['recipe-form'].form.preparationTime = { value: t.value, label: t.label }
      el.parentElement.querySelectorAll('.option-item').forEach(x => x.classList.remove('selected'))
      el.classList.add('selected')
    },
    rfSelectDiff (v, el) {
      const d = TD.difficultyLevels.find(x => x.value === v)
      Pages['recipe-form'].form.difficulty = { value: d.value, label: d.label, color: d.color }
      el.parentElement.querySelectorAll('.option-item').forEach(x => x.classList.remove('selected'))
      el.classList.add('selected')
    },
    rfSelectSize (v, el) {
      const s = TD.servingSizes.find(x => x.value === v)
      Pages['recipe-form'].form.servingSize = { value: s.value, label: s.label }
      el.parentElement.querySelectorAll('.option-item').forEach(x => x.classList.remove('selected'))
      el.classList.add('selected')
    },
    rfTogglePublic () {
      const f = Pages['recipe-form'].form
      f.isPublic = !f.isPublic
      document.getElementById('rf-public').classList.toggle('on', f.isPublic)
    },
    rfIng (i, field, v) { Pages['recipe-form'].form.ingredients[i][field] = v },
    rfStep (i, v) { Pages['recipe-form'].form.steps[i].content = v },
    rfAddIngredient () {
      const f = Pages['recipe-form'].form
      f.ingredients.push({ id: 'ing_' + Date.now(), name: '', amount: '' })
      Pages['recipe-form'].refreshDynamic()
    },
    rfDelIngredient (i) {
      const f = Pages['recipe-form'].form
      if (f.ingredients.length <= 1) return toast('至少保留一项食材')
      f.ingredients.splice(i, 1)
      Pages['recipe-form'].refreshDynamic()
    },
    rfAddStep () {
      const f = Pages['recipe-form'].form
      f.steps.push({ id: 'step_' + Date.now(), content: '', image: '' })
      Pages['recipe-form'].refreshDynamic()
    },
    rfDelStep (i) {
      const f = Pages['recipe-form'].form
      if (f.steps.length <= 1) return toast('至少保留一个步骤')
      f.steps.splice(i, 1)
      Pages['recipe-form'].refreshDynamic()
    },
    rfPickImage () { document.getElementById('rf-file').click() },
    rfDelImage (i) {
      Pages['recipe-form'].form.images.splice(i, 1)
      Pages['recipe-form'].refreshDynamic()
    },
    /* ---- AI 自动生成菜谱（搜索网络菜谱 + DeepSeek 综合） ---- */
    rfAIGenerate () {
      const cur = (document.getElementById('rf-name').value || '').trim()
      modal(`
        <div class="modal-title">✨ AI 自动生成菜谱</div>
        <div class="form-item"><label>菜名</label>
          <input class="input" id="ai-name" value="${esc(cur)}" placeholder="例如：鱼香肉丝" autofocus></div>
        <div style="font-size:12px;color:var(--text-3);line-height:1.7">
          会先用 DeepSeek 搜索网络菜谱，再综合成「食材清单 + 做法步骤 + 分类 + 配图」，约需 10 秒。
        </div>
        <div id="ai-status" style="margin-top:12px"></div>
        <div class="modal-actions">
          <button class="btn btn-plain" id="ai-cancel" onclick="App.closeModal()">取消</button>
          <button class="btn btn-primary" id="ai-run" onclick="App.rfAIRun()">开始生成</button>
        </div>`, { center: true })
      const inp = document.getElementById('ai-name')
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') App.rfAIRun() })
      inp.focus()
    },
    async rfAIRun () {
      const name = (document.getElementById('ai-name').value || '').trim()
      const status = document.getElementById('ai-status')
      const runBtn = document.getElementById('ai-run')
      if (!name) return toast('请先输入菜名')
      const p = Pages['recipe-form']
      const hasContent = p.form.ingredients.some(i => i.name && i.name.trim()) || p.form.steps.some(s => s.content && s.content.trim())
      if (hasContent) {
        const ok = await confirmBox('表单已有内容，AI 生成会覆盖它，确定继续吗？', { confirmText: '继续生成' })
        if (!ok) return
        modal(`
          <div class="modal-title">✨ AI 自动生成菜谱</div>
          <div class="form-item"><label>菜名</label>
            <input class="input" id="ai-name" value="${esc(name)}"></div>
          <div id="ai-status" style="margin-top:12px"></div>
          <div class="modal-actions">
            <button class="btn btn-plain" id="ai-cancel" onclick="App.closeModal()">取消</button>
            <button class="btn btn-primary" id="ai-run" onclick="App.rfAIRun()">开始生成</button>
          </div>`, { center: true })
        return App.rfAIRun()
      }
      runBtn.disabled = true
      runBtn.textContent = '生成中…'
      status.innerHTML = '<div class="ai-loading"><div class="loading-spinner"></div><div>正在搜索网络菜谱并综合…</div><div class="ai-loading-tip">通常需要 10 秒左右</div></div>'
      const res = await api('/api/recipes/generate', { method: 'POST', body: { name, withImage: true } })
      if (!res.success) {
        status.innerHTML = `<div style="color:var(--danger);font-size:13px">${esc(res.message)}</div>`
        runBtn.disabled = false
        runBtn.textContent = '重试'
        return
      }
      const rc = res.data.recipe
      p.form.name = rc.name
      p.form.description = rc.description
      p.form.images = [...(rc.images || [])]
      p.form.ingredients = rc.ingredients.map(x => ({ ...x }))
      p.form.steps = rc.steps.map(x => ({ ...x }))
      p.form.preparationTime = rc.preparationTime
      p.form.difficulty = rc.difficulty
      p.form.servingSize = rc.servingSize
      p.form.sceneCategory = rc.sceneCategory
      p.form.ingredientCategory = rc.ingredientCategory
      p.form.optionalTags = [...(rc.optionalTags || [])]
      const nameEl = document.getElementById('rf-name')
      const descEl = document.getElementById('rf-desc')
      if (nameEl) nameEl.value = rc.name
      if (descEl) descEl.value = rc.description
      p.refreshDynamic()
      // 来源展示
      const srcEl = document.getElementById('rf-ai-sources')
      if (srcEl) {
        const list = res.data.sources || []
        srcEl.innerHTML = list.length
          ? `<div class="ai-sources"><div class="ai-src-title">📚 参考来源（${list.length}）</div>${list.map(s =>
              `<a href="${esc(s.url)}" target="_blank" rel="noopener" class="ai-src-item">${esc(s.title || s.url)}${s.site ? ' · ' + esc(s.site) : ''}</a>`).join('')}</div>`
          : ''
      }
      status.innerHTML = `<div style="color:var(--mint);font-size:13px;line-height:1.7">
        ✅ 已填入表单：${rc.ingredients.length} 项食材 · ${rc.steps.length} 步做法${rc.images.length ? ' · 1 张配图' : ''}
        <div style="color:var(--text-3);font-size:12px;margin-top:4px">建议检查一下用量与火候，确认后点「发布菜谱」</div></div>`
      const cancel = document.getElementById('ai-cancel')
      if (cancel) cancel.textContent = '关闭'
      runBtn.style.display = 'none'
      toast('AI 菜谱已生成')
    },

    /* ---- 搜索配图（图源 + DeepSeek 审图） ---- */
    async rfSearchImage () {
      const p = Pages['recipe-form']
      const name = (document.getElementById('rf-name').value || p.form.name || '').trim()
      if (!name) return toast('先填写菜谱名称，再搜索配图')
      const desc = (document.getElementById('rf-desc').value || '').trim()
      const requirement = desc ? `${name}（${desc.slice(0, 20)}）` : name

      modal(`
        <div class="modal-title">🔍 搜索配图</div>
        <div style="display:flex;gap:8px">
          <input class="input" id="is-keyword" value="${esc(name)}" placeholder="关键词，如 红烧肉" style="flex:1">
          <button class="icon-btn" onclick="App.isSearch()">🔍</button>
        </div>
        <div id="is-result" style="margin-top:14px"><div class="loading-wrap"><div class="loading-spinner"></div><div>正在搜图并用 DeepSeek 审图…</div></div></div>
      `)
      document.getElementById('is-keyword').addEventListener('keydown', e => { if (e.key === 'Enter') App.isSearch() })
      App._isRequirement = requirement
      App.isSearch()
    },
    async isSearch () {
      const keyword = (document.getElementById('is-keyword').value || '').trim()
      const box = document.getElementById('is-result')
      if (!keyword) return toast('请输入关键词')
      box.innerHTML = '<div class="loading-wrap"><div class="loading-spinner"></div><div>正在搜图并用 DeepSeek 审图…</div></div>'
      const res = await api('/api/images/search', {
        method: 'POST',
        body: { query: keyword, count: 6, requirement: App._isRequirement || keyword, verify: true }
      })
      if (!res.success) { box.innerHTML = `<div class="empty"><div class="empty-icon">😵</div><div>${esc(res.message)}</div></div>`; return }
      const d = res.data
      if (!d.items.length) { box.innerHTML = '<div class="empty"><div class="empty-icon">🔍</div><div>没找到图片，换个关键词试试</div></div>'; return }
      App._isItems = d.items
      const good = d.items.filter(i => i.verdict.match >= 2).length
      box.innerHTML = `
        <div style="font-size:12px;color:var(--text-3);margin-bottom:10px" id="is-summary">
          图源：${esc(d.provider)}${d.verified ? ' · 已用 DeepSeek 审图' : ' · 未审图（未配置 Key）'} · 可用 ${good}/${d.items.length} 张
        </div>
        <div class="img-pick-grid">
          ${d.items.map((it, i) => {
            const v = it.verdict
            const mark = v.match >= 2 ? 'ok' : v.match === 1 ? 'warn' : 'bad'
            const label = v.match < 0 ? '未审' : `${v.match}/3`
            return `<div class="img-pick ${mark}" onclick="App.isPick(${i})">
              <img src="${esc(it.thumb)}" alt="" loading="lazy" onerror="App.isImgFail(this)">
              <span class="ip-badge ${mark}">${mark === 'ok' ? '✅' : mark === 'warn' ? '⚠️' : '❌'} ${label}</span>
            </div>`
          }).join('')}
        </div>
        <div id="is-detail" style="margin-top:12px;font-size:12px;color:var(--text-2);line-height:1.7"></div>
        <div class="modal-actions" style="justify-content:center">
          <button class="btn btn-plain btn-sm" style="flex:0 0 auto;padding:9px 34px" onclick="App.closeModal()">关闭</button>
        </div>`
    },
    isImgFail (img) {
      const wrap = img.closest('.img-pick')
      if (!wrap) return
      wrap.classList.add('broken')
      wrap.classList.remove('ok', 'warn')
      img.remove()
      wrap.insertAdjacentHTML('afterbegin', '<span class="ip-broken">图片加载失败</span>')
      const badge = wrap.querySelector('.ip-badge')
      if (badge) { badge.className = 'ip-badge bad'; badge.textContent = '⚠️ 加载失败' }
      // 破图不计入可用数量
      const grid = document.querySelector('.img-pick-grid')
      const summary = document.getElementById('is-summary')
      const items = App._isItems || []
      if (grid && summary) {
        const okDecorated = items.filter(x => x.verdict.match >= 2).length
        const broken = grid.querySelectorAll('.img-pick.broken').length
        const total = grid.querySelectorAll('.img-pick').length
        const base = summary.textContent.split('· 可用')[0]
        summary.textContent = `${base}· 可用 ${Math.max(0, okDecorated - broken)}/${total} 张`
      }
    },
    isPick (i) {
      const it = (App._isItems || [])[i]
      if (!it) return
      const v = it.verdict
      const mark = v.match >= 2 ? '✅ 可用' : v.match === 1 ? '⚠️ 可疑' : '❌ 不符'
      document.getElementById('is-detail').innerHTML = `
        <div><b>${mark}</b> · ${esc(v.reason || '')}${v.dish ? ` · 识别为「${esc(v.dish)}」` : ''}</div>
        <div style="color:var(--text-3);margin-top:4px">尺寸 ${it.width || '?'}x${it.height || '?'} · ${esc(it.source)}</div>
        <div style="color:var(--text-3)">版权：${esc(it.license || '未知')}</div>`
      if (v.match >= 2) {
        if (Pages['recipe-form'].form.images.includes(it.url)) return toast('已在图片列表里')
        if (Pages['recipe-form'].form.images.length >= 3) return toast('最多 3 张图片')
        Pages['recipe-form'].form.images.push(it.url)
        Pages['recipe-form'].refreshDynamic()
        toast('已添加为菜谱图片')
      } else {
        toast('这张图片审核不通过，换一张试试')
      }
    },

    async rfSubmit (status) {
      const p = Pages['recipe-form']
      const f = p.form
      f.name = document.getElementById('rf-name').value.trim()
      f.description = document.getElementById('rf-desc').value.trim()
      // 过滤空食材/步骤（与小程序校验一致：名称和用量都需填写）
      const ingredients = f.ingredients.filter(x => x.name && x.amount && x.name.trim() && x.amount.trim())
      const steps = f.steps.filter(x => x.content && x.content.trim())
      const data = { ...f, ingredients, steps, status }
      const errors = TD.validateRequiredFields(data)
      if (errors.length) return toast(errors[0])
      const res = p.editId
        ? await api('/api/recipes/' + p.editId, { method: 'PUT', body: data })
        : await api('/api/recipes', { method: 'POST', body: data })
      if (!res.success) return toast(res.message)
      toast(status === 'draft' ? '草稿已保存' : (p.editId ? '修改已保存' : '发布成功'))
      go('/my-recipe')
    },

    /* ---- 搜索 ---- */
    doSearch () {
      const kw = document.getElementById('s-input').value.trim()
      if (!kw) return toast('请输入搜索关键词')
      // 记录历史
      let history = JSON.parse(localStorage.getItem('fy_search_history') || '[]')
      history = [kw, ...history.filter(h => h !== kw)].slice(0, 10)
      localStorage.setItem('fy_search_history', JSON.stringify(history))
      const el = document.getElementById('s-result')
      el.innerHTML = loadingHtml()
      api('/api/recipes?search=' + encodeURIComponent(kw) + '&pageSize=20').then(res => {
        if (!res.success) { el.innerHTML = emptyHtml('😵', res.message); return }
        el.innerHTML = res.data.recipes.length
          ? `<div class="section-title">搜索结果（${res.data.recipes.length}）</div><div class="recipe-grid">${res.data.recipes.map(recipeCardHtml).join('')}</div>`
          : emptyHtml('🔍', `没有找到与「${kw}」相关的菜谱`)
      })
    },
    searchWord (w) {
      document.getElementById('s-input').value = w
      App.doSearch()
    },
    clearHistory () {
      localStorage.removeItem('fy_search_history')
      document.getElementById('s-history').innerHTML = ''
    },

    /* ---- 我的菜谱 ---- */
    mrFilter (status) {
      const p = Pages['my-recipe']
      p.filter.status = status
      p.filter.page = 1
      document.querySelectorAll('.chip-row .chip').forEach(ch => ch.classList.toggle('active', ch.dataset.v === status))
      p.load()
    },
    mrMore () { Pages['my-recipe'].filter.page++; Pages['my-recipe'].load() },

    /* ---- 点餐 ---- */
    dcMeal (v) {
      const p = Pages.diancan
      p.mealType = v
      const c = Cart.get(); c.mealType = v; Cart.save(c)
      document.querySelectorAll('.meal-tab').forEach(t => t.classList.toggle('active', t.dataset.v === v))
    },
    dcSearch () {
      const p = Pages.diancan
      p.filters.search = document.getElementById('dc-search').value.trim()
      p.filters.page = 1
      p.load()
    },
    dcChip (el) {
      const p = Pages.diancan
      const g = el.dataset.g
      const v = el.dataset.v
      el.classList.toggle('active')
      const active = [...document.querySelectorAll(`#dc-chips .chip.active[data-g="${g}"]`)].map(x => x.dataset.v)
      if (g === 'scene') p.filters.sceneCategories = active
      else if (g === 'ing') p.filters.ingredientCategories = active
      else if (g === 'time') p.filters.preparationTime = active[0] || '', document.querySelectorAll('#dc-chips .chip[data-g="time"].active').forEach((x, i) => { if (i > 0) x.classList.remove('active') })
      p.filters.page = 1
      p.load()
    },
    dcToggle (id) {
      const p = Pages.diancan
      if (Cart.has(id)) {
        Cart.remove(id)
      } else {
        const r = p.filters.list.find(x => x._id === id)
        if (r) Cart.add(r, p.mealType)
      }
      const btn = document.getElementById('dc-add-' + id)
      if (btn) {
        const added = Cart.has(id)
        btn.className = 'add-btn' + (added ? ' added' : '')
        btn.textContent = added ? '✓ 已添加' : '＋ 添加'
        if (added) {
          btn.classList.add('pulse')
          flyToCart(btn)
        }
      }
      p.refreshCartBar()
    },
    dcMore () { Pages.diancan.filters.page++; Pages.diancan.load(true) },

    async openCart () {
      const c = Cart.get()
      const totalTime = c.recipes.reduce((t, r) => t + (parseInt(r.preparationTime && r.preparationTime.value) || 30), 0)
      modal(`
        <div class="modal-title">🛒 已选菜品（${c.recipes.length}）</div>
        ${c.recipes.length ? c.recipes.map(r => `
          <div class="cart-item">
            ${r.images && r.images[0] ? `<img src="${esc(r.images[0])}">` : '<div class="mini-ph" style="width:48px;height:48px;border-radius:8px;background:linear-gradient(135deg,#fef3c7,#fde68a);display:flex;align-items:center;justify-content:center">🍲</div>'}
            <div class="ci-body">
              <div style="font-weight:600">${esc(r.name)}</div>
              <div style="font-size:12px;color:var(--text-3)">👤 ${esc(r.creator.nickname || '我')} · ⏰${esc(r.preparationTime.label || '')}</div>
            </div>
            <button class="ci-del" onclick="App.cartRemove('${r._id}')">删除</button>
          </div>`).join('') : '<div style="text-align:center;color:var(--text-3);padding:20px">购物车是空的，先去挑选菜品吧</div>'}
        ${c.recipes.length ? `<div style="text-align:right;color:var(--text-2);font-size:13px;padding-top:10px">预计制作时间：${totalTime} 分钟</div>` : ''}
        <div class="modal-actions">
          ${c.recipes.length ? '<button class="btn btn-plain" onclick="App.cartClear()">清空</button>' : ''}
          <button class="btn btn-primary" ${c.recipes.length ? '' : 'disabled'} onclick="App.cartCheckout()">确认订单</button>
        </div>`)
    },
    cartRemove (id) {
      Cart.remove(id)
      App.openCart()
      const p = Pages.diancan
      if (document.getElementById('dc-cart-bar')) { p.refreshCartBar(); p.load() }
    },
    cartClear () {
      Cart.clear()
      App.openCart()
      if (document.getElementById('dc-cart-bar')) { Pages.diancan.refreshCartBar(); Pages.diancan.load() }
    },
    async cartCheckout () {
      const c = Cart.get()
      if (!c.recipes.length) return
      // 加载好友列表作为制作者选项（含自己）
      const res = await api('/api/friends')
      const friends = res.success ? res.data : []
      const options = [{ id: String(state.user._id), nickname: state.user.nickname + '（自己）', avatar: state.user.avatar }, ...friends]
      const today = new Date()
      const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
      const mealLabel = (TD.mealTimes.find(m => m.value === c.mealType) || {}).label || '未选择'
      modal(`
        <div class="modal-title">订单确认</div>
        <div style="font-size:14px;line-height:2">
          <div>餐次：<b>${esc(mealLabel)}</b></div>
          <div>日期：<input type="date" class="input" id="co-date" value="${dateStr}" style="margin:4px 0"></div>
          <div style="margin-top:6px">选中菜品：</div>
          <div style="color:var(--text-2);font-size:13px">${c.recipes.map(r => `• ${esc(r.name)}（${esc(r.creator.nickname || '我')}）`).join('<br>')}</div>
          <div style="margin-top:10px">制作者：</div>
          <div class="assignee-row" id="co-assignee">
            ${options.map((o, i) => `<div class="assignee-item ${i === 0 ? 'selected' : ''}" data-v="${o.id}" onclick="App.coAssignee(this)">${avatarHtml(o.avatar, o.nickname)} ${esc(o.nickname)}</div>`).join('')}
          </div>
          <div style="margin-top:10px">备注：</div>
          <textarea class="textarea" id="co-notes" placeholder="例如：少油少盐" style="min-height:56px"></textarea>
        </div>
        <div class="modal-actions">
          <button class="btn btn-plain" onclick="App.closeModal()">取消</button>
          <button class="btn btn-primary" onclick="App.coSubmit()">确认提交</button>
        </div>`)
    },
    coAssignee (el) {
      document.querySelectorAll('#co-assignee .assignee-item').forEach(x => x.classList.remove('selected'))
      el.classList.add('selected')
    },
    async coSubmit () {
      const c = Cart.get()
      const assigneeEl = document.querySelector('#co-assignee .assignee-item.selected')
      if (!assigneeEl) return toast('请选择制作者')
      const orderData = {
        mealType: c.mealType || 'dinner',
        orderDate: document.getElementById('co-date').value,
        notes: document.getElementById('co-notes').value.trim(),
        assigneeId: assigneeEl.dataset.v,
        // 菜谱快照（对应订单数据结构）
        recipes: c.recipes.map(r => ({
          recipeId: r._id,
          recipeName: r.name,
          authorId: r.creatorId,
          authorName: r.creator.nickname || '',
          authorAvatar: r.creator.avatar || '',
          image: (r.images && r.images[0]) || '',
          preparationTime: r.preparationTime.label || '30分钟',
          difficulty: r.difficulty.label || '简单',
          servingSize: r.servingSize.label || '3-4人'
        }))
      }
      const res = await api('/api/orders', { method: 'POST', body: { orderData } })
      if (!res.success) return toast(res.message)
      closeModal()
      Cart.clear()
      toast('下单成功 🎉')
      go('/order-detail/' + res.data.orderId)
    },

    /* ---- 订单 ---- */
    olTab (v) {
      const p = Pages['order-list']
      p.filter.status = v
      p.filter.page = 1
      document.querySelectorAll('.status-tab').forEach(t => t.classList.toggle('active', t.dataset.v === v))
      p.load()
    },
    olSearch () {
      const p = Pages['order-list']
      p.filter.searchValue = document.getElementById('ol-search').value.trim()
      p.filter.page = 1
      p.load()
    },
    olMore () { Pages['order-list'].filter.page++; Pages['order-list'].load(true) },

    async odStatus (status) {
      const o = Pages['order-detail'].order
      const res = await api(`/api/orders/${o._id}/status`, { method: 'PUT', body: { status } })
      toast(res.message || '')
      if (res.success) Pages['order-detail'].render({}, o._id)
    },
    async odCancel () {
      const o = Pages['order-detail'].order
      const ok = await confirmBox('确定取消该订单吗？', { danger: true, confirmText: '取消订单' })
      if (!ok) return
      const res = await api(`/api/orders/${o._id}/cancel`, { method: 'POST' })
      toast(res.message || '')
      if (res.success) Pages['order-detail'].render({}, o._id)
    },
    odReorder () {
      // 再次点餐：订单菜谱 → 购物车（对应《再次点餐功能修复任务.md》的数据转换）
      const o = Pages['order-detail'].order
      let okCount = 0
      o.recipes.forEach(r => {
        const added = Cart.add({
          _id: r.recipeId,
          name: r.recipeName,
          creatorId: r.authorId,
          creator: { nickname: r.authorName, avatar: r.authorAvatar },
          images: r.image ? [r.image] : [],
          preparationTime: { label: r.preparationTime || '30分钟', value: String(parseInt(r.preparationTime) || 30) },
          difficulty: { label: r.difficulty || '简单' },
          servingSize: { label: r.servingSize || '3-4人' }
        }, o.mealType)
        if (added) okCount++
      })
      toast(okCount ? `已将 ${okCount} 道菜加入购物车` : '菜品已在购物车中')
      go('/diancan')
    },

    /* ---- 好友 ---- */
    frFilter (kw) { Pages.friends.renderList(kw) },
    async delFriend (id, name) {
      const ok = await confirmBox(`确定删除好友「${name}」吗？`, { danger: true, confirmText: '删除' })
      if (!ok) return
      const res = await api('/api/friends/' + id, { method: 'DELETE' })
      toast(res.message || '')
      if (res.success) Pages.friends.render()
    },

    /* ---- 好友请求 ---- */
    async frqSearch () {
      const code = document.getElementById('frq-code').value.trim()
      const el = document.getElementById('frq-result')
      if (!code) return toast('请输入搜索码')
      const res = await api('/api/user/search?searchCode=' + encodeURIComponent(code))
      if (!res.success) { el.innerHTML = `<div style="color:var(--text-3);font-size:13px">${esc(res.message)}</div>`; return }
      const u = res.data.user
      if (String(u._id) === String(state.user._id)) {
        el.innerHTML = '<div style="color:var(--warn);font-size:13px">😅 这是你自己的搜索码，不能添加自己为好友</div>'
        return
      }
      el.innerHTML = `
        <div class="friend-item" style="padding:10px 0">
          ${avatarHtml(u.avatar, u.nickname, 'avatar avatar-lg')}
          <div class="fi-body"><div class="fi-name">${esc(u.nickname)}</div><div class="fi-sub">搜索码：${esc(u.searchCode)}</div></div>
          <button class="btn btn-primary btn-sm" onclick="App.frqSend('${u._id}')">加好友</button>
        </div>`
    },
    frqSend (targetId) {
      modal(`
        <div class="modal-title">发送好友请求</div>
        <textarea class="textarea" id="frq-msg" placeholder="和 TA 打个招呼吧…"></textarea>
        <div class="modal-actions">
          <button class="btn btn-plain" onclick="App.closeModal()">取消</button>
          <button class="btn btn-primary" onclick="App.frqSendSubmit('${targetId}')">发送</button>
        </div>`, { center: true })
    },
    async frqSendSubmit (targetId) {
      const message = document.getElementById('frq-msg').value.trim()
      const res = await api('/api/friends/requests', { method: 'POST', body: { targetId, message } })
      toast(res.message || '')
      if (res.success) {
        closeModal()
        document.getElementById('frq-result').innerHTML = ''
        document.getElementById('frq-code').value = ''
        Pages['friend-requests'].load()
      }
    },
    async frqHandle (id, accept) {
      const res = await api(`/api/friends/requests/${id}/handle`, { method: 'POST', body: { accept } })
      toast(res.message || '')
      if (res.success) Pages['friend-requests'].load()
    },

    /* ---- 个人中心 ---- */
    copyCode (code) {
      if (!code) return
      if (navigator.clipboard) {
        navigator.clipboard.writeText(code).then(() => toast('搜索码已复制'))
      } else {
        toast('搜索码：' + code)
      }
    },
    async refreshCode () {
      const ok = await confirmBox('刷新后旧搜索码将失效，确定刷新吗？')
      if (!ok) return
      const res = await api('/api/user/searchCode', { method: 'POST' })
      if (res.success) {
        state.user.searchCode = res.data.searchCode
        localStorage.setItem('fy_user', JSON.stringify(state.user))
        toast('搜索码已刷新：' + res.data.searchCode)
        route()
      }
    },
    editProfile () {
      modal(`
        <div class="modal-title">编辑资料</div>
        <div class="form-item"><label>昵称</label>
          <input class="input" id="ep-nickname" value="${esc(state.user.nickname)}"></div>
        <div class="form-item"><label>头像</label>
          <div style="display:flex;align-items:center;gap:12px">
            <div id="ep-avatar-preview">${avatarHtml(state.user.avatar, state.user.nickname, 'avatar avatar-lg')}</div>
            <button class="btn btn-outline btn-sm" onclick="document.getElementById('ep-file').click()">上传头像</button>
            <input type="file" accept="image/*" class="hidden-input" id="ep-file">
          </div></div>
        <div class="modal-actions">
          <button class="btn btn-plain" onclick="App.closeModal()">取消</button>
          <button class="btn btn-primary" onclick="App.epSubmit()">保存</button>
        </div>`, { center: true })
      let avatarUrl = state.user.avatar
      App._epAvatar = () => avatarUrl
      document.getElementById('ep-file').addEventListener('change', async e => {
        const file = e.target.files[0]
        if (!file) return
        toast('上传中…')
        try {
          avatarUrl = await uploadImage(file)
          document.getElementById('ep-avatar-preview').innerHTML = `<img class="avatar avatar-lg" src="${esc(avatarUrl)}">`
        } catch (err) { toast(err.message) }
      })
    },
    async epSubmit () {
      const nickname = document.getElementById('ep-nickname').value.trim()
      if (!nickname) return toast('昵称不能为空')
      const res = await api('/api/user/profile', { method: 'PUT', body: { nickname, avatar: App._epAvatar() } })
      if (!res.success) return toast(res.message)
      state.user = res.data.user
      localStorage.setItem('fy_user', JSON.stringify(state.user))
      closeModal()
      toast('资料已更新')
      route()
    }
  }

  // 图片上传事件（菜谱表单，动态绑定）
  document.addEventListener('change', async e => {
    if (e.target && e.target.id === 'rf-file') {
      const file = e.target.files[0]
      if (!file) return
      toast('上传中…')
      try {
        const url = await uploadImage(file)
        Pages['recipe-form'].form.images.push(url)
        Pages['recipe-form'].refreshDynamic()
      } catch (err) { toast(err.message) }
      e.target.value = ''
    }
  })

  /* ================= 启动 ================= */
  route()
})()
