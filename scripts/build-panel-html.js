/**
 * Bundles panel/public/styles.css, charts.js, and app.js inline into
 * panel/public/index.html so Cipi Panel renders identically both on the
 * HTTP/SSE server (0.0.0.0:3000) AND inside static/srcdoc HTML file viewers.
 */

const fs = require('fs');
const path = require('path');

const pubDir = path.join(__dirname, '..', 'panel', 'public');
const css = fs.readFileSync(path.join(pubDir, 'styles.css'), 'utf8');
const chartsJs = fs.readFileSync(path.join(pubDir, 'charts.js'), 'utf8');
const appJs = fs.readFileSync(path.join(pubDir, 'app.js'), 'utf8');

const html = `<!DOCTYPE html>
<html lang="id" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CP — Cipi Panel · Bot &amp; Resource Control</title>
  <script>
    (function () {
      try {
        var saved = localStorage.getItem('cp-theme');
        var preferred = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', saved === 'light' || saved === 'dark' ? saved : preferred);
      } catch (e) {
        document.documentElement.setAttribute('data-theme', 'dark');
      }
    })();
  </script>
  <style id="cp-design-system">
${css}
  </style>
</head>
<body>
  <!-- ═══ Authentication Gate ═══ -->
  <div id="authOverlay" class="auth-overlay hidden">
    <div class="auth-card">
      <div class="auth-header">
        <div class="cp-brand">
          <span class="cp-mark" aria-hidden="true">
            <img class="cp-logo-img" src="/assets/logo-cp-badge.png?v=20261201b" alt="" width="34" height="34" draggable="false" decoding="async" />
          </span>
          <div class="cp-brand-text">
            <span class="cp-brand-title">Cipi Panel</span>
            <span class="cp-brand-sub">CP · Node &amp; Bot Daemon</span>
          </div>
        </div>
        <button type="button" id="loginThemeBtn" class="btn btn-icon" title="Switch Theme" aria-label="Switch Theme">
          <svg width="15" height="15" class="icon theme-icon-moon" viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          <svg width="15" height="15" class="icon theme-icon-sun hidden" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
        </button>
      </div>
      <p class="auth-desc">Masukkan kredensial operator untuk mengakses kontrol instance, konsol live, dan telemetri sistem.</p>
      <div id="authError" class="auth-error hidden"></div>
      <form id="loginForm">
        <div style="margin-bottom: 10px;">
          <label class="field-label" for="loginUsername">Operator Username</label>
          <input id="loginUsername" type="text" class="input mono" value="admin" autocomplete="username" required />
        </div>
        <div>
          <label class="field-label" for="loginPassword">PANEL_PASSWORD / Startup PIN</label>
          <input id="loginPassword" type="password" class="input mono" placeholder="••••••••••••" autocomplete="current-password" required />
        </div>
        <div style="margin-top: 14px; display: flex; flex-direction: column; gap: 8px;">
          <button type="submit" class="btn btn-primary" style="width: 100%;">Authenticate Session</button>
          <button type="button" id="btnQuickPreview" class="btn hidden" style="width: 100%;">Enter Sandbox Preview</button>
        </div>
      </form>
    </div>
  </div>

  <!-- ═══ Main Application Shell ═══ -->
  <div id="appShell" class="app-shell">
    <aside id="sidebar" class="sidebar">
      <div class="sidebar-top">
        <div class="cp-brand">
          <span class="cp-mark" title="CP — Cipi Panel">
            <img class="cp-logo-img" src="/assets/logo-cp-badge.png?v=20261201b" alt="CP Logo" width="34" height="34" draggable="false" decoding="async" />
          </span>
          <div class="cp-brand-text">
            <span class="cp-brand-title">Cipi Panel</span>
            <span class="cp-brand-sub">CP · Bot &amp; Node Control</span>
          </div>
        </div>
      </div>

      <div class="sidebar-section-label">Instance Control</div>
      <nav class="nav-list" aria-label="Primary Navigation">
        <button type="button" class="nav-btn active" data-view="console">
          <span class="nav-btn-left">
            <svg width="15" height="15" class="icon" viewBox="0 0 24 24"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
            <span>Console &amp; Graphs</span>
          </span>
        </button>

        <button type="button" class="nav-btn" data-view="runtime">
          <span class="nav-btn-left">
            <svg width="15" height="15" class="icon" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/></svg>
            <span>Runtime &amp; Commands</span>
          </span>
          <span id="navCmdCount" class="nav-count">79</span>
        </button>

        <button type="button" class="nav-btn" data-view="minecraft">
          <span class="nav-btn-left">
            <svg width="15" height="15" class="icon" viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
            <span>Minecraft &amp; Wings</span>
          </span>
        </button>
      </nav>

      <div class="sidebar-section-label">Management</div>
      <nav class="nav-list" aria-label="Management Navigation">
        <button type="button" class="nav-btn" data-view="users">
          <span class="nav-btn-left">
            <svg width="15" height="15" class="icon" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            <span>Users &amp; Economy</span>
          </span>
          <span id="navUserCount" class="nav-count">0</span>
        </button>

        <button type="button" class="nav-btn" data-view="comms">
          <span class="nav-btn-left">
            <svg width="15" height="15" class="icon" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            <span>Broadcast &amp; Tickets</span>
          </span>
          <span id="navTicketCount" class="nav-count">0</span>
        </button>

        <button type="button" class="nav-btn" data-view="storage">
          <span class="nav-btn-left">
            <svg width="15" height="15" class="icon" viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
            <span>Backups &amp; Storage</span>
          </span>
        </button>

        <button type="button" class="nav-btn" data-view="audit">
          <span class="nav-btn-left">
            <svg width="15" height="15" class="icon" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            <span>Audit &amp; Access</span>
          </span>
        </button>
      </nav>

      <div class="sidebar-footer">
        <div class="stream-indicator">
          <span class="stream-dot-wrap">
            <span id="sseLed" class="led warn"></span>
            <span id="sseLabel">SSE Connecting</span>
          </span>
          <span id="nodeVerLabel" class="mono" style="font-size: 11px; color: var(--text-muted);">node</span>
        </div>
        <button type="button" id="logoutBtn" class="btn btn-sm" style="width: 100%;">
          <svg width="13" height="13" class="icon icon-sm" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          <span>Sign Out Session</span>
        </button>
      </div>
    </aside>

    <!-- Workspace Area -->
    <div class="workspace">
      <!-- Pterodactyl Persistent Instance Header -->
      <header class="instance-header">
        <div class="instance-meta">
          <button type="button" id="mobileMenuBtn" class="btn btn-icon mobile-menu-btn" aria-label="Toggle Menu">
            <svg width="15" height="15" class="icon" viewBox="0 0 24 24"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>

          <div class="instance-title-group">
            <span id="instanceLed" class="led ok"></span>
            <span class="breadcrumb-muted">Instances /</span>
            <span id="headerBotName" class="instance-name">CipiSMP Bot</span>
            <span id="waBadge" class="badge ok">RUNNING</span>
            <span id="modeBadge" class="badge">PUBLIC</span>
          </div>

          <span class="meta-divider"></span>

          <span class="meta-pill mono" title="Process Uptime">
            <svg width="13" height="13" class="icon icon-sm" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <span id="headerUptime">00h 00m 00s</span>
          </span>

          <span class="meta-pill mono" title="Allocation Endpoint">
            <svg width="13" height="13" class="icon icon-sm" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
            <span id="headerEndpoint">0.0.0.0:3000</span>
          </span>
        </div>

        <div class="header-controls">
          <div class="power-group">
            <button type="button" id="btnWaConnect" class="btn btn-success btn-sm" title="Start / Reconnect WhatsApp Socket">
              <svg width="13" height="13" class="icon icon-sm" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              <span>Start</span>
            </button>

            <button type="button" id="btnReloadCmds" class="btn btn-warn btn-sm" title="Hot-Reload Command Registry">
              <svg width="13" height="13" class="icon icon-sm" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
              <span>Reload</span>
            </button>

            <button type="button" id="btnWaDisconnect" class="btn btn-danger btn-sm" title="Disconnect WhatsApp Socket">
              <svg width="13" height="13" class="icon icon-sm" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12"/></svg>
              <span>Stop</span>
            </button>
          </div>

          <!-- Dark / Light Theme Switcher -->
          <button type="button" id="themeToggleBtn" class="btn btn-sm" title="Toggle Dark / Light Mode" aria-label="Toggle Dark or Light Mode">
            <svg width="13" height="13" class="icon icon-sm theme-icon-moon" viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            <svg width="13" height="13" class="icon icon-sm theme-icon-sun hidden" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
            <span id="themeModeLabel">Dark</span>
          </button>
        </div>
      </header>

      <main class="content-body">
        <!-- ═══ Persistent Pterodactyl 4-Metric Resource Strip ═══ -->
        <section class="metrics-strip" aria-label="Resource Telemetry">
          <div class="metric-card">
            <div class="metric-head">
              <span>CPU Load (Process / Host)</span>
              <span class="metric-icon-box">
                <svg width="13" height="13" class="icon icon-sm" viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              </span>
            </div>
            <div class="metric-value-row">
              <span id="metricCpuVal" class="metric-value">0.0%</span>
              <span id="metricCpuSub" class="metric-sub">0 cores · load 0.00</span>
            </div>
            <div class="meter-track"><div id="meterCpu" class="meter-fill" style="width: 4%;"></div></div>
          </div>

          <div class="metric-card">
            <div class="metric-head">
              <span>Memory (Node RSS / V8 Heap)</span>
              <span class="metric-icon-box">
                <svg width="13" height="13" class="icon icon-sm" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="7" y1="8" x2="7" y2="16"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="17" y1="8" x2="17" y2="16"/></svg>
              </span>
            </div>
            <div class="metric-value-row">
              <span id="metricMemVal" class="metric-value">0.0 MB</span>
              <span id="metricMemSub" class="metric-sub">Heap 0 / 0 MB</span>
            </div>
            <div class="meter-track"><div id="meterMem" class="meter-fill ok" style="width: 8%;"></div></div>
          </div>

          <div class="metric-card">
            <div class="metric-head">
              <span>SQLite WAL &amp; Host Disk</span>
              <span class="metric-icon-box">
                <svg width="13" height="13" class="icon icon-sm" viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
              </span>
            </div>
            <div class="metric-value-row">
              <span id="metricDiskVal" class="metric-value">0 KB</span>
              <span id="metricDiskSub" class="metric-sub">Disk 0% used</span>
            </div>
            <div class="meter-track"><div id="meterDisk" class="meter-fill" style="width: 10%;"></div></div>
          </div>

          <div class="metric-card">
            <div class="metric-head">
              <span>Event-Loop &amp; Throughput</span>
              <span class="metric-icon-box">
                <svg width="13" height="13" class="icon icon-sm" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              </span>
            </div>
            <div class="metric-value-row">
              <span id="metricLoopVal" class="metric-value">0.00 ms</span>
              <span id="metricLoopSub" class="metric-sub">0 cmds/min</span>
            </div>
            <div class="meter-track"><div id="meterLoop" class="meter-fill ok" style="width: 4%;"></div></div>
          </div>
        </section>

        <!-- ═══ VIEW 1: Console & Live Telemetry ═══ -->
        <section id="view-console" class="view-section">
          <div class="console-grid">
            <div class="panel-card terminal-card">
              <div class="panel-head">
                <div class="panel-title">
                  <svg width="15" height="15" class="icon" viewBox="0 0 24 24"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
                  <span>tty0 · Live Instance Console</span>
                </div>
                <div class="filter-pills">
                  <button type="button" class="pill-btn active" data-log-filter="ALL">ALL</button>
                  <button type="button" class="pill-btn" data-log-filter="info">INFO</button>
                  <button type="button" class="pill-btn" data-log-filter="warn">WARN</button>
                  <button type="button" class="pill-btn" data-log-filter="error">ERROR</button>
                  <button type="button" class="pill-btn" data-log-filter="cmd">CMD</button>
                  <button type="button" id="btnAutoScroll" class="btn btn-sm">Auto-Scroll: ON</button>
                  <button type="button" id="btnClearConsole" class="btn btn-sm">Clear</button>
                </div>
              </div>

              <div id="terminalViewport" class="terminal-viewport" aria-live="polite"></div>

              <div class="terminal-quick-bar">
                <span style="font-size: 10.5px; color: #71717a; font-family: 'JetBrains Mono', monospace;">Quick CLI:</span>
                <button type="button" class="terminal-chip" data-cli-chip="status">status</button>
                <button type="button" class="terminal-chip" data-cli-chip="mem">mem</button>
                <button type="button" class="terminal-chip" data-cli-chip="reload">reload</button>
                <button type="button" class="terminal-chip" data-cli-chip="checkpoint">checkpoint</button>
                <button type="button" class="terminal-chip" data-cli-chip="backup">backup</button>
                <button type="button" class="terminal-chip" data-cli-chip="help">help</button>
              </div>

              <form id="consoleExecForm" class="terminal-input-bar">
                <span class="terminal-prompt">container@cipi:~$</span>
                <input
                  id="consoleCmdInput"
                  type="text"
                  class="terminal-cmd-input"
                  placeholder="Type CLI command (help, status, mem, reload, mode public|self, backup, checkpoint)..."
                  autocomplete="off"
                />
                <button type="submit" class="btn btn-primary btn-sm">Send</button>
              </form>
            </div>

            <div class="charts-stack">
              <div class="chart-box">
                <div class="metric-head">
                  <span>CPU Utilization (%) — 90s Window</span>
                  <span id="chartCpuLabel" class="mono">0.0%</span>
                </div>
                <div class="chart-canvas-wrap">
                  <canvas id="canvasCpu"></canvas>
                </div>
              </div>

              <div class="chart-box">
                <div class="metric-head">
                  <span>Node Resident Set Size (MB)</span>
                  <span id="chartMemLabel" class="mono">0.0 MB</span>
                </div>
                <div class="chart-canvas-wrap">
                  <canvas id="canvasMem"></canvas>
                </div>
              </div>

              <div class="chart-box">
                <div class="metric-head">
                  <span>Event-Loop Latency (ms)</span>
                  <span id="chartLoopLabel" class="mono">0.00 ms</span>
                </div>
                <div class="chart-canvas-wrap">
                  <canvas id="canvasLoop"></canvas>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- ═══ VIEW 2: Runtime & Commands ═══ -->
        <section id="view-runtime" class="view-section hidden">
          <div class="two-col-grid" style="margin-bottom: 14px;">
            <div class="panel-card">
              <div class="panel-head">
                <div class="panel-title">Runtime Switches &amp; WhatsApp Pairing</div>
                <span id="runtimeWaStatusBadge" class="badge">CHECKING</span>
              </div>
              <div class="panel-body" style="display: flex; flex-direction: column; gap: 12px;">
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                  <button type="button" id="btnToggleBotMode" class="btn btn-sm">Mode: PUBLIC</button>
                  <button type="button" id="btnToggleMaint" class="btn btn-sm">Maintenance: OFF</button>
                  <button type="button" id="btnToggleDryRun" class="btn btn-sm">Dry-Run: OFF</button>
                  <button type="button" id="btnToggleButtons" class="btn btn-sm">Buttons: ON</button>
                </div>

                <div style="border-top: 1px solid var(--border-subtle); padding-top: 10px;">
                  <label class="field-label" for="pairingPhoneInput">Request 8-Digit WhatsApp Pairing Code</label>
                  <form id="pairingForm" style="display: flex; gap: 8px;">
                    <input id="pairingPhoneInput" type="text" class="input mono" placeholder="6281234567890" />
                    <button type="submit" class="btn btn-primary">Request Code</button>
                  </form>
                  <div id="pairingResultBox" class="meta-pill mono hidden" style="margin-top: 8px; font-size: 12.5px;"></div>
                </div>
              </div>
            </div>

            <div class="panel-card">
              <div class="panel-head">
                <div class="panel-title">Host &amp; Instance Environment</div>
              </div>
              <div class="panel-body">
                <div id="runtimeEnvKv" class="kv-list"></div>
              </div>
            </div>
          </div>

          <div class="panel-card">
            <div class="panel-head">
              <div class="panel-title">Registered Command Modules</div>
              <div class="toolbar-row">
                <input id="cmdSearchInput" type="search" class="input" style="width: 210px; height: 28px;" placeholder="Filter command or alias..." />
                <select id="cmdCategorySelect" class="select" style="width: 165px; height: 28px;">
                  <option value="ALL">All Categories</option>
                </select>
              </div>
            </div>
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Command</th>
                    <th>Aliases</th>
                    <th>Category</th>
                    <th>Cooldown</th>
                    <th>Access Scope</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody id="cmdTableBody"></tbody>
              </table>
            </div>
          </div>
        </section>

        <!-- ═══ VIEW 3: Minecraft & Pterodactyl Wings ═══ -->
        <section id="view-minecraft" class="view-section hidden">
          <div class="two-col-grid" style="margin-bottom: 14px;">
            <div class="panel-card">
              <div class="panel-head">
                <div class="panel-title">Minecraft Server Live Probe</div>
                <button type="button" id="btnRefreshMc" class="btn btn-sm">Refresh Probe</button>
              </div>
              <div class="panel-body">
                <div id="mcStatusKv" class="kv-list"></div>
              </div>
            </div>

            <div class="panel-card">
              <div class="panel-head">
                <div class="panel-title">Pterodactyl Wings Controls</div>
                <span id="pteroConfigBadge" class="badge">UNCONFIGURED</span>
              </div>
              <div class="panel-body">
                <div id="pteroStatusKv" class="kv-list" style="margin-bottom: 12px;"></div>
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                  <button type="button" class="btn btn-success ptero-power-btn" data-signal="start">Start</button>
                  <button type="button" class="btn btn-warn ptero-power-btn" data-signal="restart">Restart</button>
                  <button type="button" class="btn btn-danger ptero-power-btn" data-signal="stop">Stop</button>
                  <button type="button" class="btn ptero-power-btn" data-signal="backup">Wings Backup</button>
                </div>
              </div>
            </div>
          </div>

          <div class="panel-card">
            <div class="panel-head">
              <div class="panel-title">Whitelisted RCON Console Dispatch</div>
              <span class="panel-sub mono">Strict security whitelist enforced</span>
            </div>
            <div class="panel-body">
              <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px;">
                <button type="button" class="btn btn-sm rcon-preset" data-cmd="list">list</button>
                <button type="button" class="btn btn-sm rcon-preset" data-cmd="tps">tps</button>
                <button type="button" class="btn btn-sm rcon-preset" data-cmd="whitelist list">whitelist list</button>
                <button type="button" class="btn btn-sm rcon-preset" data-cmd="save-all">save-all</button>
              </div>
              <form id="rconForm" style="display: flex; gap: 8px;">
                <input id="rconInput" type="text" class="input mono" placeholder="Enter whitelisted RCON command (e.g. list, whitelist add Player)..." required />
                <button type="submit" class="btn btn-primary">Execute RCON</button>
              </form>
              <pre id="rconOutput" class="mono" style="margin: 10px 0 0; padding: 10px; border-radius: 6px; background: var(--bg-terminal); color: #e4e4e7; font-size: 11.5px; min-height: 54px; white-space: pre-wrap;">Ready. Unwhitelisted commands (e.g. op, stop) are rejected with HTTP 403.</pre>
            </div>
          </div>
        </section>

        <!-- ═══ VIEW 4: Users & Economy ═══ -->
        <section id="view-users" class="view-section hidden">
          <div class="metrics-strip" style="margin-bottom: 14px;">
            <div class="metric-card">
              <div class="metric-head"><span>Registered Users</span></div>
              <div id="econTotalUsers" class="metric-value">0</div>
            </div>
            <div class="metric-card">
              <div class="metric-head"><span>Active Sakura VIP</span></div>
              <div id="econVipUsers" class="metric-value">0</div>
            </div>
            <div class="metric-card">
              <div class="metric-head"><span>Minecraft Linked</span></div>
              <div id="econLinkedMc" class="metric-value">0</div>
            </div>
            <div class="metric-card">
              <div class="metric-head"><span>Restricted (Banned)</span></div>
              <div id="econBannedUsers" class="metric-value">0</div>
            </div>
          </div>

          <div class="panel-card" style="margin-bottom: 14px;">
            <div class="panel-head">
              <div class="panel-title">Register / Inspect WhatsApp Account in SQLite</div>
              <span class="panel-sub">Create or open any real user record directly</span>
            </div>
            <div class="panel-body">
              <form id="ensureUserForm" style="display: grid; grid-template-columns: 1fr 1fr auto; gap: 8px;">
                <input id="ensureUserPhone" type="text" class="input mono" placeholder="6281234567890" required />
                <input id="ensureUserName" type="text" class="input" placeholder="Display Name (optional)" />
                <button type="submit" class="btn btn-primary">Register &amp; Inspect</button>
              </form>
            </div>
          </div>

          <div class="panel-card">
            <div class="panel-head">
              <div class="panel-title">User Ledger (Click row to inspect &amp; modify)</div>
              <div class="toolbar-row">
                <div class="filter-pills">
                  <button type="button" class="pill-btn active" data-user-filter="all">All</button>
                  <button type="button" class="pill-btn" data-user-filter="vip">VIP</button>
                  <button type="button" class="pill-btn" data-user-filter="banned">Banned</button>
                  <button type="button" class="pill-btn" data-user-filter="linked">MC Linked</button>
                </div>
                <input id="userSearchInput" type="search" class="input" style="width: 220px; height: 28px;" placeholder="Search phone, name, MC..." />
              </div>
            </div>
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>User / Phone</th>
                    <th>Minecraft</th>
                    <th>Level / XP</th>
                    <th>Wallet</th>
                    <th>Bank</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody id="usersTableBody"></tbody>
              </table>
            </div>
          </div>
        </section>

        <!-- ═══ VIEW 5: Broadcast & Support Tickets ═══ -->
        <section id="view-comms" class="view-section hidden">
          <div class="two-col-grid">
            <div class="panel-card">
              <div class="panel-head">
                <div class="panel-title">Multi-Platform Broadcast</div>
                <span class="panel-sub">Max 300 chars · Anti-spam sanitized</span>
              </div>
              <div class="panel-body">
                <form id="broadcastForm">
                  <label class="field-label" for="bcTargetMode">Target Channel</label>
                  <select id="bcTargetMode" class="select" style="margin-bottom: 10px;">
                    <option value="all">All Channels (WhatsApp + Minecraft + Discord)</option>
                    <option value="wa">WhatsApp Groups Only</option>
                    <option value="mc">Minecraft In-Game Only</option>
                    <option value="dc">Discord Webhook Only</option>
                  </select>

                  <label class="field-label" for="bcMessage">Announcement Payload</label>
                  <textarea id="bcMessage" class="textarea" maxlength="300" placeholder="Tulis pengumuman pemeliharaan atau event server (maks 300 karakter)..." required></textarea>

                  <div style="display: flex; justify-content: flex-end; margin-top: 10px;">
                    <button type="submit" class="btn btn-primary">Dispatch Broadcast</button>
                  </div>
                </form>
                <div id="bcResultInfo" class="meta-pill mono hidden" style="margin-top: 10px;"></div>
              </div>
            </div>

            <div class="panel-card">
              <div class="panel-head">
                <div class="panel-title">Support Tickets Queue</div>
                <button type="button" id="btnRefreshComms" class="btn btn-sm">Refresh</button>
              </div>
              <div class="table-wrap">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>Ticket</th>
                      <th>Category</th>
                      <th>Message</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody id="ticketsTableBody"></tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        <!-- ═══ VIEW 6: Backups & Storage ═══ -->
        <section id="view-storage" class="view-section hidden">
          <div class="two-col-grid" style="margin-bottom: 14px;">
            <div class="panel-card">
              <div class="panel-head">
                <div class="panel-title">SQLite WAL &amp; Directory Footprint</div>
                <div style="display: flex; gap: 6px;">
                  <button type="button" id="btnWalCheckpoint" class="btn btn-sm">Checkpoint WAL</button>
                  <button type="button" id="btnCreateBackup" class="btn btn-primary btn-sm">Create Snapshot</button>
                </div>
              </div>
              <div class="panel-body">
                <div id="storageBreakdownKv" class="kv-list"></div>
              </div>
            </div>

            <div class="panel-card">
              <div class="panel-head">
                <div class="panel-title">Host Filesystem &amp; SQLite Row Counts</div>
              </div>
              <div class="panel-body">
                <div id="filesystemKv" class="kv-list"></div>
              </div>
            </div>
          </div>

          <div class="panel-card">
            <div class="panel-head">
              <div class="panel-title">Database Snapshot Archives</div>
              <span id="backupRotationSub" class="panel-sub mono">Online SQLite backup snapshots</span>
            </div>
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Filename</th>
                    <th>Size</th>
                    <th>SHA-256 (12c)</th>
                    <th>Created (WIB)</th>
                    <th>Download</th>
                  </tr>
                </thead>
                <tbody id="backupsTableBody"></tbody>
              </table>
            </div>
          </div>
        </section>

        <!-- ═══ VIEW 7: Audit & Access ═══ -->
        <section id="view-audit" class="view-section hidden">
          <div class="panel-card" style="margin-bottom: 14px;">
            <div class="panel-head">
              <div class="panel-title">Security Posture &amp; Access Controls</div>
            </div>
            <div class="panel-body">
              <div id="securityPostureKv" class="kv-list"></div>
            </div>
          </div>

          <div class="panel-card">
            <div class="panel-head">
              <div class="panel-title">Administrative Audit Ledger</div>
              <div class="toolbar-row">
                <select id="auditCategorySelect" class="select" style="width: 170px; height: 28px;">
                  <option value="">All Categories</option>
                  <option value="panel_auth">panel_auth</option>
                  <option value="owner_admin">owner_admin</option>
                  <option value="server_control">server_control</option>
                  <option value="backup">backup</option>
                </select>
                <button type="button" id="btnRefreshAudit" class="btn btn-sm">Refresh</button>
              </div>
            </div>
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Timestamp (WIB)</th>
                    <th>Category</th>
                    <th>Actor</th>
                    <th>Action</th>
                    <th>Target</th>
                  </tr>
                </thead>
                <tbody id="auditTableBody"></tbody>
              </table>
            </div>
          </div>
        </section>
      </main>
    </div>
  </div>

  <!-- ═══ Slide-Over User Inspector Drawer ═══ -->
  <div id="userDrawerBackdrop" class="drawer-backdrop hidden">
    <aside class="drawer-panel" aria-label="User Inspector">
      <div class="panel-head">
        <div class="panel-title">User Account Inspector</div>
        <button type="button" id="btnCloseDrawer" class="btn btn-sm">Close</button>
      </div>
      <div class="panel-body" style="display: flex; flex-direction: column; gap: 14px;">
        <div id="drawerUserKv" class="kv-list"></div>

        <div class="panel-card">
          <div class="panel-head"><div class="panel-title">Sakura Coin Adjustment</div></div>
          <div class="panel-body" style="display: flex; gap: 8px;">
            <input id="drawerCoinAmount" type="number" min="1" value="10000" class="input mono" placeholder="Amount" />
            <button type="button" id="btnDrawerAddCoin" class="btn btn-success">Add</button>
            <button type="button" id="btnDrawerSubCoin" class="btn btn-warn">Deduct</button>
          </div>
        </div>

        <div class="panel-card">
          <div class="panel-head"><div class="panel-title">Sakura VIP Subscription</div></div>
          <div class="panel-body" style="display: flex; gap: 8px;">
            <input id="drawerVipDuration" type="text" value="30d" class="input mono" placeholder="7d / 30d / permanen" />
            <button type="button" id="btnDrawerGrantVip" class="btn btn-primary">Grant VIP</button>
            <button type="button" id="btnDrawerRevokeVip" class="btn btn-danger">Revoke</button>
          </div>
        </div>

        <div class="panel-card">
          <div class="panel-head"><div class="panel-title">Moderation Restriction</div></div>
          <div class="panel-body" style="display: flex; flex-direction: column; gap: 8px;">
            <input id="drawerBanReason" type="text" class="input" placeholder="Ban reason (recorded in audit log)" />
            <div style="display: flex; gap: 8px;">
              <button type="button" id="btnDrawerBan" class="btn btn-danger" style="flex: 1;">Ban User</button>
              <button type="button" id="btnDrawerUnban" class="btn btn-success" style="flex: 1;">Unban User</button>
            </div>
          </div>
        </div>
      </div>
    </aside>
  </div>

  <!-- ═══ Confirmation Modal ═══ -->
  <div id="confirmModalBackdrop" class="modal-backdrop hidden">
    <div class="modal-card">
      <div class="panel-title" id="confirmModalTitle" style="margin-bottom: 8px;">Confirm Action</div>
      <p id="confirmModalDesc" style="margin: 0 0 16px; color: var(--text-secondary); font-size: 12.5px;"></p>
      <div style="display: flex; justify-content: flex-end; gap: 8px;">
        <button type="button" id="btnConfirmCancel" class="btn">Cancel</button>
        <button type="button" id="btnConfirmProceed" class="btn btn-danger">Confirm</button>
      </div>
    </div>
  </div>

  <div id="toastStack" class="toast-stack" aria-live="polite"></div>

  <script id="cp-charts-engine">
${chartsJs}
  </script>
  <script id="cp-app-controller">
${appJs}
  </script>
</body>
</html>
`;

fs.writeFileSync(path.join(pubDir, 'index.html'), html, 'utf8');
console.log(`[BUILD] Generated self-contained panel/public/index.html (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)`);
