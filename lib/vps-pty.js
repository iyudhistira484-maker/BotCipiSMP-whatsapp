const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { WebSocketServer } = require('ws');
const { addAuditLog } = require('./database');
const { logger } = require('./logger');

const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULT_SHELL = fs.existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh';

function hasBinary(cmd) {
  try {
    const res = spawnSync('which', [cmd], { timeout: 1500, encoding: 'utf8' });
    return res.status === 0 && Boolean(String(res.stdout || '').trim());
  } catch {
    return false;
  }
}

const HAS_PYTHON3_PTY = (() => {
  if (process.platform === 'win32') return false;
  try {
    const res = spawnSync('python3', ['-c', 'import pty, fcntl, termios, struct, select'], {
      timeout: 2000,
    });
    return res.status === 0;
  } catch {
    return false;
  }
})();

const HAS_SCRIPT_BIN = process.platform !== 'win32' && hasBinary('script');

/**
 * Bridge Python 3 murni menggunakan kernel pty.openpty() + TIOCSCTTY + TIOCSWINSZ:
 * - fd 0 (stdin)  : byte ketikan mentah 8-bit langsung ke master_fd
 * - fd 1 (stdout) : byte layar VT100/ANSI/UTF-8 mentah dari master_fd
 * - fd 2 (stderr) : metadata JSON internal (tty name & shell pid)
 * - fd 3 (ctrl)   : kanal resize real-time "R:<cols>:<rows>\n" -> TIOCSWINSZ + SIGWINCH
 */
const PYTHON_PTY_BRIDGE = `
import errno, fcntl, json, os, pty, select, signal, struct, sys, termios

cols = max(20, min(500, int(os.environ.get("CIPI_COLS", "100"))))
rows = max(8, min(200, int(os.environ.get("CIPI_ROWS", "30"))))
shell = os.environ.get("CIPI_SHELL", "/bin/bash")
cwd = os.environ.get("CIPI_CWD", os.getcwd())

master_fd, slave_fd = pty.openpty()
tty_path = os.ttyname(slave_fd)
winsz = struct.pack("HHHH", rows, cols, 0, 0)
fcntl.ioctl(slave_fd, termios.TIOCSWINSZ, winsz)

pid = os.fork()
if pid == 0:
    try:
        os.close(master_fd)
        try:
            os.close(3)
        except OSError:
            pass
        os.setsid()
        fcntl.ioctl(slave_fd, termios.TIOCSCTTY, 0)
        os.dup2(slave_fd, 0)
        os.dup2(slave_fd, 1)
        os.dup2(slave_fd, 2)
        if slave_fd > 2:
            os.close(slave_fd)
        if os.path.isdir(cwd):
            os.chdir(cwd)
        env = dict(os.environ)
        env.pop("CIPI_COLS", None)
        env.pop("CIPI_ROWS", None)
        env.pop("CIPI_SHELL", None)
        env.pop("CIPI_CWD", None)
        env["TERM"] = "xterm-256color"
        env["COLORTERM"] = "truecolor"
        if not env.get("LANG"):
            env["LANG"] = "C.UTF-8"
        base = os.path.basename(shell)
        args = [shell, "-i"] if base in ("bash", "zsh", "sh") else [shell]
        os.execvpe(shell, args, env)
    except Exception as exc:
        os.write(2, ("PTY exec failed: " + str(exc) + "\\r\\n").encode("utf-8", "replace"))
        os._exit(1)

os.close(slave_fd)
os.write(2, (json.dumps({"tty": tty_path, "shellPid": pid}) + "\\n").encode("utf-8"))

ctrl_open = True
try:
    os.fstat(3)
except OSError:
    ctrl_open = False

ctrl_buf = b""
stdin_open = True

def apply_resize(c, r):
    c = max(20, min(500, c))
    r = max(8, min(200, r))
    ws = struct.pack("HHHH", r, c, 0, 0)
    try:
        fcntl.ioctl(master_fd, termios.TIOCSWINSZ, ws)
    except OSError:
        pass
    try:
        pgrp = os.tcgetpgrp(master_fd)
        if pgrp > 0:
            os.killpg(pgrp, signal.SIGWINCH)
    except OSError:
        try:
            os.killpg(pid, signal.SIGWINCH)
        except OSError:
            pass

exit_code = 0
try:
    while True:
        watch = [master_fd]
        if stdin_open:
            watch.append(0)
        if ctrl_open:
            watch.append(3)
        try:
            rlist, _, _ = select.select(watch, [], [], 1.0)
        except InterruptedError:
            continue

        if master_fd in rlist:
            try:
                data = os.read(master_fd, 16384)
                if not data:
                    break
                os.write(1, data)
            except OSError as e:
                if e.errno == errno.EIO:
                    break
                raise

        if stdin_open and 0 in rlist:
            chunk = os.read(0, 8192)
            if not chunk:
                stdin_open = False
                try:
                    os.killpg(pid, signal.SIGHUP)
                except OSError:
                    pass
            else:
                os.write(master_fd, chunk)

        if ctrl_open and 3 in rlist:
            cchunk = os.read(3, 1024)
            if not cchunk:
                ctrl_open = False
            else:
                ctrl_buf += cchunk
                while b"\\n" in ctrl_buf:
                    line, ctrl_buf = ctrl_buf.split(b"\\n", 1)
                    parts = line.decode("ascii", "ignore").strip().split(":")
                    if len(parts) == 3 and parts[0] == "R":
                        try:
                            apply_resize(int(parts[1]), int(parts[2]))
                        except ValueError:
                            pass

        wpid, status = os.waitpid(pid, os.WNOHANG)
        if wpid == pid:
            if os.WIFEXITED(status):
                exit_code = os.WEXITSTATUS(status)
            elif os.WIFSIGNALED(status):
                exit_code = 128 + os.WTERMSIG(status)
            break
finally:
    try:
        os.close(master_fd)
    except OSError:
        pass
    try:
        os.killpg(pid, signal.SIGHUP)
    except OSError:
        pass
    try:
        _, status = os.waitpid(pid, os.WNOHANG)
        if os.WIFEXITED(status):
            exit_code = os.WEXITSTATUS(status)
    except OSError:
        pass

sys.exit(exit_code)
`;

