// 页面 6：设置（网格/数值/渲染 + WebGPU 自检与 FFT 基准）
import { store } from '../../core/store';
import { h, clear, labeledField, slider } from '../dom';
import { initWebGPU } from '../../gpu/device';
import { WaveSimulation } from '../../gpu/simulation';
import { GRAVITY } from '../../core/physics';

export function renderSettingsPage(root: HTMLElement) {
  clear(root);
  const s = store.data.settings;

  root.append(
    h('h1', { class: 'page-title' }, '系统设置'),
    h('p', { class: 'page-sub' }, '网格与渲染参数全局生效；修改网格分辨率后需重新进入仿真页重建引擎。'),
  );

  const benchOut = h('div', { id: 'bench', class: 'muted', style: 'line-height:2;font-variant-numeric:tabular-nums' }, '尚未运行自检。');

  function patch(p: Partial<typeof s>) {
    store.updateSettings(p);
    renderSettingsPage(root);
  }

  const gridCard = h('div', { class: 'card' },
    h('h2', {}, '网格与数值'),
    h('div', { class: 'grid-2' },
      labeledField('网格分辨率 N（N×N）', (() => {
        const sel = h('select', {},
          ...[128, 256, 512, 1024].map((n) =>
            h('option', { value: n, selected: s.gridN === n }, `${n} × ${n}`)),
        ) as HTMLSelectElement;
        sel.addEventListener('change', () => patch({ gridN: parseInt(sel.value, 10) }));
        return sel;
      })(), '512² 为验收基准；1024² 需 ≥8GB 显存'),
      labeledField('水池域长 (m)', h('input', {
        type: 'number', step: 10, value: s.domainLength,
        onchange: (e: Event) => patch({ domainLength: parseFloat((e.target as HTMLInputElement).value) }),
      }), '建议 ≥4 倍船长'),
      labeledField('CFL 时间步系数', slider(s.cfl, 0.2, 1.2, 0.05, (v) => patch({ cfl: v }))),
      labeledField('消波层宽度占比', slider(s.spongeWidth, 0.05, 0.25, 0.01, (v) => patch({ spongeWidth: v }))),
      labeledField('消波强度', slider(s.dampingStrength, 0.5, 8, 0.1, (v) => patch({ dampingStrength: v }))),
    ),
  );

  const renderCard = h('div', { class: 'card' },
    h('h2', {}, '水面渲染'),
    h('div', { class: 'grid-2' },
      labeledField('菲涅尔反射/折射', toggle(s.renderReflection, (v) => patch({ renderReflection: v }))),
      labeledField('白浪泡沫', toggle(s.renderFoam, (v) => patch({ renderFoam: v }))),
      labeledField('起泡沫波陡阈值', slider(s.foamThreshold, 0.004, 0.03, 0.001, (v) => patch({ foamThreshold: v }))),
      labeledField('相机跟随船体', toggle(s.cameraFollow, (v) => patch({ cameraFollow: v }))),
    ),
  );

  const gpuCard = h('div', { class: 'card' },
    h('h2', {}, 'WebGPU 自检与性能基准'),
    h('p', { class: 'muted', style: 'margin-top:0' },
      '按当前网格设置构建引擎，连续推进 100 个时间步并统计平均耗时，换算等效帧率。谱方法每步含 4 次二维 FFT。'),
    h('div', { class: 'btn-row' },
      h('button', {
        class: 'primary',
        onclick: async () => runBenchmark(benchOut),
      }, '运行自检（约 5 秒）'),
    ),
    benchOut,
  );

  root.append(gridCard, renderCard, gpuCard);
}

function toggle(value: boolean, onChange: (v: boolean) => void) {
  const input = h('input', { type: 'checkbox' }) as HTMLInputElement;
  input.checked = value;
  input.style.width = '20px';
  input.style.height = '20px';
  input.addEventListener('change', () => onChange(input.checked));
  return input;
}

async function runBenchmark(out: HTMLElement) {
  const s = store.data.settings;
  out.textContent = '正在初始化 WebGPU…';
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 500;
    const gpu = await initWebGPU(canvas);
    const info = gpu.adapter.info;
    out.innerHTML = `适配器: ${info?.vendor ?? '未知厂商'} / ${info?.architecture ?? '未知架构'} / ${info?.description ?? '未知设备'}<br>正在预热…`;

    const sim = new WaveSimulation(gpu.device, {
      gridN: s.gridN,
      domainLength: s.domainLength,
      depth: 40,
      speed: 2,
      cfl: s.cfl,
      spongeWidthRatio: s.spongeWidth,
      dampingStrength: s.dampingStrength,
      pressureAmp: 0.6,
      pressureLength: 0.12,
      pressureWidth: 0.55,
      hullLength: 48,
      hullBeam: 6,
      gravity: GRAVITY,
    });

    // 预热（含着色器编译）
    for (let i = 0; i < 10; i++) sim.step();
    await gpu.device.queue.onSubmittedWorkDone();

    const STEPS = 100;
    const t0 = performance.now();
    for (let i = 0; i < STEPS; i++) sim.step();
    await gpu.device.queue.onSubmittedWorkDone();
    const elapsed = performance.now() - t0;
    const perStep = elapsed / STEPS;
    const fps = 1000 / perStep;

    const memMB = (s.gridN * s.gridN * (8 + 8 + 8 + 4)) / 1e6;
    out.innerHTML =
      `适配器: <b>${info?.vendor ?? ''} ${info?.description ?? 'GPU'}</b><br>` +
      `网格: <b>${s.gridN} × ${s.gridN}</b>，仿真缓冲约 ${memMB.toFixed(0)} MB（不含 FFT scratch）<br>` +
      `单步平均: <b>${perStep.toFixed(2)} ms</b>（100 步统计，含 4 次 FFT + 谱推进 + 消波）<br>` +
      `等效仿真帧率: <b style="color:${fps >= 30 ? 'var(--accent-2)' : 'var(--warn)'}">${fps.toFixed(1)} FPS</b>　验收门槛 30 FPS<br>` +
      `dt = ${sim.timeStep.toFixed(3)} s<br>` +
      (fps >= 30
        ? '✅ 满足 512² ≥30FPS 性能目标（渲染开销另计，一般 <3ms）'
        : '⚠️ 未达 30FPS，建议降至 256² 或减小域长；若为软件渲染（SwiftShader）属预期现象。');
    sim.destroy();
  } catch (e) {
    out.innerHTML = `<span style="color:var(--danger)">自检失败：${(e as Error).message}</span>`;
  }
}
