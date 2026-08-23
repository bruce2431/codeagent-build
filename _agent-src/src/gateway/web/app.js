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
    collapse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 6 15.5 12 9.5 18"/></svg>',
    folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></svg>',
    msg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8l-5 3.5V19H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 6.3"/><path d="M20 5v6h-6"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.09a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.09a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z"/></svg>',
    chip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="6.5" y="6.5" width="11" height="11" rx="2"/><path d="M9.5 3.5v3M14.5 3.5v3M9.5 17.5v3M14.5 17.5v3M3.5 9.5h3M3.5 14.5h3M17.5 9.5h3M17.5 14.5h3"/></svg>',
    // DeepSeek 鲸鱼 logo（deepseek-harness packages/client/ui-primitives/src/FishLogo.tsx，figma I39:24057 精确提取，fill=currentColor 随父级）
    whale: '<svg class="whale" viewBox="0 0 23.16 17.04" fill="none" aria-hidden="true"><path d="M22.9168 1.43018C22.6713 1.31018 22.5658 1.53918 22.4223 1.65519C22.3733 1.69269 22.3318 1.74169 22.2903 1.78669C21.9317 2.1697 21.5127 2.42121 20.9657 2.39121C20.1657 2.34621 19.4827 2.59771 18.8787 3.20973C18.7502 2.45521 18.3236 2.0047 17.6746 1.71569C17.3351 1.56568 16.9916 1.41518 16.7536 1.08867C16.5876 0.856163 16.5421 0.597155 16.4591 0.341647C16.4061 0.187643 16.3536 0.0301382 16.1761 0.00363739C15.9836 -0.0263635 15.9081 0.135141 15.8326 0.270145C15.5306 0.822162 15.4136 1.43018 15.4251 2.0462C15.4516 3.43174 16.0366 4.53527 17.1991 5.3203C17.3311 5.4103 17.3651 5.5003 17.3236 5.63181C17.2441 5.90231 17.1501 6.16482 17.0671 6.43533C17.0141 6.60784 16.9351 6.64584 16.7501 6.57033C16.1121 6.30383 15.5611 5.90931 15.074 5.4328C14.2475 4.63328 13.5 3.75075 12.568 3.05973C12.349 2.89822 12.13 2.74822 11.9034 2.60522C10.9524 1.68169 12.028 0.923165 12.277 0.833162C12.5375 0.739159 12.3675 0.41615 11.5259 0.42015C10.6844 0.42365 9.91439 0.705658 8.93286 1.08117C8.78935 1.13767 8.63835 1.17867 8.48384 1.21267C7.59332 1.04367 6.66829 1.00617 5.70226 1.11517C3.88321 1.31768 2.43016 2.1777 1.36213 3.64575C0.0790928 5.4103 -0.222916 7.41536 0.146595 9.50642C0.535106 11.7105 1.66014 13.535 3.38869 14.9616C5.18125 16.4406 7.24581 17.1657 9.60138 17.0266C11.0319 16.9441 12.6245 16.7526 14.421 15.2321C14.874 15.4576 15.3496 15.5476 16.1381 15.6151C16.7456 15.6716 17.3306 15.5851 17.7836 15.4911C18.4931 15.3411 18.4441 14.6841 18.1876 14.5636C16.1081 13.595 16.5646 13.9891 16.1496 13.67C17.2061 12.42 18.8202 10.1979 19.3182 7.17235C19.3672 6.83834 19.4297 6.36783 19.4222 6.09732C19.4182 5.93231 19.4562 5.86831 19.6447 5.84931C20.1657 5.78931 20.6712 5.64681 21.1357 5.3913C22.4833 4.65528 23.0268 3.44624 23.1548 1.9972C23.1738 1.77569 23.1508 1.54668 22.9168 1.43018ZM11.1749 14.4736C9.15936 12.889 8.18184 12.3675 7.77832 12.39C7.40081 12.4125 7.46881 12.8445 7.55182 13.126C7.63882 13.404 7.75182 13.5955 7.91033 13.8396C8.01983 14.0011 8.09533 14.2411 7.80083 14.4216C7.15181 14.8231 6.02327 14.2866 5.97027 14.2601C4.65673 13.4865 3.5587 12.4655 2.78467 11.069C2.03715 9.72493 1.60314 8.28289 1.53164 6.74384C1.51264 6.37233 1.62214 6.24082 1.99215 6.17332C2.47916 6.08332 2.98118 6.06432 3.46769 6.13582C5.52476 6.43633 7.27581 7.35586 8.74385 8.8129C9.58188 9.64243 10.2159 10.634 10.8689 11.6025C11.5634 12.631 12.3105 13.611 13.262 14.4146C13.598 14.6961 13.866 14.9101 14.1225 15.0681C13.349 15.1546 12.058 15.1731 11.1749 14.4746L11.1749 14.4736ZM12.141 8.25988C12.141 8.09488 12.273 7.96338 12.439 7.96338C12.4765 7.96338 12.5105 7.97088 12.541 7.98188C12.5825 7.99688 12.6205 8.01938 12.6505 8.05338C12.7035 8.10588 12.7335 8.18088 12.7335 8.25988C12.7335 8.42489 12.6015 8.55639 12.4355 8.55639C12.2695 8.55639 12.141 8.42489 12.141 8.25988ZM15.1415 9.79893C14.949 9.87793 14.7565 9.94544 14.5715 9.95294C14.2845 9.96794 13.9715 9.85143 13.8015 9.70893C13.5375 9.48742 13.3485 9.36342 13.2695 8.97691C13.2355 8.8119 13.2545 8.55639 13.2845 8.40989C13.3525 8.09438 13.277 7.89187 13.0545 7.70787C12.8735 7.55786 12.643 7.51636 12.39 7.51636C12.2955 7.51636 12.209 7.47486 12.1445 7.44136C12.039 7.38886 11.9519 7.25735 12.035 7.09585C12.0615 7.04335 12.19 6.91584 12.22 6.89334C12.5635 6.69784 12.9595 6.76184 13.326 6.90834C13.6655 7.04735 13.9225 7.30236 14.292 7.66287C14.6695 8.09838 14.7375 8.21838 14.9525 8.54539C15.1225 8.8009 15.277 9.06341 15.3831 9.36392C15.4471 9.55142 15.3641 9.70493 15.1415 9.79893Z" fill="currentColor"/></svg>',
    // ---- dsh 输入栏图标（2026-08-21 完全移植：deepseek-harness ui-primitives/icons 精确 path，fill=currentColor）----
    dshPlus: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8.64453 1.5V7.34961H14.5V8.65039H8.64453V14.5H7.34473V8.65039H1.5V7.34961H7.34473V1.5H8.64453Z"/></svg>',
    dshSend: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297 9.73029 1.85793 9.97949 2.10714L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577L2.70703 8.24874L1.29297 6.83468L6.02051 2.10714C6.26971 1.85793 6.51277 1.61297 6.7373 1.43233C6.97662 1.23986 7.28445 1.04402 7.6875 0.980183C7.8973 0.947006 8.1031 0.95516 8.3125 0.980183Z"/></svg>',
    dshChevDown: '<svg viewBox="0 0 14 14" fill="currentColor"><path d="M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z"/></svg>',
    dshChevRight: '<svg viewBox="0 0 14 14" fill="currentColor"><path d="M5.5 2.15137L5.92383 2.57617L8.65137 5.30273C8.90706 5.55843 9.13382 5.78438 9.29785 5.98828C9.46883 6.20088 9.61756 6.44405 9.66602 6.75C9.69222 6.91565 9.69222 7.08435 9.66602 7.25C9.61756 7.55595 9.46883 7.79912 9.29785 8.01172C9.13382 8.21561 8.90706 8.44157 8.65137 8.69727L5.92383 11.4238L5.5 11.8486L4.65137 11L5.07617 10.5762L7.80273 7.84863C8.07732 7.57405 8.24849 7.40124 8.3623 7.25977C8.46904 7.12709 8.47813 7.07728 8.48047 7.0625C8.48703 7.02105 8.48703 6.97895 8.48047 6.9375C8.47813 6.92272 8.46904 6.87291 8.3623 6.74023C8.24848 6.59876 8.07732 6.42595 7.80273 6.15137L5.07617 3.42383L4.65137 3L5.5 2.15137Z"/></svg>',
    dshCheck: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M15.0498 3.92579L8.49512 12.3818C8.25774 12.6881 8.04517 12.9645 7.84668 13.1689C7.63957 13.3823 7.38732 13.5841 7.04492 13.6719C6.86373 13.7183 6.6757 13.7346 6.48926 13.7197C6.13666 13.6915 5.8528 13.5355 5.6123 13.3604C5.38201 13.1926 5.12573 12.9567 4.83984 12.6953L1.03125 9.21289L1.96875 8.1875L5.77734 11.6699C6.08684 11.9529 6.27773 12.1249 6.43066 12.2363C6.50183 12.2882 6.54699 12.3135 6.57324 12.3252C6.58525 12.3305 6.59269 12.3322 6.5957 12.333C6.59802 12.3336 6.59961 12.334 6.59961 12.334C6.63317 12.3367 6.66758 12.3335 6.7002 12.3252C6.7002 12.3252 6.70211 12.3251 6.7041 12.3242C6.70698 12.3229 6.71348 12.319 6.72461 12.3115C6.74849 12.2956 6.78843 12.2642 6.84961 12.2012C6.98138 12.0654 7.13957 11.8628 7.39648 11.5313L13.9502 3.07422L15.0498 3.92579Z"/></svg>',
    dshWarn: '<svg viewBox="0 0 14 14" fill="currentColor"><path d="M6.3002 3.32843L7.69986 3.32843L7.69986 7.79657H6.3002L6.3002 3.32843Z"/><path d="M6.3002 9.01935H7.69986V10.6711H6.3002V9.01935Z"/><path d="M12.6328 6.99976C12.6328 3.88874 10.111 1.36694 7 1.36694C3.88899 1.36695 1.3672 3.88875 1.36719 6.99976C1.36719 10.1108 3.88899 12.6326 7 12.6326C10.111 12.6326 12.6328 10.1108 12.6328 6.99976ZM13.8582 6.99976C13.8582 10.7873 10.7876 13.8579 7 13.8579C3.21244 13.8579 0.141846 10.7873 0.141846 6.99976C0.141857 3.2122 3.21245 0.141612 7 0.141602C10.7876 0.141602 13.8581 3.21219 13.8582 6.99976Z"/></svg>',
    dshClose: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M14.1168 13.197L13.197 14.1167L1.8833 2.80303L2.80309 1.88324L14.1168 13.197Z"/><path d="M13.197 1.88326L14.1168 2.80305L2.80309 14.1168L1.8833 13.197L13.197 1.88326Z"/></svg>',
  }

  // ---------- 管理视图数据源（2026-08-15 起接后端 /api/plugins：真实已安装插件/技能 + 官方市场） ----------
  // 结构镜像后端返回：{ plugins:{personal,public}, skills:{personal,public} }，每项 {n, d, v, inst}。
  // 首次进入管理视图 fetch，刷新按钮 force 重新拉取；失败显示错误 + 重试（不回落假数据）。
  let MGR = null
  let MGR_LOADING = false
  let MGR_ERR = ''
  async function loadMgrData(force) {
    if (MGR && !force) return MGR
    if (needToken()) return null // token 门锁定态：不发起数据请求（hideGate 解锁后刷新）
    MGR_LOADING = true
    MGR_ERR = ''
    renderMgrGrid()
    try {
      const res = await fetch(apiUrl('/api/plugins'))
      const data = await res.json()
      if (!data || !data.plugins || !data.skills) throw new Error(data.error || 'bad response')
      MGR = data
    } catch (e) {
      MGR_ERR = e.message || String(e)
    } finally {
      MGR_LOADING = false
      renderMgrGrid()
    }
    return MGR
  }
  // 模型配置数据源（/api/models：便携根 settings.json 的 model + 模型类环境变量；只读展示）
  let MODELS = null
  let MODELS_LOADING = false
  let MODELS_ERR = ''
  async function loadModelsData(force) {
    if (MODELS && !force) return MODELS
    if (needToken()) return null // token 门锁定态：不发起数据请求
    MODELS_LOADING = true
    MODELS_ERR = ''
    renderMgrModels()
    try {
      const res = await fetch(apiUrl('/api/models'))
      const data = await res.json()
      if (!data || !('model' in data)) throw new Error(data.error || 'bad response')
      MODELS = data
      // 与凭据池真实状态对齐（CLI 同源）：model 优先 activeModel，provider=activeProvider，effortLevel=settings.effortLevel
      MODEL_CUR = {
        provider: data.activeProvider || MODEL_CUR.provider,
        model: data.activeModel || (data.model ? String(data.model) : MODEL_CUR.model),
        effortLevel: data.effortLevel != null ? String(data.effortLevel) : undefined,
      }
    } catch (e) {
      MODELS_ERR = e.message || String(e)
    } finally {
      MODELS_LOADING = false
      renderMgrModels()
    }
    return MODELS
  }
  const MGR_PALETTE = ['#5b8ff9', '#61a1c2', '#7b6bd6', '#5aa57a', '#d98a4a', '#c96a6a', '#4aa3a0', '#a06ba8', '#6b8f71', '#b48a5a']
  function mgrColor(n) {
    let h = 0
    for (const c of n) h = (h * 31 + c.charCodeAt(0)) >>> 0
    return MGR_PALETTE[h % MGR_PALETTE.length]
  }

  // ---------- 元素 ----------
  const chatArea = $('chat-area')
  const messagesEl = $('messages')
  const inputWrap = $('input-wrap')
  const liveChangeEl = $('live-change')
  const inputEl = $('input')
  const inputBarEl = $('input-bar')
  const sendBtn = $('send-btn')
  const ctxMeterEl = $('ctx-meter')
  const ctxBtnEl = $('ctx-btn')
  const ctxPanelEl = $('ctx-panel')
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
  const state = { mode: 'list', pt: 'projects', panelOpen: false, folded: false, currentHash: null, mgr: null, preview: null, mgrView: { kind: 'plugins', cat: 'public', q: '' } }

  // 界面状态持久化（2026-08-16）：管理视图内部状态（mgrView：插件/技能切换、公开/个人、搜索词）
  // 存 localStorage，刷新后由 route 的 mgr 分支 loadMgrView 恢复——配合 hash 路由 #mgr/<kind>/#preview/<label>
  // 实现「刷新保持当前界面」（会话/管理/预览三态均可恢复，不再回退初始界面）。
  const UI_KEY = 'floria-ui-v1'
  function saveMgrView() {
    try { localStorage.setItem(UI_KEY, JSON.stringify({ mgrView: state.mgrView })) } catch { /* 存储不可用忽略 */ }
  }
  function loadMgrView() {
    try {
      const raw = localStorage.getItem(UI_KEY)
      if (!raw) return
      const d = JSON.parse(raw)
      if (d && d.mgrView) state.mgrView = { ...state.mgrView, ...d.mgrView }
    } catch { /* 忽略 */ }
  }
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
    // @ 提及令牌 → chip（[插件:名称] / [会话:名称]，名称已转义）。
    // ⚠️ 必须在行内代码还原（下一行）之前替换：行内代码 `[插件:X]` 已抽成占位符 \u0000N\u0000，
    // 令牌替换命中不到代码内文本，避免 chip 嵌套进 <code>（白胶囊+灰代码气泡叠一起）。
    s = s.replace(MENTION_PLUGIN_RE, (_, n) => mentionChipHtml('plugin', n))
         .replace(MENTION_SESSION_RE, (_, n) => mentionChipHtml('session', n))
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
    if (needToken()) return // token 门锁定态：不发请求（hideGate 解锁后刷新）
    try {
      const res = await fetch(apiUrl('/api/sessions'))
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
    if (needToken()) return { messages: [], context: null } // token 门锁定态
    const res = await fetch(apiUrl('/api/session?id=' + encodeURIComponent(sessionId)))
    const data = await res.json()
    if (!Array.isArray(data.messages)) throw new Error(data.error || 'bad response')
    // CLI 已按「复用已有实现」原则导出过滤后的会话展示（display，见 conversationDisplay.ts /
    // 网关 /api/session 注入）→ 存在时优先消费（thinking 过滤 / 真实用户消息识别由 CLI 权威完成），
    // 尚未导出（如网关重启后 CLI 未重发）时回退后端原始消息映射。
    // context = 网关 readSession 提取的上下文占用（dsh ContextMeter 数据源），无则 null。
    return { messages: data.display || data.messages, context: data.context || null }
  }

  // ---------- 实时同步（阶段1：SSE 监听 jsonl 变化，自动刷新会话/列表）----------
  // 兼容：刷新只替换 messagesEl 内层，折叠开合（含网关实时折叠）与滚动位置尽量保留；
  // 只读视图下最后一段「处理中（尚无回复）」的已处理折叠默认展开，回复落地后自动收起。
  function initLive() {
    if (!('EventSource' in window)) return
    if (needToken()) return // token 门锁定态：不建 SSE（避免 401 重连刷屏，hideGate 解锁后再建）
    try { live.es = new EventSource(apiUrl('/api/events')) } catch { return }
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
      if (needToken()) return // token 门锁定态
      try {
        const res = await fetch(apiUrl('/api/sessions'))
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
        const { messages, context } = await fetchMessages(s.id)
        renderCtxMeter(context)
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
        if (pendingAskInput) showTakeover(questionCardHtml(pendingAskInput, null), 'ask')
        else clearTakeover()
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
      sum.innerHTML = `<span class="d-chev">${CHEV}</span><span class="df-dot"></span>正在处理<span class="d-dur"> ${fmtDur(sec)}</span>`
    }
    tick()
    liveFoldTimer = setInterval(tick, 1000)
  }

  // ---------- 路由 ----------
  function parseRoute() {
    const raw = location.hash.replace(/^#\/?/, '')
    if (!raw) return { name: 'home' }
    // 管理视图 / 项目预览进入 hash 路由（2026-08-16）：刷新后恢复当前界面而非回到初始界面。
    // 会话 UUID 不会以 mgr//preview/ 开头，前缀判定安全。
    if (raw.startsWith('mgr/')) return { name: 'mgr', mgr: raw.slice(4) }
    if (raw.startsWith('preview/')) return { name: 'preview', label: decodeURIComponent(raw.slice(8)) }
    return { name: 'session', hash: decodeURIComponent(raw) }
  }

  function route() {
    closeMentionPop()
    liveChangeReset() // 2026-08-19：导航（首页/会话/管理/预览切换）收起变更胶囊
    const r = parseRoute()
    // 任何导航（route 被调用）→ 退出管理视图；管理视图只由 mgr-tab 点击直接 renderMgr 进入，不走 route
    state.mgr = null
    state.preview = null
    syncMgrTabs()
    renderRecent()
    if (r.name === 'home') renderHome()
    else if (r.name === 'mgr') { state.mgr = r.mgr; loadMgrView(); renderMgr() }
    else if (r.name === 'preview') { state.preview = r.label; openProjectPreview(r.label, true) }
    else renderSession(r.hash)
  }

  // 同步管理 tab 高亮（route/renderRecent 前调用）
  function syncMgrTabs() {
    document.querySelectorAll('.mgr-tab').forEach((x) => x.classList.toggle('on', x.dataset.mgr === state.mgr))
  }

  function navigate(hash) {
    if (location.hash === hash) return route()
    location.hash = hash
  }

  // 2026-08-18 按 SubPj3 实现：空态输入栏挂 #empty-hint .g-stage 内真相对定位（top=台面 76.75%−26px），
  // 会话态移回 #chat-area 沉底。界面切换时移动 DOM，保证定位基准正确且 transition 平滑。
  const emptyStageEl = () => document.querySelector('#empty-hint .g-stage')
  function mountInput(where) {
    const target = where === 'stage' ? emptyStageEl() : chatArea
    if (target && inputWrap.parentNode !== target) target.appendChild(inputWrap)
  }

  function renderHome() {
    stopLiveFoldTimer()
    pinRelease()
    clearTakeover() // 导航离开：清掉残留的提问/审批 takeover（输入栏恢复）
    state.currentHash = null
    messagesEl.innerHTML = ''
    setChar(1) // 首页空态 → 默认形象
    renderCtxMeter(null) // 首页空态 → 隐藏上下文环
    inputWrap.classList.remove('docked')
    chatArea.classList.remove('in-session')
    chatArea.classList.remove('mgr-on')
    mountInput('stage')
  }

  function renderSession(hash) {
    stopLiveFoldTimer()
    pinRelease()
    clearTakeover() // 切换会话：清掉残留的提问/审批 takeover（输入栏恢复）
    chatArea.classList.remove('mgr-on')
    mountInput('chat') // 输入栏移回 #chat-area 沉底
    const s = findSession(hash)
    state.currentHash = hash
    if (!s) {
      messagesEl.innerHTML = '<div class="msg msg-system">会话不存在或已删除</div>'
      renderCtxMeter(null) // 无会话数据 → 隐藏上下文环
      inputWrap.classList.add('docked')
      chatArea.classList.add('in-session')
      return
    }
    messagesEl.innerHTML = '<div class="msg msg-system">加载中…</div>'
    setChar(1) // 加载中 → 默认形象
    inputWrap.classList.add('docked')
    chatArea.classList.add('in-session')
    fetchMessages(s.id)
      .then(({ messages, context }) => {
        if (state.currentHash !== hash) return
        renderCtxMeter(context)
        messagesEl.innerHTML = messagesHtml(messages)
        if (pendingAskInput) showTakeover(questionCardHtml(pendingAskInput, null), 'ask')
        else clearTakeover()
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
    AskUserQuestion: '提问',
  }
  // 工具块元信息：英文名 + 中文动作 + 详情（命令/路径/搜索词等）
  function toolMeta(block) {
    const name = block.name || 'tool'
    const zh = TOOL_NAMES[name] || name
    const inp = block.input && typeof block.input === 'object' ? block.input : null
    const detail = inp ? (inp.file_path || inp.filePath || inp.query || inp.pattern || inp.command || inp.toolName || inp.path || '') : ''
    return { name, zh, detail: typeof detail === 'string' && detail ? String(detail).slice(0, 70) : '' }
  }
  function toolLine(block) {
    const t = toolMeta(block)
    return `<span class="tool-line" data-name="${esc(t.name)}"><span class="t-ico">${toolIcon(t.name)}</span>${esc(t.zh)}${t.detail ? ' · ' + esc(t.detail) : ''}</span>`
  }

  // ---- AskUserQuestion 提问卡（2026-08-21 移植 DSH QuestionComposer 视觉，只读展示）----
  // eyebrow + 标题 + 编号选项行（label/推荐徽标/描述）+ 答案注脚；
  // 答案来自后续 tool_result 文本吸附标记（parseRecommendedLabel 后缀剥离对齐 DSH）。
  function questionCardHtml(inp, answerText) {
    const q = (inp && typeof inp === 'object') ? inp : {}
    // CLI AskUserQuestion 上报 input 为 {questions:[{question,header,multiSelect,options[]}]}（数组，支持多问题）；
    // 兼容旧单问题 {question, options} 结构（无 questions 数组时把 q 当单个问题处理）。
    const list = (Array.isArray(q.questions) && q.questions.length) ? q.questions : [q]
    return list.map((qq) => {
      const question = String(qq.question || '').trim()
      const options = Array.isArray(qq.options) ? qq.options : []
      const header = String(qq.header || q.header || '提问')
      let rows = ''
      options.forEach((o, i) => {
        const label = (o && typeof o === 'object') ? String(o.label || '') : String(o || '')
        const desc = (o && typeof o === 'object' && o.description) ? String(o.description) : ''
        const m = /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/i.exec(label)
        const plain = m ? label.slice(0, m.index) : label
        const rec = !!m
        const sel = answerText != null && (answerText.includes(label) || (plain && answerText.includes(plain)))
        rows += `<div class="q-option${sel ? ' sel' : ''}"><span class="q-num">${i + 1}</span><span class="q-copy"><span class="q-line"><span class="q-label">${esc(plain)}</span>${rec ? '<span class="q-badge">推荐</span>' : ''}</span>${desc ? `<span class="q-desc">${esc(desc)}</span>` : ''}</span>${sel ? `<span class="q-check">${I.dshCheck}</span>` : ''}</div>`
      })
      const ans = answerText != null ? String(answerText).slice(0, 200) : ''
      return `<div class="question-card"><div class="q-head">${esc(header)}</div><div class="q-title">${esc(question)}</div><div class="q-options">${rows}</div>${answerText != null ? `<div class="q-ans">已选择：${esc(ans)}</div>` : '<div class="q-ans pending">等待回答…</div>'}</div>`
    }).join('')
  }
  // 提问在消息流里的紧凑行（DSH 工具行语义）：icon + 「提问」+ 状态（等待回答 / 已回答）
  function askLineHtml(answered) {
    return `<span class="tool-line" data-name="AskUserQuestion"><span class="t-ico">${toolIcon('AskUserQuestion')}</span>提问 · ${answered ? '已回答' : '等待回答'}</span>`
  }
  // 工具类型 → 概括短语（连续工具折叠的 summary 标签）
  const TOOL_VERB = {
    Read: '阅读了文件', Glob: '查找了文件', Grep: '搜索了代码',
    Bash: '运行了命令', WebFetch: '查看了网页', WebSearch: '搜索了网页',
    Edit: '编辑了文件', Write: '写入文件', NotebookEdit: '编辑了文件',
    Agent: '委派了子代理', Skill: '调用了技能', TodoWrite: '更新了待办',
    TaskCreate: '创建了任务', TaskUpdate: '更新了任务', TaskGet: '查询了任务',
    AskUserQuestion: '提出了问题',
  }
  // 一组工具的概括标签：去重保序 + 「、」/「并」连接，如「编辑了文件并运行了命令（3）」
  function toolFoldLabel(tools) {
    const verbs = []
    for (const t of tools) {
      const v = TOOL_VERB[t.name] || t.zh || '调用了工具'
      if (!verbs.includes(v)) verbs.push(v)
    }
    const label = verbs.length <= 1 ? (verbs[0] || '调用了工具') : verbs.slice(0, -1).join('、') + '并' + verbs[verbs.length - 1]
    return `${label}（${tools.length}）`
  }
  // 把段内 items（think/text/note/tool 对象）渲染为 done-body 内部 HTML：
  // 连续 tool 合并成一个可展开折叠（默认收起省空间），思考/旁白原位穿插显示（与动作关联）
  function groupTools(items) {
    let html = ''
    let group = []
    const flush = () => {
      if (!group.length) return
      const rows = group.map((g) => g.html).join('')
      const running = group.some((g) => g.running)
      html += `<details class="tool-fold"${running ? ' data-state="running"' : ''}><summary><span class="d-chev">${CHEV}</span>${running ? '<span class="tf-dot"></span>' : ''}<span class="tf-label">${esc(toolFoldLabel(group))}</span></summary><div class="tool-fold-body">${rows}</div></details>`
      group = []
    }
    for (const it of items) {
      if (!it || !it.html) continue // 占位/置空的块（reply 占位、被过滤的思考）
      if (it.kind === 'tool') { group.push(it); continue }
      flush()
      html += it.html
    }
    flush()
    return html
  }

  // ---- 文件变更汇总卡片（Codex 风格：+N 绿 / -N 红）----
  // 数据源：源码 Edit/Write 工具在 tool_result 文本末尾追加真实增删行数 `(+N -M)`，
  // 前端从文本解析出 {file, added, removed}，按段聚合去重，回合/段结束时渲染圆角卡片。
  function baseName(p) {
    const s = String(p || '').replace(/\\/g, '/')
    return s.split('/').pop() || s
  }
  // 从 tool_result 文本提取文件路径与增删行数（Edit/Write 统一格式）
  function parseFileChange(text) {
    if (!text) return null
    const t = String(text).trim()
    const m = /\([+-](\d+)\s*[+-](\d+)\)\s*\.?\s*$/.exec(t)
    if (!m) return null
    let path = null
    const fm = /The file\s+(.+?)\s+has been updated/.exec(t)
    if (fm) path = fm[1]
    else {
      const cm = /File created successfully at:\s+(.+?)\s*\(/.exec(t)
      if (cm) path = cm[1]
    }
    if (!path) return null
    return { path: path.trim(), added: Number(m[1]), removed: Number(m[2]) }
  }
  function mergeChanges(map, fc) {
    const prev = map.get(fc.path)
    map.set(fc.path, prev ? { added: prev.added + fc.added, removed: prev.removed + fc.removed } : { added: fc.added, removed: fc.removed })
  }
  function renderChangeCardHtml(changes) {
    if (!changes || !changes.size) return ''
    let totalAdd = 0, totalDel = 0
    let rows = ''
    for (const [path, c] of changes) {
      totalAdd += c.added
      totalDel += c.removed
      rows += `<div class="ch-row"><span class="ch-file">${esc(baseName(path))}</span><span class="ch-add">+${c.added}</span><span class="ch-del">-${c.removed}</span></div>`
    }
    // 2026-08-19 默认折叠：卡片落地即为收起姿态（标题行 + ▸），点右上角展开文件列表
    return `<div class="msg change-card collapsed"><div class="ch-title"><span class="ch-count">${changes.size}个文件已更改</span><span class="ch-add">+${totalAdd}</span><span class="ch-del">-${totalDel}</span><button class="ch-toggle" title="收起/展开文件列表">${CHEV}</button></div><div class="ch-list">${rows}</div></div>`
  }

  // ---- 文件变更胶囊（2026-08-19）：回合运行中在输入栏中央上方悬浮小胶囊，回合结束 FLIP 平滑变形进消息流 ----
  function liveChangeReset() {
    liveChanges = new Map()
    if (liveChangeEl) {
      liveChangeEl.hidden = true
      liveChangeEl.classList.remove('has')
      liveChangeEl.innerHTML = ''
    }
  }
  // tool_result 有真实文件变更 → 更新/浮现胶囊（N个文件已更改 +N -M，约整卡 1/5 宽）
  function updateLiveChangeCapsule() {
    if (!liveChanges || !liveChanges.size) return
    if (!liveChangeEl) return
    let add = 0, del = 0
    for (const c of liveChanges.values()) { add += c.added; del += c.removed }
    liveChangeEl.innerHTML =
      `<span class="lc-n">${liveChanges.size}个文件已更改</span><span class="ch-add">+${add}</span><span class="ch-del">-${del}</span>`
    if (liveChangeEl.hidden) {
      liveChangeEl.hidden = false
      void liveChangeEl.offsetWidth // 强制 reflow → opacity 过渡生效（淡入）
      liveChangeEl.classList.add('has')
    }
  }
  // 回合结束：胶囊 FLIP 平滑变形进消息流末尾，落地为默认折叠的汇总卡片。
  // 步骤：记录胶囊视口矩形 → 消息流内建卡片（先 visibility:hidden 占位）→ 吸底 → 测卡片矩形 →
  // 反演变换（translate+scale 到胶囊位/大小，top-left 锚定）→ 过渡回自然位 = 从胶囊形态长成卡片。
  function commitLiveChangeCard() {
    if (!liveChanges || !liveChanges.size) return
    const html = renderChangeCardHtml(liveChanges)
    const wrap = document.createElement('div')
    wrap.innerHTML = html
    const card = wrap.firstElementChild
    const capRect = liveChangeEl && !liveChangeEl.hidden ? liveChangeEl.getBoundingClientRect() : null
    liveChangeReset() // 隐藏胶囊 + 清空本回合聚合
    if (!card) return
    card.style.transformOrigin = 'top left'
    if (!capRect) {
      msgAppend(card)
      scrollBottom()
      return
    }
    card.style.visibility = 'hidden'
    msgAppend(card)
    scrollBottom()
    const cardRect = card.getBoundingClientRect()
    const dx = capRect.left - cardRect.left
    const dy = capRect.top - cardRect.top
    const sx = cardRect.width ? capRect.width / cardRect.width : 1
    const sy = cardRect.height ? capRect.height / cardRect.height : 1
    card.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`
    card.style.visibility = 'visible'
    void card.offsetWidth // 强制 reflow：让反演态成为过渡起点
    card.style.transition = 'transform 0.45s cubic-bezier(0.22, 0.61, 0.36, 1)'
    card.style.transform = 'none'
  }
  // 卡片右上角隐藏按钮：点击切换列表收起/展开（事件委托，innerHTML 重建不受影响）
  document.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('.ch-toggle') : null
    if (!btn || !messagesEl.contains(btn)) return
    const card = btn.closest('.change-card')
    if (!card) return
    const collapsed = card.classList.toggle('collapsed')
    btn.innerHTML = CHEV
    btn.classList.toggle('open', !collapsed)
  })

  // 消息复制（DSH MessageIconActions copy 语义）：取消息纯文本（剔除已处理折叠/变更卡/操作行/工具折叠），
  // writeClipboard 成功 → 图标换 check 1s（DSH 同款反馈窗口），失败 toast
  function messageCopyText(msgEl) {
    const clone = msgEl.cloneNode(true)
    clone.querySelectorAll('.done-fold, .change-card, .msg-actions, .tool-fold, .mention-x, script, style').forEach((el) => el.remove())
    return (clone.textContent || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  }
  document.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('.msg-copy') : null
    if (!btn || !messagesEl.contains(btn) || btn.classList.contains('copied')) return
    const msgEl = btn.closest('.msg')
    if (!msgEl) return
    const text = messageCopyText(msgEl)
    if (!text) return
    writeClipboard(text).then((ok) => {
      if (!ok) { toast('复制失败'); return }
      btn.classList.add('copied')
      btn.innerHTML = I.dshCheck
      btn.title = '已复制'
      btn.setAttribute('aria-label', '已复制')
      setTimeout(() => {
        if (!btn.isConnected) return
        btn.classList.remove('copied')
        btn.innerHTML = ICON_COPY
        btn.title = '复制'
        btn.setAttribute('aria-label', '复制')
      }, 1000)
    })
  })

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

  // ---- 思考折叠行（2026-08-22 移植 deepseek-harness ReasoningRow / DisclosureRow）----
  // 每个思考块 = 一条可展开折叠行：14px 思考图标 + 「思考」标题 + 2×2 圆点 + 摘要
  // （已结束=首行 / 运行中=末行实时跟随），展开正文 14/24 弱化色、左缩进 22px，运行中扫光动画。
  // 图标 path 精确取自 deepseek-harness packages/client/ui-primitives/src/icons/index.tsx
  // （IconThinkOutline14 / IconChevronDownOutline14，fill=currentColor 随父级）。
  const THINK_ICON = '<svg viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M7.06431 5.93342C7.68763 5.93342 8.19307 6.43904 8.19322 7.06233C8.19322 7.68573 7.68772 8.19123 7.06431 8.19123C6.44099 8.19113 5.9354 7.68567 5.9354 7.06233C5.93555 6.43911 6.44108 5.93353 7.06431 5.93342Z" fill="currentColor"/><path fill-rule="evenodd" clip-rule="evenodd" d="M8.6815 0.963693C10.1169 0.447019 11.6266 0.374829 12.5633 1.31135C13.5 2.24805 13.4277 3.75776 12.911 5.19319C12.7126 5.74431 12.4386 6.31796 12.0965 6.89729C12.4969 7.54638 12.8141 8.19018 13.036 8.80647C13.5527 10.2419 13.6251 11.7516 12.6883 12.6883C11.7516 13.625 10.242 13.5527 8.8065 13.036C8.19022 12.8141 7.54641 12.4969 6.89732 12.0965C6.31797 12.4386 5.74435 12.7125 5.19322 12.911C3.75777 13.4276 2.2481 13.5 1.31138 12.5633C0.374859 11.6266 0.447049 10.1168 0.963724 8.68147C1.17185 8.10338 1.46321 7.50063 1.82896 6.8924C1.52182 6.35711 1.27235 5.82825 1.08872 5.31819C0.572068 3.88278 0.499714 2.37306 1.43638 1.43635C2.37308 0.499655 3.8828 0.572044 5.31822 1.08869C5.82828 1.27232 6.35715 1.5218 6.89243 1.82893C7.50066 1.46318 8.10341 1.17181 8.6815 0.963693ZM11.3573 8.01154C10.9083 8.62253 10.3901 9.22873 9.80943 9.8094C9.22877 10.3901 8.62255 10.9083 8.01158 11.3572C8.4257 11.5841 8.8287 11.7688 9.21275 11.9071C10.5456 12.3868 11.4246 12.2547 11.8397 11.8397C12.2548 11.4246 12.3869 10.5456 11.9071 9.21272C11.7688 8.82866 11.5841 8.42568 11.3573 8.01154ZM2.56529 8.02912C2.37344 8.39322 2.21495 8.74796 2.09263 9.08772C1.61291 10.4204 1.74512 11.2995 2.16001 11.7147C2.57505 12.1297 3.45415 12.2618 4.78697 11.7821C5.11057 11.6656 5.44786 11.5164 5.7938 11.3367C5.249 10.9223 4.70922 10.4533 4.19029 9.9344C3.57578 9.31987 3.03169 8.67633 2.56529 8.02912ZM6.90708 3.2469C6.24065 3.70479 5.5646 4.26321 4.91392 4.91389C4.26325 5.56456 3.70482 6.24063 3.24693 6.90705C3.72674 7.63325 4.32777 8.37459 5.03892 9.08576C5.64943 9.69627 6.28183 10.2265 6.90806 10.6678C7.59368 10.2025 8.2908 9.63076 8.96079 8.96076C9.6308 8.29075 10.2025 7.59366 10.6678 6.90803C10.2265 6.2818 9.69631 5.6494 9.08579 5.03889C8.37462 4.32773 7.63328 3.72672 6.90708 3.2469ZM11.7147 2.15998C11.2996 1.74509 10.4204 1.61288 9.08775 2.0926C8.74835 2.21479 8.39382 2.37271 8.03013 2.56428C8.67728 3.03065 9.31995 3.5758 9.93443 4.19026C10.4534 4.7092 10.9223 5.24896 11.3368 5.79377C11.5164 5.44785 11.6656 5.11052 11.7821 4.78694C12.2618 3.45416 12.1297 2.57502 11.7147 2.15998ZM4.91197 2.2176C3.57922 1.73788 2.70004 1.86995 2.28501 2.28498C1.87001 2.70003 1.73791 3.5792 2.21763 4.91194C2.31709 5.18822 2.44112 5.47427 2.58677 5.7674C3.01931 5.1887 3.51474 4.6158 4.06529 4.06526C4.61584 3.5147 5.18872 3.01928 5.76743 2.58674C5.47431 2.4411 5.18824 2.31706 4.91197 2.2176Z" fill="currentColor"/></svg>'
  const THINK_CHEV = '<svg viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z" fill="currentColor"/></svg>'
  // ---- 折叠 chevron（DSH IconChevronRightOutline14，「>」箭头，替换旧 ▸ 小三角）----
  const CHEV = '<svg viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M5.5 2.15137L5.92383 2.57617L8.65137 5.30273C8.90706 5.55843 9.13382 5.78438 9.29785 5.98828C9.46883 6.20088 9.61756 6.44405 9.66602 6.75C9.69222 6.91565 9.69222 7.08435 9.66602 7.25C9.61756 7.55595 9.46883 7.79912 9.29785 8.01172C9.13382 8.21561 8.90706 8.44157 8.65137 8.69727L5.92383 11.4238L5.5 11.8486L4.65137 11L5.07617 10.5762L7.80273 7.84863C8.07732 7.57405 8.24849 7.40124 8.3623 7.25977C8.46904 7.12709 8.47813 7.07728 8.48047 7.0625C8.48703 7.02105 8.48703 6.97895 8.48047 6.9375C8.47813 6.92272 8.46904 6.87291 8.3623 6.74023C8.24848 6.59876 8.07732 6.42595 7.80273 6.15137L5.07617 3.42383L4.65137 3L5.5 2.15137Z" fill="currentColor"/></svg>'

  // ---- 工具步骤图标（2026-08-21 移植 deepseek-harness ui-tool 的 variant leading 映射，
  // path 精确取自 ui-primitives/icons/index.tsx，fill=currentColor 随父级；替代旧 ⚙ 齿轮）----
  const ICON_BROWSE = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M11.2426 4.80473V6.10551H4.75819V4.80473H11.2426Z" fill="currentColor"/><path d="M9.40858 7.84478V9.14557H4.75819V7.84478H9.40858Z" fill="currentColor"/><path d="M9.23438 0.546389C10.1941 0.546389 10.9683 0.544914 11.5859 0.611819C12.2161 0.680096 12.7634 0.825745 13.2393 1.17139C13.5172 1.3733 13.7619 1.61812 13.9639 1.896C14.3096 2.37183 14.4551 2.91922 14.5234 3.54932C14.5903 4.16686 14.5889 4.94133 14.5889 5.90088V10.0981C14.5889 11.0576 14.5903 11.8321 14.5234 12.4497C14.4552 13.0798 14.3094 13.6272 13.9639 14.103C13.7619 14.381 13.5172 14.6257 13.2393 14.8276C12.7633 15.1734 12.2163 15.3189 11.5859 15.3872C10.9683 15.4541 10.1942 15.4536 9.23438 15.4536H6.76563C5.80591 15.4536 5.03168 15.4541 4.41407 15.3872C3.78385 15.3189 3.23665 15.1734 2.76074 14.8276C2.48291 14.6257 2.23802 14.3809 2.03614 14.103C1.69066 13.6272 1.54483 13.0798 1.47657 12.4497C1.40973 11.8321 1.41114 11.0576 1.41114 10.0981V5.90088C1.41113 4.94132 1.40966 4.16686 1.47657 3.54932C1.54488 2.91921 1.69042 2.37184 2.03614 1.896C2.2381 1.61807 2.4828 1.37333 2.76074 1.17139C3.23665 0.825682 3.78386 0.680109 4.41407 0.611819C5.03168 0.544905 5.80591 0.546389 6.76563 0.546389H9.23438ZM6.76563 1.896C5.77586 1.896 5.0876 1.89738 4.55957 1.95459C4.0443 2.01043 3.76214 2.11349 3.55469 2.26416C3.39135 2.38284 3.24761 2.52662 3.12891 2.68994C2.97821 2.89736 2.8752 3.17967 2.81934 3.69483C2.76214 4.22279 2.76075 4.91131 2.76074 5.90088V10.0981C2.76074 11.0876 2.76221 11.7762 2.81934 12.3042C2.87516 12.8194 2.97829 13.1026 3.12891 13.3101C3.24754 13.4733 3.39147 13.6172 3.55469 13.7358C3.76213 13.8865 4.04438 13.9896 4.55957 14.0454C5.0876 14.1026 5.77586 14.103 6.76563 14.103H9.23438C10.2242 14.103 10.9124 14.1026 11.4404 14.0454C11.9556 13.9896 12.2379 13.8865 12.4453 13.7358C12.6086 13.6172 12.7525 13.4733 12.8711 13.3101C13.0217 13.1026 13.1248 12.8195 13.1807 12.3042C13.2378 11.7762 13.2393 11.0876 13.2393 10.0981V5.90088C13.2393 4.91131 13.2379 4.22279 13.1807 3.69483C13.1248 3.17969 13.0218 2.89736 12.8711 2.68994C12.7524 2.52667 12.6086 2.38281 12.4453 2.26416C12.2379 2.11355 11.9556 2.01041 11.4404 1.95459C10.9124 1.8974 10.2241 1.896 9.23438 1.896H6.76563Z" fill="currentColor"/></svg>'
  const ICON_EDIT = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M9.94076 1.34942C10.7047 0.90231 11.6503 0.902415 12.4143 1.34942C12.7061 1.52015 12.9688 1.79118 13.3104 2.13284C13.6521 2.47448 13.9231 2.73721 14.0939 3.02894C14.5408 3.79294 14.5409 4.73856 14.0939 5.50251C13.9231 5.79415 13.652 6.05704 13.3104 6.39861L6.65932 13.0497C6.28068 13.4284 6.00695 13.7108 5.66543 13.9097C5.32391 14.1085 4.94315 14.2074 4.42705 14.3498L3.24394 14.6761C2.77527 14.8054 2.34538 14.9262 2.00131 14.9684C1.65196 15.0112 1.17964 15.0013 0.810764 14.6325C0.441921 14.2637 0.432107 13.7913 0.47486 13.442C0.517035 13.0979 0.6379 12.668 0.767181 12.1993L1.09352 11.0162C1.23588 10.5001 1.33481 10.1193 1.5336 9.77784C1.7325 9.43632 2.0149 9.1626 2.39355 8.78395L9.04466 2.13284C9.38625 1.79126 9.64911 1.52016 9.94076 1.34942ZM15.5427 14.8398H7.55223L8.96707 13.425H15.5427V14.8398ZM3.39382 9.78422C2.965 10.213 2.84244 10.3436 2.75709 10.49C2.67183 10.6366 2.61862 10.8079 2.45733 11.3925L2.13099 12.5756C2.00183 13.0439 1.92194 13.3419 1.88863 13.5536C2.10041 13.5204 2.39872 13.4416 2.86764 13.3123L4.05075 12.9859C4.63544 12.8246 4.80669 12.7715 4.95323 12.6862C5.09968 12.6008 5.23022 12.4783 5.65905 12.0494L10.721 6.98644L8.45577 4.72121L3.39382 9.78422ZM11.7 2.57079C11.3774 2.38198 10.9777 2.38198 10.6551 2.57079C10.5602 2.62647 10.4487 2.72931 10.0449 3.13311L9.45604 3.72094L11.7213 5.98617L12.3102 5.39833C12.7139 4.99457 12.8168 4.88307 12.8725 4.78818C13.0613 4.46561 13.0612 4.06585 12.8725 3.74326C12.8169 3.64827 12.7146 3.53752 12.3102 3.13311C11.9057 2.72863 11.795 2.6264 11.7 2.57079Z" fill="currentColor"/></svg>'
  const ICON_SEARCH = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M11.894845 6.647401C11.894845 3.725463 9.534486 1.356779 6.623219 1.35657C3.711786 1.35657 1.351635 3.725338 1.351635 6.647401C1.351843 9.569296 3.711911 11.938273 6.623219 11.938273C9.534361 11.938064 11.894637 9.569171 11.894845 6.647401ZM13.245462 6.647401C13.245254 10.317935 10.280401 13.293613 6.623219 13.293821C2.965871 13.293821 0.000204 10.31806 0 6.647401C0 2.976574 2.965746 0 6.623219 0C10.280526 0.000205 13.245462 2.9767 13.245462 6.647401Z" fill="currentColor"/><path d="M16.000417 15.041079L15.044449 16.000433L11.530434 12.473588L12.486298 11.514234L16.000417 15.041079Z" fill="currentColor"/></svg>'
  const ICON_API = '<svg viewBox="0 0 14 14" fill="none" aria-hidden="true"><path transform="translate(0.6689 1.073)" d="M11.4818 5.57813C11.4818 4.45301 11.4807 3.66237 11.4075 3.05908C11.3359 2.46953 11.2024 2.13852 10.9939 1.89441C10.9247 1.81341 10.8493 1.73801 10.7683 1.66882C10.5242 1.46033 10.1932 1.32686 9.60364 1.25525C9.00034 1.18198 8.20974 1.18091 7.0846 1.18091L5.57813 1.18091C4.45301 1.18091 3.66238 1.18198 3.05908 1.25525C2.46953 1.32686 2.13852 1.46033 1.89441 1.66882C1.81341 1.73801 1.73801 1.81341 1.66882 1.89441C1.46033 2.13852 1.32686 2.46953 1.25525 3.05908C1.18198 3.66238 1.18091 4.45301 1.18091 5.57813L1.18091 6.2771C1.18091 7.40218 1.18197 8.19288 1.25525 8.79614C1.32687 9.38553 1.46036 9.71674 1.66882 9.96082C1.73797 10.0417 1.81347 10.1173 1.89441 10.1864C2.13851 10.3948 2.46965 10.5275 3.05908 10.5991C3.66238 10.6724 4.45298 10.6735 5.57813 10.6735L7.0846 10.6735C8.20977 10.6735 9.00033 10.6724 9.60364 10.5991C10.1931 10.5275 10.5242 10.3948 10.7683 10.1864C10.8493 10.1173 10.9247 10.0417 10.9939 9.96082C11.2024 9.71674 11.3358 9.38553 11.4075 8.79614C11.4808 8.19288 11.4818 7.40218 11.4818 6.2771L11.4818 5.57813ZM12.6627 6.2771C12.6627 7.37222 12.6637 8.247 12.5798 8.93799C12.4942 9.64284 12.3133 10.2359 11.8928 10.7282C11.7834 10.8562 11.6637 10.9751 11.5356 11.0845C11.0434 11.5049 10.4511 11.6867 9.74634 11.7723C9.05525 11.8563 8.17999 11.8552 7.0846 11.8552L5.57813 11.8552C4.48273 11.8552 3.60747 11.8563 2.91638 11.7723C2.21157 11.6867 1.61933 11.5049 1.12708 11.0845C0.99901 10.9751 0.879281 10.8562 0.769898 10.7282C0.349454 10.2359 0.168506 9.64284 0.0828864 8.93799C-0.00101964 8.247 4.88512e-07 7.37222 6.47206e-07 6.2771L6.47206e-07 5.57813C6.47206e-07 4.48273 -0.00106163 3.60747 0.0828864 2.91638C0.168502 2.21168 0.349594 1.61928 0.769898 1.12708C0.879302 0.998981 0.998981 0.879302 1.12708 0.769898C1.61928 0.349594 2.21168 0.168502 2.91638 0.0828864C3.60747 -0.00106163 4.48273 6.47206e-07 5.57813 6.47206e-07L7.0846 6.47206e-07C8.17999 6.47206e-07 9.05525 -0.00106163 9.74634 0.0828864C10.451 0.168505 11.0434 0.349587 11.5356 0.769898C11.6637 0.879302 11.7834 0.998981 11.8928 1.12708C12.3131 1.61928 12.4942 2.21169 12.5798 2.91638C12.6638 3.60747 12.6627 4.48273 12.6627 5.57813L12.6627 6.2771Z" fill="currentColor"/><path transform="translate(0.6689 1.073)" d="M6.02607 5.50955L6.44306 5.9274L3.84284 8.52762L3.425 8.11063L3.00715 7.69278L4.77253 5.9274L3.00715 4.16202L3.84284 3.32633L6.02607 5.50955Z" fill="currentColor"/><path transform="translate(0.6689 1.073)" d="M9.23789 7.35397L9.23789 8.53488L6.96238 8.53488L6.96238 7.35397L9.23789 7.35397Z" fill="currentColor"/></svg>'
  const ICON_GLOBE = '<svg viewBox="0 0 14 14" fill="none" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M7.00018 0.353516C10.6708 0.353535 13.6468 3.32958 13.6469 7.00018C13.6468 10.6708 10.6708 13.6468 7.00018 13.6469C3.32957 13.6468 0.353535 10.6708 0.353516 7.00018C0.353535 3.32957 3.32957 0.353531 7.00018 0.353516ZM5.44643 7.59661C5.49463 8.97506 5.70762 10.191 6.02136 11.0793C6.20141 11.5891 6.40328 11.9585 6.59898 12.1889C6.79501 12.4196 6.93213 12.454 7.00018 12.454C7.06822 12.454 7.20533 12.4197 7.40138 12.1889C7.59708 11.9585 7.79895 11.589 7.979 11.0793C8.29274 10.191 8.50574 8.97506 8.55394 7.59661H5.44643ZM1.57861 7.59661C1.80785 9.70467 3.2386 11.4509 5.1715 12.1388C5.07135 11.9317 4.97972 11.7098 4.89746 11.477C4.53084 10.4391 4.30224 9.0828 4.25357 7.59661H1.57861ZM9.74679 7.59661C9.69813 9.0828 9.46952 10.4391 9.1029 11.477C9.0206 11.7099 8.92818 11.9316 8.82797 12.1388C10.7613 11.4511 12.1925 9.70496 12.4218 7.59661H9.74679ZM5.1706 1.8616C3.23814 2.54963 1.80876 4.29604 1.5795 6.40376H4.25357C4.30224 4.91756 4.53083 3.56129 4.89746 2.5234C4.97968 2.29066 5.07051 2.0686 5.1706 1.8616ZM7.00018 1.54637C6.93213 1.54638 6.79503 1.5807 6.59898 1.81145C6.40332 2.04177 6.20139 2.41058 6.02136 2.92012C5.70754 3.80851 5.49461 5.02499 5.44643 6.40376H8.55394C8.50575 5.025 8.29282 3.80851 7.979 2.92012C7.79898 2.41059 7.59705 2.04177 7.40138 1.81145C7.20531 1.58067 7.06823 1.54637 7.00018 1.54637ZM8.82887 1.8616C8.92902 2.0687 9.02064 2.29053 9.1029 2.5234C9.46953 3.56129 9.69812 4.91756 9.74679 6.40376H12.4209C12.1916 4.29575 10.7618 2.54943 8.82887 1.8616Z" fill="currentColor"/></svg>'
  const ICON_CHECKLIST = '<svg viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M13.3277 9.69629V10.976H7.28086V9.69629H13.3277Z" fill="currentColor"/><path d="M13.3277 2.97256V4.25225H7.28086V2.97256H13.3277Z" fill="currentColor"/><path d="M4.64512 10.336C4.64505 9.62755 4.07081 9.05322 3.3623 9.05322C2.65386 9.05329 2.07956 9.62759 2.07949 10.336C2.07949 11.0445 2.65382 11.6188 3.3623 11.6188C4.07085 11.6188 4.64512 11.0446 4.64512 10.336ZM5.92559 10.336C5.92559 11.7515 4.77777 12.8993 3.3623 12.8993C1.94689 12.8993 0.799805 11.7515 0.799805 10.336C0.799871 8.92066 1.94693 7.7736 3.3623 7.77354C4.77773 7.77354 5.92552 8.92062 5.92559 10.336Z" fill="currentColor"/><path d="M4.64531 3.6123C4.6453 2.90382 4.07098 2.32949 3.3625 2.32949C2.65403 2.32951 2.0797 2.90383 2.07969 3.6123C2.07969 4.32079 2.65402 4.8951 3.3625 4.89512C4.07099 4.89512 4.64531 4.3208 4.64531 3.6123ZM5.925 3.6123C5.925 5.02772 4.77792 6.1748 3.3625 6.1748C1.9471 6.17479 0.8 5.02771 0.8 3.6123C0.800013 2.19691 1.9471 1.04982 3.3625 1.0498C4.77791 1.0498 5.92499 2.1969 5.925 3.6123Z" fill="currentColor"/></svg>'
  const ICON_SKILL = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M12.5113 15.4067C12.4395 15.6249 12.1308 15.6249 12.059 15.4067L11.643 14.1416C11.454 13.567 11.0033 13.1164 10.4288 12.9274L9.16369 12.5113C8.94544 12.4395 8.94544 12.1308 9.16369 12.059L10.4288 11.643C11.0033 11.454 11.454 11.0033 11.643 10.4288L12.059 9.16369C12.1308 8.94544 12.4395 8.94544 12.5113 9.16369L12.9274 10.4288C13.1164 11.0033 13.567 11.454 14.1416 11.643L15.4067 12.059C15.6249 12.1308 15.6249 12.4395 15.4067 12.5113L14.1416 12.9274C13.567 13.1164 13.1164 13.567 12.9274 14.1416L12.5113 15.4067Z" fill="currentColor"/><path d="M9.02246 0.546878C9.9822 0.546878 10.7564 0.545403 11.374 0.612307C12.0042 0.680586 12.5515 0.826244 13.0273 1.17188C13.3052 1.37376 13.5501 1.61868 13.752 1.89649C14.0975 2.37225 14.2432 2.91984 14.3115 3.54981C14.3784 4.16727 14.377 4.94206 14.377 5.90137V8.51367C13.9611 8.29533 13.5071 8.13985 13.0273 8.06055V5.90137C13.0273 4.9121 13.0259 4.22322 12.9688 3.69532C12.9129 3.18044 12.8098 2.89782 12.6592 2.69043C12.5406 2.52724 12.3966 2.38326 12.2334 2.26465C12.026 2.11404 11.7437 2.0109 11.2285 1.95508C10.7005 1.89789 10.0122 1.89649 9.02246 1.89649H6.55371C5.56395 1.89649 4.87569 1.89787 4.34766 1.95508C3.83242 2.01092 3.55022 2.11398 3.34278 2.26465C3.17953 2.38329 3.03564 2.52719 2.91699 2.69043C2.76642 2.89782 2.66325 3.18042 2.60742 3.69532C2.55027 4.22322 2.54883 4.9121 2.54883 5.90137V10.0986C2.54883 11.0878 2.55031 11.7768 2.60742 12.3047C2.66326 12.8196 2.76642 13.1032 2.91699 13.3105C3.03558 13.4736 3.17966 13.6178 3.34278 13.7363C3.5502 13.8869 3.83265 13.9901 4.34766 14.0459C4.87568 14.1031 5.56398 14.1035 6.55371 14.1035H8.08399C8.27443 14.6025 8.55077 15.0585 8.89551 15.4541H6.55371C5.59402 15.4541 4.81976 15.4546 4.20215 15.3877C3.57204 15.3194 3.02468 15.1738 2.54883 14.8281C2.27111 14.6263 2.02606 14.3813 1.82422 14.1035C1.47883 13.6278 1.33293 13.08 1.26465 12.4502C1.19783 11.8327 1.19922 11.0579 1.19922 10.0986V5.90137C1.19922 4.94206 1.1978 4.16727 1.26465 3.54981C1.33295 2.91984 1.47867 2.37225 1.82422 1.89649C2.02613 1.61864 2.27098 1.37379 2.54883 1.17188C3.02472 0.826181 3.57197 0.6806 4.20215 0.612307C4.81976 0.545393 5.594 0.546877 6.55371 0.546878H9.02246ZM9.19629 9.14649H4.5459V7.84571H9.19629V9.14649ZM11.0303 6.10645H4.5459V4.80567H11.0303V6.10645Z" fill="currentColor"/></svg>'
  const ICON_SPARKLE = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6.1 3.1Q6.6 7.8 11.3 8.3Q6.6 8.8 6.1 13.5Q5.6 8.8 0.9 8.3Q5.6 7.8 6.1 3.1Z" fill="currentColor"/><path d="M11.9 1Q12.2 3.7 14.9 4Q12.2 4.3 11.9 7Q11.6 4.3 8.9 4Q11.6 3.7 11.9 1Z" fill="currentColor"/><path d="M12.5 9.4Q12.7 11.4 14.7 11.6Q12.7 11.8 12.5 13.8Q12.3 11.8 10.3 11.6Q12.3 11.4 12.5 9.4Z" fill="currentColor"/></svg>'
  // 映射对齐 DSH ui-tool GenericToolCard variant leading：read→browse、write/edit→edit、search→search、
  // bash→api、web_search→globe（web_fetch→browse）、todo/task→checklist、skill→skill、其余（含 Agent）→sparkle
  const TOOL_ICONS = {
    Read: ICON_BROWSE, Edit: ICON_EDIT, Write: ICON_EDIT, NotebookEdit: ICON_EDIT,
    Grep: ICON_SEARCH, Glob: ICON_SEARCH, Bash: ICON_API,
    WebFetch: ICON_BROWSE, WebSearch: ICON_GLOBE,
    TaskCreate: ICON_CHECKLIST, TaskUpdate: ICON_CHECKLIST, TaskGet: ICON_CHECKLIST, TodoWrite: ICON_CHECKLIST,
    Skill: ICON_SKILL,
  }
  function toolIcon(name) { return TOOL_ICONS[name] || ICON_SPARKLE }

  // ---- 消息复制按钮（2026-08-21 移植 DSH MessageIconActions：28px 圆形图标钮，copy → check 1s 反馈。
  // path 取自 ui-primitives/icons IconCopyOutline16；成功对勾复用 I.dshCheck）----
  const ICON_COPY = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6.14929 4.02032C7.11197 4.02032 7.87983 4.02016 8.49597 4.07598C9.12128 4.13269 9.65792 4.25188 10.1415 4.53106C10.7202 4.8653 11.2008 5.3459 11.535 5.92462C11.8142 6.40818 11.9334 6.94481 11.9901 7.57012C12.0459 8.18625 12.0458 8.95419 12.0458 9.9168C12.0458 10.8795 12.0459 11.6473 11.9901 12.2635C11.9334 12.8888 11.8142 13.4254 11.535 13.909C11.2008 14.4877 10.7202 14.9683 10.1415 15.3025C9.65792 15.5817 9.12128 15.7009 8.49597 15.7576C7.87984 15.8134 7.11196 15.8133 6.14929 15.8133C5.18667 15.8133 4.41874 15.8134 3.80261 15.7576C3.1773 15.7009 2.64067 15.5817 2.1571 15.3025C1.5784 14.9683 1.09778 14.4877 0.76355 13.909C0.484366 13.4254 0.365184 12.8888 0.308472 12.2635C0.252649 11.6473 0.252808 10.8795 0.252808 9.9168C0.252808 8.95418 0.252664 8.18625 0.308472 7.57012C0.365184 6.94481 0.484366 6.40818 0.76355 5.92462C1.09777 5.34589 1.57839 4.86529 2.1571 4.53106C2.64067 4.25188 3.1773 4.13269 3.80261 4.07598C4.41874 4.02017 5.18666 4.02032 6.14929 4.02032ZM6.14929 5.37774C5.16181 5.37774 4.46634 5.37761 3.92566 5.42657C3.39434 5.47472 3.07859 5.56574 2.83582 5.70587C2.4632 5.92106 2.15354 6.2307 1.93835 6.60333C1.79823 6.8461 1.70721 7.16185 1.65906 7.69317C1.6101 8.23385 1.61023 8.92933 1.61023 9.9168C1.61023 10.9043 1.61009 11.5998 1.65906 12.1404C1.70721 12.6717 1.79823 12.9875 1.93835 13.2303C2.15356 13.6029 2.46321 13.9126 2.83582 14.1277C3.07859 14.2679 3.39434 14.3589 3.92566 14.407C4.46634 14.456 5.16182 14.4559 6.14929 14.4559C7.13682 14.4559 7.83224 14.456 8.37292 14.407C8.90425 14.3589 9.21999 14.2679 9.46277 14.1277C9.83535 13.9126 10.145 13.6029 10.3602 13.2303C10.5004 12.9875 10.5914 12.6717 10.6395 12.1404C10.6885 11.5998 10.6884 10.9043 10.6884 9.9168C10.6884 8.92934 10.6885 8.23384 10.6395 7.69317C10.5914 7.16185 10.5004 6.8461 10.3602 6.60333C10.1451 6.23071 9.83536 5.92107 9.46277 5.70587C9.21999 5.56574 8.90424 5.47472 8.37292 5.42657C7.83224 5.3776 7.13682 5.37774 6.14929 5.37774ZM9.80164 0.367975C10.7638 0.367975 11.5314 0.36788 12.1473 0.423639C12.7726 0.480307 13.3093 0.598759 13.7928 0.877741C14.3717 1.21192 14.8521 1.69355 15.1864 2.27227C15.4655 2.75574 15.5857 3.29164 15.6425 3.9168C15.6983 4.53301 15.6971 5.3016 15.6971 6.26446V7.82989C15.6971 8.29264 15.6989 8.58993 15.6649 8.84844C15.4668 10.3525 14.401 11.5738 12.9833 11.9988V10.5467C13.6973 10.1903 14.2105 9.49662 14.3192 8.67169C14.3387 8.52347 14.3407 8.3358 14.3407 7.82989V6.26446C14.3407 5.27706 14.3398 4.58149 14.2909 4.04083C14.2428 3.50968 14.1526 3.19372 14.0126 2.95098C13.7974 2.57849 13.4876 2.26869 13.1151 2.05352C12.8724 1.91347 12.5564 1.82237 12.0253 1.77423C11.4847 1.72528 10.7888 1.7254 9.80164 1.7254H7.71472C6.7562 1.72558 5.92665 2.27697 5.52332 3.07891H4.07019C4.54221 1.51132 5.9932 0.368186 7.71472 0.367975H9.80164Z" fill="currentColor"/></svg>'
  // 剪贴板写入（DSH ui-primitives clipboard.ts 移植）：异步 Clipboard API 优先，
  // 非安全上下文（http 局域网 / 无 clipboard）回退 textarea + execCommand('copy')
  async function writeClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try { await navigator.clipboard.writeText(text); return true } catch { return false }
    }
    const exec = typeof document.execCommand === 'function' ? document.execCommand.bind(document) : undefined
    if (!exec) return false
    const el = document.createElement('textarea')
    el.value = text
    el.setAttribute('readonly', '')
    el.style.position = 'fixed'
    el.style.left = '-9999px'
    document.body.appendChild(el)
    el.select()
    try { return exec('copy') } catch { return false } finally { el.remove() }
  }

  // 摘要语义（对齐 DSH ReasoningRow）：已结束=firstLine（不 trim 的首行）；运行中=latestLine（trimEnd 后取末行）
  function thinkSummary(text, running) {
    const t = String(text || '')
    const visible = t.replace(/\s+$/, '')
    const lastNl = visible.lastIndexOf('\n')
    if (running) return lastNl === -1 ? visible : visible.slice(lastNl + 1)
    const firstNl = t.indexOf('\n')
    return firstNl === -1 ? t : t.slice(0, firstNl)
  }
  function thinkRowHtml(text, running) {
    const t = String(text || '')
    if (!t.trim()) return ''
    const summary = thinkSummary(t, running)
    return `<details class="think-row" data-state="${running ? 'running' : 'ok'}"><summary><span class="tr-leading" aria-hidden="true"><span class="tr-ico">${THINK_ICON}</span><span class="tr-chev">${THINK_CHEV}</span></span><span class="tr-title">思考</span><span class="tr-sep" aria-hidden="true"></span><span class="tr-summary"${running ? ' data-follow-end' : ''}>${esc(summary)}</span></summary><div class="tr-body">${mdHtml(t)}</div></details>`
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
    // 运行中思考行摘要：text-overflow clip 后把滚动位置甩到末尾（对齐 DSH ReasoningRow 实时跟随末行）
    messagesEl.querySelectorAll('.think-row[data-state="running"] .tr-summary').forEach((el) => { el.scrollLeft = el.scrollWidth })
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
    pendingAskInput = null // 每次渲染重置：末尾待答提问由下方检测重写
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
      const processing = isFinal && !s.finished // 最后一段且末尾还没收到纯文本回复 = 处理中
      // 旁白 text 原位回填（与其后的动作交错，不再统一沉到段尾）；reply 占位置空（回复主内容在折叠外单独渲染）
      for (const t of s.texts) s.items[t.idx].html = (t === reply) ? '' : processTextHtml(t.text)
      // 思考过滤：处理中段保留全部思考块（对齐 CLI 实时可见思考）；已处理段只留最后一个
      // （对齐 CLI hidePastThinking——中间思考为无效对话剔除）
      if (s.thinks.length > 1 && !processing) {
        for (let k = 0; k < s.thinks.length - 1; k++) s.items[s.thinks[k]].html = ''
      }
      // 处理中段末个思考块 → running 态（末行摘要实时跟随 + 扫光，对齐 DSH ReasoningRow 流式尾块）
      if (processing && s.thinks.length) {
        const it = s.items[s.thinks[s.thinks.length - 1]]
        if (it && it.html) it.html = thinkRowHtml(it.text, true)
      }
      // 处理中段末个工具行 → running 态（扫光 + 脉冲点，对齐 DSH ToolRow 流式尾块）
      if (processing && s.lastToolIdx != null) s.items[s.lastToolIdx].running = true

      if (s.user) {
        const m = s.user
        const txt = m.blocks.filter((b) => b.kind === 'text').map((b) => b.text).join('')
        const hasImg = m.blocks.some((b) => b.kind === 'image')
        const body = hasImg && !txt ? '[图片]' : txt
        html += `<div class="msg user" data-m="${s.key}" data-t="u"><div class="body">${mdHtml(body)}</div><div class="msg-actions"><button class="msg-copy" title="复制" aria-label="复制">${ICON_COPY}</button></div></div>`
      }

      // 已处理折叠：思考 + 阅读/编辑/搜索 等全部收进一个可展开容器
      // 时长 = 回复时间 − 用户消息时间（t2 − t1，即整段 AI 处理过程）
      let foldHtml = ''
      if (s.items.length) {
        const bodyHtml = groupTools(s.items) // 连续工具合并折叠 + 思考/旁白原位穿插
        if (bodyHtml) {
          const endTs = reply ? reply.ts : s.lastTs
          // 处理中：label「正在处理」+ 实时计时（bindLiveFoldTimer 每秒跳字）；回复落地后「已处理 X」
          const t1 = (s.user && s.user.timestamp) || (isFinal ? lastUserTs : 0)
          const dur = !processing && t1 && endTs ? fmtDur(Math.round((endTs - t1) / 1000)) : ''
          const openAttr = processing ? ' open' : ''
          const liveCls = processing ? ' done-live' : ''
          foldHtml = `<details class="done-fold${liveCls}" data-m="${s.key}" data-t="f"${openAttr}><summary><span class="d-chev">${CHEV}</span>${processing ? '<span class="df-dot"></span>' : ''}${processing ? '正在处理' : '已处理'}${dur ? `<span class="d-dur"> ${dur}</span>` : ''}</summary><div class="done-body">${bodyHtml}</div></details>`
        }
      }

      if (reply) {
        html += `<div class="msg assistant" data-m="${s.key}" data-t="a"><div class="body"><div class="blocks">${foldHtml}${mdHtml(reply.text)}</div><div class="msg-actions"><button class="msg-copy" title="复制" aria-label="复制">${ICON_COPY}</button></div></div></div>`
      } else if (foldHtml) {
        // 段被中断（无回复）：已处理折叠独立展示
        html += foldHtml
      }

      // 段末文件变更汇总卡片（回合内 Edit/Write 的真实增删行数）
      if (s.changes && s.changes.size) html += renderChangeCardHtml(s.changes)
    }

    for (let i = 0; i < messages.length; i++) {
      const m = messages[i]
      if (isContinuationMsg(m)) {
        // 压缩/自动摘要标记：若当前段仍在处理中（尚无正式回复）→ 不中断，
        // 把标记作为段内一条浅灰注释吸进同一「已处理/正在处理」折叠，后续 thinking/工具/回复继续追写；
        // 否则（段间）照旧居中展示为无发布者系统提示。
        const txt = m.blocks.filter((b) => b.kind === 'text').map((b) => b.text).join('\n').trim()
        if (seg && !seg.finished) {
          seg.items.push({ kind: 'note', html: `<div class="done-fold-note">${esc(txt || '会话续接')}</div>` })
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
        seg = { user: m, items: [], texts: [], lastTs: null, key: i, thinks: [], lastTool: null, lastAsk: null, changes: new Map() }
        continue
      }
      if (!seg) seg = { user: null, items: [], texts: [], lastTs: null, key: i, thinks: [], lastTool: null, lastAsk: null, changes: new Map() }
      const hasText = m.blocks.some((b) => b.kind === 'text' && b.text && b.text.trim())
      for (const b of m.blocks) {
        // 思考块先进 items 占位并记下索引：处理中段保留全部思考；已处理段只留最后一个（对齐 CLI hidePastThinking）
        if (b.kind === 'thinking') { seg.thinks.push(seg.items.length); seg.items.push({ kind: 'think', text: b.text, html: thinkRowHtml(b.text, false) }) }
        else if (b.kind === 'tool_use') {
          if (b.name === 'AskUserQuestion') {
            // 提问块 → DSH 风格提问卡（答案由后续 tool_result 文本吸附）
            const it = { kind: 'ask', name: 'AskUserQuestion', zh: '提问', input: b.input, answer: null, html: askLineHtml(false) }
            seg.items.push(it)
            seg.lastAsk = it
          } else {
            const t = toolMeta(b); seg.items.push({ kind: 'tool', html: toolLine(b), name: t.name, zh: t.zh }); seg.lastTool = b.name; seg.lastToolIdx = seg.items.length - 1 // 记录段内最近工具 → 供形象切换 + 处理中运行态标记
          }
        }
        else if (b.kind === 'tool_result') {
          const fc = parseFileChange(b.text); if (fc) mergeChanges(seg.changes, fc) // 聚合文件变更 → 段末汇总卡片
          // AskUserQuestion 答案关联：最近的未回答提问卡吸附该 tool_result 文本并标出所选
          if (seg.lastAsk && seg.lastAsk.answer == null && b.text) {
            seg.lastAsk.answer = String(b.text)
            seg.lastAsk.html = askLineHtml(true) // 已答 → 「提问 · 已回答」
          }
        }
      }
      if (hasText) {
        // text 块占位进 items（记索引）：closeSeg 时旁白原位填充、reply 置空（回复主内容在折叠外单独渲染）
        const text = m.blocks.filter((b) => b.kind === 'text').map((b) => b.text).join('')
        seg.items.push({ kind: 'text', html: '' })
        seg.texts.push({ text, ts: m.timestamp, idx: seg.items.length - 1 })
      }
      // finished = 该消息是「纯文本回复」（无 tool_use）= 段已收尾；
      // 末尾仍在调工具/思考（含旁白文本后再跟 tool_use）= 处理中
      if (m.role === 'assistant') {
        seg.finished = hasText && !m.blocks.some((b) => b.kind === 'tool_use') ? 1 : 0
      }
      if (m.timestamp) seg.lastTs = m.timestamp
    }
    // 末尾待答提问（最后一条 tool_use 是 AskUserQuestion 且其后无 tool_result）→ 记录 input 供 composer takeover；
    // 消息流里保留紧凑行「提问 · 等待回答」（与「提问 · 已回答」同形态，仅状态字不同）
    if (seg && seg.lastAsk && seg.lastAsk.answer == null) {
      pendingAskInput = seg.lastAsk.input
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
      <span class="dot${dotCls}"></span><span class="title">${esc(s.title)}</span></button>`
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
    // 保留展开的项目文件夹 + 侧栏滚动位置（2026-08-16：主区导航进管理视图/预览走 route→renderRecent，
    // 重建列表时不重置侧栏状态，避免展开文件夹收起、滚动跳顶）
    const openF = [...bodyEl.querySelectorAll('.folder.open')].map((f) => f.dataset.f)
    const prevTop = bodyEl.scrollTop
    bodyEl.innerHTML = ''
    modeTabsEl.classList.toggle('hidden', state.mode !== 'project')
    recentLabel.textContent = state.mode === 'list' ? '最近' : '最近对话'
    if (state.mode === 'list') renderList()
    else renderProject()
    bodyEl.querySelectorAll('.sess-item, .folder').forEach((el) => {
      const k = el.dataset.hash || el.dataset.f
      if (k && !prevKeys.has(k)) el.classList.add('item-in')
    })
    if (openF.length) {
      for (const f of bodyEl.querySelectorAll('.folder')) {
        if (openF.includes(f.dataset.f)) f.classList.add('open')
      }
    }
    if (prevTop) bodyEl.scrollTop = prevTop
    renderBubble()
    renderSearch()
  }

  // 管理视图（插件/技能预览，Codex 风格）：渲染到主聊天区（侧栏会话列表保持不变）。
  // 插件与技能预览都从「插件」入口进入，顶部插件/技能切换；数据源 = 网关 /api/plugins 实时扫描。
  // 重渲保留滚动位置（切换 kind/cat 时内容高度变化，避免 scrollTop 被重置成可见跳动）。
  function renderMgr() {
    closeMentionPop()
    stopLiveFoldTimer()
    pinRelease()
    state.currentHash = null
    state.preview = null
    const scrollEl = document.querySelector('#chat-scroll')
    const prevTop = scrollEl ? scrollEl.scrollTop : 0
    // 「项目」入口：仿照插件布设，每个项目胶囊占据一整行（数据源 = 会话按 projectLabel 分组）
    if (state.mgr === 'projects') {
      // 顶部结构与插件视图完全同构（mgr-top mgr-kind + mgr-cats 占位），避免切换跳动；无刷新/设置按钮
      const projCount = new Set(ALL.filter((s) => s.projectScope === 'project' && s.projectLabel).map((s) => s.projectLabel)).size
      messagesEl.innerHTML =
        '<div class="mgr-pane">' +
        // 空 mgr-top 占位：与插件视图「插件/技能」切换行等高（.mgr-top min-height），避免切换时标题跳动
        '<div class="mgr-top"></div>' +
        '<div class="mgr-head"><h2 class="mgr-title">项目</h2>' +
        '<div class="mgr-sub">按项目文件夹分组 · 会话按最近活跃排序</div></div>' +
        `<div class="mgr-search">${I.mag}<input id="mgr-pq" type="text" placeholder="搜索项目…" value="${esc(state.mgrView.q)}"></div>` +
        `<div class="mgr-cats"><span class="mgr-cat on">共 ${projCount} 个项目</span></div>` +
        '<div class="mgr-list" id="mgr-list"></div>' +
        '<div class="mgr-foot">数据源：会话按项目分组（/api/sessions）</div>' +
        '</div>'
      inputWrap.classList.remove('docked')
      chatArea.classList.remove('in-session')
      chatArea.classList.add('mgr-on')
      renderMgrProj()
      const pq = $('mgr-pq')
      if (pq) pq.addEventListener('input', () => { state.mgrView.q = pq.value; saveMgrView(); renderMgrProj() })
      return
    }
    // 「模型」入口：仿照项目布设，展示便携根 settings.json 的模型配置（只读）
    if (state.mgr === 'models') {
      // 顶部结构与插件视图完全同构（空 mgr-top 占位等高防跳）
      messagesEl.innerHTML =
        '<div class="mgr-pane">' +
        '<div class="mgr-top"></div>' +
        '<div class="mgr-head"><h2 class="mgr-title">模型列表</h2></div>' +
        '<div class="mgr-model-list" id="mgr-model-list"></div>' +
        '<div class="mgr-foot">数据源：网关 /api/models</div>' +
        '</div>'
      inputWrap.classList.remove('docked')
      chatArea.classList.remove('in-session')
      chatArea.classList.add('mgr-on')
      renderMgrModels()
      loadModelsData(false)
      return
    }
    const v = state.mgrView
    const kindName = v.kind === 'skills' ? '技能' : '插件'
    const sub =
      v.kind === 'skills'
        ? '个人 = 已安装技能（扫描便携根 .claude/skills）· 公开 = 官方市场技能'
        : '个人 = 已安装插件（扫描便携根 .claude/plugins）· 公开 = 官方市场插件'
    messagesEl.innerHTML =
      '<div class="mgr-pane">' +
      '<div class="mgr-top">' +
      '<div class="mgr-kind">' +
      `<button class="mgr-kind-btn${v.kind === 'plugins' ? ' on' : ''}" data-kind="plugins">插件</button>` +
      `<button class="mgr-kind-btn${v.kind === 'skills' ? ' on' : ''}" data-kind="skills">技能</button>` +
      '</div>' +
      '</div>' +
      `<div class="mgr-head"><h2 class="mgr-title">${kindName}</h2><div class="mgr-sub">${sub}</div></div>` +
      `<div class="mgr-search">${I.mag}<input id="mgr-q" type="text" placeholder="${v.kind === 'skills' ? '搜索技能…' : '搜索插件…'}" value="${esc(v.q)}"></div>` +
      '<div class="mgr-cats">' +
      `<button class="mgr-cat${v.cat === 'public' ? ' on' : ''}" data-cat="public">公开</button>` +
      `<button class="mgr-cat${v.cat === 'personal' ? ' on' : ''}" data-cat="personal">个人</button>` +
      '</div>' +
      '<div class="mgr-grid" id="mgr-grid"></div>' +
      '<div class="mgr-foot">数据源：网关 /api/plugins 实时扫描</div>' +
      '</div>'
    inputWrap.classList.remove('docked')
    chatArea.classList.remove('in-session')
    chatArea.classList.add('mgr-on')
    renderMgrGrid()
    loadMgrData(false) // 真实数据：首次进入拉取，刷新按钮 force 重拉
    // 恢复滚动位置（scroll-behavior:smooth 会让赋值动画，临时切 auto 立即归位）
    if (scrollEl) {
      const old = scrollEl.style.scrollBehavior
      scrollEl.style.scrollBehavior = 'auto'
      scrollEl.scrollTop = prevTop
      scrollEl.style.scrollBehavior = old
    }
    const pane = messagesEl.querySelector('.mgr-pane')
    pane.querySelectorAll('.mgr-kind-btn').forEach((b) =>
      b.addEventListener('click', () => {
        v.kind = b.dataset.kind
        saveMgrView()
        renderMgr()
      }),
    )
    pane.querySelectorAll('.mgr-cat').forEach((b) =>
      b.addEventListener('click', () => {
        v.cat = b.dataset.cat
        saveMgrView()
        renderMgr()
      }),
    )
    const q = $('mgr-q')
    if (q) q.addEventListener('input', () => { v.q = q.value; saveMgrView(); renderMgrGrid() })
  }

  // 管理视图：插件/技能卡片网格（按 kind + cat + 搜索词过滤；数据源 = 后端 /api/plugins）
  function renderMgrGrid() {
    const v = state.mgrView
    const grid = $('mgr-grid')
    if (!grid) return
    const label = v.kind === 'skills' ? '技能' : '插件'
    if (MGR_LOADING) {
      grid.innerHTML = '<div class="mgr-empty">加载真实清单中…</div>'
      return
    }
    if (MGR_ERR) {
      grid.innerHTML =
        '<div class="mgr-empty">清单加载失败：' + esc(MGR_ERR) +
        '<br><button class="mgr-retry" id="mgr-retry">重试</button></div>'
      const retry = $('mgr-retry')
      if (retry) retry.addEventListener('click', () => loadMgrData(true))
      return
    }
    const src = (MGR && MGR[v.kind] && MGR[v.kind][v.cat]) || []
    const q = (v.q || '').trim().toLowerCase()
    const rows = q ? src.filter((x) => x.n.toLowerCase().includes(q) || x.d.toLowerCase().includes(q)) : src
    grid.innerHTML = rows.length
      ? rows.map(mgrCardHtml).join('')
      : `<div class="mgr-empty">没有匹配的${label}</div>`
  }
  function mgrCardHtml(x) {
    const badge = x.inst ? '<span class="inst-badge">已安装</span>' : ''
    return (
      `<div class="mgr-card"><div class="mgr-ic" style="background:${mgrColor(x.n)}">${esc((x.n[0] || '?').toUpperCase())}</div>` +
      `<div class="mgr-meta"><div class="mgr-name">${esc(x.n)}${badge}</div><div class="mgr-desc">${esc(x.d)}</div></div>` +
      '<button class="mgr-more" title="更多">…</button></div>'
    )
  }

  // 管理视图：项目列表（仿照插件布设，每个项目胶囊占据一整行）
  // 数据源 = 已加载会话 ALL 按 projectLabel 分组（projectScope==='project'），不另起后端接口。
  function renderMgrProj() {
    const list = $('mgr-list')
    if (!list) return
    const q = (state.mgrView.q || '').trim().toLowerCase()
    const byProject = {}
    for (const s of ALL) if (s.projectScope === 'project' && s.projectLabel) (byProject[s.projectLabel] = byProject[s.projectLabel] || []).push(s)
    const labels = Object.keys(byProject).filter((l) => !q || l.toLowerCase().includes(q))
    // 按项目最近活跃时间降序（同 renderProject 排序）
    labels.sort((a, b) => {
      const la = Math.max(0, ...byProject[a].map((s) => s.updatedAt))
      const lb = Math.max(0, ...byProject[b].map((s) => s.updatedAt))
      return lb - la
    })
    // 该项目是否带 .claude/preview/（会话 preview 标志由后端 findProjects.hasPreview 透传）
    const hasPreview = (l) => ALL.some((s) => s.projectScope === 'project' && s.projectLabel === l && s.preview)
    list.innerHTML = labels.length
      ? labels.map((l) => mgrProjHtml(l, byProject[l], hasPreview(l))).join('')
      : '<div class="mgr-empty">' + (q ? '没有匹配的项目' : '暂无项目会话') + '</div>'
    list.querySelectorAll('.mgr-proj').forEach((b) =>
      b.addEventListener('click', () => {
        // 点项目胶囊一律进预览：带 .claude/preview 加载真预览页；不带 → 默认项目主页
        // （GitHub 仓库风格，web/default-preview/，由网关 /api/project 拉数据）。
        if (b.dataset.label) {
          // 进预览走 hash 路由（#preview/<label>），刷新后可恢复当前预览页
          navigate('#preview/' + encodeURIComponent(b.dataset.label))
          if (isMobile()) setPanel(false)
          return
        }
        const hash = b.dataset.hash
        if (!hash) return
        navigate('#/' + encodeURIComponent(hash))
        if (isMobile()) setPanel(false)
      }),
    )
  }
  function mgrProjHtml(label, chats, hasPreview) {
    const latest = [...chats].sort((a, b) => b.updatedAt - a.updatedAt)[0]
    const n = chats.length
    return (
      `<button class="mgr-proj" data-hash="${latest ? esc(hashOf(latest)) : ''}" data-label="${esc(label)}" data-preview="${hasPreview ? '1' : '0'}" title="${esc(label)} · ${n} 个会话（点击进入项目主页）">` +
      `<span class="mgr-ic" style="background:${mgrColor(label)}">${I.folder}</span>` +
      `<span class="mgr-meta"><span class="mgr-name">${esc(label)}${hasPreview ? '<span class="pv-badge">预览</span>' : ''}<span class="inst-badge">${n} 个会话</span></span>` +
      `<span class="mgr-desc">${hasPreview ? '点击打开项目预览页（.claude/preview）' : '点击打开默认项目主页（无预览页）'}</span></span>` +
      '<span class="mgr-more" title="打开">›</span></button>'
    )
  }

  // 管理视图：模型列表（按供应商分组；数据源 = 网关 /api/models，只读展示）
  const MODEL_PROVIDER_KEYS = [
    [/^ANTHROPIC_/, 'Claude · Anthropic'],
    [/^OPENAI_/, 'OpenAI'],
    [/^GEMINI_/, 'Google Gemini'],
    [/^DEEPSEEK_/, 'DeepSeek'],
    [/^QWEN_/, 'Qwen · 通义千问'],
    [/^DASHSCOPE_/, 'Qwen · 通义千问'],
    [/^GLM_/, '智谱 GLM'],
    [/^MOONSHOT_/, 'Moonshot Kimi'],
    [/^OPENROUTER_/, 'OpenRouter'],
  ]
  // 供应商判定：key 优先（模型类环境变量名带供应商前缀），通用 model 键或未命中则按模型串前缀。
  function modelProviderOf(it) {
    const k = String(it.k || '')
    const v = String(it.v || '')
    if (k !== 'model') {
      for (const [re, name] of MODEL_PROVIDER_KEYS) if (re.test(k)) return name
    }
    const vl = v.toLowerCase()
    if (vl.startsWith('claude')) return 'Claude · Anthropic'
    if (vl.startsWith('deepseek')) return 'DeepSeek'
    if (vl.startsWith('qwen')) return 'Qwen · 通义千问'
    if (vl.startsWith('gpt') || vl.startsWith('o1') || vl.startsWith('o3')) return 'OpenAI'
    if (vl.startsWith('gemini')) return 'Google Gemini'
    if (vl.startsWith('glm')) return '智谱 GLM'
    if (vl.startsWith('moonshot') || vl.includes('kimi')) return 'Moonshot Kimi'
    if (vl.includes('doubao')) return '字节豆包'
    return '自定义 / 其他'
  }
  function renderMgrModels() {
    const list = $('mgr-model-list')
    if (!list) return
    if (MODELS_LOADING) {
      list.innerHTML = '<div class="mgr-empty">加载模型列表…</div>'
      return
    }
    if (MODELS_ERR) {
      list.innerHTML =
        '<div class="mgr-empty">模型列表加载失败：' + esc(MODELS_ERR) +
        '<br><button class="mgr-retry" id="mgr-models-retry">重试</button></div>'
      const retry = $('mgr-models-retry')
      if (retry) retry.addEventListener('click', () => loadModelsData(true))
      return
    }
    const d = MODELS
    if (!d) {
      list.innerHTML = '<div class="mgr-empty">暂无模型配置</div>'
      return
    }
    const items = Array.isArray(d.items) ? d.items : []
    if (!items.length) {
      list.innerHTML = '<div class="mgr-empty">暂无模型配置</div>'
      return
    }
    // 按供应商分组（保持配置出现顺序，组内保持原序）
    const groups = []
    for (const it of items) {
      const p = modelProviderOf(it)
      let g = groups.find((x) => x.provider === p)
      if (!g) {
        g = { provider: p, items: [] }
        groups.push(g)
      }
      g.items.push(it)
    }
    list.innerHTML = groups
      .map(
        (g) =>
          '<div class="mgr-model-group">' +
          `<div class="mgr-model-ghead"><span class="mgr-model-gname">${esc(g.provider)}</span></div>` +
          g.items.map(modelCapHtml).join('') +
          '</div>',
      )
      .join('')
    list.querySelectorAll('.mgr-model-item.settable').forEach((row) => {
      row.addEventListener('click', () => setDefaultModel(row.dataset.model))
    })
  }
  // 模型胶囊：完全复用项目胶囊 .mgr-proj 的风格与尺寸（40px 彩块 icon + 名称行 + 描述行）。
  // 2026-08-23 设为默认：凭据池当前供应商可切换模型（MODELS.providerModels 内）→ 整行可点「设为默认」；
  // 当前默认模型（MODELS.activeModel）标「默认」徽标；其余配置项保持只读 › 箭头。
  function modelCapHtml(it) {
    const name = String(it.v || '')
    // 备注小字 = 是否为视觉模型（凭据池 modelVision 配置；未标记按非视觉）
    const desc = it.vision === true ? '支持视觉' : '不支持视觉'
    // DeepSeek 供应商 → 白底 + 蓝色鲸鱼；其它供应商保留彩块 + 芯片线条
    const isDs = modelProviderOf(it) === 'DeepSeek'
    const icStyle = isDs ? 'background:#fff;color:#4d6bfe;border:1px solid #d9e2f8' : 'background:' + mgrColor(name)
    const icSvg = isDs ? I.whale : I.chip
    // 凭据池当前供应商可切换模型 → 整行可点「设为默认」；默认模型整行绿色高亮（无文字徽标）。
    // 不渲染右侧装饰箭头：模型胶囊右侧无任何按钮。
    const settable = !!(MODELS && Array.isArray(MODELS.providerModels) && MODELS.providerModels.includes(name))
    const isDefault = settable && MODELS.activeModel === name
    const cls = 'mgr-proj mgr-model-item' + (settable ? ' settable' : '') + (isDefault ? ' is-default' : '')
    return (
      `<div class="${cls}"${settable ? ' title="点击设为默认模型"' : ''} data-model="${esc(name)}">` +
      `<span class="mgr-ic" style="${icStyle}">${icSvg}</span>` +
      `<span class="mgr-meta"><span class="mgr-name">${esc(name)}</span>` +
      `<span class="mgr-desc">${esc(desc)}</span></span>` +
      '</div>'
    )
  }
  // 2026-08-23 设为默认：POST /api/model { defaultModel } → 写 credentials.json activeModel（仅全局默认，
  // 不影响当前会话）。成功后本地更新 MODELS.activeModel 重渲染，默认徽标移到新模型。
  async function setDefaultModel(id) {
    if (!gToken) { toast('未连接网关，无法设置'); return }
    if (MODELS && MODELS.activeModel === id) { toast('已是默认模型'); return }
    const ok = await apiSetModel({ defaultModel: id })
    if (ok) {
      if (MODELS) MODELS.activeModel = id
      renderMgrModels()
      toast(`默认模型已设为 ${id}`)
    } else {
      toast('设置失败 · 模型不在当前供应商清单或网关未连接')
    }
  }
  // 项目预览：主聊天区渲染返回栏 + iframe，替换管理/会话界面。
  // 预览页加载三级策略（2026-08-19 Web 容器）：
  //  ① preview.json 声明 backend → 网关 /api/backend 懒加载 spawn 后端进程，iframe 直连 http://127.0.0.1:<port>/
  //     （并 60s 心跳刷新网关侧 lastActive，防空闲回收误杀）；
  //  ② 有 .claude/preview/ 静态页（hasPreview=true）→ 加载 <项目>/.claude/preview/index.html；
  //  ③ 兜底默认项目主页（GitHub 仓库风格，web/default-preview/，/api/project 拉取文件树/README/会话）。
  function openProjectPreview(label, hasPreview) {
    state.currentHash = null
    stopLiveFoldTimer()
    pinRelease()
    state.preview = label
    inputWrap.classList.remove('docked')
    chatArea.classList.remove('in-session')
    chatArea.classList.add('mgr-on')
    messagesEl.innerHTML =
      '<div class="preview-shell">' +
      '<div class="preview-bar">' +
      '<button class="preview-back" id="preview-back">← 返回项目列表</button>' +
      '</div>' +
      '<div class="preview-body"><div class="preview-loading">正在加载…</div></div>' +
      '</div>'
    const back = $('preview-back')
    if (back) back.addEventListener('click', () => closeProjectPreview())
    const mount = (src, name) => {
      const body = document.querySelector('.preview-body')
      if (!body) return
      // 覆盖层遮住后端前端加载时的深色初始化画面（2026-08-20 三轮反馈后定稿 v81）：
      // ① 纯遮罩无指令/按钮（用户「弹出的指令框」= 带指令文字的提示层，已去指令）；
      // ② 文案由 backend name 驱动（可插拔：preview.json backend.name，缺省「项目服务」）；
      // ③ backend 容器 load 后缓冲自动淡出 —— 用户「不点击界面就永远卡转圈，但其实早就启动好了」：
      //    后端已就绪（/api/backend 命中）才挂 iframe，load 后 object_info（如 ComfyUI 855 节点）拉取渲染
      //    还需数秒，缓冲 8s 自动淡出（不再永远卡转圈），点击仍可提前关闭（focus iframe 移交内部焦点）。
      body.innerHTML =
        `<iframe class="preview-frame" title="${esc(label)} 项目主页" src="${src}"></iframe>` +
        `<div class="preview-overlay"><div class="preview-overlay-spin"></div>` +
        `<div class="preview-overlay-title">正在启动 ${esc(name || '项目服务')}…</div>` +
        `<div class="preview-overlay-sub">首次启动需等待后端就绪，加载完成后将自动进入</div></div>`
      const frame = body.querySelector('.preview-frame')
      const overlay = body.querySelector('.preview-overlay')
      if (!frame) return
      let autoDismiss = null
      const dismiss = () => {
        if (autoDismiss) { clearTimeout(autoDismiss); autoDismiss = null }
        if (overlay) { overlay.classList.add('done'); setTimeout(() => overlay.remove(), 400) }
      }
      frame.addEventListener('load', () => {
        try { frame.focus() } catch {}
        if (!overlay) return
        // backend 容器（传了 name）：object_info 拉取渲染需数秒，缓冲后自动淡出；
        // 静态 preview / 默认主页（无 name）：无后端 loading，立即淡出不挡内容
        if (name) autoDismiss = setTimeout(dismiss, 8000)
        else dismiss()
      })
      // 点击关闭（可提前进入）：focus iframe + 移除覆盖层；首次点击把键盘焦点交给 iframe 内部
      if (overlay) overlay.addEventListener('click', () => { try { frame.focus() } catch {}; dismiss() })
    }
    // ① Web 容器：backend 优先（/api/* 受网关 token 校验）
    fetch(`/api/backend?label=${encodeURIComponent(label)}${gToken ? '&token=' + encodeURIComponent(gToken) : ''}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
      .then((d) => {
        if (!(d && d.url)) throw new Error('no-backend')
        mount(d.url, d.name)
        if (window.__backendHeartbeat) clearInterval(window.__backendHeartbeat)
        window.__backendHeartbeat = setInterval(() => {
          fetch(`/api/backend?label=${encodeURIComponent(label)}&token=${encodeURIComponent(gToken || '')}`).catch(() => {})
        }, 60000)
      })
      .catch(() => {
        // ② ③ 静态 preview / 默认项目主页兜底
        const previewSrc = `/preview/${encodeURIComponent(label)}/index.html${gToken ? '?token=' + encodeURIComponent(gToken) : ''}`
        const defaultSrc = `/default-preview/${encodeURIComponent(label)}/${gToken ? '?token=' + encodeURIComponent(gToken) : ''}`
        if (hasPreview) {
          fetch(previewSrc, { method: 'GET' })
            .then((r) => {
              if (!r.ok) throw new Error('HTTP ' + r.status)
              mount(previewSrc)
            })
            .catch(() => mount(defaultSrc))
        } else {
          mount(defaultSrc)
        }
      })
  }
  function closeProjectPreview() {
    state.preview = null
    if (window.__backendHeartbeat) {
      clearInterval(window.__backendHeartbeat)
      window.__backendHeartbeat = null
    }
    navigate('#mgr/projects') // 回到项目管理视图（hash 路由；预览只从项目胶囊进入）
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

  // 管理入口 tab（插件，含技能预览）：点击 → 主区切换管理视图（侧栏会话列表不变）；再点已选中 tab → 退出管理
  document.querySelectorAll('.mgr-tab').forEach((b) =>
    b.addEventListener('click', () => {
      const k = b.dataset.mgr
      // 管理视图进/出走 hash 路由（#mgr/<kind> / #/）：刷新后可恢复当前管理视图
      if (state.mgr === k) navigate('#/')
      else { saveMgrView(); navigate('#mgr/' + k) }
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

  // ---------- 上下文占用指示（2026-08-23 dsh ContextMeter 移植）----------
  // 数据来自 /api/session 的 context 字段（网关 readSession 提取最后一条 assistant usage，
  // 除以 getContextWindowForModel 窗口）。无数据（无 usage / 无模型窗口）→ hidden。
  // 环形 = 14px/2px 圆环，点击展开 breakdown 面板（headline + ~used/window + 占比条）。
  const ctx = { data: null, open: false }
  const CTX_RADIUS = 5.5
  const CTX_CIRC = 2 * Math.PI * CTX_RADIUS

  // 紧凑 token 计数（dsh formatTokens）：517 / 12.2K / 517K / 1.2M
  function formatTokensCompact(n) {
    const scaled = (v) => (v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10))
    if (n < 1000) return String(n)
    if (n < 1000000) return scaled(n / 1000) + 'K'
    return scaled(n / 1000000) + 'M'
  }

  function renderCtxMeter(context) {
    ctx.data = context || null
    if (!context || !(context.usedTokens >= 0) || !(context.contextWindow > 0)) {
      ctxMeterEl.hidden = true
      ctx.open = false
      ctxPanelEl.hidden = true
      ctxBtnEl.setAttribute('aria-expanded', 'false')
      return
    }
    const percent = context.percent != null
      ? Math.min(100, Math.max(0, Math.round(context.percent)))
      : Math.min(100, Math.round((context.usedTokens / context.contextWindow) * 100))
    const reading = percent + '%'
    const label = '上下文已用 ' + reading
    const dash = (CTX_CIRC * percent / 100).toFixed(3)
    ctxBtnEl.innerHTML = '<svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">' +
      '<circle class="ctx-track" cx="7" cy="7" r="' + CTX_RADIUS + '"/>' +
      '<circle class="ctx-fill" cx="7" cy="7" r="' + CTX_RADIUS + '" stroke-dasharray="' + dash + ' ' + CTX_CIRC.toFixed(3) + '" transform="rotate(-90 7 7)"/>' +
      '</svg>'
    ctxBtnEl.title = label
    ctxBtnEl.setAttribute('aria-label', label)
    ctxPanelEl.innerHTML = ctxPanelHtml(context, percent, reading)
    ctxMeterEl.hidden = false
    if (ctx.open) ctxPanelEl.hidden = false
  }

  // dsh ContextMeter panel：headline「上下文已用」+ 百分比（primary）+ ~used/window（figures）+
  // 单段占比条（transcript 无 system/tools/messages 分解，对齐 dsh breakdown 缺失时的单段回落）
  function ctxPanelHtml(context, percent, reading) {
    const figures = '~' + formatTokensCompact(context.usedTokens) + ' / ' + formatTokensCompact(context.contextWindow)
    // 0% 不渲染段（对齐 dsh parts.filter(width>0)：空上下文显示空轨道，不被 .ctx-segment 的 min-width 画出填充）
    const seg = percent > 0 ? '<div class="ctx-segment" style="width:' + percent + '%"></div>' : ''
    return '<div class="ctx-header">' +
      '<span class="ctx-headline">上下文已用</span>' +
      '<span class="ctx-percent">' + reading + '</span>' +
      '<span class="ctx-headline"></span>' +
      '<span class="ctx-figures">' + figures + '</span>' +
      '</div>' +
      '<div class="ctx-bar">' + seg + '</div>'
  }

  function setCtxOpen(open) {
    ctx.open = open
    ctxPanelEl.hidden = !open
    ctxBtnEl.setAttribute('aria-expanded', open ? 'true' : 'false')
  }
  function closeCtxMeter() { if (ctx.open) setCtxOpen(false) }

  // 浮窗外部关闭（对齐 dsh 语义：mousedown 时机 + contains 判断——mousedown 在 DOM 变更前命中目标，
  // 天然免疫 innerHTML 重渲染把被点元素摘除后 e.target.closest() 返回 null 误判「点外关闭」的浮窗闪关/复开）
  document.addEventListener('mousedown', (e) => {
    // 上下文面板：点 #ctx-meter 外（环形按钮除外，其 click toggle 接管开合）= 关闭（dsh ContextMeter pointerdown）
    if (ctx.open && !ctxMeterEl.contains(e.target)) closeCtxMeter()
    // 风险确认门：点对话框外（遮罩）= 取消（dsh Modal 的 mask onClick=onClose）；点对话框内部不触发「点外关闭」
    const rm = $('risk-modal')
    if (!rm.hidden) {
      const dlg = rm.querySelector('.dialog')
      if (dlg && !dlg.contains(e.target)) { closeRiskModal(); return }
    }
    // 命令菜单：点卡片外（+ 按钮除外，其 click toggle 接管开合）= 关闭（dsh PopupSelectView pointerdown capture）
    if (cmd.open && !cmdPop.contains(e.target) && !$('cmd-btn').contains(e.target)) closeCmdPop()
    // 模型菜单：点 root 外（模型 trigger 除外，其 click toggle 接管开合）= 关闭（dsh ModelSelect mousedown + rootRef.contains）
    if (msel.open && !modelPop.contains(e.target) && !modelSeatEl.contains(e.target)) closeModelPop()
  })
  // 点击空白关闭弹层（@ 浮窗 / 整理会话 / 最近气泡 / 已处理折叠收起）
  document.addEventListener('click', (e) => {
    // @ 浮窗：点浮窗外任意处关闭；点输入内 chip 的 × 删除该 chip
    if (e.target.closest('.mention .m-x')) {
      const chip = e.target.closest('.mention')
      if (chip) removeChip(chip)
      return
    }
    if (!e.target.closest('#mention-pop')) closeMentionPop()
    if (!$('organize-pop').contains(e.target) && !e.target.closest('#recent-more')) $('organize-pop').classList.remove('show')
    if (!bubblePop.contains(e.target) && !e.target.closest('#rail-bubble')) bubblePop.classList.remove('show')
    // 「已处理」折叠展开时，点击列表任意部分 → 收起（summary 点击走原生切换，跳过）
    const df = e.target.closest('details.done-fold')
    if (df && df.open && !e.target.closest('summary')) df.open = false
  })
  // 风险确认门：Escape 关闭（dsh Modal 的 Escape onClose 监听；输入栏 keydown 不覆盖遮罩态）
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (ctx.open) closeCtxMeter()
      if (!$('risk-modal').hidden) closeRiskModal()
    }
  })

  // composer（只读；网关模式由下方 gatewayInit 的 gwSend 接管）
  sendBtn.innerHTML = I.dshSend // 2026-08-21 dsh 移植：发送 = dsh IconSendOutline16
  $('cmd-btn').innerHTML = I.dshPlus // 2026-08-21 dsh 移植：+ 按钮 = dsh IconPlusOutline16（命令菜单）
  // 模型 seat 的 chevron 是静态 DOM（dsh 移植，随 open 翻转），初始塞入 dsh IconChevronDownOutline14
  $('model-seat').querySelector('.chevron').innerHTML = I.dshChevDown
  // 命令菜单 / 模型菜单按钮（2026-08-21 dsh 输入栏移植；controller 定义见下）
  $('cmd-btn').addEventListener('click', () => { if (gateAwait || state.mgr) return; toggleCmdPop() })
  $('model-seat').addEventListener('click', () => { if (gateAwait || state.mgr) return; toggleModelPop() })
  ctxBtnEl.addEventListener('click', () => { if (gateAwait || state.mgr || ctxMeterEl.hidden) return; setCtxOpen(!ctx.open) })
  sendBtn.addEventListener('click', () => {
    if (gateAwait) { gateSubmit(); return } // token 门态：点击发送 = 提交 token
    if (!gwSend()) toast('只读查看 · 无法发送')
  })
  inputEl.addEventListener('keydown', (e) => {
    // token 门态：输入框只做 token 提交
    if (gateAwait) {
      if (e.key === 'Enter') { e.preventDefault(); gateSubmit() }
      return
    }
    // 命令菜单打开：方向键/回车/ESC 走选择逻辑（2026-08-21 dsh 移植，不移动光标、不发送）
    if (cmd.open) {
      if (e.key === 'ArrowDown') { e.preventDefault(); cmdMove(1); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); cmdMove(-1); return }
      if (e.key === 'Enter') { e.preventDefault(); cmdSelect(); return }
      if (e.key === 'Escape') { e.preventDefault(); closeCmdPop(); return }
      return
    }
    // 模型菜单打开：ESC 从 drill 面板退一级再关；方向键移动焦点（2026-08-21 dsh 移植）
    if (msel.open) {
      if (e.key === 'Escape') { e.preventDefault(); modelEscape(); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); mselMove(1); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); mselMove(-1); return }
      return
    }
    // @ 浮窗打开：方向键/回车/ESC 走选择逻辑（不移动光标、不发送）
    if (mention.open) {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveMentionSel(1); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); moveMentionSel(-1); return }
      if (e.key === 'Enter') { e.preventDefault(); selectMention(); return }
      if (e.key === 'Escape') { e.preventDefault(); closeMentionPop(); return }
    }
    // 退格删除光标前的 @chip（含尾随空格）
    if (e.key === 'Backspace' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const chip = mentionBeforeCaret()
      if (chip) { e.preventDefault(); removeChip(chip); return }
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (gateAwait) { gateSubmit(); return } // token 门态：回车 = 提交 token
      if (!gwSend()) toast('只读查看 · 无法发送')
    }
  })

  // 路由
  window.addEventListener('hashchange', route)
  // 默认项目主页（default-preview iframe）点会话 → 父级打开该会话（hash = 会话 uuid）
  window.addEventListener('message', (e) => {
    const d = e.data || {}
    if (d.type === 'floria-open-session' && d.hash) {
      navigate('#/' + encodeURIComponent(d.hash))
      if (isMobile()) setPanel(false)
    }
  })
  // 钉顶回合窗口尺寸变化（旋转/缩放）时，预留空间跟随新容器高度自适应
  window.addEventListener('resize', () => { if (pin.active && pin.reserve) pinReserveApply() })

  // 钉顶滚动监听：用户上滑离开底部 → 仅暂停跟随（pin.follow=false），钉顶/占位保持不解除；
  // 回到底部重挂跟随（触发 pinReserveApply 的解除判定）。滚动不解除钉顶——2026-08-22 恢复：
  // 2026-08-20 加的「上滑即 pinRelease」过度敏感，用户仅轻微滑动占位即消失。处理折叠展开
  // 撑满视口、回复撑满视口的让位/解除均由 pinReserveApply 内容驱动（roundFoldOpen/replied
  // 判定 + toggle 重算），无需滚动监听介入。
  $('chat-scroll').addEventListener('scroll', () => {
    if (!pin.active || !pin.el || !pin.el.isConnected || pin.animT) return
    const sc = $('chat-scroll')
    const atBottom = sc.scrollTop >= sc.scrollHeight - sc.clientHeight - 40
    if (atBottom) {
      if (!pin.follow) { pin.follow = true; pinScrollFollow() } // 回底重挂跟随 → 解除判定
    } else {
      pin.follow = false // 上滑离开底部：仅暂停跟随，钉顶保持，回底重挂
    }
  })
  // 展开/收起处理折叠（details toggle）→ 内容高度变化，重算钉顶占位：展开的处理折叠内容
  // 撑满视口即临时让位（roundFoldOpen 判正文，折叠收起后恢复钉顶），收起后短内容重新补回占位。
  messagesEl.addEventListener('toggle', () => { if (pin.active) pinReserveApply() }, true)

  // ---------- 网关模式（SubPj2 私有化网关）----------
  // 检测 /api/health 返回 mode==='gateway' 即启用：composer 可发、WS 双向、工具审批。
  // 只读查看模式（SubPj1 后端）下本块全部不生效。
  let GATEWAY = false
  let GATEWAY_REVIEW = false // 审阅模式（server.mjs REVIEW_GATEWAY）：health 带 review 标志，token 门不建真 WS 直接走视觉流程
  let HOT_RELOAD = false // 开发审阅热重载（server.mjs HOT_RELOAD）：health 带 hotReload 标志，建 SSE 监听 public 变化自动刷新
  let gateAwait = false // token 门态：网关 token 验证通过前锁定为全空白 + 中间输入框
  let gToken = new URLSearchParams(location.search).get('token') || ''
  let gws = null
  let cur = null // 当前正在流的 assistant 消息元素

  // 安全加固（2026-08-15）：数据接口 URL 统一附加网关 token（query），与 WS 升级校验一致。
  // token 门锁定态（GATEWAY 且尚无 token）下不发数据请求，待 hideGate 解锁后重新加载。
  const needToken = () => GATEWAY && !gToken
  function apiUrl(path) {
    const q = path.includes('?') ? '&' : '?'
    return path + q + 'token=' + encodeURIComponent(gToken)
  }

  function gatewayCss() {
    const s = document.createElement('style')
    s.textContent = `
      #send-btn.enabled{opacity:1;cursor:pointer}
      /* 2026-08-21 审批卡：DSH ApprovalPanel 完全移植（warn 语义令牌就地映射）——
         amber 顶部条带[8px 圆点 + 13/18 文字] + 正文[15/24 500 headline + mono 命令] + 右对齐胶囊按钮。
         2026-08-22 composer takeover：审批卡占输入栏，.appr-card 提为全局（去掉 .msg.approval 作用域） */
      .appr-card{overflow:hidden;width:100%;border:1px solid #fcd34d;border-radius:20px;background:#fff;box-shadow:0 4px 12px 0 rgba(0,0,0,.02),0 2px 8px 0 rgba(0,0,0,.04)}
      .appr-strip{display:flex;align-items:center;gap:8px;padding:10px 16px;background:#fef3c7;color:#b45309;font-size:13px;line-height:18px}
      .appr-strip .appr-dot{flex:none;width:8px;height:8px;border-radius:50%;background:#b45309}
      .appr-body{display:flex;flex-direction:column;gap:6px;box-sizing:border-box;max-height:200px;overflow-y:auto;padding:12px 16px 0}
      .appr-headline{color:var(--text);font-size:15px;font-weight:500;line-height:24px}
      .appr-command{color:var(--text-2);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:13px;line-height:20px;word-break:break-all;white-space:pre-wrap}
      .appr-btns{display:flex;justify-content:flex-end;gap:8px;padding:14px 16px}
      .appr-btns button{height:32px;padding:0 16px;border-radius:999px;font-size:13px;font-weight:500;line-height:18px;cursor:pointer;border:1px solid var(--border);background:#fff;color:var(--text-2)}
      .appr-btns button:disabled{opacity:.5;cursor:default}
      .appr-deny:hover:not(:disabled){background:#fef2f2;color:#dc2626;border-color:transparent}
      .appr-allow{border:none!important;background:#4176e6!important;color:#fff!important}
      .appr-allow:hover:not(:disabled){background:#679efe!important}`
    document.head.appendChild(s)
  }

  // ---------- @ 提及（2026-08-15）：输入 @ 弹出「插件/技能 + 近48h 会话」浮窗，选中插入内联 chip ----------
  // 消息文本中 chip 序列化为 [插件:名称] / [会话:名称] 令牌（CLI 终端渲染为 [名称]，遥测端渲染为 chip；
  // 令牌保留 kind 供两端差异化渲染 + 未来插件激活扩展）。
  const MENTION_PLUGIN_RE = /\[插件:([^\]]+)\]/g
  const MENTION_SESSION_RE = /\[会话:([^\]]+)\]/g
  // @ 提及 icon：与侧栏插件/项目 tab 一致，纯线条（stroke）风格，颜色走 currentColor
  const MENTION_PLUGIN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M10.2 3.5H4.6a1.1 1.1 0 0 0-1.1 1.1v5.6a1.1 1.1 0 0 0 1.1 1.1h5.6a1.1 1.1 0 0 0 1.1-1.1V4.6a1.1 1.1 0 0 0-1.1-1.1z"/><path d="M19.4 3.5h-5.6a1.1 1.1 0 0 0-1.1 1.1v5.6a1.1 1.1 0 0 0 1.1 1.1h5.6a1.1 1.1 0 0 0 1.1-1.1V4.6a1.1 1.1 0 0 0-1.1-1.1z"/><path d="M10.2 13.7H4.6a1.1 1.1 0 0 0-1.1 1.1v5.6a1.1 1.1 0 0 0 1.1 1.1h5.6a1.1 1.1 0 0 0 1.1-1.1v-5.6a1.1 1.1 0 0 0-1.1-1.1z"/><path d="M19.4 13.7h-5.6a1.1 1.1 0 0 0-1.1 1.1v5.6a1.1 1.1 0 0 0 1.1 1.1h5.6a1.1 1.1 0 0 0 1.1-1.1v-5.6a1.1 1.1 0 0 0-1.1-1.1z"/></svg>'
  const MENTION_SESSION_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M4 5h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8l-5 3.5v-3.5H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/></svg>'
  let mention = { open: false, sentinel: null, q: '', items: [], sel: 0 }

  // chip HTML（name 为已转义文本：mdInline/addUser 入口已 esc，这里不再二次转义）
  // 消息内渲染=透明胶囊（无图标），仅保留名称文本（用户要求「只要一个白色浮窗似的胶囊」→ 透明胶囊）
  function mentionChipHtml(kind, name) {
    return `<span class="mention-chip ${kind === 'session' ? 'm-session' : 'm-plugin'}">${name}</span>`
  }

  // 实时回显的用户消息：把令牌转 chip（与离线 messagesHtml 的 mdInline 一致）
  function renderUserText(text) {
    return esc(text)
      .replace(MENTION_PLUGIN_RE, (_, n) => mentionChipHtml('plugin', n))
      .replace(MENTION_SESSION_RE, (_, n) => mentionChipHtml('session', n))
  }

  // 序列化 contenteditable → 纯文本（chip → [插件:X]/[会话:X]，nbsp→空格，块级→换行）
  function serializeInput() {
    let out = ''
    const walk = (nodes) => {
      for (const n of nodes) {
        if (n.nodeType === 3) { out += n.nodeValue; continue }
        if (n.nodeType !== 1) continue
        if (n.classList && n.classList.contains('mention')) {
          out += n.dataset.kind === 'session' ? `[会话:${n.dataset.name}]` : `[插件:${n.dataset.name}]`
        } else if (n.tagName === 'BR') {
          out += '\n'
        } else {
          walk(n.childNodes)
          if (/^(DIV|P)$/.test(n.tagName)) out += '\n'
        }
      }
    }
    walk(inputEl.childNodes)
    return out.replace(/\u00A0/g, ' ')
  }

  function closeMentionPop() {
    if (mention.sentinel && mention.sentinel.isConnected) mention.sentinel.remove()
    mention.open = false
    mention.sentinel = null
    mention.q = ''
    mention.items = []
    mention.sel = 0
    const pop = $('mention-pop')
    if (pop) pop.hidden = true
  }

  // 在光标处插入零宽锚点（紧跟 @），作为「@查询区间」标记；后续输入夹在 @ 与锚点之间
  function ensureSentinel() {
    if (mention.sentinel && mention.sentinel.isConnected) return mention.sentinel
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount) return null
    const r = sel.getRangeAt(0)
    if (!r.collapsed) return null
    const sp = document.createElement('span')
    sp.className = 'm-sentinel'
    r.insertNode(sp)
    r.setStartAfter(sp); r.setEndAfter(sp)
    sel.removeAllRanges(); sel.addRange(r)
    mention.sentinel = sp
    return sp
  }

  function openMentionPopAtCaret() {
    const sp = ensureSentinel()
    if (!sp) return
    mention.open = true
    mention.sel = 0
    mention.q = ''
    renderMentionPop()
    // 首次打开确保插件/技能清单已加载（异步），加载完用当前查询重新渲染
    loadMgrData().then(() => { if (mention.open) renderMentionPop() }).catch(() => {})
  }

  function mentionItems(q) {
    const ql = (q || '').trim().toLowerCase()
    const match = (s) => !ql || String(s).toLowerCase().includes(ql)
    const items = []
    if (MGR) {
      for (const p of (MGR.plugins && MGR.plugins.personal) || []) if (match(p.n)) items.push({ kind: 'plugin', name: p.n, desc: p.d })
      for (const s of (MGR.skills && MGR.skills.personal) || []) if (match(s.n)) items.push({ kind: 'plugin', name: s.n, desc: s.d })
    }
    const cutoff = Date.now() - 48 * 3600 * 1000 // 会话仅展示近 48 小时
    for (const s of [...ALL].filter((x) => x.updatedAt >= cutoff).sort((a, b) => b.updatedAt - a.updatedAt)) {
      if (match(s.title || '')) items.push({ kind: 'session', name: s.title || '未命名会话', desc: relTime(s.updatedAt) })
    }
    return items
  }

  function renderMentionPop() {
    const pop = $('mention-pop')
    if (!pop || !mention.open) return
    const items = mentionItems(mention.q)
    if (!items.length) { closeMentionPop(); return }
    mention.items = items
    mention.sel = Math.min(mention.sel, items.length - 1)
    let html = ''
    let lastGroup = ''
    let idx = 0
    for (const it of items) {
      const group = it.kind === 'session' ? '会话' : '插件 / 技能'
      if (group !== lastGroup) { html += `<div class="mp-sec">${group}</div>`; lastGroup = group }
      const on = idx === mention.sel ? ' on' : ''
      const icon = `<span class="mp-ic">${it.kind === 'session' ? MENTION_SESSION_ICON : MENTION_PLUGIN_ICON}</span>`
      html += `<button type="button" class="mp-item${on}" data-idx="${idx}">${icon}<span class="mp-t"><span class="mp-nm">${esc(it.name)}</span>${it.desc ? `<span class="mp-d">${esc(it.desc)}</span>` : ''}</span></button>`
      idx++
    }
    pop.innerHTML = html
    pop.hidden = false
    pop.querySelectorAll('.mp-item').forEach((b) =>
      b.addEventListener('click', () => {
        const it = mention.items[+b.dataset.idx]
        if (it) insertMention(it.kind, it.name)
      }),
    )
  }

  function moveMentionSel(d) {
    const n = mention.items.length
    if (!n) return
    mention.sel = (mention.sel + d + n) % n
    const pop = $('mention-pop')
    if (!pop) return
    pop.querySelectorAll('.mp-item').forEach((b, i) => b.classList.toggle('on', i === mention.sel))
    const el = pop.querySelector('.mp-item.on')
    if (el) el.scrollIntoView({ block: 'nearest' })
  }

  function selectMention() {
    const it = mention.items[mention.sel]
    if (it) insertMention(it.kind, it.name)
  }

  // 选中项 → 用 chip + 尾随空格替换 @查询区间，光标放到空格后
  function insertMention(kind, name) {
    const sp = mention.sentinel
    if (sp && sp.isConnected) {
      const prev = sp.previousSibling
      if (prev && prev.nodeType === 3 && /@$/.test(prev.nodeValue || '')) {
        prev.nodeValue = prev.nodeValue.replace(/@$/, '')
        if (!prev.nodeValue) prev.remove()
      }
      let nx = sp.nextSibling
      while (nx && nx.nodeType === 3) { const t = nx; nx = nx.nextSibling; t.remove() }
      const chip = document.createElement('span')
      chip.className = 'mention'
      chip.contentEditable = 'false'
      chip.dataset.kind = kind
      chip.dataset.name = name
      chip.innerHTML = `<span class="m-ic">${kind === 'session' ? MENTION_SESSION_ICON : MENTION_PLUGIN_ICON}</span><span class="m-nm">${esc(name)}</span><span class="m-x" title="删除">×</span>`
      sp.replaceWith(chip)
      const space = document.createTextNode('\u00A0')
      chip.after(space)
      const sel = window.getSelection()
      const r = document.createRange()
      r.setStartAfter(space); r.collapse(true)
      sel.removeAllRanges(); sel.addRange(r)
    }
    closeMentionPop()
    inputEl.focus()
    syncGwSend()
  }

  function removeChip(chip) {
    let nx = chip.nextSibling
    if (nx && nx.nodeType === 3 && /^\s*$/.test(nx.nodeValue)) nx.remove()
    chip.remove()
    syncGwSend()
  }

  // 光标前的 @chip（跳过尾随空格文本），供退格/× 删除
  function mentionBeforeCaret() {
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount || !sel.isCollapsed) return null
    const node = sel.anchorNode
    if (!node) return null
    let prev = null
    if (node.nodeType === 3) {
      const off = sel.anchorOffset
      if (off === 0) prev = node.previousSibling
      else if (off >= node.nodeValue.length && /^\s*$/.test(node.nodeValue)) prev = node.previousSibling
      else if (/^\s+$/.test(node.nodeValue.slice(0, off))) prev = node.previousSibling
      else return null
    } else if (node.nodeType === 1) {
      // 光标落在根元素（contenteditable 本体）边界：取光标前一个子节点（跳过随后的空白后找 chip）；
      // 落在其它子元素（块级 div/p）时沿用「其前一个兄弟」。
      prev = (node === inputEl) ? node.childNodes[sel.anchorOffset - 1] : node.previousSibling
    }
    while (prev && prev.nodeType === 3 && /^\s*$/.test(prev.nodeValue || '')) prev = prev.previousSibling
    if (prev && prev.nodeType === 1 && prev.classList && prev.classList.contains('mention')) return prev
    return null
  }

  // input 事件：检测 @ 触发 / 维护已打开的 @查询（光标前是 @ 则开浮窗）
  function onInputMention() {
    if (!GATEWAY || gateAwait || state.mgr) { closeMentionPop(); return }
    if (mention.sentinel && mention.sentinel.isConnected) {
      const sp = mention.sentinel
      const prev = sp.previousSibling
      const ok = prev && prev.nodeType === 3 && /@$/.test(prev.nodeValue || '')
      if (!ok) { closeMentionPop(); return }
      let q = ''
      let nx = sp.nextSibling
      while (nx && nx.nodeType === 3) { q += nx.nodeValue; nx = nx.nextSibling }
      if (q !== mention.q) { mention.q = q; renderMentionPop() }
      return
    }
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount || !sel.isCollapsed) return
    const node = sel.anchorNode
    if (node && node.nodeType === 3 && node.nodeValue.slice(0, sel.anchorOffset).endsWith('@')) {
      openMentionPopAtCaret()
    }
  }
  function onInputChange() { syncGwSend(); onInputMention() }

  // ---------- 命令菜单 + 模型选择（2026-08-21 dsh 输入栏逻辑移植）----------
  // ⚠️ 数据源 = 本地内置展示数据（⚠️ 非 dsh 真实注册表、非网关接口）：
  // 网关暂无 /api/commands 与 /api/models，命令列表/模型目录先本地内置供 UI 审阅——
  // 命令 = floria(Claude Code) 真实斜杠命令（claim=带参数/bare=直接执行/risk=需确认门），
  // 模型目录 = 真实 Claude 模型（对齐 dsh ModelDirectory：provider 分组 + reasoning.defaultEffort/efforts[]）。
  // 待网关接口就绪后替换数据源，交互逻辑不变。
  const MOCK_COMMANDS = [
    { name: 'compact', desc: '压缩当前会话上下文', claim: true },
    { name: 'clear', desc: '清除当前会话上下文', risk: '将清空当前会话的所有消息（含文件状态与上下文），不可恢复。' },
    { name: 'model', desc: '切换模型', claim: true },
    { name: 'permission', desc: '调整权限模式', claim: true },
    { name: 'plan', desc: '进入计划模式', claim: true },
    { name: 'rename', desc: '重命名会话', claim: true },
    { name: 'resume', desc: '继续子代理会话', claim: true },
    { name: 'retry', desc: '重试上一条消息', bare: true },
    { name: 'status', desc: '会话状态', bare: true },
    { name: 'skills', desc: '查看可用技能', bare: true },
    { name: 'plugins', desc: '查看插件清单', bare: true },
  ]
  // 推理等级（全局：Off/Low/High/Max，对齐 CLI effortValue 语义；Off=不发送 effort 参数。2026-08-22 由 per-model reasoning 改为全局）
  const EFFORT_LEVELS = [
    { id: 'low', name: 'Low' },
    { id: 'high', name: 'High' },
    { id: 'max', name: 'Max' },
  ]
  // 模型目录（真实凭据池，与 floria MGR 模型 tab 同源）：providerModels=当前供应商可切换清单（网关 switchModel 校验集），
  // 无 activeProvider 时回落 /api/models items（全部供应商池化模型）。2026-08-22 取代 MOCK_MODEL_DIR（anthropic 上游）。
  function modelDir() {
    const raw = (MODELS && Array.isArray(MODELS.providerModels) && MODELS.providerModels.length)
      ? MODELS.providerModels
      : ((MODELS && Array.isArray(MODELS.items) ? MODELS.items : []).map(it => String(it.v)).filter(Boolean))
    const seen = new Set()
    const out = []
    for (const id of raw) {
      if (!id || seen.has(id)) continue
      seen.add(id)
      out.push(id)
    }
    return out
  }
  // 当前选中模型（本地状态；首次 /api/models 加载后与凭据池 activeModel/provider/effortLevel 对齐）
  let MODEL_CUR = { provider: '', model: '', effortLevel: undefined }
  // 命令菜单状态（对齐 dsh PopupState：open/status/options/search/active/submitting/confirming/acknowledged/error）
  const cmd = { open: false, status: 'pending', options: [], search: '', active: 0, submitting: false, confirming: null, acknowledged: false, error: null }
  // 模型菜单状态（对齐 dsh ModelSelect Pane：root | model | effort）
  const msel = { open: false, pane: 'root', active: 0 }
  const cmdPop = $('cmd-pop')
  const modelPop = $('model-pop')
  const modelSeatEl = $('model-seat')

  // ---- 命令菜单（dsh PopupSelectController 移植：open→加载一次→本地过滤→高亮→选择→确认门）----
  function cmdFiltered() {
    const q = cmd.search.trim().toLowerCase().replace(/^\//, '')
    if (!q) return cmd.options
    return cmd.options.filter(o => o.name.toLowerCase().includes(q) || (o.desc && o.desc.toLowerCase().includes(q)))
  }
  function toggleCmdPop() {
    if (cmd.open) { closeCmdPop(); return }
    if (msel.open) closeModelPop()
    closeMentionPop()
    cmd.open = true
    cmd.status = 'ready' // 本地内置列表同步就绪（dsh PopupState：pending→ready 即出列表）
    cmd.options = MOCK_COMMANDS
    cmd.search = ''
    cmd.active = 0
    cmd.confirming = null
    cmd.acknowledged = false
    cmd.error = null
    renderCmdPop()
  }
  function closeCmdPop() {
    if (!cmd.open) return
    cmd.open = false
    cmd.confirming = null
    cmd.acknowledged = false
    cmdPop.hidden = true
    const rm = $('risk-modal')
    if (!rm.hidden) closeRiskModal()
  }
  function renderCmdPop() {
    if (!cmd.open) return
    // dsh confirmation gate：确认态下命令卡隐藏，改由全屏 RiskConfirmation 模态接管
    if (cmd.confirming) { cmdPop.hidden = true; renderRiskModal(); return }
    const items = cmdFiltered()
    let html = `<input class="search" type="text" placeholder="搜索命令…" aria-label="搜索命令" autocomplete="off"/>`
    if (cmd.error !== null) {
      html += `<div class="error" role="alert"><span class="errorText">${esc(cmd.error)}</span>${cmd.status === 'failed' ? `<button type="button" class="retry">重试</button>` : ''}</div>`
    } else if (cmd.status === 'pending') {
      html += `<div class="status">加载中…</div>`
    } else if (cmd.status === 'ready' && !items.length) {
      html += `<div class="status">没有匹配的命令</div>`
    } else if (cmd.status === 'ready') {
      html += `<div role="listbox" class="viewport">${items.map((o, i) => {
        const on = i === cmd.active ? ' rowActive' : ''
        return `<button type="button" role="option" aria-selected="${i === cmd.active}" class="row${on}" data-idx="${i}"><span class="label">/${o.name}</span>${o.desc ? `<span class="detail">${esc(o.desc)}</span>` : ''}${o.active === true ? `<span class="check">${I.dshCheck}</span>` : ''}</button>`
      }).join('')}</div>`
    }
    cmdPop.innerHTML = html
    cmdPop.hidden = false
    // 搜索输入：本地过滤（dsh 语义——敲字不重查选项；←→ 保留原生光标）
    const box = cmdPop.querySelector('.search')
    if (box) {
      box.value = cmd.search
      box.addEventListener('input', () => { cmd.search = box.value; cmd.active = 0; renderCmdPop() })
      box.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); cmdMove(1) }
        if (e.key === 'ArrowUp') { e.preventDefault(); cmdMove(-1) }
        if (e.key === 'Enter') { e.preventDefault(); cmdSelect() }
        if (e.key === 'Escape') { e.preventDefault(); closeCmdPop() }
      })
      box.focus()
    }
    cmdPop.querySelectorAll('.row').forEach(b => b.addEventListener('click', () => { cmd.active = +b.dataset.idx; cmdSelect() }))
    cmdPop.querySelector('.retry')?.addEventListener('click', () => { cmd.error = null; cmd.status = 'ready'; renderCmdPop() })
    const on = cmdPop.querySelector('.row.rowActive')
    if (on) on.scrollIntoView({ block: 'nearest' })
  }
  // 风险确认门（dsh RiskConfirmation + Modal 移植）：全屏遮罩 + 居中对话框，checkbox 勾选后才可确认
  function renderRiskModal() {
    const o = cmd.confirming
    if (!o) { const m = $('risk-modal'); if (!m.hidden) m.hidden = true; return }
    const rm = $('risk-modal')
    rm.innerHTML = `
      <div class="mask"></div>
      <div class="dialog" role="dialog" aria-modal="true" aria-label="执行 /${esc(o.name)}？">
        <div class="header">
          <h2 class="title">执行 /${esc(o.name)}？</h2>
          <button type="button" class="close" aria-label="关闭">${I.dshClose}</button>
        </div>
        <div class="body">
          <div class="warning">${I.dshWarn}<p>${esc(o.risk)}</p></div>
          <label class="acknowledgement"><input type="checkbox" ${cmd.acknowledged ? 'checked' : ''}/><span>我已了解该操作的风险</span></label>
        </div>
        <div class="footer">
          <button type="button" class="button outline">取消</button>
          <button type="button" class="button primary" ${cmd.acknowledged ? '' : 'disabled'}>确认执行</button>
        </div>
      </div>`
    rm.hidden = false
    const cb = rm.querySelector('.acknowledgement input')
    if (cb) cb.addEventListener('change', () => { cmdAck(cb.checked) })
    // 无需 stopPropagation：外部关闭已改 mousedown+contains（mousedown 在重渲染前命中目标），不再误判（dsh Modal 同语义）
    rm.querySelector('.mask')?.addEventListener('click', () => closeRiskModal())
    rm.querySelector('.close')?.addEventListener('click', () => closeRiskModal())
    rm.querySelector('.outline')?.addEventListener('click', () => closeRiskModal())
    rm.querySelector('.primary')?.addEventListener('click', () => cmdConfirm())
  }
  // 取消确认：清除确认态、恢复命令列表（dsh cancelConfirmation：确认卡关闭、列表重显）
  function closeRiskModal() {
    const rm = $('risk-modal')
    rm.hidden = true
    rm.innerHTML = ''
    cmd.confirming = null
    cmd.acknowledged = false
    renderCmdPop()
  }
  function cmdMove(d) {
    const n = cmdFiltered().length
    if (!n) return
    cmd.active = (cmd.active + d + n) % n
    renderCmdPop()
  }
  function cmdSelect() {
    const o = cmdFiltered()[cmd.active]
    if (!o || cmd.submitting) return
    if (o.risk) { cmd.confirming = o; cmd.acknowledged = false; renderCmdPop(); return }
    cmdSettle(o)
  }
  function cmdAck(v) { cmd.acknowledged = v; renderCmdPop() }
  function cmdConfirm() {
    if (!cmd.confirming || !cmd.acknowledged) return
    const o = cmd.confirming
    cmd.confirming = null
    cmd.acknowledged = false
    cmdSettle(o)
  }
  // 选择落地：把命令文本写入输入栏（claim 带参数提示 / bare 直接插入），回车发送由 CLI 端执行；本地展示同闭环
  function cmdSettle(o) {
    setInputText(o.claim ? `/${o.name} ` : `/${o.name}`)
    closeCmdPop()
    inputEl.focus()
    toast(`命令已写入输入栏：/${o.name}（回车发送）`)
  }
  function setInputText(text) {
    if (inputEl.contentEditable !== 'true') return
    inputEl.textContent = text
    syncGwSend()
  }

  // ---- 模型选择（dsh ModelSelect 移植：trigger 显示「模型名 · 推理等级」，root 两行 Model/Effort 各自 drill）----
  // 当前选中模型 id：本地 MODEL_CUR 优先，未同步时回落 MODELS 的 activeModel/model（凭据池同源）
  function currentChoice() {
    const id = MODEL_CUR.model || (MODELS && (MODELS.activeModel || (MODELS.model ? String(MODELS.model) : ''))) || ''
    if (!id) return null
    return { model: { id, name: id } }
  }
  // 推理等级名（全局；effortLevel 未设置 = Off）
  function effLabel() {
    const eff = MODEL_CUR.effortLevel
    if (eff === undefined || eff === null) return 'Off'
    const level = EFFORT_LEVELS.find(e => e.id === eff)
    return level ? level.name : String(eff)
  }
  function renderModelSeat() {
    // 显示源 = currentChoice()（MODEL_CUR.model，用户切换后即时更新），不用 MODELS.model 缓存——
    // 否则切换后仍显示初次加载的旧模型（用户反馈「输入栏没同步最新模型」）。
    const c = currentChoice()
    const name = c ? c.model.name : '选择模型'
    const eff = MODEL_CUR.effortLevel != null ? effLabel() : ''
    // dsh ModelSelect trigger：.triggerLabel=模型名 + .triggerEffort=推理等级（无则隐藏）+ 静态 .chevron（随 open 翻转）
    const label = modelSeatEl.querySelector('.triggerLabel')
    const effort = modelSeatEl.querySelector('.triggerEffort')
    if (label) label.textContent = name
    if (effort) { if (eff) { effort.textContent = eff; effort.hidden = false } else effort.hidden = true }
    modelSeatEl.title = eff ? `${name} · ${eff}` : name
    modelSeatEl.dataset.real = c ? '1' : ''
    // 真实配置尚未拉取且未过 token 门 → 懒加载一次（成功后重渲触发座，静默失败保留占位）
    if (!c && !needToken() && !MODELS_LOADING && !MODELS) {
      loadModelsData(false).then(() => renderModelSeat()).catch(() => {})
    }
  }
  function toggleModelPop() {
    if (msel.open) { closeModelPop(); return }
    if (cmd.open) closeCmdPop()
    closeMentionPop()
    msel.open = true
    msel.pane = 'root'
    msel.active = 0
    renderModelPop()
    inputEl.focus({ preventScroll: true }) // 焦点留输入栏：方向键/ESC 走 keydown
  }
  function closeModelPop() {
    if (!msel.open) return
    msel.open = false
    modelPop.hidden = true
    modelSeatEl.querySelector('.chevron')?.classList.remove('open')
  }
  function modelEscape() {
    if (msel.pane !== 'root') { msel.pane = 'root'; msel.active = 0; renderModelPop() } else closeModelPop()
  }
  // 当前面板的可导航行（root=两 cell；model=凭据池模型按 provider 序；effort=Off + Low/High/Max）
  function mselRows() {
    if (msel.pane === 'model') {
      const rows = []
      for (const id of modelDir()) rows.push({ kind: 'model', id })
      return rows
    }
    if (msel.pane === 'effort') {
      const rows = [{ kind: 'effort', effort: undefined, label: 'Off' }]
      for (const e of EFFORT_LEVELS) rows.push({ kind: 'effort', effort: e.id, label: e.name })
      return rows
    }
    return [{ kind: 'cell', cell: 'model' }, { kind: 'cell', cell: 'effort' }]
  }
  function mselMove(d) {
    const n = mselRows().length
    if (!n) return
    msel.active = (msel.active + d + n) % n
    renderModelPop()
  }
  function renderModelPop() {
    if (!msel.open) return
    let html = ''
    if (msel.pane === 'root') {
      // dsh root 面板：Model / Effort 两行 cell（label + value + 右 chevron），无返回按钮（dsh 用 Escape 退级）
      const c = currentChoice()
      const mname = c ? c.model.name : '—'
      const ename = effLabel() || '—'
      html += `<button type="button" class="cell"><span class="cellLabel">模型</span><span class="cellValue">${esc(mname)}</span><span class="cellChevron">${I.dshChevRight}</span></button>`
      html += `<button type="button" class="cell"><span class="cellLabel">推理等级</span><span class="cellValue">${esc(ename)}</span><span class="cellChevron">${I.dshChevRight}</span></button>`
    } else if (msel.pane === 'model') {
      // dsh model 面板：.groups > .group[.groupTitle + .option×]，check 尾勾；分组按凭据池供应商（与 MGR 模型 tab 同判据）
      const ids = modelDir()
      if (!ids.length) {
        html += `<div class="empty">暂无模型</div>`
      } else {
        html += `<div class="groups">`
        const groups = []
        for (const id of ids) {
          const p = modelProviderOf({ k: id, v: id })
          let g = groups.find((x) => x.provider === p)
          if (!g) { g = { provider: p, items: [] }; groups.push(g) }
          g.items.push(id)
        }
        let idx = 0
        const curId = currentChoice()?.model.id
        for (const g of groups) {
          html += `<div class="group"><div class="groupTitle">${esc(g.provider)}</div>`
          for (const id of g.items) {
            const on = idx === msel.active ? ' on' : ''
            const selected = id === curId
            html += `<button type="button" class="option${on}" data-idx="${idx}" role="menuitemradio" aria-checked="${selected}"><span class="optionCopy"><span class="modelName">${esc(id)}</span></span><span class="check">${selected ? I.dshCheck : ''}</span></button>`
            idx++
          }
          html += `</div>`
        }
        html += `</div>`
      }
    } else if (msel.pane === 'effort') {
      // dsh effort 面板：扁平 option 列表（Off + Low/High/Max，无 groups 包裹）
      let idx = 0
      const curEff = MODEL_CUR.effortLevel
      for (const r of mselRows()) {
        const on = idx === msel.active ? ' on' : ''
        // Off 项只在「未显式选择等级」时勾选；具体等级按当前显式值匹配
        const selected = r.effort === undefined ? curEff === undefined : curEff === r.effort
        html += `<button type="button" class="option${on}" data-idx="${idx}" role="menuitemradio" aria-checked="${selected}"><span class="optionCopy"><span class="modelName">${esc(r.label)}</span></span><span class="check">${selected ? I.dshCheck : ''}</span></button>`
        idx++
      }
    }
    modelPop.innerHTML = html
    modelPop.hidden = false
    modelSeatEl.querySelector('.chevron')?.classList.add('open')
    // cell/option 点击不再需要 stopPropagation：外部关闭已改 mousedown+contains（mousedown 在重渲染前命中目标，
    // innerHTML 摘除节点不再误判「点外关闭」，dsh ModelSelect 同语义）
    modelPop.querySelectorAll('.cell').forEach((b, i) => b.addEventListener('click', () => { msel.pane = i === 0 ? 'model' : 'effort'; msel.active = 0; renderModelPop() }))
    modelPop.querySelectorAll('.option').forEach(b => b.addEventListener('click', () => { msel.active = +b.dataset.idx; mselChoose() }))
    const on = modelPop.querySelector('.option.on')
    if (on) on.scrollIntoView({ block: 'nearest' })
  }
  // 2026-08-22 模型/思考等级切换接通网关：POST /api/model（持久化写 settings.json + 广播实时生效），
  // 非网关环境（无 gToken）返回 false → toast 提示。
  async function apiSetModel(body) {
    if (!gToken) return false
    try {
      const res = await fetch(apiUrl('/api/model'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      return res.ok
    } catch { return false }
  }
  function mselChoose() {
    const row = mselRows()[msel.active]
    if (!row) return
    if (msel.pane === 'model') {
      const id = row.id
      if (MODEL_CUR.model === id) { closeModelPop(); return }
      MODEL_CUR = { ...MODEL_CUR, model: id }
      renderModelSeat()
      closeModelPop()
      // 2026-08-23 用户定案：model 每会话覆盖，带 sessionId 精确路由，网关不广播兜底
      void apiSetModel({ model: id, sessionId: state.currentHash || undefined })
        .then(ok => toast(ok ? `模型已切换为 ${id}` : '切换失败 · 目标会话未在线或网关未连接'))
    } else if (msel.pane === 'effort') {
      const eff = row.effort === undefined ? undefined : row.effort
      if (MODEL_CUR.effortLevel === eff) { closeModelPop(); return }
      MODEL_CUR = { ...MODEL_CUR, effortLevel: eff }
      renderModelSeat()
      closeModelPop()
      // Off（清除等级）发 'off'，网关据此 delete settings.effortLevel + 广播 null → CLI effortValue=undefined
      const payload = eff === undefined ? { effortLevel: 'off' } : { effortLevel: eff }
      void apiSetModel(payload).then(ok => toast(ok ? `推理等级已切换为 ${row.label}` : '切换失败 · 网关未连接'))
    }
  }
  renderModelSeat() // 初始渲染模型 seat（trigger 显示当前模型名 · 推理等级）

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
  const pin = { active: false, key: null, el: null, top: null, follow: false, animT: null, settleT: null, lastReplyLen: -1, reserve: false, replied: false, temp: false }
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
    pin.follow = false; pin.lastReplyLen = -1; pin.reserve = false; pin.replied = false; pin.temp = false
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

  // 本回合处理折叠是否展开：处理中（done-live 自动展开）与用户手动展开「已处理」折叠（只读
  // 路径回复落地后 done-live 被移除、只剩 done-fold）都算「正文」——roundFoldOpen() 直接参与
  // 钉顶解除判定，处理过程撑满视口即解除，让消息上滑、思考/工具过程可滚动阅读。折叠须归属
  // 当前（钉顶）回合：实时（WS）路径折叠是钉顶用户消息的直接后续兄弟，只读（SSE）路径折叠
  // 嵌套在钉顶用户消息的回复消息内；两者取其一，避免历史回合展开的折叠误解除钉顶。
  function roundFoldOpen() {
    const next = pin.el && pin.el.nextElementSibling
    if (!next) return false
    const fold = next.matches('details.done-fold')
      ? next
      : next.querySelector('details.done-fold')
    return !!(fold && fold.open)
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
    // 内容已 ≥ 目标：占位无法为负，撤掉。本回合已有「正文」（正式回复 pin.replied，或展开的
    // 处理/思考折叠 roundFoldOpen——思考、工具调用如编辑文件本身就是正文）即平滑解除钉顶，
    // 此刻 scrollTop 恰等于 pin.top（消息自然位 = 视口顶）→ 消息随内容自然上滑出视口
    // （ChatGPT 式过渡），处理/思考过程可全屏滚动阅读；否则（钉顶初始、内容全为历史时 baseH
    // 已大）只撤占位、保持钉顶，等正文出现。2026-08-20：放开 roundFoldOpen——此前展开的处理
    // 折叠不被识别为正文，钉顶消息 sticky 悬浮遮挡可滚动阅读的思考/工具过程。
    if (baseH >= target) {
      if (sp) sp.remove()
      if (pin.replied || roundFoldOpen()) {
        const sc = $('chat-scroll')
        const wasFollow = pin.follow
        // 处理折叠展开撑满视口（roundFoldOpen）= **临时让位**：仅移除 sticky 让思考/工具过程
        // 可滚动阅读，但保留钉顶资格（el/key/top）——折叠收起后内容变短即由下方占位分支恢复
        // 钉顶（2026-08-20 用户反馈：展开撑满解除占位后折叠长度缩减、占位消失导致钉失效）。
        // 无论是否已出正式回复都走临时让位：展开的「已处理」折叠撑满视口只是折叠内容撑满、
        // 并非回复正文长，折叠收起须能恢复钉顶——此前用 `roundFoldOpen() && !pin.replied`
        // 门住，回复落地后展开折叠落回永久 pinRelease()，折叠后钉顶消失（2026-08-23 用户反馈）。
        // 正式回复正文自身撑满视口（pin.replied 且折叠未展开）= 永久解除（长回复完成）。
        if (roundFoldOpen()) {
          pin.el.classList.remove('msg-pin')
          pin.temp = true
          pin.follow = false
          if (wasFollow || sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 40) {
            sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' })
            smoothDismissPending = true // 本帧内各调用点 auto 吸底让位
          }
          return
        }
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
    // 内容未满一屏：临时让位中内容变短（如折叠处理折叠）→ 恢复钉顶 sticky，重算吸附位
    if (pin.temp) {
      pin.el.classList.add('msg-pin')
      pin.temp = false
      pin.top = pinNaturalTop()
      pin.follow = true
    }
    // 目标：加占位后 scrollHeight 恰为 target → maxScrollTop == pin.top，吸底时消息贴顶、
    // 视口恰满、无死区、无跳动。边界时高算 0 也保留元素：靠 flex gap 补足，避免撤占位丢掉
    // gap 使吸底差一截、消息贴不到顶（rel>0）。target 用恢复后的 pin.top 重算。
    const h = Math.max(0, Math.round((pin.top + sc.clientHeight) - baseH - mGap))
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
    // 仅当正式回复正文填满视口才永久解除：展开的处理/思考折叠（roundFoldOpen）只是折叠内容
    // 撑满，须临时让位而非永久解除，折叠收起后由 pinReserveApply 恢复钉顶——否则展开折叠会被
    // 误判为「长回复」触发永久解除、折叠后钉顶消失（2026-08-23 用户反馈）。pinReserveApply
    // 已处理临时让位，此处只在折叠收起且回复正文填满视口时兜底解除。
    if (pin.replied && !roundFoldOpen() && baseH >= pin.top + sc.clientHeight) pinRelease() // 回合结束、回复正文填满视口才解除
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
    // 临时让位中（处理折叠展开撑满、sticky 已让位）：重绘后不强制贴 sticky，由下方
    // pinReserveApply 按当前 baseH 判定（仍撑满→保持让位；变短→占位分支恢复钉顶）
    if (!pin.temp) el.classList.add('msg-pin')
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
    liveAskInput = null
    clearTakeover() // 新回合：清掉上一回合残留的提问/审批 takeover
    liveChangeReset() // 2026-08-19：新回合开始收起上一回合残留的变更胶囊
    const div = document.createElement('div')
    div.className = 'msg user msg-in'
    div.innerHTML = `<div class="body">${renderUserText(text)}</div><div class="msg-actions"><button class="msg-copy" title="复制" aria-label="复制">${ICON_COPY}</button></div>`
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
  let procToolGroup = null // 当前实时工具折叠 <details>（连续工具行合并；思考/回复出现即封口另起一组）
  let procStart = 0 // 本次处理开始时间（ms）
  let procTimer = null // 计时器 id
  let liveChanges = new Map() // 当前回合文件变更聚合（tool_result 解析 → result 时渲染卡片）
  function procLabel(verb, dur) {
    const live = verb === '正在处理'
    return `<span class="d-chev">${CHEV}</span>${live ? '<span class="df-dot"></span>' : ''}${verb}${dur ? `<span class="d-dur"> ${dur}</span>` : ''}`
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
    // 注意：思考/工具折叠展开期间**不**置 pin.replied——思考过程不是回复，不构成回复语义。
    // 处理折叠展开本身即「正文」：pinReserveApply 以 roundFoldOpen() 判定，展开的处理/思考
    // 折叠撑满视口时直接解除钉顶（消息上滑让内容可滚动阅读，2026-08-20）。replied 只由
    // streamText / syncPinAfterRender 在回复文本真正出现时置位，标识「正式回复已发布」。
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
    procToolGroup = null // 处理结束：封口当前工具折叠组
    // 回合结束：清掉工具折叠的运行态（扫光/脉冲点停止，对齐 DSH running → ok）
    if (proc && proc.isConnected) proc.querySelectorAll('.tool-fold[data-state="running"]').forEach((el) => el.removeAttribute('data-state'))
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
    procToolGroup = null // 思考出现 → 封口当前工具折叠组，后续工具另起一组（思考与动作关联）
    const d = procOpen()
    const body = d.querySelector('.done-body')
    // start=true = 新一轮思考块开始：清掉折叠区内旧思考行，只保留当前块（对齐 CLI 实时只显示正在思考的块）
    if (start) body.querySelectorAll('.think-row').forEach((el) => el.remove())
    let th = body.lastElementChild
    if (!th || !th.classList || !th.classList.contains('think-row')) {
      th = document.createElement('details')
      th.className = 'think-row'
      th.dataset.state = 'running'
      th.innerHTML = `<summary><span class="tr-leading" aria-hidden="true"><span class="tr-ico">${THINK_ICON}</span><span class="tr-chev">${THINK_CHEV}</span></span><span class="tr-title">思考</span><span class="tr-sep" aria-hidden="true"></span><span class="tr-summary" data-follow-end></span></summary><div class="tr-body"></div>`
      body.appendChild(th)
    }
    th.querySelector('.tr-body').appendChild(document.createTextNode(text))
    // 运行中摘要 = 正文末行（DSH latestLine：trimEnd 后取末行），并把滚动甩到末尾实时跟随
    const sum = th.querySelector('.tr-summary')
    sum.textContent = thinkSummary(th.querySelector('.tr-body').textContent, true)
    sum.scrollLeft = sum.scrollWidth
    scrollBottom()
  }
  function procTool(block) {
    const d = procOpen()
    const body = d.querySelector('.done-body')
    const t = toolMeta(block)
    // 上个元素仍是我们未封口的工具折叠组 → 追加进去；否则（新回合/思考/其它元素之后）另起一组
    let g = procToolGroup
    if (!g || !g.isConnected || body.lastElementChild !== g) {
      g = document.createElement('details')
      g.className = 'tool-fold'
      g.innerHTML = `<summary><span class="d-chev">${CHEV}</span><span class="tf-dot"></span><span class="tf-label"></span></summary><div class="tool-fold-body"></div>`
      body.appendChild(g)
      procToolGroup = g
    }
    // 运行态：只有当前组在跑（扫光 + 脉冲点），其它组清掉（对齐 DSH 只有流式尾块 running）
    body.querySelectorAll('.tool-fold[data-state="running"]').forEach((el) => { if (el !== g) el.removeAttribute('data-state') })
    g.dataset.state = 'running'
    const row = document.createElement('span')
    row.className = 'tool-line'
    row.dataset.name = t.name
    row.innerHTML = `<span class="t-ico">${toolIcon(t.name)}</span>${esc(t.zh)}${t.detail ? ' · ' + esc(t.detail) : ''}`
    g.querySelector('.tool-fold-body').appendChild(row)
    // 重算概括标签（组内工具名集合 → 「运行了命令（3）」风格）
    const names = [...g.querySelectorAll('.tool-line')].map((el) => el.dataset.name)
    const tools = [...new Set(names)].map((n) => ({ name: n, zh: TOOL_NAMES[n] || n }))
    g.querySelector('.tf-label').textContent = toolFoldLabel(tools)
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
      div.innerHTML = `<div class="body"><div class="blocks"></div><div class="msg-actions"><button class="msg-copy" title="复制" aria-label="复制">${ICON_COPY}</button></div></div>`
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
    procThink(text, !(last && last.classList && last.classList.contains('think-row')))
  }
  function toolChip(block) {
    const name = (block && block.name) || 'tool'
    if (name === 'AskUserQuestion') { procAsk(block); return }
    setChar(toolToChar(name)) // 工具调用 → 对应形象（读/搜=3、写/编=2、执行/插件/命令=4）
    procTool(block)
  }
  // ---- composer takeover（2026-08-22 修复）：DSH 提问/审批占输入栏（替换 #input-bar），而非渲染在 chat 内。
  //      takeover = 'ask' | 'approval' | null，记录当前占据输入栏的待答提问/待审批；
  //      解决（tool_result / 审批提交）后 #input-bar 回归（content swap，同输入栏卡片足迹）。 ----
  let takeover = null
  let pendingAskInput = null // messagesHtml 检测到「末尾待答提问」时写入提问 input，供 renderSession/refreshSession 触发 composer takeover
  const takeoverEl = () => $('composer-takeover')
  function showTakeover(html, kind) {
    if (inputBarEl) inputBarEl.style.display = 'none'
    const t = takeoverEl()
    if (t) { t.innerHTML = html; t.hidden = false }
    takeover = kind
    scrollBottom()
  }
  function clearTakeover() {
    if (inputBarEl) inputBarEl.style.display = ''
    const t = takeoverEl()
    if (t) { t.hidden = true; t.innerHTML = '' }
    takeover = null
  }
  // ---- 实时提问卡（AskUserQuestion）：DSH QuestionComposer 语义——提问占输入栏（composer takeover），
  //      不进入 chat 流；tool_result 到来时输入栏回归、已答提问落到处理折叠只读展示 ----
  let liveAskInput = null
  function procAsk(block) {
    setChar(1) // 提问 → 默认形象
    procToolGroup = null // 提问出现 → 封口当前工具折叠组
    liveAskInput = block.input
    showTakeover(questionCardHtml(block.input, null), 'ask')
  }
  function addToolResult(text) {
    // 待答提问 → 输入栏回归，已答提问落到处理折叠只读展示（标记所选）；否则按普通结果行追加
    if (takeover === 'ask' && liveAskInput) {
      clearTakeover()
      const d = procOpen()
      const body = d.querySelector('.done-body')
      const el = document.createElement('div')
      el.className = 'ask-holder'
      el.innerHTML = questionCardHtml(liveAskInput, String(text || ''))
      body.appendChild(el)
      liveAskInput = null
      scrollBottom()
      return
    }
    procResult(text)
  }
  function addThinking(text) {
    // 完成的 assistant 思考块：替换流式增量（去重）并清掉旧思考块，只留当前回合最后一个
    procThink(text, true)
  }

  function renderApproval(a) {
    let input = ''
    try { input = JSON.stringify(a.input, null, 2) } catch { input = String(a.input || '') }
    const zh = TOOL_NAMES[a.toolName] || ''
    const headline = a.justification || a.headline || (zh || a.toolName || '工具调用')
    // 2026-08-22 composer takeover：审批卡占输入栏（DSH ApprovalPanel 语义），不再 appendMsg 进 chat
    showTakeover(`
      <div class="appr-card">
        <div class="appr-strip"><span class="appr-dot"></span>需要批准${zh ? ' · ' + esc(zh) : ''}${a.toolName ? '（' + esc(a.toolName) + '）' : ''}</div>
        <div class="appr-body">
          <div class="appr-headline">${esc(headline)}</div>
          <div class="appr-command">${esc(input)}</div>
        </div>
        <div class="appr-btns">
          <button class="appr-deny">拒绝</button>
          <button class="appr-allow">允许</button>
        </div>
      </div>`, 'approval')
    const t = takeoverEl()
    t.querySelector('.appr-allow').addEventListener('click', () => sendApprove(a.requestId, true))
    t.querySelector('.appr-deny').addEventListener('click', () => sendApprove(a.requestId, false))
  }

  function sendApprove(requestId, allowed) {
    if (!gws || gws.readyState !== 1) return addError('连接已断开，无法审批')
    gws.send(JSON.stringify({ type: 'approve', requestId, allowed }))
    clearTakeover() // 审批提交 → 输入栏回归
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
        else if (c.type === 'tool_use') toolChip(c)
      }
    } else if (t === 'user') {
      const content = (m.message && m.message.content) || []
      const tr = content.filter((c) => c && c.type === 'tool_result')
      for (const c of tr) {
        const text = typeof c.content === 'string' ? c.content : ''
        if (!text) continue
        addToolResult(text)
        const fc = parseFileChange(text)
        if (fc) {
          mergeChanges(liveChanges, fc) // 聚合文件变更 → 回合结束渲染汇总卡片
          updateLiveChangeCapsule() // 2026-08-19：回合中在输入栏上方悬浮变更胶囊
        }
      }
    } else if (t === 'stream_event') {
      const se = m.event || {}
      if (se.type === 'content_block_delta') {
        const d = se.delta || {}
        if (d.type === 'text_delta' && d.text) streamText(d.text)
        else if (d.type === 'thinking_delta' && d.thinking) streamThinking(d.thinking)
      } else if (se.type === 'message_start') {
        const content = (((se.message || {}).content) || []).filter((c) => c && c.type === 'tool_use')
        if (content.length) toolChip(content[0])
      }
    } else if (t === 'result') {
      addSystem(m.is_error ? '（回合出错）' : '（回合结束）')
      procClose()
      clearTakeover() // 回合结束：清掉残留的提问/审批 takeover
      cur = null
      pinMaybeRelease() // 回合结束且回复填满视口 → 平滑解除钉顶；短回复保持占位
      // 回合结束：输入栏上方胶囊 FLIP 平滑变形进消息流末尾，落地为默认折叠的汇总卡片
      commitLiveChangeCard()
    }
  }

  function connect() {
    if (GATEWAY_REVIEW) {
      // 审阅模式（bun 编译 exe）：node:http 的 upgrade 握手在 bun 下 101 无法送达客户端、
      // WS onopen 永不触发，token 门会卡在「正在验证」。审阅模式 token 非空即视为通过，
      // 不建真 WS，直接走视觉流程（视频过渡 → 趴栏 → 空态）。正式网关（无 review 标志）不受影响。
      gateVerified = true
      setConn(true, '已连接')
      gatePlayTransition()
      return
    }
    if (gws) { try { gws.close() } catch {} }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    gws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(gToken)}`)
    gws.onopen = () => {
      setConn(true, '已连接')
      gateVerified = true
      if (gateAwait) gatePlayTransition() // 门流程：播过渡视频（白板拉伸成输入栏/角色转正趴栏），ended 后 hideGate
      else hideGate() // URL 带 token 直连（无门）：验证通过直接解锁
      syncGwSend()
    }
    gws.onclose = () => {
      setConn(false, '未连接')
      liveChangeReset() // 2026-08-19：断连收起变更胶囊
      // 2026-08-18 修复：token 未验证成功即断开（URL token 过期——网关重启/换新 token、或门内输入错误）
      // 一律回 token 门重输，避免静默卡在空态、后续数据请求带着无效 token 全 401。
      if (!gateVerified) {
        toast(gateAwait ? 'token 错误或连接失败，请重试' : '连接失败：token 无效或已过期，请重新输入')
        showGate()
      }
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

  // ---- token 门（2026-08-15；2026-08-17 SubPj3 复刻：白板内 token 表单 → 视频过渡 → 趴栏+胶囊+台面输入栏）----
  // 输入 token 回车 → connect()（WS 服务端验证）→ onopen 置 gateVerified → 白板内表单淡出 + 过渡视频
  // （白板拉伸成输入栏/角色转正趴栏）→ ended → 阶段3 趴栏+胶囊淡入 → 停留后 hideGate() 进空态
  // （空态同趴栏 stage，位置一致无缝）。token 错误（onclose 未验证）→ 回门重输。
  let gateVerified = false // WS 已验证 token
  let finishGateTimer = null // 阶段3 停留后 hideGate 的定时器
  let hideGateTimer = null // gate-screen 淡出后隐藏的定时器（hideGate 不再硬切）
  const gateScreen = $('gate-screen')
  const gTok = $('g-token'), gVid = $('g-video'), gNewImg = $('g-new')
  const gCard = $('g-card')
  const gTokenInput = $('g-token-input')

  function showGate() {
    closeMentionPop()
    liveChangeReset() // 2026-08-19：回 token 门收起变更胶囊
    gateAwait = true
    gateVerified = false
    document.body.classList.add('token-gate')
    // token 门态输入栏必须回到 chat 空态位（位置一致），防 hash 残留会话导致 docked 到底部
    inputWrap.classList.remove('docked')
    chatArea.classList.remove('in-session')
    // 重置门到阶段1：举白板 + 白板内 token 表单
    // 平滑浮现：先置透明再移除 fade-out（强制 reflow 让 transition 生效）→ 淡入
    clearTimeout(hideGateTimer)
    gateScreen.classList.add('fade-out')
    gateScreen.hidden = false
    void gateScreen.offsetWidth
    gateScreen.classList.remove('fade-out')
    clearTimeout(finishGateTimer)
    gVid.pause(); gVid.currentTime = 0
    gVid.classList.remove('show', 'fade-out')
    gTok.classList.remove('fade-out')
    gNewImg.classList.remove('show')
    gCard.classList.remove('hide', 'shake')
    gTokenInput.value = ''
    gTokenInput.focus()
    syncGwSend()
  }
  function gatePlayTransition() {
    // 阶段1 → 阶段2：白板内表单淡出，过渡视频淡入播放（视频首帧≈举白板图，无缝衔接）
    gCard.classList.add('hide')
    gTok.classList.add('fade-out')
    gVid.classList.add('show')
    gVid.currentTime = 0
    gVid.playbackRate = 1.5 // 过渡视频提速（用户「动画播放快一点」）
    const p = gVid.play()
    if (p && p.catch) p.catch(finishGate) // 视频不可播（不支持 webm/mp4）→ 直接进空态
  }
  function finishGate() {
    if (!gateVerified) return
    // 阶段2 → 阶段3：视频淡出，趴栏图淡入；停留片刻后 hideGate（空态同趴栏 stage，无缝）
    gVid.classList.add('fade-out')
    gVid.classList.remove('show')
    gNewImg.classList.add('show')
    clearTimeout(finishGateTimer)
    finishGateTimer = setTimeout(hideGate, 300)
  }
  gVid.addEventListener('ended', finishGate)

  function hideGate() {
    gateAwait = false
    document.body.classList.remove('token-gate')
    // 2026-08-18：token 验证通过后写入 URL（replaceState 不触发刷新）——地址栏显示 token，
    // 刷新/收藏即带 token 直连，不再回门重输（用户实测「url 还是 ?token= 空」）。
    try {
      const u = new URL(location.href)
      u.searchParams.set('token', gToken)
      history.replaceState(null, '', u.toString())
    } catch { /* 忽略 */ }
    gVid.pause()
    inputEl.dataset.ph = '输入消息，Enter 发送' // 占位符复位（token 提示 → 正常输入）
    // gate-screen 淡出后隐藏，与空态（同款渐变背景）交叉过渡 → 切换平滑浮现，不做硬切
    gateScreen.classList.add('fade-out')
    clearTimeout(hideGateTimer)
    hideGateTimer = setTimeout(() => {
      gateScreen.hidden = true
      gateScreen.classList.remove('fade-out')
    }, 280)
    syncGwSend()
    // token 门锁定态跳过的数据加载，解锁后补拉（SSE 重连 + 会话列表/当前会话）
    // 2026-08-18 修复：loadSessions 只填 ALL 不渲染，门后首次拉取后侧栏一直空——
    // 后续 SSE hello→refreshList 因 sig===listSig 短路跳过渲染；须在数据落地后显式渲染侧栏
    //（renderRecent 保留展开文件夹+滚动位置，幂等）。
    loadSessions().then(renderRecent)
    initLive()
    // 恢复当前界面（gToken 已就绪）：预览态重挂 iframe、管理视图补拉数据、会话态增量刷新
    if (state.preview) route()
    else if (state.mgr) { loadMgrData(true); if (state.mgr === 'models') loadModelsData(true) }
    else refreshSession()
  }
  function gateSubmit() {
    const t = gTokenInput.value.trim()
    if (!t) {
      gTokenInput.classList.remove('shake'); void gTokenInput.offsetWidth
      gTokenInput.classList.add('shake')
      gTokenInput.focus()
      return
    }
    gToken = t
    connect()
  }
  // 白板内 token 表单：回车提交（无发送按钮）
  gTokenInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); gateSubmit() }
  })

  function gwSend() {
    if (!GATEWAY) return false
    closeMentionPop()
    const text = serializeInput().trim()
    if (!text) { inputEl.focus(); return true }
    if (!gws || gws.readyState !== 1) { toast('未连接，无法发送'); return true }
    if (!inputWrap.classList.contains('docked')) {
      // 先入会话态（输入栏沉底、滚动区留底边距），再追加/钉顶消息，保证钉顶位置计算基于最终布局
      mountInput('chat') // 输入栏从空态 stage 移回 #chat-area 沉底
      inputWrap.classList.add('docked')
      chatArea.classList.add('in-session')
    }
    addUser(text)
    // 2026-08-17 网关独立化：带当前会话 hash，网关按 sessionId 精确路由给对应 CLI 进程
    // （未在具体会话时 currentHash 为 null → 字段省略，网关广播兜底）
    gws.send(JSON.stringify({ type: 'send', text, sessionId: state.currentHash || undefined }))
    inputEl.textContent = ''
    syncGwSend()
    return true
  }

  function syncGwSend() {
    const on = GATEWAY && gws && gws.readyState === 1 && serializeInput().trim().length > 0
    sendBtn.classList.toggle('enabled', on)
  }

  function initGateway() {
    gatewayCss()
    // 连接状态徽章已改为 Floria 品牌名后的浅灰小字（index.html #floria-conn），不再动态建 #conn-badge。
    // 空态图标不隐藏：进会话时的隐藏由 #chat-area.in-session 的 CSS 承担，
    // 永久 display:none 会让首页图标只在网关检测完成前瞬间可见、刷新即消失。
    inputEl.contentEditable = 'true'
    inputEl.dataset.ph = '输入消息，Enter 发送'
    inputEl.addEventListener('input', onInputChange)
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
      if (d.review) GATEWAY_REVIEW = true
      if (d.hotReload) HOT_RELOAD = true
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
    else { inputEl.contentEditable = 'false'; inputEl.dataset.ph = '只读查看 · 无法发送' } // 只读查看器：输入不可编辑
    if (HOT_RELOAD) {
      // 开发审阅热重载：server.mjs HOT_RELOAD=1 时，public/ 文件变化经 SSE 通知 → 自动刷新
      const hr = new EventSource('/api/hotreload')
      hr.onmessage = (e) => { if (e.data === 'reload') location.reload() }
    }
  })()
})()
