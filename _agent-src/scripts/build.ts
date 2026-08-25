import { chmodSync, existsSync, mkdirSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const pkg = await Bun.file(new URL('../package.json', import.meta.url)).json() as {
  name: string
  version: string
}

const args = process.argv.slice(2)
const compile = args.includes('--compile')
const dev = args.includes('--dev')

const fullExperimentalFeatures = [
  'AGENT_MEMORY_SNAPSHOT',
  'AGENT_TRIGGERS',
  'AGENT_TRIGGERS_REMOTE',
  'AWAY_SUMMARY',
  'BASH_CLASSIFIER',
  'BUILTIN_EXPLORE_PLAN_AGENTS',
  'CACHED_MICROCOMPACT',
  'COMPACTION_REMINDERS',
  'CONNECTOR_TEXT',
  'EXTRACT_MEMORIES',
  'HISTORY_PICKER',
  'HOOK_PROMPTS',
  'KAIROS_BRIEF',
  'KAIROS_CHANNELS',
  'LODESTONE',
  'MCP_RICH_OUTPUT',
  'MESSAGE_ACTIONS',
  'NATIVE_CLIPBOARD_IMAGE',
  'NEW_INIT',
  'POWERSHELL_AUTO_MODE',
  'PROMPT_CACHE_BREAK_DETECTION',
  'QUICK_SEARCH',
  'SHOT_STATS',
  'TEAMMEM',
  'TOKEN_BUDGET',
  'TREE_SITTER_BASH',
  'TREE_SITTER_BASH_SHADOW',
  'ULTRAPLAN',
  'ULTRATHINK',
  'UNATTENDED_RETRY',
  'VERIFICATION_AGENT',
  'VOICE_MODE',
] as const

function runCommand(cmd: string[]): string | null {
  const proc = Bun.spawnSync({
    cmd,
    cwd: process.cwd(),
    stdout: 'pipe',
    stderr: 'pipe',
  })

  if (proc.exitCode !== 0) {
    return null
  }

  return new TextDecoder().decode(proc.stdout).trim() || null
}

function getDevVersion(baseVersion: string): string {
  const timestamp = new Date().toISOString()
  const date = timestamp.slice(0, 10).replaceAll('-', '')
  const time = timestamp.slice(11, 19).replaceAll(':', '')
  const sha = runCommand(['git', 'rev-parse', '--short=8', 'HEAD']) ?? 'unknown'
  return `${baseVersion}-dev.${date}.t${time}.sha${sha}`
}

function getVersionChangelog(): string {
  return (
    runCommand(['git', 'log', '--format=%h %s', '-20']) ??
    'Local development build'
  )
}

// 2026-08-25 用户定案：PRIVATE_GATEWAY（内置私有化网关）进默认特性——所有构建默认含 /server，
// 无需再显式 --feature=PRIVATE_GATEWAY（build:dev:gateway 显式传入仍按显式代号命名产物）
const defaultFeatures = ['VOICE_MODE', 'BUILTIN_EXPLORE_PLAN_AGENTS', 'PRIVATE_GATEWAY']
const featureSet = new Set(defaultFeatures)
// 显式 --feature=X 的代号集合：用于输出 exe 以 feature 代号命名（feature 构建不复用默认 cli-dev 名，避免互相覆盖）
const explicitFeatures = new Set<string>()
// 本地时间戳 YYYYMMDDHHMMSS，用于产物命名，区分不同构建
function getBuildTimestamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i]
  if (arg === '--feature-set' && args[i + 1]) {
    if (args[i + 1] === 'dev-full') {
      for (const feature of fullExperimentalFeatures) {
        featureSet.add(feature)
      }
    }
    i += 1
    continue
  }
  if (arg === '--feature-set=dev-full') {
    for (const feature of fullExperimentalFeatures) {
      featureSet.add(feature)
    }
    continue
  }
  if (arg === '--feature' && args[i + 1]) {
    featureSet.add(args[i + 1]!)
    explicitFeatures.add(args[i + 1]!)
    i += 1
    continue
  }
  if (arg.startsWith('--feature=')) {
    const f = arg.slice('--feature='.length)
    featureSet.add(f)
    explicitFeatures.add(f)
  }
}
const features = [...featureSet]

// 2026-08-25 用户定案：dev 构建（build:dev / build:dev:gateway）产物直接输出到项目根
// （_agent-src 的上一级 = 便携项目根，免手动复制部署）。基于脚本位置推导
// （import.meta.url = <项目根>/_agent-src/scripts/build.ts → 上两级），不依赖 cwd。
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url)) // <项目根>/_agent-src/scripts
const PROJECT_ROOT = resolve(SCRIPT_DIR, '..', '..') // <项目根>

