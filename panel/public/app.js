/* ═══════════════════════════════════════════════════════════════════════
   Cipi Panel (CP) — Production Client Controller (100% Real Backend)
   Zero dummy data — connects exclusively to live Node/OS/SQLite API & SSE
   ═══════════════════════════════════════════════════════════════════════ */

(function () {
  const state = {
    token: '',
    authenticated: false,
    sandboxPreview: false,
    activeView: 'console',
    overview: null,
    telemetryHistory: [],
    consoleEntries: [],
    logFilter: 'ALL',
    autoScroll: true,
    cmdHistory: [],
    cmdHistoryIdx: -1,
    commandsCatalog: [],
    userFilter: 'all',
    userSearch: '',
    selectedUser: null,
    vpsSnapshot: null,
    vpsTerm: null,
    vpsFitAddon: null,
    vpsPtyWs: null,
    vpsPtyPingTimer: null,
    vpsTallMode: false,
    vpsProcFilter: '',
    vpsPublicIp: null,
    sse: null,
    confirmCallback: null,
  };

  try {
    state.token = sessionStorage.getItem('cp-token') || '';
  } catch {
    state.token = '';
  }

  const $ = (id) => document.getElementById(id);

  function saveToken(tok) {
    state.token = tok || '';
    try {
      if (state.token) sessionStorage.setItem('cp-token', state.token);
      else sessionStorage.removeItem('cp-token');
    } catch {
      // Ignore sandboxed storage errors
    }
  }

  // ─── Desktop Collapsible & Mobile Off-Canvas Sidebar Controller ───
  function setSidebarOpen(open) {
    const sidebar = $('sidebar');
    const backdrop = $('sidebarBackdrop');
    const isMobileOrTablet = window.innerWidth < 1024;
    if (sidebar) sidebar.classList.toggle('open', Boolean(open) && isMobileOrTablet);
    if (backdrop) backdrop.classList.toggle('open', Boolean(open) && isMobileOrTablet);
    document.body.classList.toggle('nav-locked', Boolean(open) && isMobileOrTablet);
  }

  function toggleSidebarMenu() {
    if (window.innerWidth >= 1024) {
      const shell = $('appShell');
      if (!shell) return;
      const collapsed = shell.classList.toggle('sidebar-collapsed');
      setSidebarOpen(false);
      try {
        localStorage.setItem('cp-sidebar-collapsed', collapsed ? '1' : '0');
      } catch {
        // Ignore storage error
      }
      if (state.activeView === 'console') {
        requestAnimationFrame(drawAllCharts);
        setTimeout(() => requestAnimationFrame(drawAllCharts), 255);
      } else if (state.activeView === 'vps') {
        setTimeout(() => requestAnimationFrame(fitVpsPty), 255);
      }
      return;
    }

    const isOpen = $('sidebar') && $('sidebar').classList.contains('open');
    setSidebarOpen(!isOpen);
  }

  // ─── Formatting Utilities ───
  function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  function formatNumber(n) {
    return Number(n || 0).toLocaleString('id-ID');
  }

  function formatUptime(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const rem = s % 60;
    const pad = (v) => String(v).padStart(2, '0');
    return d > 0 ? `${d}d ${pad(h)}h ${pad(m)}m` : `${pad(h)}h ${pad(m)}m ${pad(rem)}s`;
  }

  function formatTimeShort(entry) {
    if (entry?.ts) {
      const m = String(entry.ts).match(/(\d{2}:\d{2}:\d{2})/);
      if (m) return m[1];
    }
    const d = new Date(Number(entry?.epoch) || Date.now());
    return d.toTimeString().slice(0, 8);
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toast(msg, kind = 'ok') {
    const stack = $('toastStack');
    if (!stack) return;
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = msg;
    stack.appendChild(el);
    setTimeout(() => {
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 180);
    }, 3200);
  }

  function closeUserDrawer() {
    const bd = $('userDrawerBackdrop');
    if (!bd || bd.classList.contains('hidden')) return;
    bd.classList.add('closing');
    setTimeout(() => {
      bd.classList.add('hidden');
      bd.classList.remove('closing');
    }, 170);
  }

  // ─── Operator Command Palette (Ctrl+K / Cmd+K) ───
  let paletteFiltered = [];
  let paletteSelectedIdx = 0;

  function getPaletteEntries() {
    return [
      {
        title: 'Console & Telemetry Graphs',
        sub: 'Live redacted instance console, Quick CLI & CPU/RAM/Loop spline graphs',
        tag: 'View',
        keywords: 'console logs graphs cpu memory telemetry tty0',
        run: () => switchView('console'),
      },
      {
        title: 'VPS Terminal (Full Interactive PTY)',
        sub: 'Real SSH-grade /dev/pts shell (nano, htop, vim, Tab, [Y/n]) & host processes',
        tag: 'View',
        keywords: 'vps ssh pty terminal bash linux host processes disk',
        run: () => switchView('vps'),
      },
      {
        title: 'Runtime Switches & 89 Commands',
        sub: 'Public/Self mode, maintenance, WhatsApp pairing code & command registry',
        tag: 'View',
        keywords: 'runtime commands pairing mode public self maintenance',
        run: () => switchView('runtime'),
      },
      {
        title: 'Minecraft & Pterodactyl Wings',
        sub: 'Live Java/Bedrock server probe, Wings power actions & whitelisted RCON',
        tag: 'View',
        keywords: 'minecraft rcon wings pterodactyl server start restart',
        run: () => switchView('minecraft'),
      },
      {
        title: 'Users, Economy & Sakura VIP',
        sub: 'Inspect SQLite accounts, adjust Sakura Coin wallet/bank, VIP & moderation',
        tag: 'View',
        keywords: 'users economy coins vip ban wallet sqlite',
        run: () => switchView('users'),
      },
      {
        title: 'Broadcast & Support Tickets',
        sub: 'Multi-channel WhatsApp/Minecraft/Discord announcements & ticket queue',
        tag: 'View',
        keywords: 'broadcast tickets support discord announcement',
        run: () => switchView('comms'),
      },
      {
        title: 'Backups & SQLite WAL Storage',
        sub: 'Create online database snapshots, checkpoint WAL & inspect disk usage',
        tag: 'View',
        keywords: 'storage backups sqlite wal snapshot download',
        run: () => switchView('storage'),
      },
      {
        title: 'Audit Ledger & Security Posture',
        sub: 'Review administrative actions, HMAC session security & access logs',
        tag: 'View',
        keywords: 'audit security logs posture auth',
        run: () => switchView('audit'),
      },
      {
        title: 'Toggle Dark / Light Theme',
        sub: 'Switch between Obsidian Dark and Swiss Architectural Light theme',
        tag: 'Action',
        keywords: 'theme dark light mode appearance color',
        run: () => toggleTheme(),
      },
      {
        title: 'Hot-Reload Command Registry',
        sub: 'Reload all 89 WhatsApp bot commands from disk without dropping socket',
        tag: 'Action',
        keywords: 'reload commands hot refresh registry',
        run: () => $('btnReloadCmds')?.click(),
      },
      {
        title: 'Create SQLite Database Snapshot',
        sub: 'Run online SQLite backup immediately and save checksummed archive',
        tag: 'Action',
        keywords: 'create backup snapshot database save',
        run: async () => {
          const res = await api('/api/storage/backup', { method: 'POST' });
          toast(`Snapshot created: ${res.backup?.name || 'OK'}`);
          if (state.activeView === 'storage') await loadStorageView();
        },
      },
      {
        title: 'Checkpoint SQLite WAL Journal',
        sub: 'Flush write-ahead log frames into primary SQLite database file',
        tag: 'Action',
        keywords: 'wal checkpoint flush sqlite journal',
        run: async () => {
          await api('/api/storage/checkpoint', { method: 'POST' });
          toast('SQLite WAL checkpoint completed');
          if (state.activeView === 'storage') await loadStorageView();
        },
      },
      {
        title: 'Respawn Interactive VPS PTY Shell',
        sub: 'Open VPS Terminal and spawn a fresh interactive /bin/bash PTY session',
        tag: 'Action',
        keywords: 'respawn reconnect pty shell bash reset terminal',
        run: async () => {
          await switchView('vps');
          connectPtyWebSocket(true);
          toast('Interactive PTY session respawned');
        },
      },
    ];
  }

  function renderCmdPaletteList() {
    const listEl = $('cmdPaletteList');
    if (!listEl) return;
    if (!paletteFiltered.length) {
      listEl.innerHTML = `<div style="padding:18px 12px; text-align:center; color:var(--text-muted); font-size:12px;">No matching view or operator action.</div>`;
      return;
    }
    listEl.innerHTML = paletteFiltered
      .map(
        (item, idx) =>
          `<button type="button" class="cmd-palette-item ${idx === paletteSelectedIdx ? 'selected' : ''}" data-palette-idx="${idx}" role="option">` +
          `<span class="cmd-palette-left">` +
          `<span class="cmd-palette-title">${escapeHtml(item.title)}</span>` +
          `<span class="cmd-palette-sub">${escapeHtml(item.sub)}</span>` +
          `</span>` +
          `<span class="cmd-palette-tag">${escapeHtml(item.tag)}</span>` +
          `</button>`
      )
      .join('');

    listEl.querySelectorAll('[data-palette-idx]').forEach((btn) => {
      btn.addEventListener('mouseenter', () => {
        paletteSelectedIdx = Number(btn.dataset.paletteIdx) || 0;
        listEl.querySelectorAll('.cmd-palette-item').forEach((el, i) => {
          el.classList.toggle('selected', i === paletteSelectedIdx);
        });
      });
      btn.addEventListener('click', () => {
        executePaletteIndex(Number(btn.dataset.paletteIdx) || 0);
      });
    });

    const activeRow = listEl.querySelector('.cmd-palette-item.selected');
    activeRow?.scrollIntoView({ block: 'nearest' });
  }

  function filterCmdPalette(query) {
    const q = String(query || '').trim().toLowerCase();
    const all = getPaletteEntries();
    paletteFiltered = q
      ? all.filter(
          (it) =>
            it.title.toLowerCase().includes(q) ||
            it.sub.toLowerCase().includes(q) ||
            it.keywords.includes(q)
        )
      : all;
    paletteSelectedIdx = 0;
    renderCmdPaletteList();
  }

  function openCmdPalette() {
    if (!$('authOverlay')?.classList.contains('hidden')) return;
    const bd = $('cmdPaletteBackdrop');
    const inp = $('cmdPaletteInput');
    if (!bd || !inp) return;
    bd.classList.remove('hidden');
    inp.value = '';
    filterCmdPalette('');
    requestAnimationFrame(() => inp.focus());
  }

  function closeCmdPalette() {
    $('cmdPaletteBackdrop')?.classList.add('hidden');
  }

  async function executePaletteIndex(idx) {
    const chosen = paletteFiltered[idx];
    if (!chosen) return;
    closeCmdPalette();
    try {
      await chosen.run();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function askConfirm(title, desc, onProceed) {
    $('confirmModalTitle').textContent = title;
    $('confirmModalDesc').textContent = desc;
    state.confirmCallback = onProceed;
    $('confirmModalBackdrop').classList.remove('hidden');
  }

  // ─── Theme Management (Dark Mode & Light Mode) ───
  function getActiveTheme() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }

  function syncThemeControls() {
    const isLight = getActiveTheme() === 'light';
    const label = $('themeModeLabel');
    if (label) label.textContent = isLight ? 'Light' : 'Dark';

    document.querySelectorAll('.theme-icon-moon').forEach((el) => el.classList.toggle('hidden', isLight));
    document.querySelectorAll('.theme-icon-sun').forEach((el) => el.classList.toggle('hidden', !isLight));
  }

  function toggleTheme() {
    const next = getActiveTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('cp-theme', next);
    } catch {
      // Ignore storage restrictions
    }
    syncThemeControls();
    drawAllCharts();
  }

  // ─── API Helper (Bearer + Same-Origin Cookie) ───
  async function api(url, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (state.token) {
      headers.Authorization = `Bearer ${state.token}`;
    }
    const fetchOpts = {
      method: opts.method || 'GET',
      headers,
      credentials: 'same-origin',
    };
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      fetchOpts.body = JSON.stringify(opts.body);
    }

    const res = await fetch(url, fetchOpts);
    const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
    if (res.status === 401 && url !== '/api/auth/login') {
      saveToken('');
      showAuthGate();
      throw new Error(data.error || 'Sesi berakhir, silakan login ulang.');
    }
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || data.output || `Request failed (${res.status})`);
    }
    return data;
  }

  function closePtySocket() {
    if (state.vpsPtyPingTimer) {
      clearInterval(state.vpsPtyPingTimer);
      state.vpsPtyPingTimer = null;
    }
    if (state.vpsPtyWs) {
      try {
        state.vpsPtyWs.onclose = null;
        state.vpsPtyWs.close();
      } catch {
        // Ignore close error
      }
      state.vpsPtyWs = null;
    }
  }

  // ─── Auth Gate ───
  function showAuthGate() {
    if (state.sse) {
      state.sse.close();
      state.sse = null;
    }
    closePtySocket();
    setSidebarOpen(false);
    $('btnQuickPreview').classList.toggle('hidden', !state.sandboxPreview);
    $('authOverlay').classList.remove('hidden');
  }

  function hideAuthGate() {
    $('authOverlay').classList.add('hidden');
  }

  async function checkSessionAndBoot() {
    syncThemeControls();

    if (window.location.protocol === 'about:' || window.location.protocol === 'file:' || window.location.protocol === 'blob:') {
      $('sseLed').className = 'led danger';
      $('sseLabel').textContent = 'Static File';
      $('terminalViewport').innerHTML =
        `<div class="log-line"><span class="log-meta"><span class="log-lvl warn">WARN</span><span class="log-scope">[VIEWER]</span></span>` +
        `<span class="log-msg">File index.html sedang dibuka sebagai file statis tanpa koneksi daemon. Buka tab Live Preview "Cipi Panel" untuk terhubung ke proses Node.js, SQLite WAL, dan SSE real-time.</span></div>`;
      return;
    }

    try {
      const headers = state.token ? { Authorization: `Bearer ${state.token}` } : {};
      const res = await fetch('/api/auth/status', { headers, credentials: 'same-origin' });
      const st = await res.json();
      state.sandboxPreview = Boolean(st.sandboxPreview);

      if (!st.authenticated) {
        if (state.sandboxPreview) {
          const quick = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ quickPreview: true }),
          });
          if (quick.ok) {
            const qData = await quick.json();
            if (qData.token) saveToken(qData.token);
            hideAuthGate();
            await initializeDashboard();
            return;
          }
        }
        showAuthGate();
        return;
      }

      hideAuthGate();
      await initializeDashboard();
    } catch (err) {
      $('sseLed').className = 'led danger';
      $('sseLabel').textContent = 'Daemon Offline';
      toast(`Tidak dapat menghubungi daemon Cipi Panel: ${err.message}`, 'error');
    }
  }

  // ─── Telemetry & Charts Rendering ───
  function meterSeverity(pct) {
    if (pct >= 85) return 'danger';
    if (pct >= 65) return 'warn';
    return 'ok';
  }

  function updateMetricsStrip(sample) {
    if (!sample) return;

    $('headerUptime').textContent = formatUptime(sample.runtime?.processUptimeSec || 0);

    const cpuPct = Number(sample.cpu?.processPct || 0);
    const load1m = Array.isArray(sample.cpu?.loadAvg) ? sample.cpu.loadAvg[0] : 0;
    $('metricCpuVal').textContent = `${cpuPct.toFixed(1)}%`;
    $('metricCpuSub').textContent = `${sample.cpu?.cores || 1}c · load ${Number(load1m || 0).toFixed(2)}`;
    const meterCpu = $('meterCpu');
    meterCpu.style.width = `${Math.max(3, Math.min(100, cpuPct))}%`;
    meterCpu.className = `meter-fill ${meterSeverity(cpuPct)}`;

    const rssMb = Number(sample.memory?.rssMb || 0);
    const heapUsed = Number(sample.memory?.heapUsedMb || 0);
    const heapTotal = Number(sample.memory?.heapTotalMb || 1);
    const osMemPct = Number(sample.memory?.osMemPct || 0);
    $('metricMemVal').textContent = `${rssMb.toFixed(1)} MB`;
    $('metricMemSub').textContent = `Heap ${heapUsed.toFixed(0)}/${heapTotal.toFixed(0)} MB`;
    const meterMem = $('meterMem');
    meterMem.style.width = `${Math.max(5, Math.min(100, osMemPct))}%`;
    meterMem.className = `meter-fill ${meterSeverity(osMemPct)}`;

    const loopMs = Number(sample.runtime?.eventLoopMs || 0);
    $('metricLoopVal').textContent = `${loopMs.toFixed(2)} ms`;
    $('metricLoopSub').textContent = `${sample.runtime?.cmdPerMin || 0} cmds/min`;
    const loopPct = Math.min(100, (loopMs / 50) * 100);
    const meterLoop = $('meterLoop');
    meterLoop.style.width = `${Math.max(4, loopPct)}%`;
    meterLoop.className = `meter-fill ${meterSeverity(loopPct)}`;

    $('chartCpuLabel').textContent = `${cpuPct.toFixed(1)}%`;
    $('chartMemLabel').textContent = `${rssMb.toFixed(1)} MB`;
    $('chartLoopLabel').textContent = `${loopMs.toFixed(2)} ms`;

    const storage = sample.storage;
    if (storage) {
      const diskPct = Number(storage.diskUsedPct || 0);
      $('metricDiskVal').textContent = formatBytes(storage.dbBytes || 0);
      $('metricDiskSub').textContent =
        diskPct > 0 ? `Host disk ${diskPct}%` : `Backups ${formatBytes(storage.backupsBytes || 0)}`;
      const meterDisk = $('meterDisk');
      meterDisk.style.width = `${Math.max(5, Math.min(100, diskPct || 10))}%`;
      meterDisk.className = `meter-fill ${meterSeverity(diskPct)}`;
    }
  }

  function drawAllCharts() {
    if (!window.CipiCharts || state.activeView !== 'console') return;
    const hist = state.telemetryHistory;
    const cpuSeries = hist.map((s) => s.cpu?.processPct || 0);
    const memSeries = hist.map((s) => s.memory?.rssMb || 0);
    const loopSeries = hist.map((s) => s.runtime?.eventLoopMs || 0);

    window.CipiCharts.renderTelemetryChart($('canvasCpu'), cpuSeries, {
      strokeVar: '--chart-cpu',
      fillVar: '--chart-cpu-fill',
      minCeiling: 25,
      unit: '%',
    });
    window.CipiCharts.renderTelemetryChart($('canvasMem'), memSeries, {
      strokeVar: '--chart-mem',
      fillVar: '--chart-mem-fill',
      minCeiling: 140,
      unit: 'M',
    });
    window.CipiCharts.renderTelemetryChart($('canvasLoop'), loopSeries, {
      strokeVar: '--chart-loop',
      fillVar: '--chart-loop-fill',
      minCeiling: 5,
      unit: 'ms',
    });
  }

  // ─── Console Stream Rendering ───
  function renderConsoleLines() {
    const vp = $('terminalViewport');
    if (!vp) return;

    const filtered =
      state.logFilter === 'ALL'
        ? state.consoleEntries
        : state.consoleEntries.filter((e) => String(e.level).toLowerCase() === state.logFilter);

    vp.innerHTML = filtered
      .map(
        (entry) =>
          `<div class="log-line">` +
          `<span class="log-meta">` +
          `<span class="log-ts">${escapeHtml(formatTimeShort(entry))}</span>` +
          `<span class="log-lvl ${escapeHtml(entry.level)}">${escapeHtml(entry.level)}</span>` +
          `<span class="log-scope">[${escapeHtml(entry.scope)}]</span>` +
          `</span>` +
          `<span class="log-msg">${escapeHtml(entry.message)}</span>` +
          `</div>`
      )
      .join('');

    if (state.autoScroll) {
      vp.scrollTop = vp.scrollHeight;
    }
  }

  function appendConsoleEntry(entry) {
    state.consoleEntries.push(entry);
    if (state.consoleEntries.length > 300) state.consoleEntries.shift();
    if (state.activeView === 'console') renderConsoleLines();
  }

  // ─── SSE Real-Time Connection ───
  function connectSseStream() {
    if (state.sse) state.sse.close();

    const sseUrl = state.token
      ? `/api/stream?token=${encodeURIComponent(state.token)}`
      : '/api/stream';
    const es = new EventSource(sseUrl);
    state.sse = es;

    es.onopen = () => {
      $('sseLed').className = 'led ok';
      $('sseLabel').textContent = 'SSE Live (1.5s)';
    };

    es.addEventListener('init', (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.overview) applyOverviewData(data.overview);
        if (Array.isArray(data.telemetryHistory)) {
          state.telemetryHistory = data.telemetryHistory;
          const last = state.telemetryHistory[state.telemetryHistory.length - 1];
          if (last) updateMetricsStrip(last);
          drawAllCharts();
        }
        if (Array.isArray(data.consoleBuffer)) {
          state.consoleEntries = data.consoleBuffer;
          renderConsoleLines();
        }
      } catch {
        // Ignore malformed frame
      }
    });

    es.addEventListener('telemetry', (ev) => {
      try {
        const sample = JSON.parse(ev.data);
        state.telemetryHistory.push(sample);
        if (state.telemetryHistory.length > 60) state.telemetryHistory.shift();
        updateMetricsStrip(sample);
        drawAllCharts();
      } catch {
        // Ignore
      }
    });

    es.addEventListener('console', (ev) => {
      try {
        const entry = JSON.parse(ev.data);
        appendConsoleEntry(entry);
      } catch {
        // Ignore
      }
    });

    es.onerror = () => {
      $('sseLed').className = 'led warn';
      $('sseLabel').textContent = 'Reconnecting...';
    };
  }

  function updateWaBadge(wa, op) {
    if (wa) {
      const status = String(wa.status || 'offline').toLowerCase();
      const badge = $('waBadge');
      const runtimeBadge = $('runtimeWaStatusBadge');
      const led = $('instanceLed');

      if (status === 'online') {
        badge.className = 'badge ok';
        badge.textContent = 'WA ONLINE';
        runtimeBadge.className = 'badge ok';
        runtimeBadge.textContent = wa.botJid ? `ONLINE · ${wa.botJid}` : 'ONLINE';
        led.className = 'led ok';
      } else if (status === 'unlinked') {
        badge.className = 'badge warn';
        badge.textContent = 'WA UNLINKED';
        runtimeBadge.className = 'badge warn';
        runtimeBadge.textContent = 'NO SESSION (PAIRING NEEDED)';
        led.className = 'led ok';
      } else if (status === 'session_saved' || status === 'pairing' || status === 'connecting' || status === 'standalone') {
        badge.className = 'badge warn';
        badge.textContent = status.replace('_', ' ').toUpperCase();
        runtimeBadge.className = 'badge warn';
        runtimeBadge.textContent = wa.botJid ? `${status.toUpperCase()} · ${wa.botJid}` : status.toUpperCase();
        led.className = 'led ok';
      } else {
        badge.className = 'badge danger';
        badge.textContent = 'WA OFFLINE';
        runtimeBadge.className = 'badge danger';
        runtimeBadge.textContent = 'OFFLINE';
        led.className = 'led danger';
      }

      if (wa.pairingCode) {
        const box = $('pairingResultBox');
        box.classList.remove('hidden');
        box.textContent = `Pairing Code: ${wa.pairingCode}`;
      }
    }

    if (op) {
      const modeBadge = $('modeBadge');
      const curMode = op.botMode || op.mode || 'public';
      if (op.maintenance) {
        modeBadge.className = 'badge warn';
        modeBadge.textContent = 'MAINTENANCE';
      } else if (curMode === 'self') {
        modeBadge.className = 'badge accent';
        modeBadge.textContent = 'SELF MODE';
      } else {
        modeBadge.className = 'badge';
        modeBadge.textContent = 'PUBLIC';
      }

      const modeBtn = $('btnToggleBotMode');
      const maintBtn = $('btnToggleMaint');
      const dryBtn = $('btnToggleDryRun');
      const btnToggle = $('btnToggleButtons');

      modeBtn.textContent = `Mode: ${curMode.toUpperCase()}`;
      modeBtn.className = curMode === 'public' ? 'btn btn-sm btn-success' : 'btn btn-sm btn-warn';

      maintBtn.textContent = `Maintenance: ${op.maintenance ? 'ON' : 'OFF'}`;
      maintBtn.className = op.maintenance ? 'btn btn-sm btn-warn' : 'btn btn-sm';

      dryBtn.textContent = `Dry-Run: ${op.dryRun ? 'ON' : 'OFF'}`;
      dryBtn.className = op.dryRun ? 'btn btn-sm btn-warn' : 'btn btn-sm';

      btnToggle.textContent = `Buttons: ${op.useButtons ? 'ON' : 'OFF'}`;
      btnToggle.className = op.useButtons ? 'btn btn-sm btn-success' : 'btn btn-sm';
    }
  }

  function applyOverviewData(ov) {
    if (!ov) return;
    state.overview = ov;

    $('headerBotName').textContent = ov.instance.name;
    $('headerEndpoint').textContent = ov.instance.bind;
    $('nodeVerLabel').textContent = ov.host.nodeVersion;

    const cmdCount = ov.instance.commands?.commandsCount || 0;
    const usrCount = ov.counts?.users || 0;
    const tktCount = ov.counts?.openTickets || 0;

    $('navCmdCount').textContent = cmdCount;
    $('navUserCount').textContent = usrCount;
    $('navTicketCount').textContent = tktCount;

    const tabCmdCount = $('tabCmdCount');
    const tabUserCount = $('tabUserCount');
    const tabTicketCount = $('tabTicketCount');
    if (tabCmdCount) tabCmdCount.textContent = cmdCount;
    if (tabUserCount) tabUserCount.textContent = usrCount;
    if (tabTicketCount) tabTicketCount.textContent = tktCount;

    updateWaBadge(ov.instance.wa, ov.instance.operational);
    if (ov.telemetry) updateMetricsStrip(ov.telemetry);

    const envRows = [
      ['Bot Name / Prefix', `${ov.instance.name} (${ov.instance.prefix})`],
      ['SQLite Driver', ov.instance.sqliteDriver],
      ['Card Renderer', ov.instance.cardEngine],
      ['Node.js / PID', `${ov.host.nodeVersion} · PID ${ov.host.pid}`],
      ['Host OS', `${ov.host.hostname} · ${ov.host.platform}`],
      ['CPU Hardware', `${ov.host.cpuModel} (${ov.host.cpuCores} cores)`],
      ['Loaded Commands', `${ov.instance.commands.commandsCount} primary (${ov.instance.commands.aliasesCount} aliases)`],
    ];
    $('runtimeEnvKv').innerHTML = envRows
      .map(([k, v]) => `<div class="kv-row"><span class="kv-key">${escapeHtml(k)}</span><span class="kv-val">${escapeHtml(v)}</span></div>`)
      .join('');

    const secRows = [
      ['Session Signature', 'HMAC-SHA256 Signed Token (Bearer + HttpOnly)'],
      ['Brute-Force Protection', 'Active (6 failed attempts / 60s per IP -> HTTP 429)'],
      ['Secret Redaction Filter', 'Active (API keys, RCON, Discord & Panel secrets -> [REDACTED])'],
      ['Owner Numbers (.env)', ov.integrations.ownerConfigured ? `${ov.integrations.ownerCount} number(s) configured` : 'Not Set in .env (OWNER_NUMBERS empty)'],
      ['Minecraft RCON Policy', 'Strict Prefix Whitelist (blocks op / stop / deop with HTTP 403)'],
      ['AI Provider Integration', `${ov.integrations.aiProvider} (${ov.integrations.aiKeyConfigured ? 'Key Set' : 'No Key in .env'})`],
      ['Discord Integration', ov.integrations.discordWebhookConfigured || ov.integrations.discordBotConfigured ? 'Configured' : 'Not Set in .env'],
    ];
    $('securityPostureKv').innerHTML = secRows
      .map(([k, v]) => `<div class="kv-row"><span class="kv-key">${escapeHtml(k)}</span><span class="kv-val">${escapeHtml(v)}</span></div>`)
      .join('');
  }

  async function loadOverview() {
    const res = await api('/api/overview');
    applyOverviewData(res.overview);
    if (Array.isArray(res.telemetryHistory) && res.telemetryHistory.length) {
      state.telemetryHistory = res.telemetryHistory;
      drawAllCharts();
    }
  }

  async function loadCommandsView() {
    const data = await api('/api/commands');
    state.commandsCatalog = data.commands || [];
    $('navCmdCount').textContent = state.commandsCatalog.length;
    const tabCmdCount = $('tabCmdCount');
    if (tabCmdCount) tabCmdCount.textContent = state.commandsCatalog.length;

    const categories = Array.from(new Set(state.commandsCatalog.map((c) => c.category))).sort();
    const sel = $('cmdCategorySelect');
    const prev = sel.value || 'ALL';
    sel.innerHTML =
      `<option value="ALL">All Categories (${state.commandsCatalog.length})</option>` +
      categories.map((cat) => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`).join('');
    sel.value = categories.includes(prev) ? prev : 'ALL';

    renderCommandsTable();
  }

  function renderCommandsTable() {
    const q = ($('cmdSearchInput').value || '').trim().toLowerCase();
    const cat = $('cmdCategorySelect').value || 'ALL';

    const rows = state.commandsCatalog.filter((c) => {
      if (cat !== 'ALL' && c.category !== cat) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        (c.aliases || []).some((a) => a.toLowerCase().includes(q)) ||
        (c.description || '').toLowerCase().includes(q)
      );
    });

    $('cmdTableBody').innerHTML = rows
      .map((c) => {
        const scopes = [];
        if (c.ownerOnly) scopes.push('<span class="badge danger">Owner</span>');
        if (c.adminOnly) scopes.push('<span class="badge warn">Admin</span>');
        if (c.premiumOnly) scopes.push('<span class="badge accent">VIP</span>');
        if (c.groupOnly) scopes.push('<span class="badge">Group</span>');
        if (!scopes.length) scopes.push('<span class="badge ok">Public</span>');

        return (
          `<tr>` +
          `<td class="mono cell-nowrap" style="font-weight:600;">.${escapeHtml(c.name)}</td>` +
          `<td class="mono" style="color:var(--text-muted);">${escapeHtml((c.aliases || []).slice(0, 4).join(', ') || '-')}</td>` +
          `<td class="cell-nowrap"><span class="badge">${escapeHtml(c.category)}</span></td>` +
          `<td class="mono cell-nowrap">${c.cooldown}s</td>` +
          `<td class="cell-nowrap"><div class="badge-group">${scopes.join('')}</div></td>` +
          `<td class="cell-desc">${escapeHtml(c.description)}</td>` +
          `</tr>`
        );
      })
      .join('');
  }

  async function loadMinecraftView() {
    $('mcStatusKv').innerHTML = `<div class="kv-row"><span class="kv-key">Probe</span><span class="kv-val">Querying Minecraft endpoint...</span></div>`;
    const data = await api('/api/minecraft');

    const st = data.status || {};
    const mcRows = [
      ['Server Endpoint', `${data.host}:${data.port} (Bedrock :${data.bedrockPort})`],
      ['Network State', st.online ? `ONLINE (${st.playersOnline}/${st.playersMax} players)` : 'OFFLINE / Unreachable from current network'],
      ['Engine / Version', st.version || '-'],
      ['Probe Source', st.sourceApi || '-'],
      ['Linked Accounts', `${(data.linkedPlayers || []).length} players in SQLite`],
    ];
    $('mcStatusKv').innerHTML = mcRows
      .map(([k, v]) => `<div class="kv-row"><span class="kv-key">${escapeHtml(k)}</span><span class="kv-val">${escapeHtml(v)}</span></div>`)
      .join('');

    const pBadge = $('pteroConfigBadge');
    if (data.pteroConfigured) {
      pBadge.className = 'badge ok';
      pBadge.textContent = 'WINGS LINKED';
    } else {
      pBadge.className = 'badge warn';
      pBadge.textContent = 'ENV NOT SET';
    }

    const pr = data.pteroResources || {};
    const pRows = [
      ['Pterodactyl Client API', data.pteroConfigured ? 'Configured' : 'Set PTERO_PANEL_URL & PTERO_CLIENT_API_KEY in .env'],
      ['Direct RCON Socket', data.rconConfigured ? 'Configured' : 'Not Set in .env'],
      ['Wings Container State', pr.state || '-'],
      ['Wings CPU / RAM', pr.cpuAbsolute !== undefined ? `${pr.cpuAbsolute}% / ${pr.memoryMb || 0} MB` : '-'],
    ];
    $('pteroStatusKv').innerHTML = pRows
      .map(([k, v]) => `<div class="kv-row"><span class="kv-key">${escapeHtml(k)}</span><span class="kv-val">${escapeHtml(v)}</span></div>`)
      .join('');
  }

  async function loadUsersView() {
    const params = new URLSearchParams({
      filter: state.userFilter,
      q: state.userSearch,
      pageSize: '80',
    });
    const [listData, ovRes] = await Promise.all([api(`/api/users?${params}`), api('/api/overview')]);
    applyOverviewData(ovRes.overview);

    const counts = ovRes.overview.counts || {};
    $('econTotalUsers').textContent = formatNumber(counts.users);
    $('econVipUsers').textContent = formatNumber(counts.activeVip);
    $('econLinkedMc').textContent = formatNumber(counts.linkedMc);
    $('econBannedUsers').textContent = formatNumber(counts.banned);

    const tbody = $('usersTableBody');
    if (!listData.users.length) {
      tbody.innerHTML =
        `<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:20px;">` +
        `Database SQLite belum memiliki user terdaftar. User otomatis tercatat saat mengirim chat ke bot, atau daftarkan nomor secara manual di kolom atas.` +
        `</td></tr>`;
      return;
    }

    tbody.innerHTML = listData.users
      .map((u) => {
        const badges = [];
        if (u.isBanned) badges.push('<span class="badge danger">BANNED</span>');
        if (u.isVip) badges.push('<span class="badge accent">VIP</span>');
        if (!badges.length) badges.push('<span class="badge ok">ACTIVE</span>');

        return (
          `<tr class="clickable" data-user-jid="${escapeHtml(u.jid)}">` +
          `<td class="cell-nowrap"><div style="font-weight:500;">${escapeHtml(u.name)}</div><div class="mono" style="font-size:11px; color:var(--text-muted);">+${escapeHtml(u.phone)}</div></td>` +
          `<td class="mono cell-nowrap">${escapeHtml(u.mcUsername || '-')}</td>` +
          `<td class="mono cell-nowrap">Lv.${u.level} <span style="color:var(--text-muted);">(${formatNumber(u.xp)} XP)</span></td>` +
          `<td class="mono cell-nowrap">${formatNumber(u.balance)}</td>` +
          `<td class="mono cell-nowrap">${formatNumber(u.bank)}</td>` +
          `<td class="cell-nowrap"><div class="badge-group">${badges.join('')}</div></td>` +
          `</tr>`
        );
      })
      .join('');

    tbody.querySelectorAll('tr[data-user-jid]').forEach((row) => {
      row.addEventListener('click', () => {
        const found = listData.users.find((x) => x.jid === row.dataset.userJid);
        if (found) openUserDrawer(found);
      });
    });
  }

  function openUserDrawer(user) {
    state.selectedUser = user;
    const rows = [
      ['Display Name', user.name],
      ['WhatsApp JID', user.jid],
      ['Minecraft IGN', user.mcUsername || '-'],
      ['Wallet Coins', formatNumber(user.balance)],
      ['Bank Vault', formatNumber(user.bank)],
      ['Gacha Shards', formatNumber(user.shards)],
      ['Level / XP', `Lv.${user.level} (${formatNumber(user.xp)} XP)`],
      ['Sakura VIP', user.isVip ? `Active until ${user.vipExpiresWib}` : 'Standard'],
      ['Moderation', user.isBanned ? `BANNED (${user.banReason || 'Restricted'})` : 'Good Standing'],
    ];
    $('drawerUserKv').innerHTML = rows
      .map(([k, v]) => `<div class="kv-row"><span class="kv-key">${escapeHtml(k)}</span><span class="kv-val">${escapeHtml(v)}</span></div>`)
      .join('');
    $('userDrawerBackdrop').classList.remove('hidden');
  }

  async function loadCommsView() {
    const data = await api('/api/community');
    const tbody = $('ticketsTableBody');
    if (!data.tickets.length) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:18px;">Belum ada tiket masuk (.lapor) di SQLite.</td></tr>`;
      return;
    }

    tbody.innerHTML = data.tickets
      .map((t) => {
        const isOpen = t.status === 'open';
        return (
          `<tr>` +
          `<td class="mono cell-nowrap" style="font-weight:600;">${escapeHtml(t.ticketNo)}<div style="font-weight:400; font-size:10.5px; color:var(--text-muted);">${escapeHtml(t.userName)}</div></td>` +
          `<td class="cell-nowrap"><span class="badge">${escapeHtml(t.category || 'umum')}</span></td>` +
          `<td class="cell-desc">${escapeHtml(t.subject || t.message)}</td>` +
          `<td class="cell-nowrap"><span class="badge ${isOpen ? 'warn' : 'ok'}">${escapeHtml(t.status.toUpperCase())}</span></td>` +
          `<td class="cell-nowrap">${
            isOpen
              ? `<button type="button" class="btn btn-sm btn-close-ticket" data-ticket="${escapeHtml(t.ticketNo)}">Close</button>`
              : '-'
          }</td>` +
          `</tr>`
        );
      })
      .join('');

    tbody.querySelectorAll('.btn-close-ticket').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await api('/api/tickets/close', {
            method: 'POST',
            body: { ticketNo: btn.dataset.ticket, resolution: 'Resolved via Cipi Panel' },
          });
          toast(`Ticket ${btn.dataset.ticket} closed`);
          await loadCommsView();
          await loadOverview();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    });
  }

  async function loadStorageView() {
    const data = await api('/api/backups');
    const st = data.storage || {};
    $('backupRotationSub').textContent = `Schedule: ${data.cronSchedule} WIB · Keep last ${data.keepLast}`;

    const breakdown = [
      ['SQLite Primary (.db)', formatBytes(st.dbPrimaryBytes ?? st.dbBytes)],
      ['SQLite Write-Ahead Log (-wal)', formatBytes(st.walBytes || 0)],
      ['SQLite Shared Memory (-shm)', formatBytes(st.shmBytes || 0)],
      ['Snapshot Archives (backups/)', `${formatBytes(st.backupsBytes)} (${st.backupsCount || 0} files)`],
      ['Baileys Auth State (session/)', `${formatBytes(st.sessionBytes)} (${st.sessionFiles || 0} files)`],
      ['Rotating Logs (logs/)', formatBytes(st.logsBytes)],
    ];
    $('storageBreakdownKv').innerHTML = breakdown
      .map(([k, v]) => `<div class="kv-row"><span class="kv-key">${escapeHtml(k)}</span><span class="kv-val">${escapeHtml(v)}</span></div>`)
      .join('');

    const totalRows = (data.tables || []).reduce((acc, t) => acc + Number(t.rows || 0), 0);
    const fsRows = [
      ['Host Filesystem Used', st.diskTotalBytes ? `${formatBytes(st.diskUsedBytes)} / ${formatBytes(st.diskTotalBytes)} (${st.diskUsedPct}%)` : 'N/A'],
      ['Host Filesystem Free', st.diskFreeBytes ? formatBytes(st.diskFreeBytes) : 'N/A'],
      ['SQLite Total Records', `${formatNumber(totalRows)} rows across ${(data.tables || []).length} tables`],
      ['Active Database File', st.dbPath ? st.dbPath.split('/').slice(-2).join('/') : 'database/cipismp.db'],
    ];
    $('filesystemKv').innerHTML = fsRows
      .map(([k, v]) => `<div class="kv-row"><span class="kv-key">${escapeHtml(k)}</span><span class="kv-val">${escapeHtml(v)}</span></div>`)
      .join('');

    const tbody = $('backupsTableBody');
    if (!data.backups.length) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:16px;">Belum ada snapshot di folder backups/. Klik "Create Snapshot" di atas untuk membuat backup SQLite.</td></tr>`;
      return;
    }

    const tokenParam = state.token ? `&token=${encodeURIComponent(state.token)}` : '';
    tbody.innerHTML = data.backups
      .map(
        (b) =>
          `<tr>` +
          `<td class="mono cell-nowrap">${escapeHtml(b.name)}</td>` +
          `<td class="mono cell-nowrap">${formatBytes(b.bytes)}</td>` +
          `<td class="mono cell-nowrap" style="color:var(--text-muted);">${escapeHtml(b.sha256Short)}</td>` +
          `<td class="mono cell-nowrap">${escapeHtml(b.createdWib)}</td>` +
          `<td class="cell-nowrap"><a class="btn btn-sm" href="/api/backups/download?file=${encodeURIComponent(b.name)}${tokenParam}">Download .db</a></td>` +
          `</tr>`
      )
      .join('');
  }

  async function loadAuditView() {
    const cat = $('auditCategorySelect').value || '';
    const data = await api(`/api/audit?limit=80&category=${encodeURIComponent(cat)}`);
    const auditBody = $('auditTableBody');
    if (!data.logs.length) {
      auditBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:14px;">No audit records matching filter.</td></tr>`;
      return;
    }

    auditBody.innerHTML = data.logs
      .map(
        (l) =>
          `<tr>` +
          `<td class="mono cell-nowrap" style="color:var(--text-muted);">${escapeHtml(l.timeWib || '-')}</td>` +
          `<td class="cell-nowrap"><span class="badge">${escapeHtml(l.category || 'system')}</span></td>` +
          `<td class="mono cell-nowrap">${escapeHtml(l.actorJid || l.actor_jid || '-')}</td>` +
          `<td class="cell-nowrap"><span class="badge accent">${escapeHtml(l.action)}</span></td>` +
          `<td class="mono">${escapeHtml(l.target || '-')}</td>` +
          `</tr>`
      )
      .join('');
  }

  // ─── VPS Host Control & Full Interactive PTY Terminal (xterm.js + WebSocket) ───
  const PTY_SPECIAL_SEQUENCES = {
    ESC: '\x1b',
    TAB: '\t',
    CTRL_C: '\x03',
    CTRL_X: '\x18',
    CTRL_O: '\x0f',
    CTRL_Z: '\x1a',
    CTRL_D: '\x04',
    CTRL_L: '\x0c',
    UP: '\x1b[A',
    DOWN: '\x1b[B',
    LEFT: '\x1b[D',
    RIGHT: '\x1b[C',
  };

  function setPtyBadgeState(status, labelText) {
    const badge = $('vpsShellStateBadge');
    if (!badge) return;
    badge.textContent = labelText;
    badge.className = `badge ${status}`;
  }

  function sendPtyPayload(payload) {
    const ws = state.vpsPtyWs;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }

  function sendPtyInput(rawStr) {
    if (!rawStr) return false;
    return sendPtyPayload({ type: 'input', data: String(rawStr) });
  }

  function fitVpsPty() {
    if (!state.vpsTerm || !state.vpsFitAddon) return;
    const mount = $('vpsXtermMount');
    if (!mount || mount.offsetWidth < 40 || mount.offsetHeight < 40) return;
    try {
      state.vpsFitAddon.fit();
      const cols = state.vpsTerm.cols || 100;
      const rows = state.vpsTerm.rows || 30;
      if ($('vpsSizeBadge')) $('vpsSizeBadge').textContent = `${cols}x${rows}`;
      sendPtyPayload({ type: 'resize', cols, rows });
    } catch {
      // Ignore layout transient errors
    }
  }

  function ensureXtermMounted() {
    if (state.vpsTerm) return state.vpsTerm;
    const mount = $('vpsXtermMount');
    if (!mount || typeof window.Terminal !== 'function') return null;

    const term = new window.Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 5000,
      fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: window.innerWidth < 768 ? 12 : 13,
      lineHeight: 1.24,
      convertEol: false,
      theme: {
        background: '#07080b',
        foreground: '#e5e7eb',
        cursor: '#38bdf8',
        cursorAccent: '#07080b',
        selectionBackground: 'rgba(59, 130, 246, 0.34)',
        black: '#18181f',
        red: '#f87171',
        green: '#34d399',
        yellow: '#fbbf24',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#22d3ee',
        white: '#e5e7eb',
        brightBlack: '#6b7280',
        brightRed: '#fca5a5',
        brightGreen: '#6ee7b7',
        brightYellow: '#fde68a',
        brightBlue: '#93c5fd',
        brightMagenta: '#d8b4fe',
        brightCyan: '#67e8f9',
        brightWhite: '#ffffff',
      },
    });

    const FitCtor = window.FitAddon && (window.FitAddon.FitAddon || window.FitAddon);
    if (typeof FitCtor === 'function') {
      const fitAddon = new FitCtor();
      term.loadAddon(fitAddon);
      state.vpsFitAddon = fitAddon;
    }

    mount.innerHTML = '';
    term.open(mount);

    term.onData((data) => {
      if (!sendPtyInput(data) && (!state.vpsPtyWs || state.vpsPtyWs.readyState === WebSocket.CLOSED)) {
        connectPtyWebSocket(false);
      }
    });

    term.onResize(({ cols, rows }) => {
      if ($('vpsSizeBadge')) $('vpsSizeBadge').textContent = `${cols}x${rows}`;
      sendPtyPayload({ type: 'resize', cols, rows });
    });

    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(() => {
        if (state.activeView === 'vps') {
          requestAnimationFrame(fitVpsPty);
        }
      });
      ro.observe(mount);
    }

    state.vpsTerm = term;
    requestAnimationFrame(fitVpsPty);
    return term;
  }

  function connectPtyWebSocket(resetScreen = false) {
    const term = ensureXtermMounted();
    if (!term) return;

    closePtySocket();
    if (resetScreen) {
      term.reset();
    }
    fitVpsPty();

    const cols = term.cols || 100;
    const rows = term.rows || 30;
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const tokenParam = state.token ? `&token=${encodeURIComponent(state.token)}` : '';
    const wsUrl = `${wsProto}//${window.location.host}/api/vps/pty?cols=${cols}&rows=${rows}${tokenParam}`;

    setPtyBadgeState('warn', 'CONNECTING');
    const ws = new WebSocket(wsUrl);
    state.vpsPtyWs = ws;

    ws.onopen = () => {
      setPtyBadgeState('ok', 'PTY LIVE');
      fitVpsPty();
      term.focus();
      state.vpsPtyPingTimer = setInterval(() => {
        sendPtyPayload({ type: 'ping' });
      }, 25000);
    };

    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === 'output' && typeof msg.data === 'string') {
        term.write(msg.data);
      } else if (msg.type === 'ready') {
        setPtyBadgeState('ok', 'PTY LIVE');
        if ($('vpsTtyBadge')) {
          $('vpsTtyBadge').textContent = msg.tty || '/dev/pts';
          $('vpsTtyBadge').title = `Shell PID ${msg.pid || '-'} (${msg.backend || 'pty'})`;
        }
      } else if (msg.type === 'exit') {
        setPtyBadgeState('danger', `EXITED (${msg.exitCode ?? 0})`);
        term.write(
          `\r\n\x1b[33m[PTY session closed — exit code ${msg.exitCode ?? 0}. Press Enter or click "Reconnect PTY" to open a new shell.]\x1b[0m\r\n`
        );
      }
    };

    ws.onclose = () => {
      if (state.vpsPtyPingTimer) {
        clearInterval(state.vpsPtyPingTimer);
        state.vpsPtyPingTimer = null;
      }
      if (state.vpsPtyWs === ws) {
        state.vpsPtyWs = null;
        if ($('vpsShellStateBadge')?.textContent === 'PTY LIVE' || $('vpsShellStateBadge')?.textContent === 'CONNECTING') {
          setPtyBadgeState('danger', 'DISCONNECTED');
        }
      }
    };

    ws.onerror = () => {
      setPtyBadgeState('danger', 'WS ERROR');
    };
  }

  function renderVpsProcesses() {
    const tbody = $('vpsProcessesBody');
    if (!tbody) return;
    const allProcs = state.vpsSnapshot?.processes || [];
    const q = (state.vpsProcFilter || '').trim().toLowerCase();
    const filtered = q
      ? allProcs.filter(
          (p) =>
            String(p.pid).includes(q) ||
            String(p.user || '').toLowerCase().includes(q) ||
            String(p.command || '').toLowerCase().includes(q) ||
            String(p.args || '').toLowerCase().includes(q)
        )
      : allProcs;

    if (!filtered.length) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--text-muted); padding:14px;">No matching host processes.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered
      .map((p) => {
        const actionCell = p.isSelf
          ? `<span class="badge accent">Panel/Bot</span>`
          : p.pid <= 1
            ? `<span class="badge">Kernel</span>`
            : `<button type="button" class="btn btn-danger btn-sm btn-kill-proc" data-pid="${p.pid}" data-cmd="${escapeHtml(p.command)}">Terminate</button>`;
        return (
          `<tr>` +
          `<td class="mono cell-nowrap">${p.pid}</td>` +
          `<td class="mono cell-nowrap">${escapeHtml(p.user)}</td>` +
          `<td class="mono cell-nowrap">${Number(p.cpuPct || 0).toFixed(1)}%</td>` +
          `<td class="mono cell-nowrap">${Number(p.memPct || 0).toFixed(1)}%</td>` +
          `<td class="mono cell-nowrap">${Number(p.rssMb || 0).toFixed(1)} MB</td>` +
          `<td class="mono cell-nowrap" style="color:var(--text-muted);">${escapeHtml(p.elapsed)}</td>` +
          `<td class="mono" title="${escapeHtml(p.args)}">${escapeHtml(p.args || p.command)}</td>` +
          `<td class="cell-nowrap">${actionCell}</td>` +
          `</tr>`
        );
      })
      .join('');

    tbody.querySelectorAll('.btn-kill-proc').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pid = Number(btn.dataset.pid);
        const name = btn.dataset.cmd || '';
        askConfirm(
          `Terminate Host Process PID ${pid}`,
          `Send SIGTERM to process "${name}" (PID ${pid}) on the VPS host?`,
          async () => {
            await api('/api/vps/kill', { method: 'POST', body: { pid, signal: 'SIGTERM' } });
            toast(`SIGTERM sent to PID ${pid}`);
            await loadVpsView(false);
          }
        );
      });
    });
  }

  function renderVpsHostDetails(vps) {
    if (!vps) return;

    if (vps.network?.publicIp) {
      state.vpsPublicIp = vps.network.publicIp;
    }

    const ifaces = (vps.network?.interfaces || [])
      .map((n) => `${n.iface}: ${n.address} (${n.family})`)
      .join(' · ');

    const pm2Summary =
      Array.isArray(vps.pm2) && vps.pm2.length > 0
        ? vps.pm2.map((p) => `${p.name} [${p.status}, ${p.memMb}MB]`).join(' · ')
        : 'None / Not running under PM2';

    const kvRows = [
      ['Hostname & Operator', `${vps.terminal?.user || 'operator'}@${vps.host.hostname}`],
      ['Operating System', `${vps.host.distro} (${vps.host.platform}/${vps.host.arch})`],
      ['Kernel & Node Runtime', `${vps.host.kernel} · Node ${vps.host.nodeVersion}`],
      ['CPU Model & Cores', `${vps.cpu.model} (${vps.cpu.cores} cores)`],
      ['Host Load Average', `${vps.cpu.load1} (1m) · ${vps.cpu.load5} (5m) · ${vps.cpu.load15} (15m) · ${vps.cpu.hostPct}%`],
      ['Host Physical RAM', `${formatBytes(vps.memory.usedBytes)} / ${formatBytes(vps.memory.totalBytes)} (${vps.memory.usedPct}%)`],
      ['Host Uptime', formatUptime(vps.host.uptimeSec)],
      ['Network Interfaces', ifaces || 'Loopback only'],
      ['Detected Public IP', state.vpsPublicIp || 'Click "Check Public IP" above'],
      ['PM2 Daemons', pm2Summary],
    ];

    const hostKvEl = $('vpsHostInfoKv');
    if (hostKvEl) {
      hostKvEl.innerHTML = kvRows
        .map(
          ([k, v]) =>
            `<div class="kv-row"><span class="kv-key">${escapeHtml(k)}</span><span class="kv-val mono">${escapeHtml(v)}</span></div>`
        )
        .join('');
    }

    const swapSub = $('vpsSwapSub');
    if (swapSub) {
      swapSub.textContent =
        vps.memory.swapTotalBytes > 0
          ? `Swap: ${formatBytes(vps.memory.swapUsedBytes)} / ${formatBytes(vps.memory.swapTotalBytes)} (${vps.memory.swapUsedPct}%)`
          : 'Swap: Disabled (0 B)';
    }

    const disksEl = $('vpsDisksList');
    if (disksEl) {
      const disks = vps.disks || [];
      if (!disks.length) {
        disksEl.innerHTML = `<div style="color:var(--text-muted); font-size:12.5px;">No mounted block filesystems detected.</div>`;
      } else {
        disksEl.innerHTML = disks
          .map((d) => {
            const pct = Math.min(100, Math.max(0, Number(d.usedPct) || 0));
            const barState = pct >= 90 ? 'danger' : pct >= 75 ? 'warn' : 'ok';
            return (
              `<div class="vps-disk-item">` +
              `<div class="vps-disk-top">` +
              `<div><span class="vps-disk-mount mono">${escapeHtml(d.mount)}</span><span class="vps-disk-fs mono">${escapeHtml(d.filesystem)}</span></div>` +
              `<span class="badge ${barState} mono">${pct}% used</span>` +
              `</div>` +
              `<div class="meter-track"><div class="meter-fill ${barState}" style="width:${Math.max(2, pct)}%;"></div></div>` +
              `<div class="vps-disk-stats mono">` +
              `<span>Used: ${formatBytes(d.usedBytes)} / ${formatBytes(d.totalBytes)}</span>` +
              `<span>Free: ${formatBytes(d.freeBytes)}</span>` +
              `</div>` +
              `</div>`
            );
          })
          .join('');
      }
    }

    renderVpsProcesses();
  }

  async function loadVpsView(includePublicIp = false) {
    ensureXtermMounted();
    if (!state.vpsPtyWs || state.vpsPtyWs.readyState > WebSocket.OPEN) {
      connectPtyWebSocket(false);
    } else {
      requestAnimationFrame(() => {
        fitVpsPty();
        state.vpsTerm?.focus();
      });
    }
    const query = includePublicIp ? '?publicIp=1' : '';
    const data = await api(`/api/vps/overview${query}`);
    state.vpsSnapshot = data.vps;
    renderVpsHostDetails(data.vps);
    return data.vps;
  }

  // ─── Navigation Switching (Sidebar + Mobile/Tablet Quick Tabs) ───
  async function switchView(viewName) {
    state.activeView = viewName;
    document.querySelectorAll('[data-view]').forEach((btn) => {
      const isActive = btn.dataset.view === viewName;
      btn.classList.toggle('active', isActive);
      if (isActive && btn.classList.contains('view-tab-pill') && typeof btn.scrollIntoView === 'function') {
        btn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    });
    document.querySelectorAll('.view-section').forEach((sec) => {
      sec.classList.toggle('hidden', sec.id !== `view-${viewName}`);
    });
    setSidebarOpen(false);

    try {
      if (viewName === 'console') {
        renderConsoleLines();
        requestAnimationFrame(drawAllCharts);
      } else if (viewName === 'vps') {
        await loadVpsView(false);
      } else if (viewName === 'runtime') {
        await Promise.all([loadOverview(), loadCommandsView()]);
      } else if (viewName === 'minecraft') {
        await loadMinecraftView();
      } else if (viewName === 'users') {
        await loadUsersView();
      } else if (viewName === 'comms') {
        await loadCommsView();
      } else if (viewName === 'storage') {
        await loadStorageView();
      } else if (viewName === 'audit') {
        await loadAuditView();
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function initializeDashboard() {
    await loadOverview();
    connectSseStream();
    requestAnimationFrame(drawAllCharts);
  }

  async function runConsoleCommand(cmd) {
    const clean = String(cmd || '').trim();
    if (!clean) return;
    state.cmdHistory.push(clean);
    state.cmdHistoryIdx = state.cmdHistory.length;
    try {
      await api('/api/console/exec', { method: 'POST', body: { command: clean } });
      await loadOverview();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ─── Event Listeners Wiring ───
  function bindEvents() {
    $('themeToggleBtn').addEventListener('click', toggleTheme);
    $('loginThemeBtn').addEventListener('click', toggleTheme);

    $('mobileMenuBtn').addEventListener('click', toggleSidebarMenu);

    try {
      if (window.innerWidth >= 1024 && localStorage.getItem('cp-sidebar-collapsed') === '1') {
        const shell = $('appShell');
        if (shell) shell.classList.add('sidebar-collapsed');
      }
    } catch {
      // Ignore storage error
    }

    const closeSidebarBtn = $('sidebarCloseBtn');
    if (closeSidebarBtn) {
      closeSidebarBtn.addEventListener('click', () => setSidebarOpen(false));
    }

    const sidebarBackdrop = $('sidebarBackdrop');
    if (sidebarBackdrop) {
      sidebarBackdrop.addEventListener('click', () => setSidebarOpen(false));
    }

    $('cmdPaletteBtn')?.addEventListener('click', openCmdPalette);
    $('cmdPaletteBackdrop')?.addEventListener('click', (e) => {
      if (e.target === $('cmdPaletteBackdrop')) closeCmdPalette();
    });
    $('cmdPaletteInput')?.addEventListener('input', (e) => {
      filterCmdPalette(e.target.value);
    });
    $('cmdPaletteInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (paletteFiltered.length) {
          paletteSelectedIdx = (paletteSelectedIdx + 1) % paletteFiltered.length;
          renderCmdPaletteList();
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (paletteFiltered.length) {
          paletteSelectedIdx = (paletteSelectedIdx - 1 + paletteFiltered.length) % paletteFiltered.length;
          renderCmdPaletteList();
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        executePaletteIndex(paletteSelectedIdx);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeCmdPalette();
      }
    });

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        if ($('cmdPaletteBackdrop')?.classList.contains('hidden')) {
          openCmdPalette();
        } else {
          closeCmdPalette();
        }
        return;
      }
      if (e.key === 'Escape') {
        setSidebarOpen(false);
        closeUserDrawer();
        closeCmdPalette();
        $('confirmModalBackdrop').classList.add('hidden');
      }
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth >= 1024) {
        document.body.classList.remove('nav-locked');
        const sidebarBackdropEl = $('sidebarBackdrop');
        if (sidebarBackdropEl) sidebarBackdropEl.classList.remove('open');
      }
      if (state.activeView === 'console') drawAllCharts();
    });

    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(() => {
        if (state.activeView === 'console') requestAnimationFrame(drawAllCharts);
      });
      ['canvasCpu', 'canvasMem', 'canvasLoop'].forEach((id) => {
        const el = $(id);
        if (el && el.parentElement) ro.observe(el.parentElement);
      });
    }

    document.querySelectorAll('[data-view]').forEach((btn) => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    // Login & Quick Sandbox Preview
    $('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      $('authError').classList.add('hidden');
      try {
        const loginData = await api('/api/auth/login', {
          method: 'POST',
          body: {
            username: $('loginUsername').value.trim(),
            password: $('loginPassword').value,
          },
        });
        if (loginData.token) saveToken(loginData.token);
        $('loginPassword').value = '';
        hideAuthGate();
        await initializeDashboard();
      } catch (err) {
        $('authError').textContent = err.message;
        $('authError').classList.remove('hidden');
      }
    });

    $('btnQuickPreview').addEventListener('click', async () => {
      try {
        const loginData = await api('/api/auth/login', { method: 'POST', body: { quickPreview: true } });
        if (loginData.token) saveToken(loginData.token);
        hideAuthGate();
        await initializeDashboard();
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    $('logoutBtn').addEventListener('click', async () => {
      await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
      saveToken('');
      state.sandboxPreview = false;
      showAuthGate();
    });

    // Persistent Instance Header Controls
    $('btnWaConnect').addEventListener('click', async () => {
      try {
        const res = await api('/api/power', { method: 'POST', body: { action: 'connect' } });
        toast(res.message || 'WhatsApp start signal sent');
        await loadOverview();
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    $('btnReloadCmds').addEventListener('click', async () => {
      try {
        const res = await api('/api/power', { method: 'POST', body: { action: 'reload' } });
        toast(`Hot-reloaded ${res.commandsCount} primary commands (${res.aliasesCount} aliases)`);
        await loadOverview();
        if (state.activeView === 'runtime') await loadCommandsView();
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    $('btnWaDisconnect').addEventListener('click', () => {
      askConfirm(
        'Disconnect WhatsApp Socket',
        'Temporarily close the active WhatsApp Baileys socket? You can reconnect anytime using Start.',
        async () => {
          const res = await api('/api/power', { method: 'POST', body: { action: 'disconnect' } });
          toast(res.message || 'WhatsApp socket disconnected');
          await loadOverview();
        }
      );
    });

    // Console Controls, Quick Chips & Internal CLI
    document.querySelectorAll('[data-log-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.logFilter = btn.dataset.logFilter;
        document.querySelectorAll('[data-log-filter]').forEach((b) => b.classList.toggle('active', b === btn));
        renderConsoleLines();
      });
    });

    document.querySelectorAll('[data-cli-chip]').forEach((chip) => {
      chip.addEventListener('click', () => {
        runConsoleCommand(chip.dataset.cliChip);
      });
    });

    $('btnAutoScroll').addEventListener('click', () => {
      state.autoScroll = !state.autoScroll;
      $('btnAutoScroll').textContent = `Auto-Scroll: ${state.autoScroll ? 'ON' : 'OFF'}`;
      if (state.autoScroll) renderConsoleLines();
    });

    $('btnClearConsole').addEventListener('click', () => {
      state.consoleEntries = [];
      renderConsoleLines();
    });

    $('consoleCmdInput').addEventListener('keydown', (e) => {
      if (!state.cmdHistory.length) return;
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        state.cmdHistoryIdx = Math.max(0, state.cmdHistoryIdx - 1);
        $('consoleCmdInput').value = state.cmdHistory[state.cmdHistoryIdx] || '';
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        state.cmdHistoryIdx = Math.min(state.cmdHistory.length, state.cmdHistoryIdx + 1);
        $('consoleCmdInput').value = state.cmdHistory[state.cmdHistoryIdx] || '';
      }
    });

    $('consoleExecForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = $('consoleCmdInput');
      const cmd = input.value.trim();
      if (!cmd) return;
      input.value = '';
      await runConsoleCommand(cmd);
    });

    // Runtime Switches & Pairing
    $('btnToggleBotMode').addEventListener('click', async () => {
      const cur = state.overview?.instance?.operational?.botMode || 'public';
      const next = cur === 'public' ? 'self' : 'public';
      try {
        const res = await api('/api/runtime/config', { method: 'POST', body: { botMode: next } });
        applyOverviewData(res.overview);
        toast(`Bot access mode set to ${next.toUpperCase()}`);
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    $('btnToggleMaint').addEventListener('click', async () => {
      const cur = Boolean(state.overview?.instance?.operational?.maintenance);
      try {
        const res = await api('/api/runtime/config', { method: 'POST', body: { maintenance: !cur } });
        applyOverviewData(res.overview);
        toast(`Maintenance mode ${!cur ? 'ENABLED' : 'DISABLED'}`);
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    $('btnToggleDryRun').addEventListener('click', async () => {
      const cur = Boolean(state.overview?.instance?.operational?.dryRun);
      try {
        const res = await api('/api/runtime/config', { method: 'POST', body: { dryRun: !cur } });
        applyOverviewData(res.overview);
        toast(`Dry-Run simulation ${!cur ? 'ENABLED' : 'DISABLED'}`);
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    $('btnToggleButtons').addEventListener('click', async () => {
      const cur = Boolean(state.overview?.instance?.operational?.useButtons);
      try {
        const res = await api('/api/runtime/config', { method: 'POST', body: { useButtons: !cur } });
        applyOverviewData(res.overview);
        toast(`Interactive buttons ${!cur ? 'ENABLED' : 'DISABLED'}`);
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    $('pairingForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const res = await api('/api/runtime/pairing', {
          method: 'POST',
          body: { phone: $('pairingPhoneInput').value },
        });
        const box = $('pairingResultBox');
        box.classList.remove('hidden');
        box.textContent = `Pairing Code (+${res.phone}): ${res.pairingCode}`;
        toast('Pairing code generated');
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    $('cmdSearchInput').addEventListener('input', renderCommandsTable);
    $('cmdCategorySelect').addEventListener('change', renderCommandsTable);

    // Minecraft & Wings View
    $('btnRefreshMc').addEventListener('click', () => loadMinecraftView().catch((e) => toast(e.message, 'error')));

    document.querySelectorAll('.ptero-power-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sig = btn.dataset.signal;
        const execPower = async () => {
          const res = await api('/api/minecraft/power', { method: 'POST', body: { action: sig } });
          toast(res.message || `Wings action "${sig}" dispatched`);
          await loadMinecraftView();
        };
        if (sig === 'stop' || sig === 'restart') {
          askConfirm(
            `Confirm Wings ${sig.toUpperCase()}`,
            `Send "${sig}" power signal to Pterodactyl Wings container? Active players may be disconnected.`,
            execPower
          );
        } else {
          execPower().catch((err) => toast(err.message, 'error'));
        }
      });
    });

    document.querySelectorAll('.rcon-preset').forEach((btn) => {
      btn.addEventListener('click', () => {
        $('rconInput').value = btn.dataset.cmd;
      });
    });

    $('rconForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const cmd = $('rconInput').value.trim();
      if (!cmd) return;
      try {
        const res = await api('/api/minecraft/console', { method: 'POST', body: { command: cmd } });
        $('rconOutput').textContent = `[OK] $ ${cmd}\n${res.output || res.message || 'Dispatched to server.'}`;
        toast('RCON command executed');
      } catch (err) {
        $('rconOutput').textContent = `[REJECTED] $ ${cmd}\n${err.message}`;
        toast(err.message, 'error');
      }
    });

    // Users & Economy View (including Real SQLite User Registration/Lookup)
    const ensureForm = $('ensureUserForm');
    if (ensureForm) {
      ensureForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const res = await api('/api/users/ensure', {
            method: 'POST',
            body: {
              phone: $('ensureUserPhone').value,
              name: $('ensureUserName').value,
            },
          });
          $('ensureUserPhone').value = '';
          $('ensureUserName').value = '';
          toast(`User +${res.phone} registered in SQLite`);
          await loadUsersView();
          const refreshed = await api(`/api/users?q=${encodeURIComponent(res.phone)}&pageSize=5`);
          const found = (refreshed.users || []).find((u) => u.jid === res.jid);
          if (found) openUserDrawer(found);
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    }

    document.querySelectorAll('[data-user-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.userFilter = btn.dataset.userFilter;
        document.querySelectorAll('[data-user-filter]').forEach((b) => b.classList.toggle('active', b === btn));
        loadUsersView().catch((err) => toast(err.message, 'error'));
      });
    });

    let searchTimer = null;
    $('userSearchInput').addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.userSearch = $('userSearchInput').value.trim();
        loadUsersView().catch((err) => toast(err.message, 'error'));
      }, 220);
    });

    $('btnCloseDrawer').addEventListener('click', () => {
      closeUserDrawer();
    });
    $('userDrawerBackdrop').addEventListener('click', (e) => {
      if (e.target === $('userDrawerBackdrop')) closeUserDrawer();
    });

    async function mutateSelectedUser(url, body, okMsg) {
      if (!state.selectedUser) return;
      await api(url, { method: 'POST', body: { jid: state.selectedUser.jid, ...body } });
      toast(okMsg);
      await loadUsersView();
      const refreshed = await api(`/api/users?q=${encodeURIComponent(state.selectedUser.phone)}&pageSize=10`);
      const found = (refreshed.users || []).find((u) => u.jid === state.selectedUser.jid);
      if (found) openUserDrawer(found);
    }

    $('btnDrawerAddCoin').addEventListener('click', () => {
      const amt = Math.abs(Number($('drawerCoinAmount').value || 0));
      mutateSelectedUser('/api/users/coins', { delta: amt }, `+${formatNumber(amt)} coins added`).catch((e) =>
        toast(e.message, 'error')
      );
    });

    $('btnDrawerSubCoin').addEventListener('click', () => {
      const amt = Math.abs(Number($('drawerCoinAmount').value || 0));
      mutateSelectedUser('/api/users/coins', { delta: -amt }, `-${formatNumber(amt)} coins deducted`).catch((e) =>
        toast(e.message, 'error')
      );
    });

    $('btnDrawerGrantVip').addEventListener('click', () => {
      const duration = ($('drawerVipDuration').value || '30d').trim();
      mutateSelectedUser('/api/users/vip', { duration }, `Granted Sakura VIP (${duration})`).catch((e) =>
        toast(e.message, 'error')
      );
    });

    $('btnDrawerRevokeVip').addEventListener('click', () => {
      mutateSelectedUser('/api/users/vip', { action: 'revoke' }, 'Sakura VIP revoked').catch((e) =>
        toast(e.message, 'error')
      );
    });

    $('btnDrawerBan').addEventListener('click', () => {
      const reason = $('drawerBanReason').value.trim();
      mutateSelectedUser('/api/users/ban', { reason }, 'User restricted (banned)').catch((e) =>
        toast(e.message, 'error')
      );
    });

    $('btnDrawerUnban').addEventListener('click', () => {
      mutateSelectedUser('/api/users/ban', { action: 'unban' }, 'User unbanned').catch((e) =>
        toast(e.message, 'error')
      );
    });

    // Broadcast & Tickets View
    const bcMsgInput = $('bcMessage');
    const bcCharCounter = $('bcCharCount');
    if (bcMsgInput && bcCharCounter) {
      bcMsgInput.addEventListener('input', () => {
        bcCharCounter.textContent = `${bcMsgInput.value.length} / 300`;
      });
    }

    $('broadcastForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const res = await api('/api/broadcast', {
          method: 'POST',
          body: {
            targetMode: $('bcTargetMode').value,
            message: $('bcMessage').value,
          },
        });
        const box = $('bcResultInfo');
        box.classList.remove('hidden');
        const r = res.result || {};
        box.textContent = `${r.dryRun ? '[DRY-RUN]' : '[LIVE]'} Broadcast dispatched (target=${$('bcTargetMode').value})`;
        toast('Broadcast job completed');
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    $('btnRefreshComms').addEventListener('click', () => loadCommsView().catch((e) => toast(e.message, 'error')));

    // Storage & Backups View
    $('btnCreateBackup').addEventListener('click', async () => {
      try {
        await api('/api/backups/create', { method: 'POST' });
        toast('SQLite snapshot created');
        await loadStorageView();
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    $('btnWalCheckpoint').addEventListener('click', async () => {
      try {
        await api('/api/storage/checkpoint', { method: 'POST' });
        toast('SQLite WAL TRUNCATE checkpoint completed');
        await loadStorageView();
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    // Audit View
    $('auditCategorySelect').addEventListener('change', () => loadAuditView().catch((e) => toast(e.message, 'error')));
    $('btnRefreshAudit').addEventListener('click', () => loadAuditView().catch((e) => toast(e.message, 'error')));

    // VPS Host Control & Full Interactive PTY Terminal View
    const vpsExecForm = $('vpsExecForm');
    const vpsCmdInput = $('vpsCmdInput');
    if (vpsExecForm && vpsCmdInput) {
      vpsExecForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const val = vpsCmdInput.value;
        vpsCmdInput.value = '';
        if (!state.vpsPtyWs || state.vpsPtyWs.readyState !== WebSocket.OPEN) {
          connectPtyWebSocket(false);
          setTimeout(() => {
            sendPtyInput(`${val}\r`);
            state.vpsTerm?.focus();
          }, 260);
          return;
        }
        sendPtyInput(`${val}\r`);
        state.vpsTerm?.focus();
      });
    }

    document.querySelectorAll('[data-pty-seq]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const seq = PTY_SPECIAL_SEQUENCES[btn.dataset.ptySeq];
        if (!seq) return;
        if (!sendPtyInput(seq)) {
          toast('PTY disconnected. Clicking Reconnect PTY to open shell.', 'warn');
          connectPtyWebSocket(false);
          return;
        }
        state.vpsTerm?.focus();
      });
    });

    document.querySelectorAll('[data-vps-chip]').forEach((chip) => {
      chip.addEventListener('click', () => {
        const cmd = chip.dataset.vpsChip || '';
        if (!cmd) return;
        if (!sendPtyInput(`${cmd}\r`)) {
          connectPtyWebSocket(false);
          setTimeout(() => sendPtyInput(`${cmd}\r`), 260);
          return;
        }
        state.vpsTerm?.focus();
      });
    });

    $('btnVpsExpand')?.addEventListener('click', () => {
      const card = $('vpsTerminalCard');
      if (!card) return;
      state.vpsTallMode = !state.vpsTallMode;
      card.classList.toggle('tall', state.vpsTallMode);
      $('btnVpsExpand').textContent = state.vpsTallMode ? 'Compact View' : 'Tall View';
      requestAnimationFrame(fitVpsPty);
      setTimeout(() => requestAnimationFrame(fitVpsPty), 255);
      state.vpsTerm?.focus();
    });

    $('btnVpsReconnect')?.addEventListener('click', () => {
      connectPtyWebSocket(true);
      toast('Interactive PTY session respawned');
    });

    $('btnVpsClear')?.addEventListener('click', () => {
      if (state.vpsTerm) {
        state.vpsTerm.clear();
        sendPtyInput('\x0c');
        state.vpsTerm.focus();
      }
    });

    $('btnVpsRefresh')?.addEventListener('click', () =>
      loadVpsView(false)
        .then(() => toast('VPS host telemetry refreshed'))
        .catch((e) => toast(e.message, 'error'))
    );

    $('btnVpsCheckPublicIp')?.addEventListener('click', async () => {
      try {
        const vps = await loadVpsView(true);
        if (vps?.network?.publicIp) {
          toast(`Public IP: ${vps.network.publicIp}`);
        } else {
          toast('Public IP lookup unavailable in offline/dry-run mode', 'warn');
        }
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    $('btnVpsRefreshProcs')?.addEventListener('click', () =>
      loadVpsView(false).catch((e) => toast(e.message, 'error'))
    );

    $('vpsProcSearchInput')?.addEventListener('input', (e) => {
      state.vpsProcFilter = e.target.value || '';
      renderVpsProcesses();
    });

    // Confirmation Modal
    $('btnConfirmCancel').addEventListener('click', () => {
      state.confirmCallback = null;
      $('confirmModalBackdrop').classList.add('hidden');
    });

    $('btnConfirmProceed').addEventListener('click', async () => {
      const fn = state.confirmCallback;
      state.confirmCallback = null;
      $('confirmModalBackdrop').classList.add('hidden');
      if (typeof fn === 'function') {
        try {
          await fn();
        } catch (err) {
          toast(err.message, 'error');
        }
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    checkSessionAndBoot();
  });
})();
