// 2D Canvas 绘图: 折线图与船型三视图
export interface Series {
  label: string;
  color: string;
  points: { x: number; z: number }[];
  dashed?: boolean;
}

export function drawLineChart(
  canvas: HTMLCanvasElement,
  series: Series[],
  opts: {
    xLabel?: string;
    yLabel?: string;
    title?: string;
    refLines?: { x?: number; label?: string }[];
  } = {},
): void {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 800;
  const cssH = canvas.clientHeight || 360;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const W = cssW, H = cssH;
  const pad = { l: 58, r: 18, t: opts.title ? 34 : 16, b: 42 };
  const all = series.flatMap((s) => s.points);
  if (!all.length) return;
  let xMin = Infinity, xMax = -Infinity, zMin = Infinity, zMax = -Infinity;
  for (const p of all) {
    xMin = Math.min(xMin, p.x); xMax = Math.max(xMax, p.x);
    zMin = Math.min(zMin, p.z); zMax = Math.max(zMax, p.z);
  }
  if (zMin === zMax) { zMin -= 0.01; zMax += 0.01; }
  const padZ = (zMax - zMin) * 0.08;
  zMin -= padZ; zMax += padZ;
  const px = (x: number) => pad.l + ((x - xMin) / (xMax - xMin)) * (W - pad.l - pad.r);
  const py = (z: number) => pad.t + (1 - (z - zMin) / (zMax - zMin)) * (H - pad.t - pad.b);

  ctx.clearRect(0, 0, W, H);
  ctx.font = '11px Segoe UI, sans-serif';
  // 网格与坐标
  ctx.strokeStyle = 'rgba(138,160,182,.18)';
  ctx.fillStyle = '#8aa0b6';
  ctx.lineWidth = 1;
  const nGrid = 5;
  for (let i = 0; i <= nGrid; i++) {
    const gy = pad.t + (i / nGrid) * (H - pad.t - pad.b);
    ctx.beginPath(); ctx.moveTo(pad.l, gy); ctx.lineTo(W - pad.r, gy); ctx.stroke();
    const val = zMax - (i / nGrid) * (zMax - zMin);
    ctx.fillText(val.toFixed(3), 6, gy + 3);
  }
  for (let i = 0; i <= nGrid; i++) {
    const gx = pad.l + (i / nGrid) * (W - pad.l - pad.r);
    const val = xMin + (i / nGrid) * (xMax - xMin);
    ctx.fillText(val.toFixed(1), gx - 12, H - pad.b + 16);
  }
  // 零线
  if (zMin < 0 && zMax > 0) {
    ctx.strokeStyle = 'rgba(220,230,240,.4)';
    ctx.beginPath(); ctx.moveTo(pad.l, py(0)); ctx.lineTo(W - pad.r, py(0)); ctx.stroke();
  }
  // 参考竖线
  for (const ref of opts.refLines ?? []) {
    if (ref.x === undefined || ref.x < xMin || ref.x > xMax) continue;
    ctx.strokeStyle = 'rgba(232,176,75,.7)';
    ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(px(ref.x), pad.t); ctx.lineTo(px(ref.x), H - pad.b); ctx.stroke();
    ctx.setLineDash([]);
    if (ref.label) ctx.fillText(ref.label, px(ref.x) + 4, pad.t + 12);
  }
  // 曲线
  for (const s of series) {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 1.8;
    ctx.setLineDash(s.dashed ? [5, 4] : []);
    ctx.beginPath();
    s.points.forEach((p, i) => {
      const X = px(p.x), Y = py(p.z);
      i === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // 标题与图例
  if (opts.title) {
    ctx.fillStyle = '#dce6f0';
    ctx.font = '13px Segoe UI, sans-serif';
    ctx.fillText(opts.title, pad.l, 20);
  }
  ctx.font = '11px Segoe UI, sans-serif';
  let lx = pad.l;
  series.forEach((s) => {
    ctx.fillStyle = s.color;
    ctx.fillRect(lx, H - 14, 12, 3);
    ctx.fillStyle = '#8aa0b6';
    ctx.fillText(s.label, lx + 16, H - 10);
    lx += ctx.measureText(s.label).width + 36;
  });
  if (opts.xLabel) {
    ctx.fillStyle = '#8aa0b6';
    ctx.fillText(opts.xLabel, W - pad.r - 60, H - 4);
  }
}
