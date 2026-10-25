// Host half of the Attention Notifier bundle.
//
// Windows does not route a click on a classic toast body to an unpackaged
// application, so the notification is a small always-on-top WinForms card
// drawn by popup.ps1. The whole card is clickable: a click runs the focus
// handler (attn-focus.ps1 through its hidden VBS wrapper), which focuses the
// Harness window and reports the notified session to the Web Client. The
// Client half (client.js) polls that report and selects the session through
// the UI's own navigation service.
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RUNTIME_DIR = join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'DeepSeekHarness', 'attention-notifier')
const FOCUS_SCRIPT = join(RUNTIME_DIR, 'attn-focus.ps1')
const FOCUS_VBS = join(RUNTIME_DIR, 'attn-focus.vbs')
const POPUP_SCRIPT = join(RUNTIME_DIR, 'attn-popup.ps1')
const POPUP_SOURCE = fileURLToPath(new URL('./popup.ps1', import.meta.url))
const WHALE_IMAGE = join(RUNTIME_DIR, 'attn-whale.png')
const WHALE_PNG = Buffer.from('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', 'base64')
const CHANNEL = '/attention-notifier'
const FOCUS_ROUTE = CHANNEL + '/focus'
const PENDING_ROUTE = '/api' + CHANNEL + '/pending'
const DEBUG_ROUTE = CHANNEL + '/debug'
const DEFAULT_ORIGIN = 'http://127.0.0.1:3080'
const BODY_LIMIT = 120
const SESSION_PATTERN = /^[A-Za-z0-9._~-]{1,200}$/
const POPUP_HINT = '点击打开 Harness'
const TIMEOUTS = {
  question: 600,
  approval: 600,
  done: 15,
  error: 30,
}

// ASCII-only on purpose: Windows PowerShell reads a BOM-less .ps1 as ANSI.
const PS_FOCUS = `param([string]$ProtocolUrl = '')
$ErrorActionPreference = 'SilentlyContinue'

# The popup passes a notification target as dshattn://focus?o=<origin>&s=<session>&u=<fallback>.
function Get-ProtocolValue([string]$url, [string]$key) {
  if ($url -match ('[?&]' + [regex]::Escape($key) + '=([^&]+)')) {
    try { return [System.Uri]::UnescapeDataString($Matches[1]) } catch { return '' }
  }
  return ''
}

# Only a loopback http(s) origin is accepted, so another local program cannot
# turn this handler into a general URL opener.
$origin = ''
$rawOrigin = Get-ProtocolValue $ProtocolUrl 'o'
if ($rawOrigin) {
  $uri = $null
  if ([System.Uri]::TryCreate($rawOrigin, [System.UriKind]::Absolute, [ref]$uri)) {
    if (($uri.Scheme -eq 'http' -or $uri.Scheme -eq 'https') -and
        ($uri.Host -eq '127.0.0.1' -or $uri.Host -eq 'localhost' -or $uri.Host -eq '::1')) {
      $origin = $uri.GetLeftPart([System.UriPartial]::Authority)
    }
  }
}

$session = Get-ProtocolValue $ProtocolUrl 's'
if ($session -notmatch '^[A-Za-z0-9._~-]{1,200}$') { $session = '' }

$openUrl = ''
$rawFallback = Get-ProtocolValue $ProtocolUrl 'u'
if ($rawFallback) {
  $uri = $null
  if ([System.Uri]::TryCreate($rawFallback, [System.UriKind]::Absolute, [ref]$uri)) {
    if ($uri.Scheme -eq 'http' -or $uri.Scheme -eq 'https') { $openUrl = $rawFallback }
  }
}

$needle = 'DeepSeek Harness'
if ($origin) { $needle = $needle + '|' + [regex]::Escape(($origin -replace '^https?://', '')) }

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class AttnWin {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
}
"@

function Focus-Window($proc) {
  if (-not $proc) { return $false }
  $handle = $proc.MainWindowHandle
  if ($handle -eq 0) { return $false }
  # Restore only when minimized; a maximized window keeps its size.
  if ([AttnWin]::IsIconic($handle)) { [void][AttnWin]::ShowWindow($handle, 9) }
  $foreground = [AttnWin]::GetForegroundWindow()
  $foregroundThread = [uint32]0
  [void][AttnWin]::GetWindowThreadProcessId($foreground, [ref]$foregroundThread)
  $currentThread = [AttnWin]::GetCurrentThreadId()
  [void][AttnWin]::AttachThreadInput($currentThread, $foregroundThread, $true)
  [void][AttnWin]::SetForegroundWindow($handle)
  [void][AttnWin]::BringWindowToTop($handle)
  [void][AttnWin]::AttachThreadInput($currentThread, $foregroundThread, $false)
  return $true
}

$focused = $false

# 1) The desktop shell window, matched by executable name so a session title in
#    the caption cannot hide it.
$app = Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue
$target = $app | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($target) { $focused = Focus-Window $target }

# 2) Any window whose caption names the app or its advertised authority (the
#    Web GUI opened in a browser).
if (-not $focused) {
  $target = Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -match $needle
  } | Select-Object -First 1
  if ($target) { $focused = Focus-Window $target }
}

# 3) Any visible browser window, so the user lands in the browser without a
#    duplicate tab when the Harness tab is not the active one.
if (-not $focused) {
  $target = Get-Process -ErrorAction SilentlyContinue -Name chrome,msedge,firefox,opera,brave,vivaldi |
    Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if ($target) { $focused = Focus-Window $target }
}

# 4) The app process is alive without a visible window (tray): a second launch
#    hands off to the single running instance and restores it.
if (-not $focused -and $app) {
  $path = ($app | Where-Object { $_.Path } | Select-Object -First 1).Path
  if ($path) { Start-Process -FilePath $path; $focused = $true }
}

# Tell the live page which session to select. The request is ignored when the
# Host, the plugin's Host half, or the page is not running.
if ($origin -and $session) {
  try { Invoke-WebRequest -UseBasicParsing -Uri ($origin + '/attention-notifier/focus?session=' + $session) -TimeoutSec 3 | Out-Null } catch {}
}

# 5) Nothing to focus: open the GUI URL. It carries the session, so the Client
#    half selects it once the page loads.
if (-not $focused -and $openUrl) { Start-Process $openUrl }
`

