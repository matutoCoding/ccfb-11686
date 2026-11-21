// 页面 3：工况设置（船速、水深、弗劳德数、压力源、实测回填）
import { store } from '../../core/store';
import type { TestCondition, MeasuredCut } from '../../core/types';
import { h, clear, labeledField, numberInput, slider } from '../dom';
import { navigate } from '../router';
import {
  depthFroude,
  lengthFroude,
  theoreticalWakeHalfAngle,
  KELVIN_HALF_ANGLE_DEEP,
} from '../../core/physics';
import { uid } from '../../core/storage';

export function renderConditionPage(root: HTMLElement) {
  clear(root);
  const project = store.activeProject();
  if (!project) {
    root.append(h('div', { class: 'empty' }, '请先选择或创建方案。'));
    return;
  }
  const hull = store.getHull(project.hullId)!;
  const conds = store.data.conditions.filter((c) => project.conditionIds.includes(c.id));
  const cond = store.activeCondition() ?? conds[0];

  root.append(
    h('h1', { class: 'page-title' }, '水池试验工况'),
    h('p', { class: 'page-sub' }, `方案「${project.name}」· 船型「${hull.name}」（Lpp=${hull.lengthBP}m）。同一船型可挂多组工况，弗劳德数随船速/水深实时计算。`),
  );

  if (!cond) {
    root.append(
      h('div', { class: 'empty' }, '当前方案还没有工况。',
        h('div', { style: 'margin-top:14px' },
          h('button', { class: 'primary', onclick: () => { store.addCondition(project.id); } }, '＋ 新建工况'))),
    );
    return;
  }

  // —— 工况切换标签 ——
  const tabs = h('div', { class: 'btn-row', style: 'margin-bottom:16px;flex-wrap:wrap' });
  conds.forEach((c) => {
    tabs.append(h('button', {
      class: c.id === cond.id ? 'primary small' : 'small',
      onclick: () => store.setActive(project.id, c.id),
    }, c.name));
  });
  tabs.append(
    h('button', { class: 'small', onclick: () => store.addCondition(project.id) }, '＋ 新工况'),
    h('button', {
      class: 'small danger',
      onclick: () => { if (confirm(`删除工况「${cond.name}」？`)) store.removeCondition(project.id, cond.id); },
    }, '删除'),
  );
  root.append(tabs);

  const frL = lengthFroude(cond.speed, hull.lengthBP);
  const frH = depthFroude(cond.speed, cond.waterDepth);
  const theoryAngle = theoreticalWakeHalfAngle(cond.waterDepth, cond.speed);

  const metricFrL = metric('长度弗劳德数 Fr_L', frL.toFixed(4), 'U/√(gL)');
  const metricFrH = metric('水深弗劳德数 Fr_h', frH.toFixed(4), frH >= 1 ? '超临界' : 'U/√(gh)', frH >= 1 ? 'warn' : frH > 0.8 ? 'warn' : 'good');
  const metricAngle = metric('理论尾迹半角', theoryAngle.toFixed(2) + '°',
    frH < 0.1 ? `深水极限 ${KELVIN_HALF_ANGLE_DEEP.toFixed(2)}°` : '有限水深');

  function metric(k: string, v: string, u: string, cls = '') {
    return h('div', { class: 'metric' }, h('div', { class: 'k' }, k),
      h('div', { class: `v ${cls}` }, v, ' ', h('span', { class: 'u' }, u)));
  }

  function patch(p: Partial<TestCondition>) {
    store.updateCondition(cond.id, p);
    renderConditionPage(root);
  }

  const paramsCard = h('div', { class: 'card' },
    h('h2', {}, '工况参数'),
    h('div', { class: 'grid-2' },
      labeledField('工况名称', h('input', { value: cond.name, onchange: (e: Event) => patch({ name: (e.target as HTMLInputElement).value }) })),
      labeledField('备注', h('input', { value: cond.notes ?? '', placeholder: '例如第 3 水池档期', onchange: (e: Event) => patch({ notes: (e.target as HTMLInputElement).value }) })),
      labeledField('船速 U (m/s)', numberInput(cond.speed, 0.1, (v) => patch({ speed: Math.max(0.05, v) }), 0.05, 20)),
      labeledField('水深 h (m)', numberInput(cond.waterDepth, 0.5, (v) => patch({ waterDepth: Math.max(0.1, v) }), 0.1, 500),
        `h/T=${(cond.waterDepth / hull.draft).toFixed(2)}，<3 为浅水`),
    ),
    h('div', { class: 'grid-3', style: 'margin-top:14px' }, metricFrL, metricFrH, metricAngle),
    h('p', { class: 'muted', style: 'margin-top:10px' },
      `深水判据 Fr_h<0.1；Fr_h→1 时尾迹半角由 19.47° 增大趋近 90°。当前理论值由色散关系 ω²=gk·tanh(kh) 驻相解数值求得。`),
  );

  const pressureCard = h('div', { class: 'card' },
    h('h2', {}, '等效移动压力源'),
    h('p', { class: 'muted', style: 'margin-top:0' }, '船体在势流近似下等效为随船高斯压力斑 p=p₀·exp(…)，p₀ 以等效压力水头 p₀/ρg（米）表示。'),
    h('div', { class: 'grid-3' },
      labeledField('压力幅值水头 (m)', slider(cond.pressureAmp, 0.05, 5, 0.05, (v) => patch({ pressureAmp: v }))),
      labeledField('纵向尺度 σx/L', slider(cond.pressureLength, 0.04, 0.4, 0.01, (v) => patch({ pressureLength: v })),
        `σx=${(cond.pressureLength * hull.lengthBP).toFixed(2)}m`),
      labeledField('横向尺度 σz/B', slider(cond.pressureWidth, 0.2, 1.5, 0.05, (v) => patch({ pressureWidth: v })),
        `σz=${(cond.pressureWidth * hull.beam).toFixed(2)}m`),
    ),
  );

  // —— 实测回填 ——
  const measuredCard = renderMeasured(cond, patch);

  root.append(
    h('div', { style: 'display:grid;grid-template-columns:1fr 360px;gap:16px;align-items:start' },
      h('div', {}, paramsCard, pressureCard),
      h('div', {}, measuredCard),
    ),
    h('div', { class: 'btn-row' },
      h('button', { class: 'primary', onclick: () => navigate('simulation') }, '应用并进入仿真 →'),
      h('button', { onclick: () => navigate('analysis') }, '波形分析页 →'),
    ),
  );
}

