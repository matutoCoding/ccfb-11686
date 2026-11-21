// Canvas 2D 轻量折线图（支持多序列、双来源对比、理论参考线）
export interface LineSeries {
  label: string;
  color: string;
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  dashed?: boolean;
  width?: number;
}

export interface ChartOptions {
  title?: string;
  xLabel?: string;
  yLabel?: string;
  xUnit?: string;
  yUnit?: string;
  markers?: { x: number; label: string; color?: string }[];
  yMin?: number;
  yMax?: number;
}

export function drawLineChart(canvas: HTMLCanvasElement, series: LineSeries[], opts: ChartOptions = {}) {
  const dpr = devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 600;
  const cssH = canvas.clientHeight || 320;
  if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = cssW;
  const H = cssH;
  ctx.clearRect(0, 0, W, H);

  const padL = 62;
  const padR = 18;
  const padT = opts.title ? 34 : 14;
  const padB = 42;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = opts.yMin ?? Infinity;
  let yMax = opts.yMax ?? -Infinity;
  for (const s of series) {
    for (let i = 0; i < s.x.length; i++) {
      xMin = Math.min(xMin, s.x[i]);
      xMax = Math.max(xMax, s.x[i]);
      if (opts.yMin === undefined) yMin = Math.min(yMin, s.y[i]);
      if (opts.yMax === undefined) yMax = Math.max(yMax, s.y[i]);
    }
  }
  if (!Number.isFinite(xMin)) { xMin = 0; xMax = 1; }
  if (!Number.isFinite(yMin)) { yMin = -1; yMax = 1; }
  if (yMin === yMax) { yMin -= 0.5; yMax += 0.5; }
  const yPad = (yMax - yMin) * 0.08;
  if (opts.yMin === undefined) yMin -= yPad;
  if (opts.yMax === undefined) yMax += yPad;

  const sx = (x: number) => padL + ((x - xMin) / (xMax - xMin || 1)) * plotW;
  const sy = (y: number) => padT + plotH - ((y - yMin) / (yMax - yMin)) * plotH;

  // 背景网格
  ctx.strokeStyle = 'rgba(138,163,184,0.14)';
  ctx.fillStyle = '#8aa3b8';
  ctx.lineWidth = 1;
  ctx.font = '11px Consolas, monospace';
  const nY = 6;
  for (let i = 0; i <= nY; i++) {
    const y = yMin + ((yMax - yMin) * i) / nY;
    const py = sy(y);
    ctx.beginPath();
    ctx.moveTo(padL, py);
    ctx.lineTo(padL + plotW, py);
    ctx.stroke();
    ctx.textAlign = 'right';
    ctx.fillText(y.toFixed(3), padL - 8, py + 4);
  }
  const nX = 8;
  ctx.textAlign = 'center';
  for (let i = 0; i <= nX; i++) {
    const x = xMin + ((xMax - xMin) * i) / nX;
    const px = sx(x);
    ctx.beginPath();
    ctx.moveTo(px, padT);
    ctx.lineTo(px, padT + plotH);
    ctx.stroke();
    ctx.fillText(x.toFixed(1), px, padT + plotH + 16);
  }

  // 零轴
  if (yMin < 0 && yMax > 0) {
    ctx.strokeStyle = 'rgba(220,232,242,0.4)';
    ctx.beginPath();
    ctx.moveTo(padL, sy(0));
    ctx.lineTo(padL + plotW, sy(0));
    ctx.stroke();
  }

  // 标记竖线
  for (const m of opts.markers ?? []) {
    if (m.x < xMin || m.x > xMax) continue;
    ctx.strokeStyle = m.color ?? 'rgba(240,168,72,0.7)';
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(sx(m.x), padT);
    ctx.lineTo(sx(m.x), padT + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = m.color ?? '#f0a848';
    ctx.textAlign = 'left';
    ctx.fillText(m.label, sx(m.x) + 5, padT + 12);
  }

  // 数据线
  for (const s of series) {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width ?? 1.8;
    ctx.setLineDash(s.dashed ? [6, 4] : []);
    ctx.beginPath();
    for (let i = 0; i < s.x.length; i++) {
      const px = sx(s.x[i]);
      const py = sy(s.y[i]);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 标题与图例
  ctx.fillStyle = '#dce8f2';
  ctx.font = '13px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'left';
  if (opts.title) ctx.fillText(opts.title, padL, 20);
  let lx = padL;
  const ly = H - 12;
  ctx.font = '12px "Microsoft YaHei", sans-serif';
  for (const s of series) {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2;
    ctx.setLineDash(s.dashed ? [5, 3] : []);
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(lx + 18, ly);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#a9c0d3';
    ctx.textAlign = 'left';
    ctx.fillText(s.label, lx + 23, ly + 4);
    lx += ctx.measureText(s.label).width + 44;
  }
  ctx.fillStyle = '#6f8aa0';
  ctx.font = '11px Consolas, monospace';
  ctx.textAlign = 'center';
  if (opts.xLabel) ctx.fillText(`${opts.xLabel}${opts.xUnit ? ` (${opts.xUnit})` : ''}`, padL + plotW / 2, H - 2);
  ctx.save();
  ctx.translate(14, padT + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillText(`${opts.yLabel ?? ''}${opts.yUnit ? ` (${opts.yUnit})` : ''}`, 0, 0);
  ctx.restore();
}