// Codepoint-aware so a limited body never splits a surrogate pair.
function truncate(text) {
  const value = String(text == null ? '' : text).trim()
  const chars = Array.from(value)
  return chars.length > BODY_LIMIT ? chars.slice(0, BODY_LIMIT - 1).join('') + '…' : value
}

function firstHeading(markdown) {
  const match = /^#{1,6}\s+(.+?)\s*$/m.exec(markdown)
  return match ? match[1].trim() : ''
}

function localOrigin(ctx) {
  try {
    const server = ctx.get('webServer')
    if (server && typeof server.getOrigin === 'function') return server.getOrigin()
  } catch {}
  try {
    const app = ctx.get('webApp')
    if (app && typeof app.getAdvertisedUrl === 'function') return new URL(app.getAdvertisedUrl()).origin
  } catch {}
  return DEFAULT_ORIGIN
}

function fallbackUrl(ctx, sessionId) {
  let base = localOrigin(ctx)
  try {
    const app = ctx.get('webApp')
    const advertised = app && typeof app.getAdvertisedUrl === 'function' ? app.getAdvertisedUrl() : ''
    if (advertised) base = advertised
  } catch {}
  if (!sessionId) return base
  try {
    const url = new URL(base)
    url.searchParams.set('session', sessionId)
    return url.href
  } catch {
    return base
  }
}

function focusUrl(ctx, sessionId) {
  const params = new URLSearchParams()
  params.set('o', localOrigin(ctx))
  if (sessionId) params.set('s', sessionId)
  params.set('u', fallbackUrl(ctx, sessionId))
  return 'dshattn://focus?' + params.toString()
}

function notifyDesktop(ctx, item) {
  try {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', POPUP_SCRIPT], {
      env: {
        ...process.env,
        DSH_ATTN_TITLE: item.title,
        DSH_ATTN_BODY: item.body,
        DSH_ATTN_HINT: POPUP_HINT,
        DSH_ATTN_FOCUS: focusUrl(ctx, item.sessionId),
        DSH_ATTN_VBS: FOCUS_VBS,
        DSH_ATTN_TIMEOUT: String(TIMEOUTS[item.kind] || 60),
        DSH_ATTN_SOUND: item.kind,
        DSH_ATTN_IMAGE: WHALE_IMAGE,
      },
      stdio: 'ignore',
      windowsHide: true,
    })
    child.on('error', (error) => {
      console.error('[attention-notifier] popup spawn failed:', error.message)
    })
    child.unref()
  } catch (error) {
    console.error('[attention-notifier] popup error:', error && error.message)
  }
}

