// 页面 5：波形分析（纵剖面仿真/实测叠合、Radon 尾迹角、理论曲线、CSV）
import { store } from '../../core/store';
import { h, clear } from '../dom';
import { navigate } from '../router';
import {
  listSnapshotMeta,
  getSnapshot,
  deleteSnapshot,
} from '../../core/storage';
import type { SnapshotMeta, MeasuredCut } from '../../core/types';
import {
  extractLongitudinalProfile,
  measureWakeAngleSpectral,
  profilesToCsv,
  downloadTextFile,
} from '../../core/analysis';
import type { ProfileResult } from '../../core/analysis';
import { drawLineChart } from '../chart';
import {
  KELVIN_HALF_ANGLE_DEEP,
  theoreticalWakeHalfAngle,
  theoreticalWakeCurve,
  depthFroude,
} from '../../core/physics';

export function renderAnalysisPage(root: HTMLElement) {
  clear(root);
  const project = store.activeProject();
  const cond = store.activeCondition();

  root.append(
    h('h1', { class: 'page-title' }, '波形分析'),
    h('p', { class: 'page-sub' }, '从仿真快照沿船长提取波高纵剖面，与回填实测叠合；Radon 变换测量尾迹半角并与有限水深理论值对比。'),
  );
  if (!project || !cond) {
    root.append(h('div', { class: 'empty' }, '请先选择方案与工况。',
      h('div', { style: 'margin-top:12px' }, h('button', { class: 'primary', onclick: () => navigate('projects') }, '去方案列表'))));
    return;
  }

  const snapListEl = h('div', { class: 'probe-list' });
  const probeCard = h('div', { class: 'card' },
    h('h2', {}, '快照库（IndexedDB）'),
    snapListEl,
  );

  const profileCanvas = h('canvas', { class: 'chart', style: 'height:340px' }) as HTMLCanvasElement;
  const energyCanvas = h('canvas', { class: 'chart', style: 'height:300px' }) as HTMLCanvasElement;
  const theoryCanvas = h('canvas', { class: 'chart', style: 'height:300px' }) as HTMLCanvasElement;

  const resultMetrics = h('div', { class: 'grid-3' });
  const probeControls = h('div', { class: 'card' },
    h('h2', {}, '纵剖面探测线'),
    h('div', { class: 'btn-row', style: 'margin-bottom:10px' },
      h('button', { class: 'small', onclick: () => addProbe(2) }, '＋ y=+2m'),
      h('button', { class: 'small', onclick: () => addProbe(4.8) }, '＋ y=+4.8m'),
      h('button', { class: 'small', onclick: () => addProbe(-4.8) }, '＋ y=-4.8m'),
      h('button', { class: 'small ghost', onclick: () => { probes.clear(); refreshProbes(); runAnalysis(); } }, '清空'),
    ),
    h('div', { id: 'probe-list', class: 'probe-list' }),
  );

  const chartCard = h('div', { class: 'card' },
    h('h2', {}, '沿船长波高剖面（仿真 vs 实测）'),
    h('div', { class: 'legend' },
      h('span', {}, h('i', { style: 'background:var(--sim)' }), '仿真'),
      h('span', {}, h('i', { style: 'background:var(--meas)' }), '实测回填'),
    ),
    h('div', { class: 'canvas-wrap' }, profileCanvas),
    h('div', { class: 'btn-row', style: 'margin-top:12px' },
      h('button', { class: 'primary small', onclick: exportCsv }, '导出 CSV'),
      h('button', { class: 'small', onclick: runAnalysis }, '重新分析'),
    ),
  );

  const angleCard = h('div', { class: 'card' },
    h('h2', {}, '开尔文尾迹半角测量'),
    resultMetrics,
    h('div', { class: 'canvas-wrap', style: 'margin-top:14px' }, energyCanvas),
    h('div', { class: 'canvas-wrap', style: 'margin-top:14px' }, theoryCanvas),
  );

  root.append(
    h('div', { style: 'display:grid;grid-template-columns:320px 1fr;gap:16px;align-items:start' },
      h('div', {}, probeCard, probeControls),
      h('div', {}, chartCard, angleCard),
    ),
  );

  const probes = new Set<number>([2, 4.8]);
  let selectedSnap: SnapshotMeta | null = null;
  let lastProfiles: ProfileResult[] = [];

  function addProbe(y: number) {
    probes.add(y);
    refreshProbes();
    runAnalysis();
  }
  function refreshProbes() {
    const el = probeControls.querySelector('#probe-list')!;
    el.innerHTML = '';
    for (const y of [...probes].sort((a, b) => a - b)) {
      el.append(h('div', { class: 'probe-item' },
        h('span', { class: 'mono', style: 'flex:1' }, `y = ${y} m`),
        h('button', { class: 'small danger', onclick: () => { probes.delete(y); refreshProbes(); runAnalysis(); } }, '删'),
      ));
    }
  }

  async function loadSnapshots() {
    const all = await listSnapshotMeta();
    const mine = all.filter((s) => s.conditionId === cond!.id || project!.conditionIds.includes(s.conditionId));
    snapListEl.innerHTML = '';
    if (mine.length === 0) {
      snapListEl.append(h('div', { class: 'muted', style: 'padding:6px' }, '暂无快照，请先在仿真页点击「存快照」。'));
      return;
    }
    for (const s of mine) {
      snapListEl.append(h('div', {
        class: 'probe-item',
        style: selectedSnap?.id === s.id ? 'border-color:var(--accent)' : '',
      },
        h('div', { style: 'flex:1;cursor:pointer', onclick: () => { selectedSnap = s; loadSnapshots(); runAnalysis(); } },
          h('div', {}, new Date(s.createdAt).toLocaleString('zh-CN')),
          h('div', { class: 'muted' }, `t=${s.simTime.toFixed(1)}s ${s.gridN}² Fr_h=${s.depthFroude.toFixed(3)}`),
        ),
        h('button', {
          class: 'small danger',
          onclick: async () => {
            if (confirm('删除该快照？')) {
              await deleteSnapshot(s.id);
              if (selectedSnap?.id === s.id) selectedSnap = null;
              loadSnapshots();
            }
          },
        }, '删'),
      ));
    }
    if (!selectedSnap) selectedSnap = mine[0];
  }

  async function runAnalysis() {
    if (!selectedSnap) {
      drawEmpty(profileCanvas, '请选择快照');
      drawEmpty(energyCanvas, '请选择快照');
      drawEmpty(theoryCanvas, '请选择快照');
      return;
    }
    const bundle = await getSnapshot(selectedSnap.id);
    if (!bundle) return;
    const { heights, gridN, domainLength } = bundle;

    // 船位直接取自快照元数据（引擎写入时的精确位置）；兼容旧快照的回退估算
    const shipZ = bundle.shipZ ?? domainLength * 0.5;
    const shipX = bundle.shipX ?? Math.min(
      domainLength * 0.25 + bundle.speed * bundle.simTime,
      domainLength * 0.82,
    );

    // —— 纵剖面 ——
    const windowM = Math.min(domainLength * 0.35, 60);
    lastProfiles = [...probes].sort((a, b) => a - b).map((y) =>
      extractLongitudinalProfile(heights, gridN, domainLength, shipX, shipZ, y, windowM));

    const palette = ['#2f81f7', '#27d0a4', '#b48cf2', '#5cc8ef'];
    const series = lastProfiles.map((p, i) => ({
      label: `仿真 y=${p.yOffset}m`,
      color: palette[i % palette.length],
      x: p.x,
      y: p.eta,
      width: 1.6,
    }));

    // 实测叠合：重采样到仿真 x 网格
    const measured = (cond!.measured ?? []) as MeasuredCut[];
    const measSeries = measured.map((m, mi) => {
      const xs = new Float32Array(m.values.length);
      for (let i = 0; i < m.values.length; i++) xs[i] = m.xStart + i * m.dx;
      return {
        label: `实测 ${m.label}`,
        color: '#f0a848',
        x: xs,
        y: Float32Array.from(m.values),
        dashed: true,
        width: 2,
      };
    }).filter((_, i) => i < 4);

    drawLineChart(profileCanvas, [...series, ...measSeries], {
      title: `波高 η 纵剖面（快照 t=${bundle.simTime.toFixed(1)}s）`,
      xLabel: '相对船位 x', xUnit: 'm',
      yLabel: '波高 η', yUnit: 'm',
    });

    // —— Radon 尾迹角 ——
    const wake = measureWakeAngleSpectral(heights, gridN, domainLength, shipX, shipZ);
    const theoryNow = theoreticalWakeHalfAngle(bundle.waterDepth, bundle.speed);
    const frH = depthFroude(bundle.speed, bundle.waterDepth);
    const dev = Math.abs(wake.halfAngleDeg - theoryNow);

    resultMetrics.innerHTML = '';
    resultMetrics.append(
      metricBlock('Radon 测得半角', wake.halfAngleDeg.toFixed(2) + '°', dev < 1 ? 'good' : 'warn'),
      metricBlock('理论半角（有限水深）', theoryNow.toFixed(2) + '°', frH < 0.1 ? '' : 'warn'),
      metricBlock('偏差', dev.toFixed(2) + '°', dev < 1 ? 'good' : 'warn'),
    );

    drawLineChart(energyCanvas, [{
      label: 'Radon 积分能量',
      color: '#2f81f7',
      x: Float32Array.from(wake.energyCurve.map((p) => p.angleDeg)),
      y: Float32Array.from(wake.energyCurve.map((p) => p.energy)),
    }], {
      title: `${wake.peakDetail}；深水理论 ${KELVIN_HALF_ANGLE_DEEP.toFixed(2)}°`,
      xLabel: '射线半角 ψ', xUnit: '°',
      yLabel: '归一化能量',
      markers: [
        { x: wake.halfAngleDeg, label: `实测 ${wake.halfAngleDeg.toFixed(1)}°`, color: '#27d0a4' },
        { x: theoryNow, label: `理论 ${theoryNow.toFixed(1)}°`, color: '#f0a848' },
      ],
    });

    // —— 理论 ψ(χ) 曲线 ——
    const curve = theoreticalWakeCurve(bundle.waterDepth, bundle.speed);
    drawLineChart(theoryCanvas, [{
      label: '理论射线角 ψ(χ)',
      color: '#f0a848',
      x: Float32Array.from(curve.map((p) => p.chiDeg)),
      y: Float32Array.from(curve.map((p) => p.psiDeg)),
    }], {
      title: `有限水深驻相解（Fr_h=${frH.toFixed(3)}），曲线最大值=理论尾迹半角`,
      xLabel: '波数矢角 χ', xUnit: '°',
      yLabel: '射线角 ψ', yUnit: '°',
      markers: [{ x: 35.26, label: '深水 χ*=35.26°', color: '#5f7a90' }],
    });
  }

  function metricBlock(k: string, v: string, cls: string) {
    return h('div', { class: 'metric' }, h('div', { class: 'k' }, k),
      h('div', { class: `v ${cls}` }, v));
  }

  function drawEmpty(c: HTMLCanvasElement, text: string) {
    const dpr = devicePixelRatio || 1;
    const W = c.clientWidth || 600;
    const H = c.clientHeight || 300;
    c.width = W * dpr;
    c.height = H * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#5f7a90';
    ctx.font = '14px "Microsoft YaHei"';
    ctx.textAlign = 'center';
    ctx.fillText(text, W / 2, H / 2);
  }

  function exportCsv() {
    if (lastProfiles.length === 0) {
      alert('请先选择快照并分析。');
      return;
    }
    const meas = (cond!.measured ?? []).map((m) => ({
      label: m.label,
      x: Float32Array.from(m.values.map((_, i) => m.xStart + i * m.dx)),
      eta: Float32Array.from(m.values),
    }));
    const csv = profilesToCsv(lastProfiles, meas, {
      方案: project!.name,
      工况: cond!.name,
      船速: `${cond!.speed} m/s`,
      水深: `${cond!.waterDepth} m`,
      快照时间: selectedSnap ? `${selectedSnap.simTime.toFixed(1)} s` : '-',
      网格: `${selectedSnap?.gridN ?? '-'}`,
    });
    downloadTextFile(`wave_profiles_${cond!.name}_${Date.now()}.csv`, csv);
  }

  refreshProbes();
  void loadSnapshots().then(runAnalysis);
}
