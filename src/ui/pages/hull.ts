// 页面 2：船型编辑（主尺度 + 型线参数 + 三视图）
import { store } from '../../core/store';
import { generateHull, hullSummary } from '../../core/hull';
import type { HullGeometry } from '../../core/hull';
import type { HullParams } from '../../core/types';
import { h, clear, labeledField, numberInput, slider } from '../dom';
import { navigate } from '../router';
import { drawBodyView, drawPlanView, drawSideView } from '../hullViews';

export function renderHullPage(root: HTMLElement) {
  clear(root);
  const project = store.activeProject();
  const hull = project ? store.getHull(project.hullId) : store.data.hulls[0];

  root.append(
    h('h1', { class: 'page-title' }, '船型参数化编辑'),
    h('p', { class: 'page-sub' }, '调整主尺度与型线参数，站线型值表与三视图实时重建；几何同时用于仿真页的船体网格与压力斑尺寸。'),
  );

  if (!hull) {
    root.append(h('div', { class: 'empty' }, '请先在方案列表创建方案。'));
    return;
  }

  let geo: HullGeometry = generateHull(hull);
  const summary = hullSummary(geo);

  const sideCanvas = h('canvas', { class: 'chart', style: 'height:240px' }) as HTMLCanvasElement;
  const planCanvas = h('canvas', { class: 'chart', style: 'height:240px' }) as HTMLCanvasElement;
  const bodyCanvas = h('canvas', { class: 'chart', style: 'height:260px' }) as HTMLCanvasElement;

  const volMetric = h('div', { class: 'metric' },
    h('div', { class: 'k' }, '排水体积 ∇'),
    h('div', { class: 'v' }, h('span', {}, ''), h('span', { class: 'u' }, ' m³')));
  const cbMetric = h('div', { class: 'metric' },
    h('div', { class: 'k' }, '实际方形系数 Cb'),
    h('div', { class: 'v' }, h('span', {}, ''), h('span', { class: 'u' }, '')));
  const lcbMetric = h('div', { class: 'metric' },
    h('div', { class: 'k' }, '站线数 / 水线数'),
    h('div', { class: 'v' }, '21 × 11'));

  function refreshMetrics() {
    const s = hullSummary(geo);
    volMetric.querySelector('.v')!.firstChild!.textContent = s.displacedVolume.toFixed(1);
    cbMetric.querySelector('.v')!.firstChild!.textContent = s.cbActual.toFixed(3);
  }

  function redraw() {
    geo = generateHull(hull!);
    drawSideView(sideCanvas, geo);
    drawPlanView(planCanvas, geo);
    drawBodyView(bodyCanvas, geo);
    refreshMetrics();
  }

  function patch(p: Partial<HullParams>) {
    const next: HullParams = { ...hull!, ...p };
    store.upsertHull(next);
    Object.assign(hull!, next);
    redraw();
  }

  const dimCard = h('div', { class: 'card' },
    h('h2', {}, '主尺度'),
    h('div', { class: 'grid-2' },
      labeledField('垂线间长 Lpp (m)', numberInput(hull.lengthBP, 1, (v) => patch({ lengthBP: Math.max(5, v) }), 5, 400)),
      labeledField('型宽 B (m)', numberInput(hull.beam, 0.5, (v) => patch({ beam: Math.max(0.5, v) }), 0.5, 60)),
      labeledField('吃水 T (m)', numberInput(hull.draft, 0.2, (v) => patch({ draft: Math.max(0.2, v) }), 0.2, 30)),
      labeledField('方形系数 Cb', slider(hull.blockCoeff, 0.4, 0.85, 0.01, (v) => patch({ blockCoeff: v }))),
      labeledField('中横剖面系数 Cm', slider(hull.midshipCoeff, 0.7, 0.98, 0.01, (v) => patch({ midshipCoeff: v }))),
    ),
  );

  const shapeCard = h('div', { class: 'card' },
    h('h2', {}, '型线参数'),
    h('div', { class: 'grid-2' },
      labeledField('进流段半角 (°)', slider(hull.entranceAngle, 2, 30, 0.5, (v) => patch({ entranceAngle: v })), '越大首部越尖瘦'),
      labeledField('横剖 U/V 倾向', slider(hull.prismaticCurve, -1, 1, 0.05, (v) => patch({ prismaticCurve: v })), '-1 偏 V 形，+1 偏 U 形'),
      labeledField('球鼻艏强度', slider(hull.bulb, 0, 1, 0.05, (v) => patch({ bulb: v }))),
      labeledField('方艉宽度比', slider(hull.transom, 0, 1, 0.05, (v) => patch({ transom: v }))),
    ),
    h('div', { class: 'btn-row', style: 'margin-top:16px' },
      h('button', { onclick: () => { patch({ name: hull.name }); navigate('simulation'); } }, '完成，去仿真'),
      h('input', {
        value: hull.name,
        style: 'max-width:260px',
        onchange: (e: Event) => patch({ name: (e.target as HTMLInputElement).value }),
      }),
    ),
  );

  const viewsCard = h('div', { class: 'card' },
    h('h2', {}, '三视图（站线 0=艉，20=艏）'),
    h('div', { class: 'three-view' },
      h('div', { class: 'canvas-wrap' }, h('h3', {}, '侧视图（纵剖）'), sideCanvas),
      h('div', { class: 'canvas-wrap' }, h('h3', {}, '俯视图（水线）'), planCanvas),
      h('div', { class: 'canvas-wrap', style: 'grid-column:1/3' }, h('h3', {}, '横剖面图（典型站）'), bodyCanvas),
    ),
  );

  const metricsCard = h('div', { class: 'card' },
    h('h2', {}, '几何核算'),
    h('div', { class: 'grid-3' }, volMetric, cbMetric, lcbMetric),
    h('p', { class: 'muted', style: 'margin-top:10px' },
      `目标 Cb=${hull.blockCoeff}，由面积曲线数值积分反推保证实际 Cb 收敛；排水体积按梯形法沿 21 站积分。`),
  );

  root.append(
    h('div', { style: 'display:grid;grid-template-columns:380px 1fr;gap:16px;align-items:start' },
      h('div', {}, dimCard, shapeCard),
      h('div', {}, metricsCard, viewsCard),
    ),
  );
  redraw();
}