const activePtySessions = new Set();

function clampCols(cols) {
  return Math.max(20, Math.min(500, Number.parseInt(String(cols || 100), 10) || 100));
}

function clampRows(rows) {
  return Math.max(8, Math.min(200, Number.parseInt(String(rows || 30), 10) || 30));
}

/**
 * Spawn satu sesi interaktif PTY penuh (mendukung nano, htop, vim, tmux, Tab, Ctrl+C, resize)
 */
function createInteractivePtySession({
  cols = 100,
  rows = 30,
  cwd = ROOT_DIR,
  actorLabel = 'panel:admin',
  onData = () => {},
  onMeta = () => {},
  onExit = () => {},
} = {}) {
  const safeCols = clampCols(cols);
  const safeRows = clampRows(rows);
  const startCwd = cwd && fs.existsSync(cwd) ? cwd : process.cwd();

  let child = null;
  let ctrlStream = null;
  let backend = 'pipe';
  let shellPid = null;
  let ttyPath = 'pty';
  let closed = false;

  const baseEnv = {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    HOME: os.homedir() || process.env.HOME || '/root',
  };

  if (HAS_PYTHON3_PTY) {
    backend = 'linux-openpty';
    child = spawn('python3', ['-u', '-c', PYTHON_PTY_BRIDGE], {
      cwd: startCwd,
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
      env: {
        ...baseEnv,
        CIPI_COLS: String(safeCols),
        CIPI_ROWS: String(safeRows),
        CIPI_SHELL: DEFAULT_SHELL,
        CIPI_CWD: startCwd,
      },
    });
    ctrlStream = child.stdio[3] || null;
  } else if (HAS_SCRIPT_BIN) {
    backend = 'util-linux-script';
    child = spawn('script', ['-qfc', `${DEFAULT_SHELL} -i`, '/dev/null'], {
      cwd: startCwd,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...baseEnv,
        COLUMNS: String(safeCols),
        LINES: String(safeRows),
      },
    });
  } else {
    backend = 'interactive-shell';
    child = spawn(DEFAULT_SHELL, ['-i'], {
      cwd: startCwd,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...baseEnv,
        COLUMNS: String(safeCols),
        LINES: String(safeRows),
      },
    });
  }

  let stderrBuf = '';

  child.stdout.on('data', (chunk) => {
    if (!closed) onData(chunk.toString('utf8'));
  });

  if (backend === 'linux-openpty') {
    child.stderr.on('data', (chunk) => {
      stderrBuf += chunk.toString('utf8');
      let nl = stderrBuf.indexOf('\n');
      while (nl !== -1) {
        const line = stderrBuf.slice(0, nl).trim();
        stderrBuf = stderrBuf.slice(nl + 1);
        if (line.startsWith('{')) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.tty) ttyPath = parsed.tty;
            if (parsed.shellPid) shellPid = parsed.shellPid;
            onMeta({ tty: ttyPath, shellPid, backend });
          } catch {
            // Abaikan
          }
        }
        nl = stderrBuf.indexOf('\n');
      }
    });
  } else {
    child.stderr.on('data', (chunk) => {
      if (!closed) onData(chunk.toString('utf8'));
    });
  }

  const sessionObj = {
    get pid() {
      return shellPid || child?.pid || 0;
    },
    get tty() {
      return ttyPath;
    },
    backend,
    shell: path.basename(DEFAULT_SHELL),
    cwd: startCwd,
    write(inputStr) {
      if (closed || !child?.stdin || child.stdin.destroyed) return false;
      try {
        child.stdin.write(String(inputStr));
        return true;
      } catch {
        return false;
      }
    },
    resize(newCols, newRows) {
      if (closed) return false;
      const c = clampCols(newCols);
      const r = clampRows(newRows);
      if (ctrlStream && !ctrlStream.destroyed) {
        try {
          ctrlStream.write(`R:${c}:${r}\n`);
          return true;
        } catch {
          return false;
        }
      }
      return false;
    },
    destroy() {
      if (closed) return;
      closed = true;
      activePtySessions.delete(sessionObj);
      try {
        ctrlStream?.end();
      } catch {
        // Abaikan
      }
      try {
        child?.stdin?.end();
      } catch {
        // Abaikan
      }
      if (shellPid && shellPid > 1) {
        try {
          process.kill(-shellPid, 'SIGHUP');
        } catch {
          // Abaikan
        }
      }
      try {
        child?.kill('SIGTERM');
      } catch {
        // Abaikan
      }
      setTimeout(() => {
        if (shellPid && shellPid > 1) {
          try {
            process.kill(-shellPid, 'SIGKILL');
          } catch {
            // Abaikan
          }
        }
        try {
          child?.kill('SIGKILL');
        } catch {
          // Abaikan
        }
      }, 600).unref?.();
    },
  };

  activePtySessions.add(sessionObj);

  child.on('close', (code, signal) => {
    if (!closed) {
      closed = true;
      activePtySessions.delete(sessionObj);
      onExit({ exitCode: typeof code === 'number' ? code : 0, signal: signal || null });
    }
  });

  child.on('error', (err) => {
    if (!closed) {
      closed = true;
      activePtySessions.delete(sessionObj);
      onExit({ exitCode: 1, signal: null, error: err.message });
    }
  });

  addAuditLog({
    level: 'info',
    category: 'vps_control',
    actorJid: actorLabel,
    target: startCwd,
    action: 'open_pty_session',
    details: { backend, shell: DEFAULT_SHELL, cols: safeCols, rows: safeRows },
  });

  return sessionObj;
}