function renderMeasured(cond: TestCondition, patch: (p: Partial<TestCondition>) => void) {
  const list = h('div', { class: 'probe-list' });
  const cuts = cond.measured ?? [];

  function refresh() {
    list.innerHTML = '';
    if (cuts.length === 0) {
      list.append(h('div', { class: 'muted', style: 'padding:8px 2px' }, '尚无实测剖面。可手动添加或导入 CSV。'));
    }
    for (const cut of cuts) {
      list.append(h('div', { class: 'probe-item' },
        h('div', { style: 'flex:1;min-width:0' },
          h('div', {}, cut.label),
          h('div', { class: 'muted' }, `y=${cut.yOffset}m · ${cut.values.length} 点 · dx=${cut.dx}m`),
        ),
        h('button', {
          class: 'small danger',
          onclick: () => patch({ measured: cuts.filter((c) => c.id !== cut.id) }),
        }, '删'),
      ));
    }
  }

  const fileInput = h('input', { type: 'file', accept: '.csv,.txt', style: 'display:none' }) as HTMLInputElement;
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseMeasuredCsv(text);
      if (parsed.length === 0) throw new Error('未解析到有效数据行');
      patch({ measured: [...cuts, ...parsed] });
      alert(`导入 ${parsed.length} 条实测剖面成功。`);
    } catch (e) {
      alert('CSV 解析失败：' + (e as Error).message + '\n格式：x_m,eta_m（单条纵剖）或带 y_offset_m 列的多条合并格式。');
    }
    fileInput.value = '';
  });

  const card = h('div', { class: 'card' },
    h('h2', {}, '实测波高回填'),
    list,
    h('div', { class: 'btn-row', style: 'margin-top:12px' },
      h('button', {
        class: 'small',
        onclick: () => {
          const y = parseFloat(prompt('纵剖线横向位置 y（米，相对船中纵剖面）', '4.8') || 'NaN');
          const dx = parseFloat(prompt('采样间距 dx（米）', '1') || 'NaN');
          const raw = prompt('粘贴实测波高（米），逗号或空格分隔');
          if (!Number.isFinite(y) || !Number.isFinite(dx) || !raw) return;
          const values = raw.split(/[\s,]+/).map(parseFloat).filter(Number.isFinite);
          if (values.length < 2) return alert('至少需要 2 个数据点');
          const cut: MeasuredCut = {
            id: uid('meas'), label: `y/L=${(y / 48).toFixed(3)}`, yOffset: y,
            xStart: -values.length * dx / 2, dx, values, measuredAt: Date.now(),
          };
          patch({ measured: [...cuts, cut] });
        },
      }, '＋ 手动录入'),
      h('button', { class: 'small', onclick: () => fileInput.click() }, '导入 CSV'),
      h('button', {
        class: 'small ghost',
        onclick: () => {
          const tpl = 'x_m,eta_m\n-10,0.012\n-9,0.031\n-8,-0.008\n-7,-0.045\n-6,-0.021\n-5,0.028';
          const blob = new Blob([tpl], { type: 'text/csv' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'measured_template.csv';
          a.click();
        },
      }, '模板'),
    ),
    h('p', { class: 'muted', style: 'margin-top:10px' }, '实测数据随工况保存在浏览器本地，分析页与仿真剖面同图叠合。'),
  );
  refresh();
  return card;
}

/** 解析实测 CSV：支持 x_m,eta_m 两列，或 x_m,y_offset_m,eta_m 三列 */
export function parseMeasuredCsv(text: string): MeasuredCut[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (lines.length < 2) throw new Error('数据行不足');
  const first = lines[0].split(/[,;\s]+/).map((s) => s.toLowerCase());
  const hasHeader = first.some((s) => s.includes('x') || s.includes('eta'));
  const cols = first.length;
  const dataLines = hasHeader ? lines.slice(1) : lines;

  if (cols <= 2) {
    const pts = dataLines.map((l) => l.split(/[,;\s]+/).map(parseFloat)).filter((p) => p.length >= 2 && p.every(Number.isFinite));
    if (pts.length < 2) throw new Error('有效点不足');
    const dx = Math.abs(pts[1][0] - pts[0][0]);
    return [{
      id: uid('meas'),
      label: `导入剖面 ${new Date().toLocaleTimeString('zh-CN')}`,
      yOffset: 0,
      xStart: pts[0][0],
      dx,
      values: pts.map((p) => p[1]),
      measuredAt: Date.now(),
    }];
  }
  // 三列按 y 分组
  const groups = new Map<number, { x: number; eta: number }[]>();
  for (const l of dataLines) {
    const [x, y, eta] = l.split(/[,;\s]+/).map(parseFloat);
    if (![x, y, eta].every(Number.isFinite)) continue;
    if (!groups.has(y)) groups.set(y, []);
    groups.get(y)!.push({ x, eta });
  }
  return [...groups.entries()].map(([y, pts]) => ({
    id: uid('meas'),
    label: `y=${y}m`,
    yOffset: y,
    xStart: pts[0].x,
    dx: Math.abs(pts[1]?.x - pts[0].x || 1),
    values: pts.map((p) => p.eta),
    measuredAt: Date.now(),
  }));
}
