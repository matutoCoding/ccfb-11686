// 船型三视图（Canvas 2D）：侧视/俯视/横剖
import type { HullGeometry } from '../core/hull';

function setup(canvas: HTMLCanvasElement) {
  const dpr = devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 500;
  const cssH = canvas.clientHeight || 260;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  return { ctx, W: cssW, H: cssH };
}

function frame(ctx: CanvasRenderingContext2D, W: number, H: number) {
  ctx.strokeStyle = 'rgba(138,163,184,0.12)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 8; i++) {
    const x = (W * i) / 8;
    ctx.beginPath(); ctx.moveTo(x, 8); ctx.lineTo(x, H - 8); ctx.stroke();
  }
  for (let i = 1; i < 5; i++) {
    const y = (H * i) / 5;
    ctx.beginPath(); ctx.moveTo(8, y); ctx.lineTo(W - 8, y); ctx.stroke();
  }
}

/** 侧视图：纵剖轮廓 + 站线 + 水线 */
export function drawSideView(canvas: HTMLCanvasElement, geo: HullGeometry) {
  const { ctx, W, H } = setup(canvas);
  frame(ctx, W, H);
  const p = geo.params;
  const padX = 34;
  const padY = 26;
  const sx = (x: number) => padX + ((x + p.lengthBP / 2) / p.lengthBP) * (W - 2 * padX);
  const sy = (y: number) => H / 2 - (y / p.draft) * (H / 2 - padY);

  // 水线
  ctx.strokeStyle = 'rgba(56,182,230,0.55)';
  ctx.setLineDash([7, 5]);
  ctx.beginPath(); ctx.moveTo(padX, sy(0)); ctx.lineTo(W - padX, sy(0)); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#38b6e6';
  ctx.font = '11px Consolas';
  ctx.fillText('设计水线', W - padX - 64, sy(0) - 5);

  // 甲板线与龙骨线
  ctx.strokeStyle = '#dce8f2';
  ctx.lineWidth = 2;
  ctx.beginPath();
  geo.stations.forEach((st, i) => {
    const x = sx(st.x);
    const yDeck = sy(0);
    if (i === 0) ctx.moveTo(x, yDeck);
    else ctx.lineTo(x, yDeck);
  });
  ctx.stroke();

  ctx.strokeStyle = '#e5604f';
  ctx.beginPath();
  geo.stations.forEach((st, i) => {
    const x = sx(st.x);
    const yKeel = sy(-p.draft + (st.halfBreadths[st.halfBreadths.length - 1] > 0.01 ? 0 : 0));
    if (i === 0) ctx.moveTo(x, yKeel);
    else ctx.lineTo(x, yKeel);
  });
  ctx.stroke();

  // 站线（各站水线半宽投影为侧视轮廓）
  ctx.strokeStyle = 'rgba(220,232,242,0.85)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  geo.stations.forEach((st, i) => {
    const x = sx(st.x);
    if (i === 0) ctx.moveTo(x, sy(0));
    ctx.lineTo(x, sy(-p.draft));
  });
  ctx.stroke();

  // 站线刻度
  ctx.fillStyle = '#8aa3b8';
  ctx.font = '10px Consolas';
  ctx.textAlign = 'center';
  geo.stations.forEach((st, i) => {
    if (i % 2 === 0) ctx.fillText(String(i), sx(st.x), H - 8);
  });
  ctx.textAlign = 'left';
  ctx.fillStyle = '#6f8aa0';
  ctx.fillText(`Lpp=${p.lengthBP}m  T=${p.draft}m  Cb=${p.blockCoeff}`, padX, 16);
}

/** 俯视图：水线面半宽 */
export function drawPlanView(canvas: HTMLCanvasElement, geo: HullGeometry) {
  const { ctx, W, H } = setup(canvas);
  frame(ctx, W, H);
  const p = geo.params;
  const padX = 34;
  const scaleY = (H / 2 - 24) / (p.beam / 2);
  const sx = (x: number) => padX + ((x + p.lengthBP / 2) / p.lengthBP) * (W - 2 * padX);
  const sz = (z: number) => H / 2 - z * scaleY;

  ctx.strokeStyle = '#dce8f2';
  ctx.lineWidth = 2;
  for (const side of [1, -1]) {
    ctx.beginPath();
    geo.stations.forEach((st, i) => {
      const x = sx(st.x);
      const z = sz(side * st.halfBreadths[0]);
      if (i === 0) ctx.moveTo(x, z);
      else ctx.lineTo(x, z);
    });
    ctx.stroke();
  }
  // 中线
  ctx.strokeStyle = 'rgba(56,182,230,0.4)';
  ctx.setLineDash([6, 5]);
  ctx.beginPath(); ctx.moveTo(padX, H / 2); ctx.lineTo(W - padX, H / 2); ctx.stroke();
  ctx.setLineDash([]);

  // 多条水线
  ctx.strokeStyle = 'rgba(138,163,184,0.5)';
  ctx.lineWidth = 1;
  for (const j of [2, 4, 7]) {
    for (const side of [1, -1]) {
      ctx.beginPath();
      geo.stations.forEach((st, i) => {
        const x = sx(st.x);
        const z = sz(side * st.halfBreadths[Math.min(j, st.halfBreadths.length - 1)]);
        if (i === 0) ctx.moveTo(x, z);
        else ctx.lineTo(x, z);
      });
      ctx.stroke();
    }
  }
  ctx.fillStyle = '#6f8aa0';
  ctx.font = '11px Consolas';
  ctx.fillText(`B=${p.beam}m  水线族（实线）/ 设计水线（高亮）`, padX, 16);
}

/** 横剖面图：典型站的半宽-吃水形状 */
export function drawBodyView(canvas: HTMLCanvasElement, geo: HullGeometry) {
  const { ctx, W, H } = setup(canvas);
  frame(ctx, W, H);
  const p = geo.params;
  const baseX = W * 0.28;
  const scaleX = (W * 0.42) / (p.beam / 2);
  const scaleY = (H - 60) / p.draft;
  const sy = (d: number) => 24 + d * scaleY;

  const pick = [2, 5, 10, 15, 18];
  const colors = ['#27d0a4', '#38b6e6', '#dce8f2', '#f0a848', '#e5604f'];
  ctx.font = '11px Consolas';

  pick.forEach((si, ci) => {
    const st = geo.stations[si];
    if (!st) return;
    ctx.strokeStyle = colors[ci];
    ctx.lineWidth = 1.8;
    for (const side of [1, -1]) {
      ctx.beginPath();
      st.halfBreadths.forEach((hb, j) => {
        const x = baseX + side * hb * scaleX;
        const y = sy(st.depths[j]);
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
    // 图例
    ctx.fillStyle = colors[ci];
    ctx.fillText(`站 ${si}`, 12, 26 + ci * 18);
  });

  // 中线
  ctx.strokeStyle = 'rgba(56,182,230,0.4)';
  ctx.setLineDash([6, 5]);
  ctx.beginPath(); ctx.moveTo(baseX, 20); ctx.lineTo(baseX, H - 20); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#6f8aa0';
  ctx.textAlign = 'right';
  ctx.fillText(`Cm=${p.midshipCoeff}`, W - 14, H - 10);
  ctx.textAlign = 'left';
}
