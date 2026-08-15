/* floria — 会话查看器前端（ChatGPT 风格）
   hash 路由约定：
     #/          → 主界面（空态，输入栏居中）
     #/<会话哈希> → 会话转录（输入栏 docked 底部）
   「会话哈希」= 转录文件名去掉 .jsonl（Claude Code 会话 UUID）。
   数据来自后端：/api/sessions 列表、/api/session?id= 单会话。
   只读查看：composer 不可发送。 */
(() => {
  'use strict'

  const $ = (id) => document.getElementById(id)

  // ---------- SVG 图标 ----------
  const I = {
    logo: '<img class="logo-mark" src="icon.ico" alt="floria">',
    pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l1.2-4.6L16.5 4.1a1.9 1.9 0 0 1 2.7 0l.7.7a1.9 1.9 0 0 1 0 2.7L8.6 18.8 4 20z"/><path d="M13.5 6.5l4 4"/></svg>',
    mag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="10.8" cy="10.8" r="6.3"/><path d="M15.6 15.6 20 20"/></svg>',
    bubble: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M4 5h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8l-5 3.5v-3.5H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/></svg>',
    toggle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="3.5" y="5" width="6.5" height="14" rx="2"/><rect x="14" y="5" width="6.5" height="14" rx="2"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5.5v13M5.5 12h13"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2 9.5h2v5H2zM6.5 6.5H9v11H6.5zM11 3.5h2v17h-2zM15.5 6.5H18v11h-2.5zM20 9.5h2v5h-2z"/></svg>',
    mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/></svg>',
    collapse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 6 15.5 12 9.5 18"/></svg>',
    folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></svg>',
    msg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8l-5 3.5V19H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/></svg>',
  }

  // ---------- 元素 ----------
  const chatArea = $('chat-area')
  const messagesEl = $('messages')
  const inputWrap = $('input-wrap')
  const inputEl = $('input')
  const sendBtn = $('send-btn')
  const bodyEl = $('recent-body')
  const sidebar = $('sidebar')
  const toastEl = $('toast')
  const charEl = $('char')
  const bubblePop = $('bubble-pop')
  const overlay = $('search-overlay')
  const sInput = $('search-input')
  const recentLabel = $('recent-label')
  const modeTabsEl = $('mode-tabs')

  // ---------- 状态 ----------
  const state = { mode: 'list', pt: 'projects', panelOpen: false, folded: false, currentHash: null }
  let ALL = []
  let timer = null
  // 阶段1 实时同步：SSE 变更驱动的去重/防抖状态
  const live = { es: null, listSig: '', curSig: '', listT: null, sessT: null, lastUserSig: '', pinnedUserSig: '' }

  // ---------- 工具 ----------
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

  // ---------- 角色形象（2026-08-14 实验） ----------
  // 右侧空缺处的 AI 形象随操作类型切换：读取/搜索=3、书写/编辑=2、执行代码/插件/命令行=4、其余（思考/输出/空闲）=1。
  const CHAR_READ = /^(read|grep|glob|web(fetch|search)|search|lookup|view|show|list|ls|cat|head|tail|find)$/i
  const CHAR_WRITE = /^(edit|write|notebookedit|todowrite|task(create|update|get|list|stop|delete)?)$/i
  const CHAR_EXEC = /^(bash|skill|agent|task|mcp__plugin|plugin:|kill|bash_sandbox|run)/i
  function toolToChar(name) {
    const n = String(name || '').toLowerCase()
    if (CHAR_EXEC.test(n)) return 4
    if (CHAR_READ.test(n)) return 3
    if (CHAR_WRITE.test(n)) return 2
    return 1
  }
  function setChar(n) {
    if (!charEl) return
    charEl.src = 'char/' + n + '.jpg'
  }

  // ---------- Markdown 渲染（安全：mdHtml 入口先整体转义，再生成白名单 HTML） ----------
  const MD_MONO = "ui-monospace, SFMono-Regular, 'SF Mono', Consolas, 'Courier New', monospace"
  const MD_LINK_OK = (u) => /^(https?:)?\/\//.test(u) || /^[a-z0-9][a-z0-9./_-]*$/i.test(u)
  function mdInline(s) {
    // s 必须是已转义文本（来自 mdHtml 入口）
    const codes = []
    s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000' })
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>')
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => (MD_LINK_OK(u) ? `<a href="${u}" target="_blank" rel="noopener">${t}</a>` : t))
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_, p, u) => p + `<a href="${u}" target="_blank" rel="noopener">${u}</a>`)
    s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`)
    return s
  }
  function mdHtml(src) {
    if (!src) return ''
    const lines = esc(String(src)).split('\n')
    let html = ''
    let para = []
    const flushPara = () => { if (para.length) { html += `<p>${para.join('<br>')}</p>`; para = [] } }
    let inCode = false, codeLang = '', codeBuf = []
    const closeCode = () => {
      if (!inCode) return
      html += `<div class="code-block"><pre><code>${codeBuf.join('\n')}</code></pre>${codeLang ? `<span class="code-lang">${codeLang}</span>` : ''}</div>`
      codeBuf = []; codeLang = ''; inCode = false
    }
    let list = null
    const closeList = () => { if (list) { html += `</${list}>`; list = null } }
    const isSep = (r) => { const x = r.replace(/\|/g, '').replace(/[\s:-]/g, ''); return x === '' && r.includes('-') }
    const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const t = line.trim()
      if (!t) { flushPara(); closeList(); continue }
      if (/^```/.test(t)) {
        if (inCode) { closeCode() } else { inCode = true; codeLang = t.slice(3).trim() }
        continue
      }
      if (inCode) { codeBuf.push(line); continue }
      const h = /^(#{1,4})\s+(.*)$/.exec(t)
      if (h) { flushPara(); closeList(); html += `<h${h[1].length}>${mdInline(h[2])}</h${h[1].length}>`; continue }
      if (t.startsWith('&gt;')) {
        flushPara(); closeList()
        html += `<blockquote>${mdInline(t.replace(/^&gt;\s?/, ''))}</blockquote>`
        continue
      }
      if (/^[-*+]\s+/.test(t)) {
        flushPara()
        if (list !== 'ul') { closeList(); list = 'ul'; html += '<ul>' }
        html += `<li>${mdInline(t.replace(/^[-*+]\s+/, ''))}</li>`
        continue
      }
      if (/^\d+[.)]\s+/.test(t)) {
        flushPara()
        if (list !== 'ol') { closeList(); list = 'ol'; html += '<ol>' }
        html += `<li>${mdInline(t.replace(/^\d+[.)]\s+/, ''))}</li>`
        continue
      }
      if (/^(-{3,}|\*{3,})$/.test(t)) { flushPara(); closeList(); html += '<hr>'; continue }
      if (t.startsWith('|') && lines[i + 1] && isSep(lines[i + 1].trim())) {
        flushPara(); closeList()
        html += '<div class="md-table"><table><thead><tr>' + cells(t).map((c) => `<th>${mdInline(c)}</th>`).join('') + '</tr></thead><tbody>'
        i += 1
        while (i + 1 < lines.length && lines[i + 1].trim().startsWith('|')) {
          i += 1
          html += '<tr>' + cells(lines[i]).map((c) => `<td>${mdInline(c)}</td>`).join('') + '</tr>'
        }
        html += '</tbody></table></div>'
        continue
      }
      para.push(mdInline(t))
    }
    flushPara(); closeCode(); closeList()
    return html
  }

  function relTime(ms) {
    if (!ms) return ''
    const diff = Date.now() - ms
    const m = Math.floor(diff / 60000)
    if (m < 1) return '刚刚'
    if (m < 60) return `${m} 分钟前`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h} 小时前`
    const d = Math.floor(h / 24)
    if (d < 30) return `${d} 天前`
    const dt = new Date(ms)
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
  }

  function toast(msg) {
    toastEl.textContent = msg
    toastEl.hidden = false
    clearTimeout(timer)
    timer = setTimeout(() => (toastEl.hidden = true), 2600)
  }

  // 手机端（≤720px）：侧栏为全屏抽屉，选择会话后自动收起
  const isMobile = () => window.matchMedia('(max-width: 720px)').matches

  // ---------- 会话映射 ----------
  const hashOf = (s) => (s.file || '').replace(/\.jsonl$/, '')
  const findSession = (hash) => ALL.find((s) => hashOf(s) === hash)
  const sorted = () => [...ALL].sort((a, b) => b.updatedAt - a.updatedAt)

  // ---------- 数据 ----------
  async function loadSessions() {
    try {
      const res = await fetch('/api/sessions')
      const data = await res.json()
      if (!Array.isArray(data.sessions)) throw new Error(data.error || 'bad response')
      ALL = data.sessions
      const top = data.sessions[0]
      live.listSig = data.sessions.length + ':' + (top ? top.updatedAt : 0) + ':' + (top ? top.title : '')
    } catch (e) {
      toast('加载失败: ' + (e.message || e))
      bodyEl.innerHTML = '<div class="no-hit">无法连接后端服务。请确认服务已启动。</div>'
    }
  }

  async function fetchMessages(sessionId) {
    const res = await fetch('/api/session?id=' + encodeURIComponent(sessionId))
    const data = await res.json()
    if (!Array.isArray(data.messages)) throw new Error(data.error || 'bad response')
    // CLI 已按「复用已有实现」原则导出过滤后的会话展示（display，见 conversationDisplay.ts /
    // 网关 /api/session 注入）→ 存在时优先消费（thinking 过滤 / 真实用户消息识别由 CLI 权威完成），
    // 尚未导出（如网关重启后 CLI 未重发）时回退后端原始消息映射。
    return { messages: data.display || data.messages }
  }

  // ---------- 实时同步（阶段1：SSE 监听 jsonl 变化，自动刷新会话/列表）----------
  // 兼容：刷新只替换 messagesEl 内层，折叠开合（含网关实时折叠）与滚动位置尽量保留；
  // 只读视图下最后一段「处理中（尚无回复）」的已处理折叠默认展开，回复落地后自动收起。
  function initLive() {
    if (!('EventSource' in window)) return
    try { live.es = new EventSource('/api/events') } catch { return }
    live.es.onmessage = (e) => {
      let ev
      try { ev = JSON.parse(e.data) } catch { return }
      if (ev.type === 'hello') { refreshList(); refreshSession() }
      else if (ev.type === 'updated') {
        if (ev.hash === state.currentHash) refreshSession()
        refreshList()
      }
    }
    live.es.onerror = () => {
      try { live.es.close() } catch {}
      live.es = null
      setTimeout(initLive, 3000)
    }
  }

  function refreshList() {
    if (live.listT) return
    live.listT = setTimeout(async () => {
      live.listT = null
      try {
        const res = await fetch('/api/sessions')
        const data = await res.json()
        if (!Array.isArray(data.sessions)) return
        const top = data.sessions[0]
        const sig = data.sessions.length + ':' + (top ? top.updatedAt : 0) + ':' + (top ? top.title : '')
        if (sig === live.listSig) return
        live.listSig = sig
        // 保留展开中的项目文件夹
        const openF = [...bodyEl.querySelectorAll('.folder.open')].map((f) => f.dataset.f)
        ALL = data.sessions
        renderRecent()
        if (openF.length) {
          for (const f of bodyEl.querySelectorAll('.folder')) {
            if (openF.includes(f.dataset.f)) f.classList.add('open')
          }
        }
      } catch { /* 瞬时错误忽略 */ }
    }, 600)
  }

  function refreshSession() {
    const hash = state.currentHash
    if (!hash) return
    if (live.sessT) return
    live.sessT = setTimeout(async () => {
      live.sessT = null
      if (state.currentHash !== hash) return
      const s = findSession(hash)
      if (!s) return
      try {
        const { messages } = await fetchMessages(s.id)
        const last = messages.length ? messages[messages.length - 1] : null
        const sig = messages.length + ':' + (last ? (last.timestamp || '') : '') + ':' + (last && last.blocks.length ? last.blocks[last.blocks.length - 1].kind : '')
        // 新增用户消息检测（实时同步的钉顶触发点）：末尾真实用户消息索引/时间变了 = 新回合
        let lastU = -1
        for (let i = messages.length - 1; i >= 0; i--) if (isRealUser(messages[i])) { lastU = i; break }
        const uSig = lastU >= 0 ? lastU + ':' + (messages[lastU].timestamp || '') : ''
        const hasNewUser = live.lastUserSig !== '' && uSig && uSig !== live.lastUserSig
        live.lastUserSig = uSig
        if (sig === live.curSig) return
        live.curSig = sig
        const sc = $('chat-scroll')
        const atBottom = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 80
        // 按索引保留折叠开合（messagesHtml 只在末尾追加新折叠，索引稳定）
        const openState = [...messagesEl.querySelectorAll('details')].map((d) => d.open)
        const doneLivePrev = [...messagesEl.querySelectorAll('details')].map((d) => d.classList.contains('done-live'))
        // 采集刷新前的消息 key（data-m|data-t），重建后只给新增块播放入场动画
        const prevMsgs = new Set([...messagesEl.querySelectorAll('[data-m]')].map((e) => e.dataset.m + '|' + (e.dataset.t || '')))
        messagesEl.innerHTML = messagesHtml(messages)
        setChar(charNote) // 只读 SSE：按末段最近工具/处理状态切形象
        bindLiveFoldTimer(messages)
        stampMsgIn(prevMsgs)
        // 已存在的折叠恢复刷新前状态（覆盖 messagesHtml 对处理中折叠的默认 open，避免折叠后被刷新强制弹开）；
        // 处理中折叠（done-live）回复落地 → 自动收起（对齐「回复落地后收起」设计，短回复占位得以重新补回）；
        // 用户手动展开的「已处理」折叠照常恢复。新增折叠（索引越界）保留默认：处理中展开、已处理收起
        ;[...messagesEl.querySelectorAll('details')].forEach((d, i) => {
          if (i >= openState.length) return
          const finishedNow = doneLivePrev[i] && !d.classList.contains('done-live')
          d.open = finishedNow ? false : openState[i]
        })
        if (hasNewUser && uSig !== live.pinnedUserSig) {
          // 真正的新用户消息 → 钉顶到视口顶部（平滑上划）；
          // pinnedUserSig 防重复：网关 result 已解除钉顶后，迟到的刷新不会再重钉上一回合
          live.pinnedUserSig = uSig
          const el = messagesEl.querySelector(`[data-m="${lastU}"][data-t="u"]`)
          if (el) pinApply(el, true)
        } else {
          syncPinAfterRender()
        }
        // 钉顶回合由 pin 逻辑接管滚动（动画期不滚、跟随期已由 pinScrollFollow 吸底）；
        // 非钉顶回合保留原有「原本在底部就跟着吸底」行为；平滑解除帧（smoothDismissPending）
        // 则让位——pinReserveApply 已 smooth 滚到底，auto 吸底会瞬间跳掉过渡
        if (!pin.active) {
          if (smoothDismissPending) { smoothDismissPending = false }
          else {
            sc.style.scrollBehavior = 'auto'
            if (atBottom) sc.scrollTop = sc.scrollHeight
            sc.style.scrollBehavior = ''
          }
        }
      } catch { /* 瞬时错误忽略 */ }
    }, 400)
  }

  // 处理中折叠的「正在处理」实时计时（历史/SSE 路径）：末段尚无回复 = 处理中，
  // 从该段最后一个真实用户消息时间起跳字，回复落地后下轮刷新换成「已处理 X」并停表。
  let liveFoldTimer = null
  function stopLiveFoldTimer() {
    if (liveFoldTimer) { clearInterval(liveFoldTimer); liveFoldTimer = null }
  }
  function bindLiveFoldTimer(messages) {
    stopLiveFoldTimer()
    const fold = messagesEl.querySelector('details.done-live')
    if (!fold) return
    let t1 = 0
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role === 'user' && m.timestamp && m.blocks.some((b) => (b.kind === 'text' && b.text && b.text.trim() && !isSynthText(b.text)) || b.kind === 'image')) {
        t1 = m.timestamp
        break
      }
    }
    if (!t1) return
    const sum = fold.querySelector('summary')
    const tick = () => {
      if (!fold.isConnected) { stopLiveFoldTimer(); return }
      const sec = Math.round((Date.now() - t1) / 1000)
      sum.innerHTML = `<span class="d-chev">▸</span>正在处理<span class="d-dur"> ${fmtDur(sec)}</span>`
    }
    tick()
    liveFoldTimer = setInterval(tick, 1000)
  }

  // ---------- 路由 ----------
  function parseRoute() {
    const raw = location.hash.replace(/^#\/?/, '')
    if (!raw) return { name: 'home' }
    return { name: 'session', hash: decodeURIComponent(raw) }
  }

  function route() {
    const r = parseRoute()
    renderRecent()
    if (r.name === 'home') renderHome()
    else renderSession(r.hash)
  }

  function navigate(hash) {
    if (location.hash === hash) return route()
    location.hash = hash
  }

  function renderHome() {
    stopLiveFoldTimer()
    pinRelease()
    state.currentHash = null
    messagesEl.innerHTML = ''
    setChar(1) // 首页空态 → 默认形象
    inputWrap.classList.remove('docked')
    chatArea.classList.remove('in-session')
  }

  function renderSession(hash) {
    stopLiveFoldTimer()
    pinRelease()
    const s = findSession(hash)
    state.currentHash = hash
    if (!s) {
      messagesEl.innerHTML = '<div class="msg msg-system">会话不存在或已删除</div>'
      inputWrap.classList.add('docked')
      chatArea.classList.add('in-session')
      return
    }
    messagesEl.innerHTML = '<div class="msg msg-system">加载中…</div>'
    setChar(1) // 加载中 → 默认形象
    inputWrap.classList.add('docked')
    chatArea.classList.add('in-session')
    fetchMessages(s.id)
      .then(({ messages }) => {
        if (state.currentHash !== hash) return
        messagesEl.innerHTML = messagesHtml(messages)
        setChar(charNote) // 只读 SSE：按末段最近工具/处理状态切形象
        bindLiveFoldTimer(messages)
        stampMsgIn(new Set())
        const last = messages.length ? messages[messages.length - 1] : null
        live.curSig = messages.length + ':' + (last ? (last.timestamp || '') : '') + ':' + (last && last.blocks.length ? last.blocks[last.blocks.length - 1].kind : '')
        // 记录末尾真实用户消息基线：首屏默认不钉顶（只有实时同步新增用户消息才钉）
        let lastU = -1
        for (let i = messages.length - 1; i >= 0; i--) if (isRealUser(messages[i])) { lastU = i; break }
        const baseU = lastU >= 0 ? lastU + ':' + (messages[lastU].timestamp || '') : ''
        live.lastUserSig = baseU
        live.pinnedUserSig = baseU
        // 最新真实用户消息之后的回复（含处理折叠）未填满视口 → 刷新后恢复钉顶 + 补占位：
        // 处理中 / 短回复 / 长回复未填满视口都钉顶；长回复已填满视口则不钉顶、吸底。
        // messagesHtml 对处理中折叠默认展开（高思考内容会撑高 → baseH 虚大、占位被撤 =
        // 刷新后占位死亡），先强制收起，让几何判定与占位补回基于真实内容。
        let pinned = false
        if (lastU >= 0) {
          const el = messagesEl.querySelector(`[data-m="${lastU}"][data-t="u"]`)
          if (el) {
            const df = messagesEl.querySelector('details.done-live')
            if (df) df.open = false
            const g = pinGeometry(el)
            if (g.baseH < g.target) {
              pinApply(el, false)
              pinned = true
            }
          }
        }
        const sc = $('chat-scroll')
        if (!pinned) {
          sc.style.scrollBehavior = 'auto'
          sc.scrollTop = sc.scrollHeight
          sc.style.scrollBehavior = ''
        }
      })
      .catch((e) => toast('读取会话失败: ' + (e.message || e)))
  }

  // ---------- 消息渲染 ----------
  // 工具名 → 中文动作（弱化行展示，不单独成气泡）
  const TOOL_NAMES = {
    Read: '阅读', Edit: '编辑', Write: '写入', Grep: '搜索', Glob: '查找文件',
    Bash: '运行命令', WebFetch: '抓取网页', WebSearch: '搜索网页',
    NotebookEdit: '编辑笔记', TaskCreate: '创建任务', TaskUpdate: '更新任务',
    TaskGet: '查询任务', Agent: '委派 Agent', Skill: '调用技能', TodoWrite: '更新待办',
  }
  function toolLine(block) {
    const zh = TOOL_NAMES[block.name] || block.name || '工具'
    const inp = block.input && typeof block.input === 'object' ? block.input : null
    const detail = inp ? (inp.file_path || inp.filePath || inp.query || inp.pattern || inp.command || inp.toolName || inp.path || '') : ''
    const d = typeof detail === 'string' && detail ? ' · ' + String(detail).slice(0, 70) : ''
    return `<span class="tool-line"><span class="t-ico">⚙</span>${esc(zh)}${esc(d)}</span>`
  }

  // 系统注入文本（转录把系统消息记成 type:user；后端已标 role:'system'，前端再兜底滤一层）
  const SYNTH_RE = [
    /^<task-notification>/i,
    /^\[Request interrupted by user/i,
    /^<local-command-caveat>/i,
    /^<command-name>/i,
    /^<command-message>/i,
    /^<local-command-stdout>/i,
    /^<bash-stdout>/i,
    /^<bash-stderr>/i,
    /^This session is being continued from a previous conversation/i,
  ]
  function isSynthText(t) {
    t = (t || '').trim()
    return t.length > 0 && SYNTH_RE.some((re) => re.test(t))
  }

  // 压缩/自动摘要标记：转录里压缩会把「会话续接」记成 user|text（后端已映射 role:'system'，
  // 标签「会话续接（自动摘要）」）。命中它 = 当前回合被压缩打断，但 agent 仍在干活——
  // 不应把它当成回合结束，否则「正在处理」被强收成「已处理」、后续思考/工具拆成断开的新段。
  const CONTINUED_RE = /This session is being continued from a previous conversation/i
  function isContinuationMsg(m) {
    if (m.role !== 'system' && m.role !== 'user') return false
    return m.blocks.some((b) => b.kind === 'text' && (CONTINUED_RE.test(b.text) || b.text.includes('会话续接')))
  }

  // 真实用户消息（带文本/图片，非纯工具回包，非系统注入）
  function isRealUser(m) {
    if (m.role !== 'user') return false
    return m.blocks.some((b) => (b.kind === 'text' && b.text && b.text.trim() && !isSynthText(b.text)) || b.kind === 'image')
  }

  // 已处理时长：10m 50s 风格
  function fmtDur(sec) {
    if (!(sec > 0)) return ''
    if (sec < 60) return sec + 's'
    const m = Math.floor(sec / 60)
    const s = sec % 60
    if (m < 60) return s ? m + 'm ' + s + 's' : m + 'm'
    const h = Math.floor(m / 60)
    return h + 'h ' + (m % 60) + 'm'
  }

  // 思考/旁白文本：无气泡框，浅灰小字（收在「已处理」折叠区内）
  function processTextHtml(text) {
    return `<div class="done-think">${mdHtml(text)}</div>`
  }

  // 入场动画标记：对比刷新前的顶层消息 key 集合，只给「本次新增」的块加 .msg-in，
  // 已存在的块静默保留（视觉无缝），避免整体 innerHTML 重建时整屏重播动画造成强刷感。
  // key = data-m|data-t（段起始消息索引 | 块类型：u=用户 a=回复 f=独立处理折叠 s=系统）。
  // prev 为空（首屏加载）时全部淡入并带轻微 stagger，让会话打开更有层次。
  function stampMsgIn(prev) {
    let n = 0
    messagesEl.querySelectorAll('[data-m]').forEach((el) => {
      const k = el.dataset.m + '|' + (el.dataset.t || '')
      if (!prev.has(k)) {
        el.classList.add('msg-in')
        el.style.animationDelay = Math.min(n * 22, 330) + 'ms'
        n++
      }
    })
  }

  // messagesHtml 渲染时记录的末段形象（只读 SSE 路径）：末段仍在处理中且段内最近有工具调用
  // → 按该工具选形象（读/搜=3、写/编=2、执行/插件/命令=4）；回复已发布/空闲 → 默认 1
  let charNote = 1

  function messagesHtml(messages) {
    // 按「用户消息 → AI 处理 → 回复」切段：
    // 真实 user 消息开新段；assistant/tool 的 thinking 与 tool_use 归入「已处理」折叠，
    // 段内最后一个带文本的 assistant 消息 = 回复（主内容），其余文本（过程旁白）也折进去。
    // role:'system'（后端已把合成/系统注入标成 system）= 无发布者的居中提示，独立一行。
    let html = ''
    let seg = null
    // 兜底：最后一条真实用户消息的时间（供「系统消息打断后」无 user 的末段计时/展示时长）
    let lastUserTs = 0
    for (const m of messages) if (isRealUser(m) && m.timestamp) lastUserTs = m.timestamp
    function closeSeg(isFinal) {
      if (!seg) return
      const s = seg
      seg = null
      const reply = s.texts.length ? s.texts[s.texts.length - 1] : null
      // 末段仍在处理中（未出正式回复）且段内最近有工具调用 → 按该工具选形象；否则（回复已发布/空闲）默认 1
      if (isFinal) charNote = (!s.finished && s.lastTool) ? toolToChar(s.lastTool) : 1
      for (let k = 0; k < s.texts.length - 1; k++) s.items.push(processTextHtml(s.texts[k].text))
      // 对齐 CLI hidePastThinking：只保留本回合最后一个思考块，其余（"The user says…" 等中间思考）为无效对话剔除
      if (s.thinks.length > 1) {
        for (let k = 0; k < s.thinks.length - 1; k++) s.items[s.thinks[k]] = ''
      }

      if (s.user) {
        const m = s.user
        const txt = m.blocks.filter((b) => b.kind === 'text').map((b) => b.text).join('\n')
        const hasImg = m.blocks.some((b) => b.kind === 'image')
        const body = hasImg && !txt ? '[图片]' : txt
        html += `<div class="msg user" data-m="${s.key}" data-t="u"><div class="body">${mdHtml(body)}</div></div>`
      }

      // 已处理折叠：思考 + 阅读/编辑/搜索 等全部收进一个可展开容器
      // 时长 = 回复时间 − 用户消息时间（t2 − t1，即整段 AI 处理过程）
      let foldHtml = ''
      if (s.items.length) {
        const endTs = reply ? reply.ts : s.lastTs
        const processing = isFinal && !s.finished // 最后一段且末尾还没收到纯文本回复 = 处理中
        // 处理中：label「正在处理」+ 实时计时（bindLiveFoldTimer 每秒跳字）；回复落地后「已处理 X」
        const t1 = (s.user && s.user.timestamp) || (isFinal ? lastUserTs : 0)
        const dur = !processing && t1 && endTs ? fmtDur(Math.round((endTs - t1) / 1000)) : ''
        const openAttr = processing ? ' open' : ''
        const liveCls = processing ? ' done-live' : ''
        foldHtml = `<details class="done-fold${liveCls}" data-m="${s.key}" data-t="f"${openAttr}><summary><span class="d-chev">▸</span>${processing ? '正在处理' : '已处理'}${dur ? `<span class="d-dur"> ${dur}</span>` : ''}</summary><div class="done-body">${s.items.join('')}</div></details>`
      }

      if (reply) {
        html += `<div class="msg assistant" data-m="${s.key}" data-t="a"><div class="body"><div class="blocks">${foldHtml}${mdHtml(reply.text)}</div></div></div>`
      } else if (foldHtml) {
        // 段被中断（无回复）：已处理折叠独立展示
        html += foldHtml
      }
    }

    for (let i = 0; i < messages.length; i++) {
      const m = messages[i]
      if (isContinuationMsg(m)) {
        // 压缩/自动摘要标记：若当前段仍在处理中（尚无正式回复）→ 不中断，
        // 把标记作为段内一条浅灰注释吸进同一「已处理/正在处理」折叠，后续 thinking/工具/回复继续追写；
        // 否则（段间）照旧居中展示为无发布者系统提示。
        const txt = m.blocks.filter((b) => b.kind === 'text').map((b) => b.text).join('\n').trim()
        if (seg && !seg.finished) {
          seg.items.push(`<div class="done-fold-note">${esc(txt || '会话续接')}</div>`)
        } else {
          closeSeg(false)
          html += `<div class="msg system" data-m="s${i}" data-t="s">${esc(txt || '会话续接')}</div>`
        }
        continue
      }
      if (m.role === 'system') {
        // 无发布者的系统提示：中断当前段并居中展示
        closeSeg(false)
        const txt = m.blocks.filter((b) => b.kind === 'text').map((b) => b.text).join('\n').trim()
        html += `<div class="msg system" data-m="s${i}" data-t="s">${esc(txt || '系统消息')}</div>`
        continue
      }
      if (isRealUser(m)) {
        closeSeg(false)
        seg = { user: m, items: [], texts: [], lastTs: null, key: i, thinks: [], lastTool: null }
        continue
      }
      if (!seg) seg = { user: null, items: [], texts: [], lastTs: null, key: i, thinks: [], lastTool: null }
      const hasText = m.blocks.some((b) => b.kind === 'text' && b.text && b.text.trim())
      for (const b of m.blocks) {
        // 思考块先进 items 占位并记下索引，closeSeg 时只保留本回合最后一个（对齐 CLI hidePastThinking）
        if (b.kind === 'thinking') { seg.thinks.push(seg.items.length); seg.items.push(processTextHtml(b.text)) }
        else if (b.kind === 'tool_use') { seg.items.push(toolLine(b)); seg.lastTool = b.name } // 记录段内最近工具 → 供形象切换
      }
      if (hasText) {
        seg.texts.push({ text: m.blocks.filter((b) => b.kind === 'text').map((b) => b.text).join('\n'), ts: m.timestamp })
      }
      // finished = 该消息是「纯文本回复」（无 tool_use）= 段已收尾；
      // 末尾仍在调工具/思考（含旁白文本后再跟 tool_use）= 处理中
      if (m.role === 'assistant') {
        seg.finished = hasText && !m.blocks.some((b) => b.kind === 'tool_use') ? 1 : 0
      }
      if (m.timestamp) seg.lastTs = m.timestamp
    }
    closeSeg(true)
    return html || '<div class="msg msg-system">该会话暂无 user/assistant 记录</div>'
  }

  // ---------- 侧栏 ----------
  function setPanel(open) {
    state.panelOpen = open
    sidebar.classList.toggle('open', open)
    // 展开/折叠侧栏时关闭 rail 相关的弹层
    bubblePop.classList.remove('show')
    $('organize-pop').classList.remove('show')
  }

  function itemHtml(s) {
    const on = hashOf(s) === state.currentHash
    // 会话状态点：busy=绿（正在运行）· idle/waiting=红（运行暂停）· 无=透明（CLI 未打开）
    const dotCls = s.state === 'busy' ? ' st-busy' : (s.state === 'idle' || s.state === 'waiting') ? ' st-wait' : ''
    return `<button class="sess-item${on ? ' on' : ''}" data-hash="${esc(hashOf(s))}" title="${esc(s.file)}">
      <span class="dot${dotCls}"></span><span class="title">${esc(s.title)}</span>
      <span class="cnt">${s.messageCount}</span><span class="time">${relTime(s.updatedAt)}</span></button>`
  }

  function bindSessClicks(root) {
    root.querySelectorAll('.sess-item').forEach((b) =>
      b.addEventListener('click', () => {
        navigate('#/' + encodeURIComponent(b.dataset.hash))
        if (isMobile()) setPanel(false)
      }),
    )
  }

  function renderRecent() {
    if (state.folded) { bodyEl.classList.add('collapsed'); return }
    bodyEl.classList.remove('collapsed')
    // 记录刷新前的会话条目 key（会话哈希 / 项目文件夹名），仅给「新增条目」播放入场动画，
    // 已有条目静默保留，避免每次 SSE 刷新整列重播淡入
    const prevKeys = new Set()
    bodyEl.querySelectorAll('.sess-item, .folder').forEach((el) => {
      const k = el.dataset.hash || el.dataset.f
      if (k) prevKeys.add(k)
    })
    bodyEl.innerHTML = ''
    modeTabsEl.classList.toggle('hidden', state.mode !== 'project')
    recentLabel.textContent = state.mode === 'list' ? '最近' : '最近对话'
    if (state.mode === 'list') renderList()
    else renderProject()
    bodyEl.querySelectorAll('.sess-item, .folder').forEach((el) => {
      const k = el.dataset.hash || el.dataset.f
      if (k && !prevKeys.has(k)) el.classList.add('item-in')
    })
    renderBubble()
    renderSearch()
  }

  function renderList() {
    const box = document.createElement('div')
    box.innerHTML = sorted().map(itemHtml).join('')
    bindSessClicks(box)
    bodyEl.appendChild(box)
  }

  function renderProject() {
    bodyEl.innerHTML = ''
    if (state.pt === 'projects') {
      const byProject = {}
      for (const s of ALL) if (s.projectScope === 'project') (byProject[s.projectLabel] = byProject[s.projectLabel] || []).push(s)
      const labels = Object.keys(byProject).sort((a, b) => {
        const la = Math.max(0, ...byProject[a].map((s) => s.updatedAt))
        const lb = Math.max(0, ...byProject[b].map((s) => s.updatedAt))
        return lb - la
      })
      if (labels.length === 0) {
        bodyEl.innerHTML = '<div class="no-hit" style="padding:10px">暂无项目会话</div>'
        return
      }
      const box = document.createElement('div')
      box.innerHTML = labels
        .map((label) => {
          const chats = [...byProject[label]].sort((a, b) => b.updatedAt - a.updatedAt)
          return `<div class="folder" data-f="${esc(label)}"><button class="folder-head">
            <span class="chev">▶</span><span class="ficon">${I.folder}</span><span class="fname">${esc(label)}</span>
            <span class="fcount">${chats.length}</span></button><div class="folder-body">${chats.map(itemHtml).join('')}</div></div>`
        })
        .join('')
      box.querySelectorAll('.folder-head').forEach((h) => h.addEventListener('click', () => h.parentElement.classList.toggle('open')))
      bindSessClicks(box)
      bodyEl.appendChild(box)
    } else {
      const root = ALL.filter((s) => s.projectScope !== 'project')
      const box = document.createElement('div')
      box.innerHTML = root.length ? root.map(itemHtml).join('') : '<div class="no-hit" style="padding:10px">暂无根会话</div>'
      bindSessClicks(box)
      bodyEl.appendChild(box)
    }
  }

  // ---------- 气泡弹层 ----------
  function renderBubble() {
    bubblePop.innerHTML = '<div class="b-head">最近会话</div>' + sorted().slice(0, 5).map(itemHtml).join('')
    bubblePop.querySelectorAll('.sess-item').forEach((b) =>
      b.addEventListener('click', () => {
        navigate('#/' + encodeURIComponent(b.dataset.hash))
        bubblePop.classList.remove('show')
        if (isMobile()) setPanel(false)
      }),
    )
  }

  // ---------- 搜索覆盖层 ----------
  function openSearch() {
    overlay.classList.add('show')
    sInput.value = ''
    renderSearch()
    setTimeout(() => sInput.focus(), 30)
  }
  function renderSearch() {
    const q = sInput.value.trim().toLowerCase()
    const rows = sorted().filter(
      (s) => !q || s.title.toLowerCase().includes(q) || (s.projectLabel || '').toLowerCase().includes(q),
    )
    $('search-results').innerHTML = rows.length
      ? rows.map((s) => {
          const prj = s.projectScope === 'project' ? `<span class="s-prj">${esc(s.projectLabel)}</span>` : ''
          return `<div class="s-row" data-hash="${esc(hashOf(s))}"><span class="s-ico">${I.msg}</span><span class="st">${esc(s.title)}</span>${prj}</div>`
        }).join('')
      : '<div class="no-hit">没有匹配的会话</div>'
    $('search-results').querySelectorAll('.s-row').forEach((b) =>
      b.addEventListener('click', () => {
        navigate('#/' + encodeURIComponent(b.dataset.hash))
        overlay.classList.remove('show')
        if (isMobile()) setPanel(false)
      }),
    )
  }

  // ---------- 事件绑定 ----------
  // rail
  $('rail-logo').innerHTML = I.logo
  $('rail-logo').addEventListener('click', () => setPanel(true))
  $('rail-toggle').innerHTML = I.toggle
  $('rail-toggle').addEventListener('click', () => setPanel(true))
  $('panel-collapse').innerHTML = I.collapse
  $('panel-collapse').addEventListener('click', () => setPanel(false))
  $('panel-search').innerHTML = I.mag
  $('panel-search').addEventListener('click', openSearch)
  $('rail-new').innerHTML = I.pen
  $('rail-new').addEventListener('click', () => { navigate('#/'); if (isMobile()) setPanel(false) })
  $('rail-search').innerHTML = I.mag
  $('rail-search').addEventListener('click', openSearch)

  // 移动端：汉堡按钮打开抽屉、遮罩关闭抽屉
  $('menu-btn').addEventListener('click', () => setPanel(true))
  $('scrim').addEventListener('click', () => setPanel(false))
  $('rail-bubble').innerHTML = I.bubble
  $('rail-bubble').addEventListener('click', () => {
    const willShow = !bubblePop.classList.contains('show')
    if (willShow) {
      renderBubble()
      // 先以不可见方式测量，把弹窗锚定到气泡按钮右侧并垂直居中，避免闪现/错位
      bubblePop.style.visibility = 'hidden'
      bubblePop.classList.add('show')
      const r = $('rail-bubble').getBoundingClientRect()
      bubblePop.style.left = Math.round(r.right + 8) + 'px'
      bubblePop.style.top = Math.round(r.top + r.height / 2 - bubblePop.offsetHeight / 2) + 'px'
      bubblePop.style.visibility = 'visible'
    } else {
      bubblePop.classList.remove('show')
    }
  })
  $('recent-write').innerHTML = I.pen
  $('recent-write').addEventListener('click', () => { navigate('#/'); if (isMobile()) setPanel(false) })
  $('recent-more').addEventListener('click', (e) => { e.stopPropagation(); $('organize-pop').classList.toggle('show') })

  // 最近会话 折叠/展开
  $('recent-fold').addEventListener('click', () => {
    state.folded = !state.folded
    bodyEl.classList.toggle('collapsed', state.folded)
    $('recent-fold').textContent = state.folded ? '▲' : '▼'
  })

  // 项目/聊天 tab
  document.querySelectorAll('.mtab').forEach((b) =>
    b.addEventListener('click', () => {
      document.querySelectorAll('.mtab').forEach((x) => x.classList.toggle('on', x === b))
      state.pt = b.dataset.pt
      renderProject()
    }),
  )

  // 整理会话弹层
  document.querySelectorAll('.org-opt').forEach((b) =>
    b.addEventListener('click', () => {
      document.querySelectorAll('.org-opt').forEach((x) => x.classList.toggle('on', x === b))
      state.mode = b.dataset.mode
      syncModeUI()
      $('organize-pop').classList.remove('show')
    }),
  )
  function syncModeUI() {
    document.querySelectorAll('.org-opt').forEach((x) => x.classList.toggle('on', x.dataset.mode === state.mode))
    renderRecent()
  }

  // 搜索
  $('s-mag').innerHTML = I.mag
  sInput.addEventListener('input', renderSearch)
  $('search-close').addEventListener('click', () => overlay.classList.remove('show'))
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('show') })

  // 点击空白关闭弹层
  document.addEventListener('click', (e) => {
    if (!$('organize-pop').contains(e.target) && !e.target.closest('#recent-more')) $('organize-pop').classList.remove('show')
    if (!bubblePop.contains(e.target) && !e.target.closest('#rail-bubble')) bubblePop.classList.remove('show')
    // 「已处理」折叠展开时，点击列表任意部分 → 收起（summary 点击走原生切换，跳过）
    const df = e.target.closest('details.done-fold')
    if (df && df.open && !e.target.closest('summary')) df.open = false
  })

  // composer（只读；网关模式由下方 gatewayInit 的 gwSend 接管）
  sendBtn.innerHTML = I.send
  $('upload-btn').innerHTML = I.plus
  $('mic-btn').innerHTML = I.mic
  $('think-btn').addEventListener('click', () => toast(GATEWAY ? '暂不支持' : '只读查看 · 无法发送'))
  $('mic-btn').addEventListener('click', () => toast(GATEWAY ? '暂不支持' : '只读查看 · 无法发送'))
  sendBtn.addEventListener('click', () => {
    if (gateAwait) { gateSubmit(); return } // token 门态：点击发送 = 提交 token
    if (!gwSend()) toast('只读查看 · 无法发送')
  })
  $('upload-btn').addEventListener('click', () => toast(GATEWAY ? '暂不支持上传' : '只读查看 · 无法发送'))
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (gateAwait) { gateSubmit(); return } // token 门态：回车 = 提交 token
      if (!gwSend()) toast('只读查看 · 无法发送')
    }
  })

  // 路由
  window.addEventListener('hashchange', route)
  // 钉顶回合窗口尺寸变化（旋转/缩放）时，预留空间跟随新容器高度自适应
  window.addEventListener('resize', () => { if (pin.active && pin.reserve) pinReserveApply() })

  // 钉顶滚动监听：滑到底部恢复跟随；离开跟随区（上滑查看回复/历史）只暂停跟随，
  // **不解除钉顶、不撤占位**——占位生命周期 = 本回合用户消息 → 下一个用户消息（重新钉顶）
  // 或回复增长填满视口（pinReserveApply 检测 baseH≥target 且本回合已出回复 → 平滑解除），
  // 中途撤占位会造成布局位移/跳动。消息被 sticky 吸附时由 CSS 自动贴顶；用户上滑越过其
  // 自然位即自然脱吸，回到底部再吸附（follow 重挂 → 触发解除判定），全程无占位增删 → 无跳动。
  $('chat-scroll').addEventListener('scroll', () => {
    if (!pin.active || !pin.el || !pin.el.isConnected || pin.animT) return
    const sc = $('chat-scroll')
    const atBottom = sc.scrollTop >= sc.scrollHeight - sc.clientHeight - 40
    if (atBottom && !pin.follow) { pin.follow = true; pinScrollFollow() } // 回底重挂跟随 → 解除判定
    else if (!atBottom) pin.follow = false
  })

  // ---------- 网关模式（SubPj2 私有化网关）----------
  // 检测 /api/health 返回 mode==='gateway' 即启用：composer 可发、WS 双向、工具审批。
  // 只读查看模式（SubPj1 后端）下本块全部不生效。
  let GATEWAY = false
  let gateAwait = false // token 门态：网关 token 验证通过前锁定为全空白 + 中间输入框
  let gToken = new URLSearchParams(location.search).get('token') || ''
  let gws = null
  let cur = null // 当前正在流的 assistant 消息元素

  function gatewayCss() {
    const s = document.createElement('style')
    s.textContent = `
      #send-btn.enabled{opacity:1;cursor:pointer}
      .msg.approval{background:var(--rail-bg);border:1px solid var(--border);border-radius:14px;padding:12px 14px;max-width:min(640px,calc(100% - 24px))}
      .appr-title{display:flex;align-items:center;gap:8px;font-weight:600;color:var(--text)}
      .appr-title .ico{opacity:.7}
      .appr-input{margin:8px 0 10px;padding:8px 10px;background:#fff;border:1px solid var(--border-soft);border-radius:8px;font:12px/1.5 ui-monospace,monospace;white-space:pre-wrap;word-break:break-all;color:var(--text-2);max-height:160px;overflow:auto}
      .appr-btns{display:flex;gap:8px}
      .appr-btns button{flex:1;height:32px;border-radius:999px;font-size:13px;cursor:pointer;border:1px solid var(--border)}
      .appr-allow{background:var(--blue);border-color:var(--blue)!important;color:#fff}
      .appr-deny{background:#fff;color:var(--text-2)}`
    document.head.appendChild(s)
  }

  function setConn(on, label) {
    const b = $('floria-conn')
    if (!b) return
    // 浅灰小字紧跟 Floria 品牌名后；on/off 仅控制文案（已连接/未连接/连接中…），颜色统一浅灰
    b.textContent = label || (on ? '已连接' : '未连接')
  }

  function scrollBottom() {
    // 钉顶回合：动画未就位或用户上滑离开跟随区时不强制滚动（不跟用户抢）
    if (pin.active && (pin.animT || !pin.follow)) return
    const sc = messagesEl.closest('#chat-scroll')
    // 先按最新内容重算占位，再吸底：占位随回复增长收缩，scrollHeight 恒定 → 无跳动
    if (pin.active) pinReserveApply()
    // pinReserveApply 刚平滑解除并发出 smooth 滚到底 → 本帧 auto 吸底让位，不覆盖 smooth
    if (smoothDismissPending) { smoothDismissPending = false; return }
    sc.style.scrollBehavior = 'auto'
    sc.scrollTop = sc.scrollHeight
    sc.style.scrollBehavior = ''
  }

  // ---- 用户消息钉顶：最新发送/到达的用户消息吸附在视口顶部，下方预留空间给回复滚动 ----
  // active 是否处于钉顶回合；key 服务端段索引（data-m）；el 当前钉顶元素；
  // top 该消息自然位置对应的 scrollTop（滚动到此值消息即贴住视口顶部）；
  // follow 是否跟随回复自动吸底；animT 初始平滑上划动画期（期间不跟随）；
  // settleT 回合结束检测轮询；lastReplyLen 上次回复长度（稳定即视为回复结束）。
  const pin = { active: false, key: null, el: null, top: null, follow: false, animT: null, settleT: null, lastReplyLen: -1, reserve: false, replied: false }
  // 解除帧标记：pinReserveApply 平滑解除（长回复一次性撑满视口）时已发 smooth 滚到底，
  // 本帧内 scrollBottom / pinScrollFollow / refreshSession 的 auto 吸底要让位，避免覆盖 smooth
  // （否则 smooth 刚启动就被 scrollTop=scrollHeight 顶掉，退化成瞬间跳底）。
  let smoothDismissPending = false

  // 消息被 sticky 吸附时 offsetTop 会返回「渲染后的吸附位」而非自然流位置，不能直接用。
  // 自然流位置 = 前一个兄弟消息的底部 + flex gap + 消息自身 marginTop（首条消息未被吸附，
  // offsetTop 即自然位，可直接用）。
  function flowTopOf(el) {
    if (!el) return 0
    const prev = el.previousElementSibling
    if (prev) {
      const gap = parseFloat(getComputedStyle(messagesEl).gap) || 0
      return prev.offsetTop + prev.offsetHeight + gap + (parseFloat(getComputedStyle(el).marginTop) || 0)
    }
    return el.offsetTop
  }
  function pinFlowTop() { return flowTopOf(pin.el) }

  // 任意消息 el 作为钉顶消息时的几何（供首屏恢复钉顶判定复用，不依赖 pin 状态）：
  // baseH = 去占位后的真实滚动内容高（offsetHeight 布局高，不受 scrollHeight 在内容<视口时 clamp）；
  // pinTop = el 吸附到视口顶部时对应的 scrollTop；target = pinTop + 视口高。
  // baseH < target 说明「el + 其下回复 + 历史」未填满视口 → 需要钉顶补占位。
  function pinGeometry(el) {
    const sc = $('chat-scroll')
    const scs = getComputedStyle(sc)
    const padTop = parseFloat(scs.paddingTop) || 0
    const padBot = parseFloat(scs.paddingBottom) || 0
    const mGap = parseFloat(getComputedStyle(messagesEl).gap) || 0
    const sp = messagesEl.querySelector('.pin-spacer')
    const spH = sp ? sp.getBoundingClientRect().height : 0
    const msH = messagesEl.offsetHeight - spH - (sp ? mGap : 0)
    const baseH = padTop + msH + padBot
    const natural = flowTopOf(el)
    const pinTop = Math.max(0, natural - sc.offsetTop - padTop)
    return { baseH, pinTop, target: pinTop + sc.clientHeight }
  }

  // 消息吸附到顶部时对应的 scrollTop：natural 相对 #chat-scroll 内容盒顶部。
  // offsetTop 相对 #chat-area（唯一 positioned 祖先），减 #chat-scroll.offsetTop 得距滚动区
  // 顶部的距离，再减滚动区 padding-top——目标=内容区顶部（sticky top:0 的实际吸附位）。
  function pinNaturalTop() {
    const sc = $('chat-scroll')
    const padTop = parseFloat(getComputedStyle(sc).paddingTop) || 0
    return Math.max(0, pinFlowTop() - sc.offsetTop - padTop)
  }

  function pinRelease() {
    if (pin.animT) { clearTimeout(pin.animT); pin.animT = null }
    if (pin.settleT) { clearTimeout(pin.settleT); pin.settleT = null }
    if (pin.el && pin.el.classList) pin.el.classList.remove('msg-pin')
    const sc = $('chat-scroll')
    if (sc && sc.classList.contains('pin-active')) sc.classList.remove('pin-active')
    messagesEl.querySelector('.pin-spacer')?.remove()
    pin.active = false; pin.key = null; pin.el = null; pin.top = null
    pin.follow = false; pin.lastReplyLen = -1; pin.reserve = false; pin.replied = false
    smoothDismissPending = false
  }

  function pinScrollFollow() {
    if (!pin.active || !pin.follow) return
    const sc = $('chat-scroll')
    if (pin.active) pinReserveApply()
    if (smoothDismissPending) { smoothDismissPending = false; return } // 平滑解除帧：smooth 已发，不覆盖
    sc.style.scrollBehavior = 'auto'
    sc.scrollTop = sc.scrollHeight
    sc.style.scrollBehavior = ''
  }

  // 本回合处理折叠是否仍展开（done-live + open）：AI 还在思考/调工具 = 回复尚未发布。
  // 实时（WS proc 折叠）与只读（SSE 渲染的 done-live 折叠）两条路径都适用。
  function roundFoldOpen() {
    return !!messagesEl.querySelector('details.done-live[open]')
  }

  // 预留空间自适应（占位）：sticky 的包含块是内容盒（padding 不算行程），钉顶消息要能被
  // 平滑上划到视口顶部，必须用真实元素 .pin-spacer 撑高。占位高度 = 视口高 − 钉顶消息以下
  // 的真实内容高（回复未满一屏时补足），使「钉顶消息 + 回复 + 占位」恒等于一屏——
  // scrollHeight 全程恒定 → 跟随吸底不跳动；回复随流式增长时占位自动收缩（每帧几 px，无跳变）；
  // 回复填满视口后占位为 0（移除元素，无位移）。高度按滚动容器实际可见高度 clientHeight
  // 自适应（桌面/iPad/手机各自容器高，不依赖 iOS 100vh），resize 时重算。
  function pinReserveApply() {
    if (!pin.active || !pin.el || !pin.el.isConnected) return
    const sc = $('chat-scroll')
    const target = pin.top + sc.clientHeight
    const sp = messagesEl.querySelector('.pin-spacer')
    const spH = sp ? sp.getBoundingClientRect().height : 0
    const mGap = parseFloat(getComputedStyle(messagesEl).gap) || 0
    const scs = getComputedStyle(sc)
    // scrollHeight 在内容 < 视口时被 clamp 到 clientHeight 不可直读；messagesEl.offsetHeight 是
    // 布局高、不受 clamp。减去占位及其与末消息之间的 gap 得真实消息高，再加滚动区上下 padding
    // 即 baseH（去占位后的滚动内容高）。
    const msH = messagesEl.offsetHeight - spH - (sp ? mGap : 0)
    const baseH = (parseFloat(scs.paddingTop) || 0) + msH + (parseFloat(scs.paddingBottom) || 0)
    // 内容已 ≥ 目标：占位无法为负，撤掉。但处理折叠仍展开（AI 还在工作、回复未发布）时
    // **保持钉顶、只撤占位**——占位本就是给「回复未满一屏」补足用的，内容已撑满视口则占位
    // 无意义；回合结束回复落地后，短回复会重新补回占位、长回复再由下方分支平滑解除。
    // 折叠已收起且本回合已出回复（pin.replied）才是「回复把视口撑满」→ 此刻 scrollTop 恰等于
    // pin.top（消息自然位 = 视口顶）→ 平滑解除钉顶，回复继续增长时消息随内容自然上滑出视口
    // （ChatGPT 式过渡）；还没出回复（钉顶瞬间长会话背景）只撤占位、保持钉顶，等回复出现。
    if (baseH >= target) {
      if (sp) sp.remove()
      if (pin.replied && !roundFoldOpen()) {
        const sc = $('chat-scroll')
        const wasFollow = pin.follow
        pinRelease()
        // 回复一次性完成（非逐字符流式 / 静态渲染 / 刷新）时，解除后平滑滚到最新内容
        // （回复/文本底部），避免停在消息贴顶处看不到回复底部；流式场景解除后 streamText 的
        // scrollBottom 会继续自然吸底（消息随内容增长上滑出视口），此 smooth 只兜一次性路径
        if (wasFollow || sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 40) {
          sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' })
          smoothDismissPending = true // 本帧内各调用点 auto 吸底让位（scrollBottom/pinScrollFollow/refreshSession）
        }
      }
      return
    }
    // 目标：加占位后 scrollHeight 恰为 target → maxScrollTop == pin.top，吸底时消息贴顶、
    // 视口恰满、无死区、无跳动。边界时高算 0 也保留元素：靠 flex gap 补足，避免撤占位丢掉
    // gap 使吸底差一截、消息贴不到顶（rel>0）。
    const h = Math.max(0, Math.round(target - baseH - mGap))
    const sp2 = sp || document.createElement('div')
    if (!sp) { sp2.className = 'pin-spacer'; messagesEl.appendChild(sp2) }
    sp2.style.height = h + 'px'
  }

  // 回合结束后的解除兜底：回复填满视口（baseH ≥ 目标）且已出回复时，pinReserveApply 在
  // 流式/刷新过程中已自动平滑解除（见上）；此处兜底覆盖「用户上滑离底时回复悄悄撑满视口、
  // 回底重挂跟随才触发解除」等边角。短回复（未填满）保持钉顶占位不解除。
  function pinMaybeRelease() {
    if (!pin.active || !pin.el || !pin.el.isConnected) return
    pinReserveApply()
    if (!pin.active) return // 已在 pinReserveApply 内平滑解除
    const sc = $('chat-scroll')
    const sp = messagesEl.querySelector('.pin-spacer')
    const spH = sp ? sp.getBoundingClientRect().height : 0
    const mGap = parseFloat(getComputedStyle(messagesEl).gap) || 0
    const baseH = sc.scrollHeight - spH - (sp ? mGap : 0)
    // 处理折叠仍展开（回复未发布）不解除：短回复回合占位由 pinReserveApply 在折叠收起后重新补回
    if (!roundFoldOpen() && baseH >= pin.top + sc.clientHeight) pinRelease() // 回合结束且回复填满视口才解除
  }

  function pinApply(el, smooth) {
    pinRelease()
    pin.active = true
    pin.el = el
    el.classList.add('msg-pin')
    pin.top = pinNaturalTop()
    const sc = $('chat-scroll')
    // 预留空间占位：钉顶消息下方回复未满一屏时用 .pin-spacer 补齐，使「消息+回复+占位」
    // 恒等于一屏、scrollHeight 恒定 → 跟随吸底不跳动；回复增长时占位自动收缩，
    // 填满视口后占位 0 并平滑解除钉顶（消息随内容自然上滑出视口）；短回复保持钉顶占位
    sc.classList.add('pin-active')
    pin.reserve = true
    pinReserveApply()
    if (smooth) {
      // 平滑上划把该消息送到视口顶部；动画结束后进入跟随模式
      pin.follow = false
      pin.animT = setTimeout(() => { pin.animT = null; pin.follow = true; pinScrollFollow() }, 750)
      sc.scrollTo({ top: pin.top, behavior: 'smooth' })
    } else {
      sc.style.scrollBehavior = 'auto'
      sc.scrollTop = pin.top
      sc.style.scrollBehavior = ''
      pin.follow = true
    }
    // 仅对服务端渲染（有 data-m）的消息做回合结束轮询；网关本地消息靠 result 事件解除
    if (el.dataset.m) pinSettleCheck()
  }

  // 回合结束检测：钉顶段出现回复文本且长度连续两轮不变（间隔 2.5s）→ 回复已结束 → 解除钉顶
  function pinSettleCheck() {
    if (pin.settleT) clearTimeout(pin.settleT)
    pin.settleT = setTimeout(() => {
      pin.settleT = null
      if (!pin.active || !pin.el || !pin.el.isConnected) return
      const key = pin.el.dataset.m
      if (!key) return
      const reply = messagesEl.querySelector(`[data-m="${key}"][data-t="a"]`)
      if (!reply) { pinSettleCheck(); return }
      const len = reply.textContent.length
      if (len === pin.lastReplyLen) pinMaybeRelease()
      else { pin.lastReplyLen = len; pinSettleCheck() }
    }, 2500)
  }

  // 重绘后同步钉顶：沿用 pin.key 定位元素并重贴 sticky；若出现更新的用户消息则切到新回合
  function syncPinAfterRender() {
    if (!pin.active) return
    let el = pin.key ? messagesEl.querySelector(`[data-m="${pin.key}"][data-t="u"]`) : null
    if (!el) {
      const users = messagesEl.querySelectorAll('.msg.user[data-t="u"]')
      el = users.length ? users[users.length - 1] : null
    }
    if (!el) { pinRelease(); return }
    const key = el.dataset.m
    if (key !== pin.key) { pin.key = key; pin.lastReplyLen = -1 }
    pin.el = el
    pin.top = pinNaturalTop()
    el.classList.add('msg-pin')
    // 本回合已出回复（读路径：SSE 刷新渲染出回复即标记）→ 允许回复撑满视口时平滑解除
    if (el.dataset.m && messagesEl.querySelector(`[data-m="${key}"][data-t="a"]`)) pin.replied = true
    if (pin.follow) pinScrollFollow()
    if (el.dataset.m) pinSettleCheck()
    // 重建后 .pin-spacer 被 messagesEl.innerHTML 覆盖清掉，按当前状态重挂动态占位
    if (pin.reserve) pinReserveApply()
  }

  // 追加到 #messages 末尾；若钉顶预留 .pin-spacer 在末尾则插到它之前（spacer 恒为最后一个元素，
  // 否则预留空白会出现在消息中间）
  function msgAppend(el) {
    messagesEl.insertBefore(el, messagesEl.querySelector('.pin-spacer'))
    return el
  }

  function appendMsg(html) {
    const div = document.createElement('div')
    div.innerHTML = html
    const el = div.firstElementChild
    el.classList.add('msg-in')
    msgAppend(el)
    scrollBottom()
  }

  function addUser(text) {
    // 新回合：清掉上一个回合的流式状态（回复消息 + 处理折叠 + 计时器）
    procStopTimer()
    cur = null
    proc = null
    const div = document.createElement('div')
    div.className = 'msg user msg-in'
    div.innerHTML = `<div class="body">${esc(text)}</div>`
    msgAppend(div)
    // 钉顶：平滑上划让该消息吸附到视口顶部，下方预留空间给回复滚动
    pinApply(div, true)
  }
  function addSystem(text) {
    appendMsg(`<div class="msg msg-system">${esc(text)}</div>`)
  }
  function addError(text) {
    appendMsg(`<div class="msg msg-system" style="color:#ef4444">${esc(text)}</div>`)
  }
  // ---- 实时处理折叠：处理中展开流式展示思考/工具 + 「正在处理」实时计时，
  //      正式回复文本发布时收起为「已处理 X」（计时定格），下面跟上回复正文 ----
  let proc = null // 当前实时 .done-fold 元素
  let procStart = 0 // 本次处理开始时间（ms）
  let procTimer = null // 计时器 id
  function procLabel(verb, dur) {
    return `<span class="d-chev">▸</span>${verb}${dur ? `<span class="d-dur"> ${dur}</span>` : ''}`
  }
  function procTick() {
    if (!proc || !proc.isConnected) { procStopTimer(); proc = null; return }
    const sum = proc.querySelector('summary')
    if (sum) sum.innerHTML = procLabel('正在处理', fmtDur(Math.round((Date.now() - procStart) / 1000)))
  }
  function procStartTimer() {
    procStopTimer()
    procTick() // 立即显示 0s，之后每秒跳字
    procTimer = setInterval(procTick, 1000)
  }
  function procStopTimer() {
    if (procTimer) { clearInterval(procTimer); procTimer = null }
  }
  function procOpen() {
    if (proc && proc.isConnected) return proc
    // 注意：思考/工具折叠展开期间**不**置 pin.replied——思考过程不是回复，不构成解除依据。
    // 折叠展开时思考内容可几屏高、baseH 可能撑满视口，若此处置位会在折叠收起后（roundFoldOpen
    // 已 false）误触发 baseH≥target 解除。replied 只由 streamText / syncPinAfterRender 在回复
    // 文本真正出现时置位，思考折叠只靠 roundFoldOpen 门控挡住展开期的解除。
    procStart = Date.now()
    proc = document.createElement('details')
    proc.className = 'done-fold done-live msg-in'
    proc.open = true
    proc.innerHTML = `<summary>${procLabel('正在处理', '0s')}</summary><div class="done-body"></div>`
    msgAppend(proc)
    scrollBottom()
    procStartTimer()
    return proc
  }
  function procClose() {
    procStopTimer()
    if (!proc || !proc.isConnected) { proc = null; return }
    const dur = fmtDur(Math.round((Date.now() - procStart) / 1000))
    const sum = proc.querySelector('summary')
    if (sum) sum.innerHTML = procLabel('已处理', dur)
    proc.open = false
    proc = null
    // 思考折叠收起：占位在展开期可能已被 baseH≥target 撤掉，立即重算补回。不能依赖后续
    // scrollBottom——用户上滑时 follow=false，scrollBottom 会提前 return 不重算，短回复期间
    // 占位就持续缺失（上划即见占位消失）。
    if (pin.active) pinReserveApply()
  }
  function procThink(text, start) {
    setChar(1) // 思考过程 → 默认形象
    const d = procOpen()
    const body = d.querySelector('.done-body')
    // start=true = 新一轮思考块开始：清掉折叠区内旧思考块，只保留当前块（对齐 CLI 实时只显示正在思考的块）
    if (start) body.querySelectorAll('.done-think').forEach((el) => el.remove())
    let th = body.lastElementChild
    if (!th || !th.classList || !th.classList.contains('done-think')) {
      th = document.createElement('div')
      th.className = 'done-think'
      body.appendChild(th)
    }
    th.appendChild(document.createTextNode(text))
    scrollBottom()
  }
  function procTool(name) {
    const d = procOpen()
    const body = d.querySelector('.done-body')
    const t = document.createElement('span')
    t.className = 'tool-line'
    t.innerHTML = `<span class="t-ico">⚙</span>${esc(name)}`
    body.appendChild(t)
    scrollBottom()
  }
  function procResult(text) {
    const d = procOpen()
    const body = d.querySelector('.done-body')
    const r = document.createElement('div')
    r.className = 'done-result'
    r.textContent = String(text || '')
    body.appendChild(r)
    scrollBottom()
  }
  function startReply() {
    // 正式回复发布：先把处理折叠收起，再开启回复消息
    procClose()
    if (!cur || !cur.isConnected) {
      const div = document.createElement('div')
      div.className = 'msg assistant msg-in'
      div.innerHTML = `<div class="body"><div class="blocks"></div></div>`
      msgAppend(div)
      scrollBottom()
      cur = div
    }
  }
  function addAssistant(text) {
    streamText(text)
  }
  function streamText(text) {
    startReply()
    setChar(1) // 正式回复输出 → 默认形象
    if (pin.active) pin.replied = true // 回复开始流式 → 撑满视口即平滑解除钉顶
    const bl = cur.querySelector('.body .blocks')
    let p = bl.querySelector('.p')
    if (!p) {
      p = document.createElement('div')
      p.className = 'p'
      bl.appendChild(p)
    }
    p.appendChild(document.createTextNode(text))
    scrollBottom()
  }
  function streamThinking(text) {
    // thinking_delta 追加：若上一个子元素不是思考块（即新思考块开始），先清旧思考块
    const last = proc && proc.isConnected ? proc.querySelector('.done-body')?.lastElementChild : null
    procThink(text, !(last && last.classList && last.classList.contains('done-think')))
  }
  function toolChip(name) {
    setChar(toolToChar(name)) // 工具调用 → 对应形象（读/搜=3、写/编=2、执行/插件/命令=4）
    procTool(name)
  }
  function addToolResult(text) {
    procResult(text)
  }
  function addThinking(text) {
    // 完成的 assistant 思考块：替换流式增量（去重）并清掉旧思考块，只留当前回合最后一个
    procThink(text, true)
  }

  function renderApproval(a) {
    let input = ''
    try { input = JSON.stringify(a.input, null, 2) } catch { input = String(a.input || '') }
    const el = appendMsg(`
      <div class="msg approval">
        <div class="appr-title"><span class="ico">⚙</span>允许使用工具：${esc(a.toolName || 'tool')}</div>
        <div class="appr-input">${esc(input)}</div>
        <div class="appr-btns">
          <button class="appr-allow">允许</button>
          <button class="appr-deny">拒绝</button>
        </div>
      </div>`)
    el.querySelector('.appr-allow').addEventListener('click', () => sendApprove(a.requestId, true))
    el.querySelector('.appr-deny').addEventListener('click', () => sendApprove(a.requestId, false))
  }

  function sendApprove(requestId, allowed) {
    if (!gws || gws.readyState !== 1) return addError('连接已断开，无法审批')
    gws.send(JSON.stringify({ type: 'approve', requestId, allowed }))
    addSystem(allowed ? '已允许该工具调用' : '已拒绝该工具调用')
  }

  function handleLine(line) {
    let m
    try { m = JSON.parse(line) } catch { return }
    const t = m.type
    if (t === 'system') {
      addSystem(m.subtype === 'init' ? '已连接 agent（session ' + (m.session_id || '') + '）' : (m.subtype || 'system'))
    } else if (t === 'assistant') {
      const content = (m.message && m.message.content) || []
      for (const c of content) {
        if (!c || typeof c !== 'object') continue
        if (c.type === 'text') addAssistant(c.text)
        else if (c.type === 'thinking') addThinking(c.thinking || c.text || '')
        else if (c.type === 'tool_use') toolChip(c.name || 'tool')
      }
    } else if (t === 'user') {
      const content = (m.message && m.message.content) || []
      const tr = content.filter((c) => c && c.type === 'tool_result')
      if (tr.length) addToolResult(tr.map((c) => (typeof c.content === 'string' ? c.content : '')).join('\n'))
    } else if (t === 'stream_event') {
      const se = m.event || {}
      if (se.type === 'content_block_delta') {
        const d = se.delta || {}
        if (d.type === 'text_delta' && d.text) streamText(d.text)
        else if (d.type === 'thinking_delta' && d.thinking) streamThinking(d.thinking)
      } else if (se.type === 'message_start') {
        const content = (((se.message || {}).content) || []).filter((c) => c && c.type === 'tool_use')
        if (content.length) toolChip(content[0].name || 'tool')
      }
    } else if (t === 'result') {
      addSystem(m.is_error ? '（回合出错）' : '（回合结束）')
      procClose()
      cur = null
      pinMaybeRelease() // 回合结束且回复填满视口 → 平滑解除钉顶；短回复保持占位
    }
  }

  function connect() {
    if (gws) { try { gws.close() } catch {} }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    gws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(gToken)}`)
    gws.onopen = () => {
      setConn(true, '已连接')
      hideGate() // 验证通过 → 解锁正式界面（输入栏平滑拉伸平移 + 侧栏/空态淡入）
      syncGwSend()
    }
    gws.onclose = () => {
      setConn(false, '未连接')
      if (gateAwait) { toast('token 错误或连接失败，请重试'); showGate() } // 门态失败：回门重输
      gws = null
      syncGwSend()
    }
    gws.onerror = () => setConn(false, '连接失败')
    gws.onmessage = (ev) => {
      let msg
      try { msg = JSON.parse(ev.data) } catch { return }
      if (msg.type === 'out') handleLine(msg.line)
      else if (msg.type === 'approval') renderApproval(msg)
      else if (msg.type === 'status') addSystem('· ' + msg.state)
      else if (msg.type === 'err') addError(msg.line)
    }
  }

  // ---- token 门（2026-08-15）：网关 token 未验证前 = 全空白锁定态，仅中间一个输入框 ----
  // 输入正确 token 回车/点发送 → connect()，WS onopen（服务端放行）→ hideGate() 解锁正式界面：
  // 输入栏从正中央平滑拉伸平移为正式输入栏（空态位），侧栏/空态 icon/消息区随之淡入。
  function showGate() {
    gateAwait = true
    document.body.classList.add('token-gate')
    inputEl.placeholder = '请输入网关 token，回车连接'
    inputEl.value = ''
    inputEl.focus()
    syncGwSend()
  }
  function hideGate() {
    gateAwait = false
    document.body.classList.remove('token-gate')
    inputEl.placeholder = '输入消息，Enter 发送'
    inputEl.value = ''
    syncGwSend()
  }
  function gateSubmit() {
    const t = inputEl.value.trim()
    if (!t) { inputEl.focus(); return }
    gToken = t
    connect()
  }

  function gwSend() {
    if (!GATEWAY) return false
    const text = inputEl.value.trim()
    if (!text) { inputEl.focus(); return true }
    if (!gws || gws.readyState !== 1) { toast('未连接，无法发送'); return true }
    if (!inputWrap.classList.contains('docked')) {
      // 先入会话态（输入栏沉底、滚动区留底边距），再追加/钉顶消息，保证钉顶位置计算基于最终布局
      inputWrap.classList.add('docked')
      chatArea.classList.add('in-session')
    }
    addUser(text)
    gws.send(JSON.stringify({ type: 'send', text }))
    inputEl.value = ''
    syncGwSend()
    return true
  }

  function syncGwSend() {
    const on = GATEWAY && gws && gws.readyState === 1 && inputEl.value.trim().length > 0
    sendBtn.classList.toggle('enabled', on)
  }

  function initGateway() {
    gatewayCss()
    // 连接状态徽章已改为 Floria 品牌名后的浅灰小字（index.html #floria-conn），不再动态建 #conn-badge。
    // 空态图标不隐藏：进会话时的隐藏由 #chat-area.in-session 的 CSS 承担，
    // 永久 display:none 会让首页图标只在网关检测完成前瞬间可见、刷新即消失。
    inputEl.disabled = false
    inputEl.placeholder = '输入消息，Enter 发送'
    inputEl.addEventListener('input', syncGwSend)
    setConn(false, '连接中…')
    if (gToken) connect()
    else showGate()
    syncGwSend()
  }

  async function detectGateway() {
    try {
      const res = await fetch('/api/health')
      if (!res.ok) return
      const d = await res.json()
      if (d.mode === 'gateway') GATEWAY = true
    } catch { /* 非网关环境（SubPj1 后端）忽略 */ }
  }

  // ---------- 启动 ----------
  ;(async () => {
    await detectGateway()
    await loadSessions()
    initLive()
    setPanel(false)
    setChar(1) // 启动默认形象
    renderRecent()
    route()
    if (GATEWAY) initGateway()
  })()
})()