// Write the focus handler, its hidden VBS wrapper, and the popup card beside
// them. Idempotent; runs on every plugin mount.
function ensureRuntimeFiles() {
  try {
    mkdirSync(RUNTIME_DIR, { recursive: true })
    writeFileSync(FOCUS_SCRIPT, PS_FOCUS, 'utf8')
    const vbs = 'Set shell = CreateObject("WScript.Shell")\r\n' +
      'Dim cmd\r\n' +
      'cmd = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File ""' + FOCUS_SCRIPT + '"" """\r\n' +
      'cmd = cmd & WScript.Arguments(0)\r\n' +
      'cmd = cmd & """"\r\n' +
      'shell.Run cmd, 0, False\r\n'
    writeFileSync(FOCUS_VBS, vbs, 'utf8')
    writeFileSync(POPUP_SCRIPT, readFileSync(POPUP_SOURCE, 'utf8'), 'utf8')
    writeFileSync(WHALE_IMAGE, WHALE_PNG)
  } catch (error) {
    console.error('[attention-notifier] runtime files failed:', error && error.message)
  }
}

function isLocalRequest(req) {
  const host = req.headers && req.headers.host
  if (typeof host !== 'string') return false
  try {
    const hostname = new URL('http://' + host).hostname
    if (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '[::1]') return false
  } catch {
    return false
  }
  // A cross-site browser request would only be able to change the selected
  // session, but there is no reason to accept it.
  return req.headers['sec-fetch-site'] !== 'cross-site'
}

// The focus handler reports the notified session here and the Client half polls
// it. Two carriers are registered because the Desktop renderer only proxies the
// shared `/api` transport: an exact Fetch route under `/api` and the generic RPC
// channel (both authenticated). A local-only debug route exposes poll counters.
function installFocusChannel(ctx) {
  let pending = null
  let polls = 0
  let lastPollAt = 0
  const connection = ctx.get('connection')
  const webServer = ctx.get('webServer')

  const readPending = () => {
    polls += 1
    lastPollAt = Date.now()
    const current = pending
    pending = null
    return current
  }

  if (connection && connection.fetch && typeof connection.fetch.register === 'function') {
    const route = {
      path: PENDING_ROUTE,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async () => Response.json(readPending(), { headers: { 'cache-control': 'no-store' } }),
    }
    try {
      ctx.effect(() => connection.fetch.register(route), 'attention-notifier: pending Fetch route')
    } catch (error) {
      console.error('[attention-notifier] pending route registration failed:', error && error.message)
    }
  }

  if (connection && connection.rpc && typeof connection.rpc.handle === 'function') {
    const handler = async (endpoint) => {
      if (endpoint !== 'pending') {
        return {
          ok: false,
          error: { code: 'attention-notifier/unknown-endpoint', message: 'unknown endpoint', details: {} },
        }
      }
      return { ok: true, value: readPending() }
    }
    try {
      ctx.effect(() => connection.rpc.handle(CHANNEL, handler), 'attention-notifier: focus RPC channel')
    } catch (error) {
      console.error('[attention-notifier] focus channel registration failed:', error && error.message)
    }
  }

  if (webServer && typeof webServer.register === 'function') {
    const route = {
      kind: 'exact',
      path: FOCUS_ROUTE,
      handler: (req, res) => {
        if (req.method !== 'GET' || !isLocalRequest(req)) {
          res.writeHead(403)
          res.end()
          return
        }
        let sessionId = ''
        try {
          sessionId = new URL(req.url || '/', 'http://127.0.0.1').searchParams.get('session') || ''
        } catch {}
        if (!SESSION_PATTERN.test(sessionId)) {
          res.writeHead(400)
          res.end()
          return
        }
        pending = { sessionId, at: Date.now() }
        res.writeHead(204)
        res.end()
      },
    }
    try {
      ctx.effect(() => webServer.register(route), 'attention-notifier: focus route')
    } catch (error) {
      console.error('[attention-notifier] focus route registration failed:', error && error.message)
    }

    const debugRoute = {
      kind: 'exact',
      path: DEBUG_ROUTE,
      handler: (req, res) => {
        if (req.method !== 'GET' || !isLocalRequest(req)) {
          res.writeHead(403)
          res.end()
          return
        }
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ polls, lastPollAt, hasPending: pending !== null }))
      },
    }
    try {
      ctx.effect(() => webServer.register(debugRoute), 'attention-notifier: debug route')
    } catch (error) {
      console.error('[attention-notifier] debug route registration failed:', error && error.message)
    }
  }
}

