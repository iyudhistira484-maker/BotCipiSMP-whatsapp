/* ═══════════════════════════════════════════════════════════════════════
   Cipi Panel (CP) — HiDPI Monotone-Spline Telemetry Renderer
   Smooth Fritsch-Carlson spline, vertical gradient fill & hover crosshair
   ═══════════════════════════════════════════════════════════════════════ */

(function () {
  const hoverState = new WeakMap();

  function readVar(name, fallback) {
    const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return val || fallback;
  }

  function colorWithAlpha(color, alpha) {
    const c = String(color || '').trim();
    if (c.startsWith('#')) {
      const hex = c.slice(1);
      const full = hex.length === 3 ? hex.split('').map((x) => x + x).join('') : hex;
      if (full.length === 6) {
        const r = Number.parseInt(full.slice(0, 2), 16);
        const g = Number.parseInt(full.slice(2, 4), 16);
        const b = Number.parseInt(full.slice(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
      }
    }
    const rgbMatch = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (rgbMatch) {
      return `rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, ${alpha})`;
    }
    return c;
  }

  /**
   * Monotone cubic Hermite tangents (Fritsch-Carlson) so curves stay
   * silky smooth without overshooting below 0 or above real peaks.
   */
  function buildMonotonePath(ctx, pts) {
    const n = pts.length;
    if (n === 0) return;
    ctx.moveTo(pts[0].x, pts[0].y);
    if (n === 1) return;
    if (n === 2) {
      ctx.lineTo(pts[1].x, pts[1].y);
      return;
    }

    const dx = new Array(n - 1);
    const dy = new Array(n - 1);
    const m = new Array(n - 1);
    for (let i = 0; i < n - 1; i++) {
      dx[i] = Math.max(0.0001, pts[i + 1].x - pts[i].x);
      dy[i] = pts[i + 1].y - pts[i].y;
      m[i] = dy[i] / dx[i];
    }

    const tangents = new Array(n);
    tangents[0] = m[0];
    tangents[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) {
      if (m[i - 1] * m[i] <= 0) {
        tangents[i] = 0;
      } else {
        tangents[i] = (m[i - 1] + m[i]) * 0.5;
      }
    }

    for (let i = 0; i < n - 1; i++) {
      if (Math.abs(m[i]) < 1e-6) {
        tangents[i] = 0;
        tangents[i + 1] = 0;
      } else {
        const a = tangents[i] / m[i];
        const b = tangents[i + 1] / m[i];
        const s = a * a + b * b;
        if (s > 9) {
          const tau = 3 / Math.sqrt(s);
          tangents[i] = tau * a * m[i];
          tangents[i + 1] = tau * b * m[i];
        }
      }
    }

    for (let i = 0; i < n - 1; i++) {
      const h = dx[i] / 3;
      ctx.bezierCurveTo(
        pts[i].x + h,
        pts[i].y + tangents[i] * h,
        pts[i + 1].x - h,
        pts[i + 1].y - tangents[i + 1] * h,
        pts[i + 1].x,
        pts[i + 1].y
      );
    }
  }

  function bindHoverOnce(canvas) {
    if (hoverState.has(canvas)) return hoverState.get(canvas);
    const st = { x: null, lastArgs: null };
    hoverState.set(canvas, st);

    const onMove = (clientX) => {
      const rect = canvas.getBoundingClientRect();
      st.x = clientX - rect.left;
      if (st.lastArgs) {
        renderTelemetryChart(canvas, st.lastArgs.values, st.lastArgs.opts);
      }
    };

    canvas.addEventListener('mousemove', (e) => onMove(e.clientX), { passive: true });
    canvas.addEventListener('mouseleave', () => {
      st.x = null;
      if (st.lastArgs) {
        renderTelemetryChart(canvas, st.lastArgs.values, st.lastArgs.opts);
      }
    });
    canvas.addEventListener(
      'touchmove',
      (e) => {
        if (e.touches && e.touches[0]) onMove(e.touches[0].clientX);
      },
      { passive: true }
    );
    canvas.addEventListener(
      'touchend',
      () => {
        st.x = null;
        if (st.lastArgs) {
          renderTelemetryChart(canvas, st.lastArgs.values, st.lastArgs.opts);
        }
      },
      { passive: true }
    );

    return st;
  }

  function renderTelemetryChart(canvas, values, opts = {}) {
    if (!canvas) return;
    const st = bindHoverOnce(canvas);
    st.lastArgs = { values, opts };

    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetW = Math.round(rect.width * dpr);
    const targetH = Math.round(rect.height * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    ctx.clearRect(0, 0, w, h);

    const gridColor = readVar('--chart-grid', 'rgba(255,255,255,0.055)');
    const strokeColor = readVar(opts.strokeVar || '--chart-cpu', '#3b82f6');
    const mutedColor = readVar('--text-muted', '#71717a');
    const surfaceBg = readVar('--bg-elevated', '#161821');
    const borderCol = readVar('--border-strong', '#363a48');
    const primaryText = readVar('--text-primary', '#f4f4f7');

    const padTop = 8;
    const padBottom = 7;
    const padLeft = 3;
    const padRight = 40;
    const plotW = Math.max(10, w - padLeft - padRight);
    const plotH = Math.max(10, h - padTop - padBottom);

    const pts = Array.isArray(values) && values.length > 0 ? values : [0];
    const rawMax = Math.max(...pts, opts.minCeiling || 10);
    const maxVal = opts.fixedMax || Math.ceil(rawMax * 1.18);
    const unit = opts.unit || '';

    // Horizontal dashed reference hairlines (3 divisions)
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = mutedColor;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (let i = 0; i <= 2; i++) {
      const ratio = i / 2;
      const y = Math.round(padTop + plotH * ratio) + 0.5;
      ctx.save();
      if (i === 1) ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(padLeft + plotW, y);
      ctx.stroke();
      ctx.restore();

      const labelVal = Math.round(maxVal * (1 - ratio));
      ctx.fillText(`${labelVal}${unit}`, w - 2, y);
    }

    const maxSlots = opts.slots || 60;
    const stepX = plotW / Math.max(1, maxSlots - 1);
    const offsetSlots = Math.max(0, maxSlots - pts.length);

    const coords = pts.map((v, idx) => {
      const numeric = Number(v) || 0;
      const clamped = Math.max(0, Math.min(maxVal, numeric));
      const x = padLeft + (offsetSlots + idx) * stepX;
      const y = padTop + plotH - (clamped / (maxVal || 1)) * plotH;
      return { x, y, raw: numeric, ageSec: Math.round((pts.length - 1 - idx) * 1.5) };
    });

    if (coords.length === 1) {
      coords.unshift({ x: padLeft, y: coords[0].y, raw: coords[0].raw, ageSec: 2 });
    }

    // Smooth vertical gradient area fill
    const grad = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
    grad.addColorStop(0, colorWithAlpha(strokeColor, 0.24));
    grad.addColorStop(0.72, colorWithAlpha(strokeColor, 0.05));
    grad.addColorStop(1, colorWithAlpha(strokeColor, 0.0));

    ctx.beginPath();
    buildMonotonePath(ctx, coords);
    ctx.lineTo(coords[coords.length - 1].x, padTop + plotH);
    ctx.lineTo(coords[0].x, padTop + plotH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Smooth 1.75px spline stroke
    ctx.beginPath();
    buildMonotonePath(ctx, coords);
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 1.75;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Live head indicator dot + subtle halo
    const last = coords[coords.length - 1];
    ctx.beginPath();
    ctx.arc(last.x, last.y, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = colorWithAlpha(strokeColor, 0.2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(last.x, last.y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = strokeColor;
    ctx.fill();

    // Interactive hover crosshair & precision readout pill
    if (typeof st.x === 'number' && st.x >= padLeft && st.x <= padLeft + plotW + 6) {
      let nearest = coords[0];
      let minDist = Math.abs(st.x - nearest.x);
      for (let i = 1; i < coords.length; i++) {
        const d = Math.abs(st.x - coords[i].x);
        if (d < minDist) {
          minDist = d;
          nearest = coords[i];
        }
      }

      ctx.save();
      ctx.strokeStyle = colorWithAlpha(strokeColor, 0.45);
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(Math.round(nearest.x) + 0.5, padTop);
      ctx.lineTo(Math.round(nearest.x) + 0.5, padTop + plotH);
      ctx.stroke();
      ctx.restore();

      ctx.beginPath();
      ctx.arc(nearest.x, nearest.y, 3.3, 0, Math.PI * 2);
      ctx.fillStyle = surfaceBg;
      ctx.fill();
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = strokeColor;
      ctx.stroke();

      const formattedVal =
        nearest.raw >= 100 ? nearest.raw.toFixed(0) : nearest.raw >= 10 ? nearest.raw.toFixed(1) : nearest.raw.toFixed(2);
      const timeTag = nearest.ageSec <= 0 ? 'now' : `-${nearest.ageSec}s`;
      const pillText = `${formattedVal}${unit.trim() ? ' ' + unit.trim() : unit} · ${timeTag}`;

      ctx.font = '500 10px "JetBrains Mono", monospace';
      const textW = ctx.measureText(pillText).width;
      const boxW = textW + 12;
      const boxH = 18;
      const boxX = Math.max(padLeft + 2, Math.min(padLeft + plotW - boxW - 2, nearest.x - boxW / 2));
      const boxY = nearest.y > padTop + 26 ? nearest.y - 24 : nearest.y + 8;

      ctx.fillStyle = surfaceBg;
      ctx.strokeStyle = borderCol;
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(boxX, boxY, boxW, boxH, 4);
      } else {
        ctx.rect(boxX, boxY, boxW, boxH);
      }
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = primaryText;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(pillText, boxX + 6, boxY + boxH / 2 + 0.5);
    }

    ctx.restore();
  }

  window.CipiCharts = {
    renderTelemetryChart,
  };
})();
