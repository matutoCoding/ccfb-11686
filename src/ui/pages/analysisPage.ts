// 页面 5: 波形分析(沿船长剖面 + 实测叠加 + 尾迹角 + CSV 导出)
import { h, clear, labeledField } from '../dom.ts';
import { store } from '../../state/store.ts';
import { buildSpectrum, measureWakeAngle, sampleProfile, type KelvinParams } from '../../core/kelvin.ts';
import { computeSimNumbers } from '../../core/physics.ts';
import { froudeSimilarSourceScale } from '../../core/hull.ts';
import { drawLineChart } from '../chart.ts';
import type { TrialCondition } from '../../core/types.ts';

export function renderAnalysisPage(root: HTMLElement, preselectId?: string): void {
  clear(root);
  const { conditions, hulls, settings } = store.data;
  root.append(
    h('h2', { class: 'page-title' }, '波形分析'),
    h('p', { class: 'page-sub' }, '沿船长方向取波高剖面, 与试验实测数据叠加对比偏差; 远场能量法测量尾迹半角。'),
  );
  if (!conditions.length) {
    root.append(h('div', { class: 'card' }, h('p', { class: 'muted' }, '请先在方案列表中创建工况。')));
    return;
  }

  const sel = h('select', {}, ...conditions.map((c) => {
    const hull = hulls.find((x) => x.id === c.hullId);
    return h('option', { value: c.id }, `${c.name} — ${hull?.name ?? ''}`);
  })) as HTMLSelectElement;
  sel.value = preselectId && conditions.some((c) => c.id === preselectId) ? preselectId : conditions[0].id;

  const yOffsetInp = h('input', { type: 'number', step: 0.2, value: 0 }) as HTMLInputElement;
  const nPtsInp = h('input', { type: 'number', step: 50, value: 400 }) as HTMLInputElement;
  const chart = h('canvas', { style: 'height:380px' }) as HTMLCanvasElement;
  const angleBox = h('div', { class: 'stat-row' });

  const run = () => {
    const cond = conditions.find((c) => c.id === sel.value)!;
    const hull = hulls.find((x) => x.id === cond.hullId)!;
    const nums = computeSimNumbers(cond.speedKnots, hull.Lpp, cond.deepWater, cond.waterDepth);
    const depth = cond.deepWater ? Infinity : cond.waterDepth;
    // 剖面谱: 使用工况真实压力源尺度, 反映绝对波高
    const profileParams: KelvinParams = {
      speedMps: nums.speedMps,
      depth,
      pressureAmp: cond.pressureAmp,
      sourceScale: cond.sourceScale,
      components: settings.spectralComponents,
      nearFieldRatio: cond.nearFieldRatio,
    };
    // 尾迹角谱: Froude 相似源尺度(以 1.2m@2m/s 为锚), 保证开尔文角尺度无关
    const angleParams: KelvinParams = {
      ...profileParams,
      sourceScale: froudeSimilarSourceScale(nums.speedMps, 1.2),
    };
    const comps = buildSpectrum(profileParams);
    const angleComps = buildSpectrum(angleParams);
    const yOff = parseFloat(yOffsetInp.value) || 0;
    const nPts = Math.max(50, parseInt(nPtsInp.value) || 400);
    const xFrom = -hull.Lpp * 2.2;
    const xTo = hull.Lpp * 0.8;
    const sim = sampleProfile(yOff, xFrom, xTo, nPts, comps, profileParams);

    const series: import('../chart.ts').Series[] = [{ label: `仿真剖面 y=${yOff.toFixed(1)}m`, color: '#4da3ff', points: sim }];
    for (const m of cond.measured) {
      series.push({
        label: `实测: ${m.label} (y=${m.yOffset}m)`,
        color: '#e8b04b',
        points: m.points,
        dashed: true,
      });
    }
    drawLineChart(chart, series, {
      title: `${cond.name} — 纵向波高剖面`,
      xLabel: 'x (m, 艏+)',
      yLabel: '波高 z (m)',
      refLines: [{ x: -hull.Lpp / 2, label: '艉' }, { x: hull.Lpp / 2, label: '艏' }],
    });

    // 尾迹角: 远场截面按特征波长 V^2/g 缩放, probe 步长随网格尺度
    const lambda0 = (nums.speedMps * nums.speedMps) / 9.80665;
    const farScale = Math.max(1, lambda0 / 0.41); // 参考工况 V=2 时 lambda0≈0.41
    const measured = measureWakeAngle(angleComps, angleParams, {
      xList: [40, 50, 60].map((x) => x * farScale),
      probeStep: 0.12 * farScale,
    });
    const deepTheory = 19.471;
    angleBox.replaceChildren(
      stat(measured.angleDeg.toFixed(2) + '°', '实测尾迹半角(能量主峰)'),
      stat(deepTheory.toFixed(2) + '°', '深水理论 cusp 角'),
      stat(
        cond.deepWater
          ? (measured.angleDeg - deepTheory).toFixed(2) + '°'
          : '浅水工况',
        '与理论值偏差',
      ),
      stat(nums.frLength.toFixed(3), '长度弗劳德数 Fr'),
    );

    // 缓存供导出
    (run as unknown as { last: unknown }).last = { sim, cond };
  };

  const exportBtn = h('button', {
    onclick: () => {
      const last = (run as unknown as { last?: { sim: { x: number; z: number }[]; cond: TrialCondition } }).last;
      if (!last) return;
      const rows = ['x_m,z_sim_m'];
      for (const p of last.sim) rows.push(`${p.x.toFixed(4)},${p.z.toFixed(6)}`);
      const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `wave_profile_${last.cond.name.replace(/\s/g, '_')}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    },
  }, '导出仿真 CSV');

  root.append(
    h('div', { class: 'card' },
      h('div', { class: 'grid-3' },
        labeledField('选择工况', sel),
        labeledField('剖面横向位置 y (m, 中线=0)', yOffsetInp),
        labeledField('采样点数', nPtsInp),
      ),
      h('div', { class: 'toolbar', style: 'margin-top:14px' },
        h('button', { onclick: run }, '计算剖面'),
        exportBtn,
      ),
    ),
    h('div', { class: 'card' }, angleBox),
    h('div', { class: 'card canvas-wrap' }, chart),
    h('div', { class: 'legend' },
      h('span', {}, h('i', { class: 'dot', style: 'background:#4da3ff' }), '仿真(谱合成)'),
      h('span', {}, h('i', { class: 'dot', style: 'background:#e8b04b' }), '实测回填(虚线)'),
    ),
  );
  run();
}

function stat(v: string, label: string): HTMLElement {
  return h('div', { class: 'stat' }, h('div', { class: 'v' }, v), h('div', { class: 'l' }, label));
}