function notifyQuestion(ctx, request) {
  const questions = request && Array.isArray(request.questions) ? request.questions : []
  const sessionId = request && request.agent && typeof request.agent.id === 'string' ? request.agent.id : ''
  const plan = questions.find((item) => item && item.intent && item.intent.kind === 'plan-review')
  if (plan) {
    const heading = typeof plan.detail === 'string' ? firstHeading(plan.detail) : ''
    notifyDesktop(ctx, {
      kind: 'question',
      title: '计划待确认',
      body: heading ? '计划「' + heading + '」等待你的批准' : 'AI 提交了一份计划，请批准或要求继续规划',
      sessionId,
    })
    return
  }
  const texts = questions
    .map((item) => (item && typeof item.question === 'string' ? item.question.trim() : ''))
    .filter(Boolean)
  let body = 'AI 正在等待你的输入，请回到页面查看'
  if (texts.length === 1) body = truncate(texts[0])
  else if (texts.length > 1) body = truncate(texts.join('；') + '（共 ' + texts.length + ' 个问题）')
  notifyDesktop(ctx, { kind: 'question', title: '需要你答复', body, sessionId })
}

function notifyApproval(ctx, request) {
  const toolName = request && typeof request.toolName === 'string' ? request.toolName : ''
  const reason = request && typeof request.reason === 'string' ? request.reason : ''
  let body = '有一个操作需要你的允许'
  if (toolName && reason) body = truncate(toolName + '：' + reason)
  else if (toolName) body = truncate('工具「' + toolName + '」需要你的允许')
  else if (reason) body = truncate(reason)
  const sessionId = request && request.agent && typeof request.agent.id === 'string' ? request.agent.id : ''
  notifyDesktop(ctx, { kind: 'approval', title: '需要你的审批', body, sessionId })
}

function errorBody(error) {
  const message = error instanceof Error ? error.message
    : typeof error === 'string' ? error
    : error && typeof error.message === 'string' ? error.message
    : ''
  return message ? truncate('执行出错：' + message) : '会话执行出错，请回到页面查看'
}

function installNotifications(ctx) {
  const agents = ctx.get('agents')
  const running = new Set()

  const agentId = (agent) => {
    if (!agent) return ''
    return typeof agent.id === 'string' ? agent.id : String(agent.id)
  }

  const isRootAgent = (agent) => {
    if (!agents || typeof agents.roots !== 'function') return true
    try {
      const roots = agents.roots()
      if (!Array.isArray(roots)) return true
      const id = agentId(agent)
      return roots.some((root) => root === agent || agentId(root) === id)
    } catch {
      return true
    }
  }

  // Seed the running set so an idle transition right after mount is not missed.
  if (agents && typeof agents.list === 'function') {
    try {
      const all = agents.list()
      if (Array.isArray(all)) {
        for (const agent of all) {
          if (agent && agent.status === 'running') running.add(agentId(agent))
        }
      }
    } catch {}
  }

  // Prepend so the notification is emitted before the composed answerer
  // claims the request; the answerer still receives it through next().
  ctx.on('user-questions/request', (request, next) => {
    try {
      notifyQuestion(ctx, request)
    } catch {}
    return next()
  }, { prepend: true })

  ctx.on('approval/request', (request, next) => {
    try {
      notifyApproval(ctx, request)
    } catch {}
    return next()
  }, { prepend: true })

  ctx.on('agent/status', (payload) => {
    const agent = payload && payload.agent
    if (!agent) return
    const id = agentId(agent)
    if (payload.status === 'running') {
      running.add(id)
      return
    }
    if (payload.status !== 'idle' || !running.has(id)) return
    running.delete(id)
    if (!isRootAgent(agent)) return
    notifyDesktop(ctx, { kind: 'done', title: '回复完成', body: 'AI 已完成本轮，正在等待你的输入', sessionId: id })
  })

  ctx.on('agent/error', (payload) => {
    const agent = payload && payload.agent
    if (!agent || !isRootAgent(agent)) return
    notifyDesktop(ctx, { kind: 'error', title: '执行出错', body: errorBody(payload.error), sessionId: agentId(agent) })
  })
}

// Wait for the services this plugin hangs its routes and listeners on. Without
// this, a cold start can activate the row before `connection`/`webServer` exist,
// leaving the session-focus routes unregistered until the next reload.
export const inject = ['agents', 'connection', 'webServer']

export function apply(ctx) {
  if (process.platform !== 'win32') return
  ensureRuntimeFiles()
  installFocusChannel(ctx)
  installNotifications(ctx)
}