/**
 * Pasang endpoint WebSocket PTY (/api/vps/pty) pada HTTP Server Cipi Panel
 */
function attachPtyWebSocketServer(httpServer, extractSessionFn) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

  httpServer.on('upgrade', (req, socket, head) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(req.url || '/', 'http://localhost');
    } catch {
      socket.destroy();
      return;
    }

    if (parsedUrl.pathname !== '/api/vps/pty') {
      socket.destroy();
      return;
    }

    const session = extractSessionFn(req, parsedUrl.searchParams);
    if (!session) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, session, parsedUrl.searchParams);
    });
  });

  wss.on('connection', (ws, _req, session, searchParams) => {
    const actorLabel = `panel:${session.username}`;
    const initCols = clampCols(searchParams.get('cols') || 100);
    const initRows = clampRows(searchParams.get('rows') || 30);

    const sendSafe = (payload) => {
      if (ws.readyState === ws.OPEN) {
        try {
          ws.send(JSON.stringify(payload));
        } catch {
          // Socket ditutup
        }
      }
    };

    logger.info(
      'PANEL',
      `Sesi Full-PTY dibuka oleh ${session.username} (${initCols}x${initRows})`
    );

    const pty = createInteractivePtySession({
      cols: initCols,
      rows: initRows,
      cwd: ROOT_DIR,
      actorLabel,
      onData: (chunk) => {
        sendSafe({ type: 'output', data: chunk });
      },
      onMeta: (meta) => {
        sendSafe({
          type: 'ready',
          tty: meta.tty,
          pid: meta.shellPid,
          backend: meta.backend,
          shell: pty.shell,
          cwd: pty.cwd,
        });
      },
      onExit: ({ exitCode, signal }) => {
        sendSafe({ type: 'exit', exitCode, signal });
        try {
          ws.close();
        } catch {
          // Abaikan
        }
      },
    });

    if (pty.backend !== 'linux-openpty') {
      sendSafe({
        type: 'ready',
        tty: pty.tty,
        pid: pty.pid,
        backend: pty.backend,
        shell: pty.shell,
        cwd: pty.cwd,
      });
    }

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'));
      } catch {
        return;
      }

      if (msg.type === 'input' && typeof msg.data === 'string') {
        pty.write(msg.data);
      } else if (msg.type === 'resize') {
        pty.resize(msg.cols, msg.rows);
      } else if (msg.type === 'ping') {
        sendSafe({ type: 'pong' });
      }
    });

    ws.on('close', () => {
      pty.destroy();
    });

    ws.on('error', () => {
      pty.destroy();
    });
  });

  return wss;
}

