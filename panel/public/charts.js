/* ═══════════════════════════════════════════════════════════════════════
   Cipi Panel (CP) — HiDPI Real-Time Telemetry Canvas Renderer
   Reads active theme tokens from CSS variables for Dark & Light modes
   ═══════════════════════════════════════════════════════════════════════ */

(function () {
  function readVar(name, fallback) {
    const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return val || fallback;
  }

  function renderTelemetryChart(canvas, values, opts = {}) {
    if (!canvas) return;
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

    const gridColor = readVar('--chart-grid', 'rgba(255,255,255,0.06)');
    const strokeColor = readVar(opts.strokeVar || '--chart-cpu', '#3b82f6');
    const fillColor = readVar(opts.fillVar || '--chart-cpu-fill', 'rgba(59,130,246,0.14)');
    const mutedColor = readVar('--text-muted', '#71717a');

    const padTop = 6;
    const padBottom = 6;
    const padLeft = 2;
    const padRight = 36;
    const plotW = Math.max(10, w - padLeft - padRight);
    const plotH = Math.max(10, h - padTop - padBottom);

    const pts = Array.isArray(values) && values.length > 0 ? values : [0];
    const rawMax = Math.max(...pts, opts.minCeiling || 10);
    const maxVal = opts.fixedMax || Math.ceil(rawMax * 1.18);

    // Horizontal reference hairlines (3 divisions)
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = mutedColor;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (let i = 0; i <= 2; i++) {
      const ratio = i / 2;
      const y = Math.round(padTop + plotH * ratio) + 0.5;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(padLeft + plotW, y);
      ctx.stroke();

      const labelVal = Math.round(maxVal * (1 - ratio));
      const unit = opts.unit || '';
      ctx.fillText(`${labelVal}${unit}`, w - 2, y);
    }

    const maxSlots = opts.slots || 60;
    const stepX = plotW / Math.max(1, maxSlots - 1);
    const offsetSlots = Math.max(0, maxSlots - pts.length);

    const coords = pts.map((v, idx) => {
      const clamped = Math.max(0, Math.min(maxVal, Number(v) || 0));
      const x = padLeft + (offsetSlots + idx) * stepX;
      const y = padTop + plotH - (clamped / (maxVal || 1)) * plotH;
      return { x, y };
    });

    if (coords.length === 1) {
      coords.unshift({ x: padLeft, y: coords[0].y });
    }

    // Area fill
    ctx.beginPath();
    ctx.moveTo(coords[0].x, padTop + plotH);
    for (const c of coords) {
      ctx.lineTo(c.x, c.y);
    }
    ctx.lineTo(coords[coords.length - 1].x, padTop + plotH);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();

    // Crisp 1.6px signal line
    ctx.beginPath();
    coords.forEach((c, i) => {
      if (i === 0) ctx.moveTo(c.x, c.y);
      else ctx.lineTo(c.x, c.y);
    });
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 1.6;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Terminal live dot on latest point
    const last = coords[coords.length - 1];
    ctx.beginPath();
    ctx.arc(last.x, last.y, 2.6, 0, Math.PI * 2);
    ctx.fillStyle = strokeColor;
    ctx.fill();

    ctx.restore();
  }

  window.CipiCharts = {
    renderTelemetryChart,
  };
})();
