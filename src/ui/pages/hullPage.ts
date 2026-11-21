// 页面 2: 船型编辑(主尺度 + 型线参数 + 三视图)
import { h, clear, numInput, labeledField } from '../dom.ts';
import { store } from '../../state/store.ts';
import { achievedBlockCoefficient } from '../../core/hull.ts';
import { drawHullViews } from '../hullViews.ts';
import type { HullSpec } from '../../core/types.ts';

export function renderHullPage(root: HTMLElement, hullId: string, go: (p: string) => void): void {
  clear(root);
  const hull = store.data.hulls.find((x) => x.id === hullId);
  if (!hull) {
    root.append(h('p', {}, '船型不存在'), h('button', { onclick: () => go('project') }, '返回列表'));
    return;
  }

  const patch = (p: Partial<HullSpec>) => store.updateHull(hull.id, p);
  let viewCanvas: HTMLCanvasElement;

  const redraw = () => {
    const latest = store.data.hulls.find((x) => x.id === hull.id)!;
    drawHullViews(viewCanvas, latest);
    achievedEl.textContent = `实际方型系数 Cb ≈ ${achievedBlockCoefficient(latest).toFixed(3)} (目标 ${latest.Cb.toFixed(2)})`;
  };

  const sub = store.subscribe(redraw);
  window.setTimeout(redraw, 0);

  const achievedEl = h('div', { class: 'muted', style: 'margin-top:8px' });

  root.append(
    h('h2', { class: 'page-title' }, '船型编辑'),
    h('p', { class: 'page-sub' }, '主尺度与型线系数参数化生成横剖面/水线; 修改后三视图实时刷新。'),
    h('div', { class: 'card' },
      h('h3', {}, '基本信息与主尺度'),
      h('div', { class: 'grid-3' },
        labeledField('方案名称', (() => {
          const inp = h('input', { value: hull.name });
          inp.addEventListener('change', () => patch({ name: inp.value }));
          return inp;
        })()),
        labeledField('垂线间长 Lpp (m)', numInput(hull.Lpp, (v) => patch({ Lpp: v }), { min: 1, step: 0.1 })),
        labeledField('型宽 B (m)', numInput(hull.B, (v) => patch({ B: v }), { min: 0.2, step: 0.05 })),
        labeledField('设计吃水 T (m)', numInput(hull.T, (v) => patch({ T: v }), { min: 0.1, step: 0.05 })),
        labeledField('方型系数 Cb', numInput(hull.Cb, (v) => patch({ Cb: clamp(v, 0.4, 0.85) }), { min: 0.4, max: 0.85, step: 0.01 })),
        labeledField('中横剖面系数 Cm', numInput(hull.Cm, (v) => patch({ Cm: clamp(v, 0.7, 0.98) }), { min: 0.7, max: 0.98, step: 0.01 })),
        labeledField('水线面系数 Cwp', numInput(hull.Cwp, (v) => patch({ Cwp: clamp(v, 0.6, 0.95) }), { min: 0.6, max: 0.95, step: 0.01 })),
        labeledField('纵向浮心 LCB (%Lpp)', numInput(hull.LCB, (v) => patch({ LCB: clamp(v, -3, 3) }), { min: -3, max: 3, step: 0.1 })),
      ),
    ),
    h('div', { class: 'card' },
      h('h3', {}, '型线参数'),
      h('div', { class: 'grid-3' },
        sliderField('横剖面形状 (V→U)', hull.sectionShape, (v) => patch({ sectionShape: v })),
        sliderField('球鼻艏强度', hull.bulb, (v) => patch({ bulb: v })),
        sliderField('方艉宽度系数', hull.transom, (v) => patch({ transom: v })),
      ),
      achievedEl,
    ),
    h('div', { class: 'card' },
      h('h3', {}, '三视图'),
      h('div', { class: 'canvas-wrap' },
        (viewCanvas = h('canvas', { style: 'height:560px' })),
      ),
    ),
    h('div', { class: 'row' },
      h('button', { onclick: () => go('project') }, '返回方案列表'),
    ),
  );

  // 离开页面时取消订阅
  const observer = new MutationObserver(() => {
    if (!document.body.contains(root)) { sub(); observer.disconnect(); }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function sliderField(label: string, value: number, onInput: (v: number) => void): HTMLElement {
  const inp = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value });
  const val = h('span', { class: 'muted' }, value.toFixed(2));
  inp.addEventListener('input', () => {
    const v = parseFloat(inp.value);
    val.textContent = v.toFixed(2);
    onInput(v);
  });
  return h('label', { class: 'field' },
    h('span', { class: 'field-label' }, label),
    h('div', { class: 'row' }, inp, val),
  );
}