const httpPtyMap = new Map();

/**
 * Fallback transport SSE + HTTP POST (/api/vps/pty/stream, /input, /resize)
 * sehingga Full-PTY tetap berjalan 100% live meskipun reverse proxy (Nginx /
 * Cloudflare) belum meneruskan header Upgrade WebSocket.
 */
function openSsePtyStream(req, res, session, searchParams, securityHeaders = {}) {
  const sessionId = crypto.randomBytes(12).toString('hex');
  const actorLabel = `panel:${session.username}`;
  const initCols = clampCols(searchParams.get('cols') || 100);
  const initRows = clampRows(searchParams.get('rows') || 30);

  res.writeHead(200, {
    ...securityHeaders,
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const writeSse = (eventName, payload) => {
    if (res.writableEnded || res.destroyed) return;
    try {
      res.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
    } catch {
      // Koneksi ditutup
    }
  };

  logger.info(
    'PANEL',
    `Sesi Full-PTY (SSE Duplex) dibuka oleh ${session.username} (${initCols}x${initRows})`
  );

  const pty = createInteractivePtySession({
    cols: initCols,
    rows: initRows,
    cwd: ROOT_DIR,
    actorLabel,
    onData: (chunk) => {
      writeSse('output', { data: chunk });
    },
    onMeta: (meta) => {
      writeSse('ready', {
        sessionId,
        tty: meta.tty,
        pid: meta.shellPid,
        backend: meta.backend,
        shell: pty.shell,
        cwd: pty.cwd,
      });
    },
    onExit: ({ exitCode, signal }) => {
      httpPtyMap.delete(sessionId);
      writeSse('exit', { exitCode, signal });
      try {
        res.end();
      } catch {
        // Abaikan
      }
    },
  });

  httpPtyMap.set(sessionId, { pty, username: session.username });

  if (pty.backend !== 'linux-openpty') {
    writeSse('ready', {
      sessionId,
      tty: pty.tty,
      pid: pty.pid,
      backend: pty.backend,
      shell: pty.shell,
      cwd: pty.cwd,
    });
  } else {
    writeSse('session', { sessionId });
  }

  const keepAlive = setInterval(() => {
    if (res.writableEnded || res.destroyed) {
      clearInterval(keepAlive);
      return;
    }
    try {
      res.write(': keepalive\n\n');
    } catch {
      clearInterval(keepAlive);
    }
  }, 15000);
  keepAlive.unref?.();

  const cleanup = () => {
    clearInterval(keepAlive);
    httpPtyMap.delete(sessionId);
    pty.destroy();
  };

  req.on('close', cleanup);
  res.on('close', cleanup);
}

function writeHttpPtyInput(sessionId, username, data) {
  const entry = httpPtyMap.get(String(sessionId || ''));
  if (!entry || entry.username !== username) return false;
  return entry.pty.write(typeof data === 'string' ? data : '');
}

function resizeHttpPtySession(sessionId, username, cols, rows) {
  const entry = httpPtyMap.get(String(sessionId || ''));
  if (!entry || entry.username !== username) return false;
  return entry.pty.resize(cols, rows);
}

function closeAllPtySessions() {
  httpPtyMap.clear();
  for (const sess of [...activePtySessions]) {
    sess.destroy();
  }
}

module.exports = {
  createInteractivePtySession,
  attachPtyWebSocketServer,
  openSsePtyStream,
  writeHttpPtyInput,
  resizeHttpPtySession,
  closeAllPtySessions,
};
