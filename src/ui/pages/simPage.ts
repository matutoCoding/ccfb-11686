// 页面 4: 水面仿真(WebGPU 高度场 + 菲涅尔渲染 + 白浪; 无 GPU 时 CPU 回退)
import { h, clear } from '../dom.ts';
import { store } from '../../state/store.ts';
import { requestGpu, FpsCounter } from '../../gpu/device.ts';
import { WaterSim } from '../../gpu/waterSim.ts';
import { WaterRenderer } from '../../gpu/waterRenderer.ts';
import { CpuWaterSim } from '../../gpu/cpuSim.ts';
import { CpuRenderer } from '../../gpu/cpuRenderer.ts';
import { computeSimNumbers } from '../../core/physics.ts';
import type { TrialCondition } from '../../core/types.ts';

interface Handle {
  destroy: () => void;
}

export function renderSimPage(root: HTMLElement, condId: string, go: (p: string) => void): void {
  clear(root);
  const cond = store.data.conditions.find((c) => c.id === condId);
  if (!cond) {
    root.append(h('p', {}, '工况不存在'));
    return;
  }
  const hull = store.data.hulls.find((x) => x.id === cond.hullId)!;
  const settings = store.data.settings;

  root.append(
    h('h2', { class: 'page-title' }, '水面仿真'),
    h('p', { class: 'page-sub' }, '高度场 GPU 波动方程, 船体等效为移动高斯压力源; 鼠标拖拽旋转、滚轮缩放。'),
  );

  const stage = h('div', { class: 'sim-stage card', style: 'padding:10px' });
  const canvas = h('canvas', { id: 'sim-canvas' }) as HTMLCanvasElement;
  const hud = h('div', { class: 'sim-hud' });
  const fpsBadge = h('div', { class: 'fps-badge good' }, '-- FPS');
  stage.append(canvas, hud, fpsBadge);
  root.append(stage);

  const toolbar = h('div', { class: 'toolbar' },
    h('button', { id: 'btn-play' }, '暂停'),
    h('button', { class: 'ghost', id: 'btn-reset' }, '重置波面'),
    h('button', { class: 'ghost', id: 'btn-shot' }, '截图(含水印)'),
    h('span', { class: 'muted' }, `网格 ${settings.gridSize}² · 计算域 ${settings.domainLength}m · 子步 2/帧`),
    h('button', { class: 'ghost', onclick: () => go('analysis') }, '波形分析 →'),
  );
  root.append(toolbar);

  let handle: Handle | null = null;

  const startCpuFallback = (reason: string) => {
    // CPU 回退降档网格, 保证 30FPS 量级的交互流畅度
    const N = Math.min(256, settings.gridSize);
    const sim = new CpuWaterSim(N, settings.domainLength);
    sim.configure(cond, hull, settings.fdtdGain);
    const renderer = new CpuRenderer(canvas, sim);
    renderer.foamThreshold = settings.foamThreshold;
    const notice = h('div', {
      style: 'background:rgba(232,176,75,.15);border:1px solid var(--warn);color:var(--warn);padding:8px 12px;border-radius:6px;font-size:12px;margin-bottom:10px',
    }, `⚠ WebGPU 不可用(${reason}), 已切换 CPU 回退模式 (${N}×${N} 网格, 2D 伪彩渲染)。安装 Chrome/Edge 113+ 并启用硬件加速可获得完整 3D 水面效果。`);
    stage.prepend(notice);

    const fps = new FpsCounter();
    let running = true;
    let raf = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (running) sim.step(1);
      renderer.render();
      const f = fps.tick(now);
      fpsBadge.textContent = `${f.toFixed(0)} FPS`;
      fpsBadge.className = `fps-badge ${f >= 24 ? 'good' : 'bad'}`;
    };
    raf = requestAnimationFrame(loop);
    (document.getElementById('btn-play') as HTMLButtonElement).onclick = (e) => {
      running = !running;
      (e.target as HTMLButtonElement).textContent = running ? '暂停' : '继续';
    };
    (document.getElementById('btn-reset') as HTMLButtonElement).onclick = () => sim.reset();
    (document.getElementById('btn-shot') as HTMLButtonElement).onclick = () => {
      const nums = computeSimNumbers(cond.speedKnots, hull.Lpp, cond.deepWater, cond.waterDepth);
      const url = takeWatermarkShot(canvas, cond, nums);
      const a = document.createElement('a');
      a.href = url;
      a.download = `wake_${cond.name.replace(/\s/g, '_')}_${Date.now()}.png`;
      a.click();
    };
    handle = { destroy: () => cancelAnimationFrame(raf) };
  };

  requestGpu(canvas).then((gpu) => {
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2) * settings.renderScale;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(2, Math.round(rect.width * dpr));
      canvas.height = Math.max(2, Math.round(rect.height * dpr));
      renderer.resize();
    };
    const sim = new WaterSim(gpu.device, settings.gridSize, settings.domainLength);
    sim.configure(cond, hull, settings.fdtdGain);
    const renderer = new WaterRenderer(gpu.device, gpu.context, gpu.format, canvas, sim);
    renderer.foamThreshold = settings.foamThreshold;
    resize();

    const fps = new FpsCounter();
    let running = true;
    let raf = 0;
    const nums = computeSimNumbers(cond.speedKnots, hull.Lpp, cond.deepWater, cond.waterDepth);

    const fillHud = () => {
      hud.replaceChildren(
        h('div', {}, h('b', {}, cond.name)),
        h('div', {}, `船型: ${hull.name} (Lpp ${hull.Lpp}m)`),
        h('div', {}, `船速: ${cond.speedKnots.toFixed(2)} kn = ${nums.speedMps.toFixed(2)} m/s`),
        h('div', {}, `Fr = ${nums.frLength.toFixed(3)}${cond.deepWater ? ' · 深水' : ` · h=${cond.waterDepth}m · Fh=${nums.fhDepth.toFixed(3)}`}`),
        h('div', {}, `压力源: σ=${cond.sourceScale.toFixed(2)}m, p₀/ρ=${cond.pressureAmp.toFixed(3)}`),
      );
    };
    fillHud();

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (running) sim.step(2);
      renderer.render(sim, now / 1000);
      const f = fps.tick(now);
      fpsBadge.textContent = `${f.toFixed(0)} FPS`;
      fpsBadge.className = `fps-badge ${f >= 30 ? 'good' : 'bad'}`;
    };
    raf = requestAnimationFrame(loop);

    // 轨道控制
    let dragging = false, lx = 0, ly = 0;
    canvas.addEventListener('pointerdown', (e) => { dragging = true; lx = e.clientX; ly = e.clientY; });
    window.addEventListener('pointerup', () => (dragging = false));
    canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      renderer.camera.yaw -= (e.clientX - lx) * 0.008;
      renderer.camera.pitch = clamp(renderer.camera.pitch + (e.clientY - ly) * 0.006, 0.08, 1.4);
      lx = e.clientX; ly = e.clientY;
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      renderer.camera.distance = clamp(renderer.camera.distance * (1 + Math.sign(e.deltaY) * 0.08), 12, 260);
    }, { passive: false });
    window.addEventListener('resize', resize);

    (document.getElementById('btn-play') as HTMLButtonElement).onclick = (e) => {
      running = !running;
      (e.target as HTMLButtonElement).textContent = running ? '暂停' : '继续';
    };
    (document.getElementById('btn-reset') as HTMLButtonElement).onclick = () => {
      sim.reset();
    };
    (document.getElementById('btn-shot') as HTMLButtonElement).onclick = () => {
      const url = takeWatermarkShot(canvas, cond, nums);
      const a = document.createElement('a');
      a.href = url;
      a.download = `wake_${cond.name.replace(/\s/g, '_')}_${Date.now()}.png`;
      a.click();
    };

    handle = {
      destroy: () => {
        cancelAnimationFrame(raf);
        window.removeEventListener('resize', resize);
        sim.destroy();
      },
    };
  }).catch((err: Error) => {
    startCpuFallback(err.message);
  });

  const observer = new MutationObserver(() => {
    if (!document.body.contains(root) && handle) {
      handle.destroy();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** 离屏合成带工况参数水印的截图 */
function takeWatermarkShot(
  source: HTMLCanvasElement,
  cond: TrialCondition,
  nums: ReturnType<typeof computeSimNumbers>,
): string {
  const out = document.createElement('canvas');
  out.width = source.width;
  out.height = source.height;
  const ctx = out.getContext('2d')!;
  ctx.drawImage(source, 0, 0);
  const lines = [
    `船行波仿真截图`,
    `工况: ${cond.name}`,
    `船速: ${cond.speedKnots.toFixed(2)} kn (${nums.speedMps.toFixed(2)} m/s) | Fr=${nums.frLength.toFixed(3)}`,
    cond.deepWater
      ? '水深: 深水'
      : `水深: ${cond.waterDepth.toFixed(2)} m | Fh=${nums.fhDepth.toFixed(3)} | ${nums.regime}`,
    new Date().toLocaleString('zh-CN'),
  ];
  const fs = Math.max(14, out.width * 0.016);
  ctx.font = `${fs}px Segoe UI, sans-serif`;
  const pad = fs;
  const boxH = lines.length * (fs * 1.5) + pad;
  ctx.fillStyle = 'rgba(10,16,24,.72)';
  ctx.fillRect(0, out.height - boxH, ctx.measureText(lines[2]).width + pad * 3, boxH);
  ctx.fillStyle = '#e6f0fa';
  lines.forEach((line, i) => ctx.fillText(line, pad, out.height - boxH + pad + i * fs * 1.5 + fs));
  return out.toDataURL('image/png');
}
