// 船型三视图(侧视/俯视/横剖) 2D 绘制
import type { HullSpec } from '../core/types.ts';
import { buildStations, sideProfile, waterlineOutline } from '../core/hull.ts';

export function drawHullViews(canvas: HTMLCanvasElement, hull: HullSpec): void {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 900;
  const cssH = canvas.clientHeight || 520;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const W = cssW, H = cssH;
  ctx.clearRect(0, 0, W, H);
  ctx.font = '12px Segoe UI, sans-serif';

  const stations = buildStations(hull);
  const panelW = (W - 48) / 2;

  // ---- 侧视(左上) ----
  drawPanel(ctx, 16, 16, panelW, H / 2 - 24, '侧视图 Side Profile');
  drawSide(ctx, hull, 16, 16, panelW, H / 2 - 24, sideProfile(hull));

  // ---- 俯视(右上) ----
  drawPanel(ctx, 32 + panelW, 16, panelW, H / 2 - 24, '俯视图 Plan View');
  drawPlan(ctx, hull, 32 + panelW, 16, panelW, H / 2 - 24, waterlineOutline(hull));

  // ---- 横剖(下方通栏) ----
  drawPanel(ctx, 16, H / 2 + 8, W - 32, H / 2 - 24, '横剖线图 Body Plan (21 站, 右舷)');
  drawBody(ctx, hull, stations, 16, H / 2 + 8, W - 32, H / 2 - 24);
}

function drawPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, title: string) {
  ctx.strokeStyle = 'rgba(138,160,182,.25)';
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = '#8aa0b6';
  ctx.fillText(title, x + 10, y + 18);
}

function drawSide(
  ctx: CanvasRenderingContext2D, hull: HullSpec,
  ox: number, oy: number, w: number, h: number,
  profile: { x: number; z: number }[],
) {
  const pad = 34;
  const sx = (w - pad * 2) / hull.Lpp;
  const maxZ = hull.T * 1.8;
  const sz = (h - pad * 2) / maxZ;
  const X = (x: number) => ox + pad + (x + hull.Lpp / 2) * sx;
  const Z = (z: number) => oy + h - pad - z * sz;
  ctx.strokeStyle = '#4da3ff';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  profile.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Z(p.z)) : ctx.moveTo(X(p.x), Z(p.z))));
  ctx.closePath();
  ctx.stroke();
  // 水线
  ctx.strokeStyle = 'rgba(70,201,141,.8)';
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(X(-hull.Lpp / 2), Z(hull.T));
  ctx.lineTo(X(hull.Lpp / 2), Z(hull.T));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#8aa0b6';
  ctx.fillText(`设计水线 T=${hull.T}m`, X(hull.Lpp / 2) - 110, Z(hull.T) - 5);
}

function drawPlan(
  ctx: CanvasRenderingContext2D, hull: HullSpec,
  ox: number, oy: number, w: number, h: number,
  outline: { x: number; y: number }[],
) {
  const pad = 34;
  const sx = (w - pad * 2) / hull.Lpp;
  const sy = (h - pad * 2) / hull.B;
  const X = (x: number) => ox + pad + (x + hull.Lpp / 2) * sx;
  const Y = (y: number) => oy + h / 2 - y * sy;
  ctx.strokeStyle = '#4da3ff';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  outline.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
  ctx.stroke();
  // 中线
  ctx.strokeStyle = 'rgba(138,160,182,.4)';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(X(-hull.Lpp / 2), Y(0));
  ctx.lineTo(X(hull.Lpp / 2), Y(0));
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawBody(
  ctx: CanvasRenderingContext2D, hull: HullSpec,
  stations: ReturnType<typeof buildStations>,
  ox: number, oy: number, w: number, h: number,
) {
  const pad = 40;
  // 横剖图横向铺站号, 纵向为吃水, 曲线半宽按比例
  const maxHalf = hull.B / 2;
  const sy = (h - pad * 2) / hull.T;
  const stationSlot = (w - pad * 2) / stations.length;
  const Z = (z: number) => oy + h - pad - z * sy;
  const baseX = (i: number) => ox + pad + i * stationSlot + stationSlot / 2;
  const breadthScale = (stationSlot * 0.42) / maxHalf;

  // 水线参考
  ctx.strokeStyle = 'rgba(138,160,182,.25)';
  for (let t = 0; t <= 4; t++) {
    const z = (t / 4) * hull.T;
    ctx.beginPath();
    ctx.moveTo(ox + pad, Z(z));
    ctx.lineTo(ox + w - pad, Z(z));
    ctx.stroke();
  }
  ctx.strokeStyle = '#4da3ff';
  ctx.lineWidth = 1.3;
  stations.forEach((st, i) => {
    const bx = baseX(i);
    ctx.beginPath();
    const nz = 16;
    for (let iz = 0; iz <= nz; iz++) {
      const t = iz / nz;
      const half = st.halfBreadth(t);
      const z = t * hull.T;
      const x = bx + half * breadthScale;
      iz === 0 ? ctx.moveTo(x, Z(z)) : ctx.lineTo(x, Z(z));
    }
    ctx.stroke();
    // 镜像左舷
    ctx.beginPath();
    for (let iz = 0; iz <= nz; iz++) {
      const t = iz / nz;
      const half = st.halfBreadth(t);
      const z = t * hull.T;
      const x = bx - half * breadthScale;
      iz === 0 ? ctx.moveTo(x, Z(z)) : ctx.lineTo(x, Z(z));
    }
    ctx.stroke();
    // 站号线
    ctx.strokeStyle = 'rgba(138,160,182,.15)';
    ctx.beginPath();
    ctx.moveTo(bx, oy + pad - 8);
    ctx.lineTo(bx, oy + h - pad);
    ctx.stroke();
    ctx.strokeStyle = '#4da3ff';
    if (i % 2 === 0) {
      ctx.fillStyle = '#8aa0b6';
      ctx.fillText(String(i), bx - 3, oy + h - pad + 14);
    }
  });
}
