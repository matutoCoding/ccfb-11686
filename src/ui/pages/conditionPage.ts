// 页面 3: 工况设置(船速/水深/压力源 + 实测波高回填)
import { h, clear, numInput, labeledField } from '../dom.ts';
import { store } from '../../state/store.ts';
import { computeSimNumbers } from '../../core/physics.ts';
import { uid } from '../../core/types.ts';
import type { TrialCondition, MeasuredProfile } from '../../core/types.ts';

export function renderConditionPage(root: HTMLElement, condId: string, go: (p: string, id?: string) => void): void {
  clear(root);
  const cond = store.data.conditions.find((c) => c.id === condId);
  if (!cond) {
    root.append(h('p', {}, '工况不存在'), h('button', { onclick: () => go('project') }, '返回'));
    return;
  }
  const hull = store.data.hulls.find((x) => x.id === cond.hullId)!;
  const patch = (p: Partial<TrialCondition>) => store.updateCondition(cond.id, p);

  const stats = () => computeSimNumbers(cond.speedKnots, hull.Lpp, cond.deepWater, cond.waterDepth);

  const statBox = h('div', { class: 'stat-row' });
  const fillStats = () => {
    const n = stats();
    statBox.replaceChildren(
      stat(n.speedMps.toFixed(3), '船速 V (m/s)'),
      stat(n.frLength.toFixed(4), '长度弗劳德数 Fr'),
      stat(cond.deepWater ? '∞' : n.fhDepth.toFixed(4), '水深弗劳德数 Fh'),
      stat(regimeLabel(n.regime), '流态'),
    );
  };

  root.append(
    h('h2', { class: 'page-title' }, `工况设置 — ${cond.name}`),
    h('p', { class: 'page-sub' }, `所属船型: ${hull.name} (Lpp ${hull.Lpp}m)`),
    h('div', { class: 'card' },
      h('h3', {}, '航行参数'),
      h('div', { class: 'grid-3' },
        labeledField('工况名称', (() => {
          const inp = h('input', { value: cond.name });
          inp.addEventListener('change', () => patch({ name: inp.value }));
          return inp;
        })()),
        labeledField('船速 (节)', numInput(cond.speedKnots, (v) => patch({ speedKnots: v }), { min: 0, step: 0.1 })),
        labeledField('水深模式', (() => {
          const sel = h('select', {},
            h('option', { value: 'deep' }, '深水 (h→∞)'),
            h('option', { value: 'shallow' }, '有限水深'),
          ) as HTMLSelectElement;
          sel.value = cond.deepWater ? 'deep' : 'shallow';
          sel.addEventListener('change', () => patch({ deepWater: sel.value === 'deep' }));
          return sel;
        })()),
        labeledField('水深 h (m)', numInput(cond.waterDepth, (v) => patch({ waterDepth: v }), { min: 0.2, step: 0.1 })),
      ),
      h('div', { style: 'margin-top:16px' }, statBox),
    ),
    h('div', { class: 'card' },
      h('h3', {}, '移动压力源(仿真激励)'),
      h('div', { class: 'grid-3' },
        labeledField('压力源强度 p₀/ρ (m²/s²)', numInput(cond.pressureAmp, (v) => patch({ pressureAmp: v }), { step: 0.01 })),
        labeledField('高斯尺度 (m)', numInput(cond.sourceScale, (v) => patch({ sourceScale: v }), { min: 0.2, step: 0.1 })),
        labeledField('近场伯努利波面比例', numInput(cond.nearFieldRatio, (v) => patch({ nearFieldRatio: v }), { min: 0, max: 1, step: 0.05 })),
      ),
    ),
    renderMeasuredCard(cond),
    h('div', { class: 'row' },
      h('button', { onclick: () => go('project') }, '返回列表'),
      h('button', { onclick: () => go('sim', cond.id) }, '进入水面仿真 →'),
    ),
  );
  fillStats();
  const unsub = store.subscribe(() => fillStats());
  const observer = new MutationObserver(() => {
    if (!document.body.contains(root)) { unsub(); observer.disconnect(); }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function stat(v: string, label: string): HTMLElement {
  return h('div', { class: 'stat' }, h('div', { class: 'v' }, v), h('div', { class: 'l' }, label));
}

function regimeLabel(r: string): string {
  return { deep: '深水', subcritical: '亚临界', critical: '临界', supercritical: '超临界' }[r] ?? r;
}

function renderMeasuredCard(cond: TrialCondition): HTMLElement {
  const card = h('div', { class: 'card' });
  const list = h('div');
  const fileInput = h('input', { type: 'file', accept: '.csv,.txt' }) as HTMLInputElement;
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseCsv(String(reader.result));
      if (parsed) {
        store.addMeasured(cond.id, {
          id: uid('meas'),
          label: f.name.replace(/\.(csv|txt)$/i, ''),
          yOffset: 0,
          points: parsed,
          importedAt: Date.now(),
        });
        fileInput.value = '';
      } else alert('CSV 解析失败: 需要两列数值 x,z (可含表头)');
    };
    reader.readAsText(f);
  });

  const fill = () => {
    list.replaceChildren();
    if (!cond.measured.length) {
      list.append(h('p', { class: 'muted' }, '尚未回填实测波高。导入 CSV(列: 纵向位置 x m, 波高 z m)。'));
      return;
    }
    const table = h('table');
    table.append(h('thead', {}, h('tr', {},
      h('th', {}, '数据组'), h('th', {}, '横向偏移 y (m)'), h('th', {}, '测点数'), h('th', {}, ''))));
    const tb = h('tbody');
    for (const m of cond.measured) {
      const yInp = h('input', { type: 'number', step: 0.1, value: m.yOffset }) as HTMLInputElement;
      yInp.addEventListener('change', () => {
        const next = cond.measured.map((x) => x.id === m.id ? { ...x, yOffset: parseFloat(yInp.value) || 0 } : x);
        store.updateCondition(cond.id, { measured: next });
      });
      tb.append(h('tr', {},
        h('td', {}, m.label),
        h('td', {}, yInp),
        h('td', {}, String(m.points.length)),
        h('td', {}, h('button', {
          class: 'danger sm',
          onclick: () => store.removeMeasured(cond.id, m.id),
        }, '删除')),
      ));
    }
    table.append(tb);
    list.append(table);
  };

  card.append(
    h('h3', {}, '实测波高剖面(试验回填)'),
    list,
    h('div', { class: 'toolbar', style: 'margin-top:12px' },
      h('label', { class: 'muted' }, '导入 CSV:'),
      fileInput,
      h('button', {
        class: 'ghost sm',
        onclick: () => downloadTemplate(),
      }, '下载 CSV 模板'),
    ),
  );
  fill();
  const unsub = store.subscribe(fill);
  const observer = new MutationObserver(() => {
    if (!document.body.contains(card)) { unsub(); observer.disconnect(); }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return card;
}

/** 解析两列数值 CSV, 返回 {x,z} 序列 */
export function parseCsv(text: string): { x: number; z: number }[] | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: { x: number; z: number }[] = [];
  for (const line of lines) {
    const parts = line.split(/[,;\s]+/).map(parseFloat);
    if (parts.length < 2 || parts.some((n) => !Number.isFinite(n))) continue;
    out.push({ x: parts[0], z: parts[1] });
  }
  return out.length >= 3 ? out : null;
}

function downloadTemplate(): void {
  const csv = 'x_m,z_m\n-8,0.012\n-6,-0.034\n-4,0.058\n-2,-0.071\n0,0.022\n2,0.003\n';
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'measured_wave_profile_template.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}
