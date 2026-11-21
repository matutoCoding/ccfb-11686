// 页面 4：水面仿真（GPU 谱方法 + 实时渲染 + 水印截图 + 快照）
import { store } from '../../core/store';
import { h, clear } from '../dom';
import { navigate } from '../router';
import { initWebGPU } from '../../gpu/device';
import { WaveSimulation } from '../../gpu/simulation';
import { SceneRenderer } from '../../gpu/renderer';
import { attachOrbitControls } from '../../gpu/camera';
import { generateHull } from '../../core/hull';
import { computeVertexNormals } from '../../core/geometry';
import {
  depthFroude,
  lengthFroude,
  theoreticalWakeHalfAngle,
} from '../../core/physics';
import { GRAVITY } from '../../core/physics';
import { putSnapshot } from '../../core/storage';
import { downloadDataUrl } from '../../core/analysis';

interface EngineHandles {
  sim: WaveSimulation;
  renderer: SceneRenderer;
  detach: () => void;
  raf: number;
}

export function renderSimulationPage(root: HTMLElement) {
  clear(root);
  const project = store.activeProject();
  const cond = store.activeCondition();
  const hull = project ? store.getHull(project.hullId) : undefined;

  root.append(
    h('h1', { class: 'page-title' }, '水面 GPU 仿真'),
    h('p', { class: 'page-sub' }, '高度场谱方法求解（Stockham FFT + 有限水深色散），船体为随船移动高斯压力源。鼠标拖拽旋转、滚轮缩放。'),
  );

  if (!project || !cond || !hull) {
    root.append(h('div', { class: 'empty' }, '请先在方案列表选择方案与工况。',
      h('div', { style: 'margin-top:12px' }, h('button', { class: 'primary', onclick: () => navigate('projects') }, '去方案列表'))));
    return;
  }
  const proj = project;
  const activeCond = cond;
  const activeHull = hull;

  const settings = store.data.settings;
  const canvas = h('canvas', {}) as HTMLCanvasElement;
  const hud = h('div', { class: 'hud' }) as HTMLElement;
  const view = h('div', { class: 'sim-view' }, canvas, hud);

  const playBtn = h('button', { class: 'primary small' }, '⏸ 暂停') as HTMLButtonElement;
  const resetBtn = h('button', { class: 'small' }, '↺ 重置') as HTMLButtonElement;
  const shotBtn = h('button', { class: 'small' }, '📷 水印截图') as HTMLButtonElement;
  const snapBtn = h('button', { class: 'small' }, '💾 存快照') as HTMLButtonElement;
  const controls = h('div', { class: 'sim-controls' }, playBtn, resetBtn, shotBtn, snapBtn);
  view.append(controls);

  const side = h('div', { class: 'sim-side' });
  const layout = h('div', { class: 'sim-layout' }, side, view);
  root.append(layout);

  const frL = lengthFroude(activeCond.speed, activeHull.lengthBP);
  const frH = depthFroude(activeCond.speed, activeCond.waterDepth);
  const theory = theoreticalWakeHalfAngle(activeCond.waterDepth, activeCond.speed);

  side.append(
    h('div', { class: 'card' },
      h('h2', {}, '当前工况'),
      infoRow('方案 / 工况', `${proj.name} / ${activeCond.name}`),
      infoRow('船速 U', `${activeCond.speed.toFixed(2)} m/s`),
      infoRow('水深 h', `${activeCond.waterDepth.toFixed(2)} m（h/T=${(activeCond.waterDepth / activeHull.draft).toFixed(2)}）`),
      infoRow('长度弗劳德数', frL.toFixed(4)),
      infoRow('水深弗劳德数', `${frH.toFixed(4)}${frH >= 1 ? '（超临界）' : ''}`),
      infoRow('理论尾迹半角', `${theory.toFixed(2)}°（深水 19.47°）`),
      infoRow('压力水头/σx/σz', `${activeCond.pressureAmp}m / ${(activeCond.pressureLength * activeHull.lengthBP).toFixed(2)}m / ${(activeCond.pressureWidth * activeHull.beam).toFixed(2)}m`),
    ),
    h('div', { class: 'card' },
      h('h2', {}, '数值设置（设置页可调）'),
      infoRow('网格分辨率', `${settings.gridN} × ${settings.gridN}`),
      infoRow('水池域长', `${settings.domainLength} m，格距 ${(settings.domainLength / settings.gridN).toFixed(3)} m`),
      infoRow('消波层', `${(settings.spongeWidth * 100).toFixed(0)}% 域宽，强度 ${settings.dampingStrength}`),
      h('div', { class: 'btn-row', style: 'margin-top:10px' },
        h('button', { class: 'small', onclick: () => navigate('condition') }, '改工况'),
        h('button', { class: 'small', onclick: () => navigate('settings') }, '改网格/渲染'),
      ),
    ),
    h('div', { class: 'card' },
      h('h2', {}, '操作说明'),
      h('div', { class: 'muted', style: 'line-height:1.9' },
        '· 拖拽：轨道旋转视角<br>· 滚轮：缩放<br>· 船到消波带自动回绕，相机跟随<br>· 前 20s 平滑加速以抑制启动瞬态<br>· 快照供分析页离线测量尾迹角'),
    ),
  );

  let handles: EngineHandles | null = null;
  let running = true;
  let disposed = false;

  function infoRow(k: string, v: string) {
    return h('div', { style: 'display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px solid rgba(42,64,85,.5);font-size:12px' },
      h('span', { class: 'muted' }, k), h('span', { class: 'mono', style: 'text-align:right' }, v));
  }

  async function boot() {
    try {
      const gpu = await initWebGPU(canvas);
      if (disposed) { gpu.device.destroy(); return; }

      const sim = new WaveSimulation(gpu.device, {
        gridN: settings.gridN,
        domainLength: settings.domainLength,
        depth: activeCond.waterDepth,
        speed: activeCond.speed,
        cfl: settings.cfl,
        spongeWidthRatio: settings.spongeWidth,
        dampingStrength: settings.dampingStrength,
        pressureAmp: activeCond.pressureAmp,
        pressureLength: activeCond.pressureLength,
        pressureWidth: activeCond.pressureWidth,
        hullLength: activeHull.lengthBP,
        hullBeam: activeHull.beam,
        gravity: GRAVITY,
      });

      const renderer = new SceneRenderer(gpu.device, canvas, gpu.format, settings.gridN, settings.domainLength);
      const geo = generateHull(activeHull);
      const normals = computeVertexNormals(geo.mesh.positions, geo.mesh.indices);
      const ship = sim.shipPosition;
      renderer.setHullMesh(geo.mesh.positions, normals, geo.mesh.indices, [
        ship.x - activeHull.lengthBP / 2,
        0,
        0,
      ]);

      const detach = attachOrbitControls(canvas, renderer.camera, () => {});
      if (settings.cameraFollow) {
        renderer.camera.target = [ship.x - settings.domainLength * 0.25, 0, 0];
      }

      // FPS 统计
      let frames = 0;
      let lastFpsT = performance.now();
      let fps = 0;
      let stepMs = 0;

      const loop = () => {
        if (disposed) return;
        const t0 = performance.now();
        if (running) {
          sim.step();
          const shipNow = sim.shipPosition;
          if (settings.cameraFollow) {
            renderer.camera.target = [shipNow.x - settings.domainLength * 0.25, 0, 0];
          }
        }
        stepMs = performance.now() - t0;
        renderer.render(sim.heightBuffer, sim.simTime, {
          foamEnabled: settings.renderFoam,
          reflectEnabled: settings.renderReflection,
          foamThreshold: settings.foamThreshold,
        });

        frames++;
        const now = performance.now();
        if (now - lastFpsT >= 500) {
          fps = (frames * 1000) / (now - lastFpsT);
          frames = 0;
          lastFpsT = now;
          const sp = sim.shipPosition;
          const fpsCls = fps >= 30 ? 'fps-good' : 'fps-bad';
          hud.innerHTML =
            `<b>${activeCond.name}</b><br>` +
            `仿真时间 t = ${sim.simTime.toFixed(1)} s　dt = ${sim.timeStep.toFixed(3)} s<br>` +
            `船位 x = ${(sp.x - settings.domainLength * 0.25).toFixed(1)} m（相对起点）<br>` +
            `网格 ${settings.gridN}²　单步计算 ${stepMs.toFixed(1)} ms<br>` +
            `帧率 <span class="${fpsCls}">${fps.toFixed(1)} FPS</span>　目标 ≥30`;
        }
        handles && (handles.raf = requestAnimationFrame(loop));
      };
      const raf = requestAnimationFrame(loop);
      handles = { sim, renderer, detach, raf };

      playBtn.onclick = () => {
        running = !running;
        playBtn.textContent = running ? '⏸ 暂停' : '▶ 继续';
      };
      resetBtn.onclick = () => { sim.reset(); };
      shotBtn.onclick = async () => {
        shotBtn.disabled = true;
        try {
          const url = await renderer.captureWithWatermark([
            `方案: ${proj.name}    工况: ${activeCond.name}    船型: ${activeHull.name}`,
            `U=${activeCond.speed} m/s  h=${activeCond.waterDepth} m  Fr_L=${frL.toFixed(4)}  Fr_h=${frH.toFixed(4)}`,
            `网格=${settings.gridN}²  域长=${settings.domainLength}m  t=${sim.simTime.toFixed(1)}s  理论尾迹半角=${theory.toFixed(2)}°`,
          ], sim.heightBuffer, {
            foamEnabled: settings.renderFoam,
            reflectEnabled: settings.renderReflection,
            foamThreshold: settings.foamThreshold,
          });
          downloadDataUrl(`wave_${activeCond.name}_${Date.now()}.png`, url);
        } finally {
          shotBtn.disabled = false;
        }
      };
      snapBtn.onclick = async () => {
        snapBtn.disabled = true;
        try {
          const heights = await sim.readbackHeights();
          const spNow = sim.shipPosition;
          await putSnapshot({
            id: `snap_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            conditionId: activeCond.id,
            projectId: proj.id,
            createdAt: Date.now(),
            simTime: sim.simTime,
            gridN: settings.gridN,
            domainLength: settings.domainLength,
            speed: activeCond.speed,
            waterDepth: activeCond.waterDepth,
            depthFroude: frH,
            lengthFroude: frL,
            shipX: spNow.x,
            shipZ: spNow.z,
            hullLength: activeHull.lengthBP,
            hullBeam: activeHull.beam,
            heights,
          });
          alert('快照已保存，可在波形分析页加载测量。');
        } finally {
          snapBtn.disabled = false;
        }
      };
    } catch (e) {
      view.innerHTML = '';
      view.append(h('div', { class: 'error-box', style: 'margin:24px' },
        h('b', {}, 'WebGPU 初始化失败'),
        h('div', {}, (e as Error).message),
        h('div', { class: 'muted', style: 'margin-top:8px' },
          '建议：Chrome/Edge 地址栏打开 chrome://gpu 确认 WebGPU 可用；虚拟机内可能需要启用 ANGLE/SwiftShader。'),
      ));
    }
  }

  void boot();

  return () => {
    disposed = true;
    if (handles) {
      cancelAnimationFrame(handles.raf);
      handles.detach();
      handles.sim.destroy();
      handles.renderer.destroy();
    }
  };
}