// 产物命名 = <前缀>-<YYYYMMDDHHMMSS>[-<显式 feature 代号>]，Windows 输出 .exe；
// 时间戳保证不同构建不覆盖，显式 --feature 代号在时间戳后追加（多个用 + 连接）
// compile（正式发布）仍输出 ./dist/，dev 构建直出项目根
const baseOutfile = compile
  ? dev
    ? './dist/cli-dev'
    : './dist/cli'
  : dev
    ? join(PROJECT_ROOT, 'cli-dev')
    : join(PROJECT_ROOT, 'cli')
const buildTimestamp = getBuildTimestamp()
const outfile =
  explicitFeatures.size > 0
    ? `${baseOutfile}-${buildTimestamp}-${[...explicitFeatures].join('+')}`
    : `${baseOutfile}-${buildTimestamp}`
const buildTime = new Date().toISOString()
const version = dev ? getDevVersion(pkg.version) : pkg.version

const outDir = dirname(outfile)
if (outDir !== '.') {
  mkdirSync(outDir, { recursive: true })
}

const externals = [
  '@ant/*',
  'audio-capture-napi',
  'image-processor-napi',
  'modifiers-napi',
  'url-handler-napi',
]

const defines = {
  'process.env.USER_TYPE': JSON.stringify('external'),
  'process.env.CLAUDE_CODE_FORCE_FULL_LOGO': JSON.stringify('true'),
  ...(dev
    ? { 'process.env.NODE_ENV': JSON.stringify('development') }
    : {}),
  ...(dev
    ? {
        'process.env.CLAUDE_CODE_EXPERIMENTAL_BUILD': JSON.stringify('true'),
      }
    : {}),
  'process.env.CLAUDE_CODE_VERIFY_PLAN': JSON.stringify('false'),
  'process.env.CCR_FORCE_BUNDLE': JSON.stringify('true'),
  'MACRO.VERSION': JSON.stringify(version),
  'MACRO.BUILD_TIME': JSON.stringify(buildTime),
  'MACRO.PACKAGE_URL': JSON.stringify(pkg.name),
  'MACRO.NATIVE_PACKAGE_URL': 'undefined',
  'MACRO.FEEDBACK_CHANNEL': JSON.stringify('github'),
  'MACRO.ISSUES_EXPLAINER': JSON.stringify(
    'This reconstructed source snapshot does not include Anthropic internal issue routing.',
  ),
  'MACRO.VERSION_CHANGELOG': JSON.stringify(
    dev ? getVersionChangelog() : 'https://github.com/paoloanzn/claude-code',
  ),
} as const

const cmd = [
  'bun',
  'build',
  './src/entrypoints/cli.tsx',
  '--compile',
  '--target',
  'bun',
  '--format',
  'esm',
  '--outfile',
  outfile,
  '--minify',
  '--bytecode',
  '--packages',
  'bundle',
  '--conditions',
  'bun',
  '--windows-icon',
  'assets/icon.ico',
]

for (const external of externals) {
  cmd.push('--external', external)
}

for (const feature of features) {
  cmd.push(`--feature=${feature}`)
}

for (const [key, value] of Object.entries(defines)) {
  cmd.push('--define', `${key}=${value}`)
}

// 前端资源打包：把 src/gateway/web/ → web-assets.generated.ts（内置网关 PRIVATE_GATEWAY 内嵌 serve 用）
// 生成产物会打进 exe，因此每次构建都自动重跑，保证 exe 内前端为最新。
const genWeb = Bun.spawnSync({
  cmd: ['bun', 'scripts/gen-web-assets.ts'],
  cwd: process.cwd(),
  stdout: 'inherit',
  stderr: 'inherit',
})
if (genWeb.exitCode !== 0) {
  console.error('[build] 前端资源打包失败（gen-web-assets），终止构建')
  process.exit(genWeb.exitCode ?? 1)
}

const proc = Bun.spawnSync({
  cmd,
  cwd: process.cwd(),
  stdout: 'inherit',
  stderr: 'inherit',
})

if (proc.exitCode !== 0) {
  process.exit(proc.exitCode ?? 1)
}

if (existsSync(outfile)) {
  chmodSync(outfile, 0o755)
}

// bun writes `<outfile>.exe` on Windows
const builtPath = existsSync(outfile) ? outfile : `${outfile}.exe`

console.log(`Built ${builtPath}`)

// Icon finalization: rewrite into a SINGLE RT_GROUP_ICON (id=1) so Windows
// Explorer does per-size frame selection (crisp at every size). bun's own
// `--windows-icon` embeds a two-group structure (IDI_MYICON 256-only) that
// Windows reuses for ALL sizes → over-sharpened small icons. See
// scripts/postprocess-icon.mjs. Failure here is non-fatal (bun's icon remains).
if (existsSync(builtPath)) {
  const post = Bun.spawnSync({
    cmd: ['bun', 'scripts/postprocess-icon.mjs', builtPath, 'assets/icon.ico'],
    cwd: process.cwd(),
    stdout: 'inherit',
    stderr: 'inherit',
  })
  if (post.exitCode !== 0) {
    console.warn(`[build] icon post-process failed (exit ${post.exitCode}); keeping bun-embedded icon`)
  }
}
