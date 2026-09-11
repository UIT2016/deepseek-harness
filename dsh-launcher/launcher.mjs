/**
 * DSH 控制台 — zero-dependency local launcher for this DeepSeek Harness checkout.
 *
 * Serves a fixed button panel on http://127.0.0.1:17577 that runs a closed set
 * of repo commands (start/stop the `dsh web` service on port 3080, `pnpm run
 * build`, `pnpm install`, open repo/$DSH_HOME folders, open the GUI) and
 * streams their output to the page over SSE. Mutation endpoints require a
 * per-boot token; the authenticated URL is written to `.instance` beside this
 * file so a second launch reopens the live instance instead of failing on
 * EADDRINUSE. Started hidden by launch.vbs (desktop shortcut).
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execFile, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import { randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = dirname(HERE)
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const LAUNCHER_PORT = 17577
const SERVICE_PORT = 3080
const SERVICE_URL = `http://127.0.0.1:${String(SERVICE_PORT)}`
const INSTANCE_FILE = join(HERE, '.instance')
const LOG_FILE = join(HERE, 'launcher.log')
const TOKEN = randomBytes(12).toString('hex')
const PAGE = readFileSync(join(HERE, 'page.html'), 'utf8')

/** Append one lifecycle line to the launcher's own log (boots, exits, listen failures). */
function trace(message) {
  try {
    appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${message}\n`)
  } catch {
    // Best effort only: a full/unwritable log file must not kill the panel.
  }
}

/** The closed set of long repo commands the panel may spawn; nothing else is spawnable. */
const TASKS = {
  build: { command: 'pnpm', args: ['run', 'build'] },
  install: { command: 'pnpm', args: ['install'] },
}

/** Fire-and-forget open actions; explorer/start detach immediately. */
const OPENS = {
  repo: () => spawn('explorer.exe', [REPO_ROOT], { detached: true, stdio: 'ignore' }).unref(),
  home: () => spawn('explorer.exe', [DSH_HOME], { detached: true, stdio: 'ignore' }).unref(),
  gui: () => spawn('cmd', ['/c', 'start', '""', SERVICE_URL], { detached: true, stdio: 'ignore', windowsHide: true }).unref(),
}

const sseClients = new Set()
const buffer = []
const MAX_BUFFER = 4000
let droppedLines = 0

/** Broadcast one SSE frame to every connected panel. */
function emit(event, data) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const res of sseClients) res.write(frame)
}

/** Record and broadcast one output line from a spawned command. */
function logLine(source, line) {
  buffer.push({ source, line })
  if (buffer.length > MAX_BUFFER) {
    buffer.shift()
    droppedLines++
  }
  emit('log', { source, line })
}

/** Currently running repo task ({ name, child }), or null — build/install run one at a time. */
let task = null
/** The `pnpm dsh web` child this launcher spawned ({ child, pid }), or null. */
let service = null

/** Split a child's stdout/stderr into lines and feed them to the log. */
function pipeLines(child, source) {
  for (const stream of [child.stdout, child.stderr]) {
    let rest = ''
    stream.setEncoding('utf8')
    stream.on('data', (chunk) => {
      rest += chunk
      const lines = rest.split(/\r?\n/)
      rest = lines.pop() ?? ''
      for (const line of lines) logLine(source, line)
    })
    stream.on('end', () => {
      if (rest !== '') logLine(source, rest)
    })
  }
}

/** Spawn one of the fixed repo tasks. Returns an error message, or null on success. */
function runTask(name) {
  const spec = TASKS[name]
  if (spec === undefined) return `未知任务: ${name}`
  if (task !== null) return `已有任务在运行: ${task.name}`
  const child = spawn(spec.command, spec.args, {
    cwd: REPO_ROOT,
    shell: true,
    windowsHide: true,
    env: { ...process.env, NO_COLOR: '1' },
  })
  task = { name, child }
  logLine(name, `$ ${spec.command} ${spec.args.join(' ')}  (cwd: ${REPO_ROOT})`)
  pipeLines(child, name)
  child.on('error', (err) => {
    logLine(name, `启动失败: ${err.message}`)
    task = null
    emit('status', {})
  })
  child.on('exit', (code) => {
    logLine(name, `进程退出, code=${String(code)}`)
    task = null
    emit('status', {})
  })
  return null
}

/** Spawn `pnpm dsh web`. Returns an error message, or null on success. */
function startService() {
  if (service !== null) return '服务已由本启动器启动'
  const child = spawn('pnpm', ['dsh', 'web'], {
    cwd: REPO_ROOT,
    shell: true,
    windowsHide: true,
    env: { ...process.env, NO_COLOR: '1' },
  })
  service = { child, pid: child.pid }
  logLine('service', `$ pnpm dsh web  (cwd: ${REPO_ROOT})`)
  pipeLines(child, 'service')
  child.on('error', (err) => {
    logLine('service', `启动失败: ${err.message}`)
    service = null
    emit('status', {})
  })
  child.on('exit', (code) => {
    logLine('service', `服务进程退出, code=${String(code)}`)
    service = null
    emit('status', {})
  })
  return null
}

/** Kill a process tree by PID; resolves regardless of the result. */
function taskkill(pid) {
  return new Promise((resolve) => {
    execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], () => resolve())
  })
}

/** Kill whatever listens on the service port; fallback for services we did not spawn. */
function killPort(port) {
  return new Promise((resolve) => {
    execFile('powershell.exe', [
      '-NoProfile', '-Command',
      `Get-NetTCPConnection -LocalPort ${String(port)} -State Listen -ErrorAction SilentlyContinue`
      + ' | Select-Object -ExpandProperty OwningProcess -Unique'
      + ' | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }',
    ], () => resolve())
  })
}

/** Stop the harness web service: tracked child first, port kill as fallback. */
async function stopService() {
  logLine('service', '停止服务…')
  if (service !== null) await taskkill(service.pid)
  await killPort(SERVICE_PORT)
  service = null
  emit('status', {})
}

/** TCP probe: is something accepting connections on the service port? */
function probeService() {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port: SERVICE_PORT })
    socket.setTimeout(800)
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('timeout', () => { socket.destroy(); resolve(false) })
    socket.once('error', () => { socket.destroy(); resolve(false) })
  })
}

/** Read a JSON request body; returns {} for empty or invalid bodies. */
function readBody(req) {
  return new Promise((resolve) => {
    let raw = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw === '' ? '{}' : raw))
      } catch {
        resolve({})
      }
    })
  })
}

/** Send a JSON response. */
function sendJson(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${String(LAUNCHER_PORT)}`)

    if (url.pathname === '/') {
      if (url.searchParams.get('token') !== TOKEN) {
        res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('403 — 请通过桌面快捷方式打开本页面（链接里带有每次启动生成的令牌）')
        return
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(PAGE)
      return
    }

    if (url.pathname === '/api/events') {
      // EventSource cannot set headers, so the token travels in the query here.
      if (url.searchParams.get('token') !== TOKEN) {
        res.writeHead(403)
        res.end()
        return
      }
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      res.write(': ok\n\n')
      sseClients.add(res)
      // res 'close', not req: since Node 16 req 'close' fires when the GET
      // completes (immediately), which would drop the client before any frame.
      res.on('close', () => sseClients.delete(res))
      return
    }

    if (url.pathname.startsWith('/api/')) {
      if (req.headers['x-token'] !== TOKEN) {
        sendJson(res, 403, { error: 'forbidden' })
        return
      }

      if (url.pathname === '/api/status' && req.method === 'GET') {
        sendJson(res, 200, {
          running: await probeService(),
          ours: service !== null,
          pid: service?.pid ?? null,
          task: task?.name ?? null,
          serviceUrl: SERVICE_URL,
          repoRoot: REPO_ROOT,
          dshHome: DSH_HOME,
          droppedLines,
        })
        return
      }

      if (url.pathname === '/api/logs' && req.method === 'GET') {
        sendJson(res, 200, { lines: buffer, droppedLines })
        return
      }

      if (req.method === 'POST') {
        const body = await readBody(req)
        if (url.pathname === '/api/start') {
          if (await probeService()) {
            sendJson(res, 200, { error: `端口 ${String(SERVICE_PORT)} 已被占用 — 服务可能已在运行` })
            return
          }
          sendJson(res, 200, { error: startService() })
          return
        }
        if (url.pathname === '/api/stop') {
          await stopService()
          sendJson(res, 200, {})
          return
        }
        if (url.pathname === '/api/run') {
          sendJson(res, 200, { error: runTask(body.name) })
          return
        }
        if (url.pathname === '/api/open') {
          const open = OPENS[body.what]
          if (open === undefined) {
            sendJson(res, 200, { error: `未知目标: ${String(body.what)}` })
            return
          }
          open()
          logLine('open', `已打开: ${body.what}`)
          sendJson(res, 200, {})
          return
        }
        if (url.pathname === '/api/shutdown') {
          sendJson(res, 200, {})
          trace('shutdown requested; exiting')
          setTimeout(() => process.exit(0), 200)
          return
        }
      }

      sendJson(res, 404, { error: 'not found' })
      return
    }

    res.writeHead(404)
    res.end()
  })().catch((err) => {
    trace(`request failed: ${String(err)}`)
    sendJson(res, 500, { error: String(err) })
  })
})

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && existsSync(INSTANCE_FILE)) {
    const existing = readFileSync(INSTANCE_FILE, 'utf8').trim()
    trace(`already running; reopening ${existing}`)
    spawn('cmd', ['/c', 'start', '""', existing], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
    process.exit(0)
  }
  trace(`listen failed: ${err.message}`)
  process.exit(1)
})

server.listen(LAUNCHER_PORT, '127.0.0.1', () => {
  const selfUrl = `http://127.0.0.1:${String(LAUNCHER_PORT)}/?token=${TOKEN}`
  writeFileSync(INSTANCE_FILE, selfUrl)
  trace(`listening ${selfUrl}`)
  console.log(`DSH 控制台: ${selfUrl}`)
  spawn('cmd', ['/c', 'start', '""', selfUrl], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
})
