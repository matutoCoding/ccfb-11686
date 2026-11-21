// WebGPU 无头自检：初始化设备 → FFT → 仿真推进 → 校验能量与尾迹结构
// 结果写入 document.title 和 #result，供 headless Chrome 抓取
import { initWebGPU } from './gpu/device';
import { WaveSimulation } from './gpu/simulation';
import { measureWakeAngleSpectral } from './core/analysis';
import { GRAVITY } from './core/physics';
import spectrumShaderSrc from './gpu/wgsl/spectrum.wgsl?raw';

async function main() {
  const result = document.getElementById('result')!;
  const log = (msg: string) => {
    console.log('[SELFTEST]', msg);
    result.textContent += msg + '\n';
  };
  try {
    if (!navigator.gpu) throw new Error('navigator.gpu 不存在');
    const adapter = await navigator.gpu.requestAdapter();
    log(`adapter: ${adapter?.info?.description ?? 'unknown'}`);

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 384;
    const gpu = await initWebGPU(canvas);
    log('WebGPU 设备初始化成功');

    const N = 256;
    const sim = new WaveSimulation(gpu.device, {
      gridN: N,
      domainLength: 120,
      depth: 60,
      speed: 4.0,
      cfl: 0.9,
      spongeWidthRatio: 0.12,
      dampingStrength: 3,
      pressureAmp: 0.6,
      pressureLength: 0.12,
      pressureWidth: 0.55,
      hullLength: 48,
      hullBeam: 6,
      gravity: GRAVITY,
    });
    log(`仿真引擎构建成功 N=${N} dt=${sim.timeStep.toFixed(3)}s`);

    // 读回引擎 uniform 验证
    {
      const st = gpu.device.createBuffer({ size: 64, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const enc3 = gpu.device.createCommandEncoder();
      enc3.copyBufferToBuffer((sim as unknown as { uniformBuffer: GPUBuffer }).uniformBuffer, 0, st, 0, 64);
      gpu.device.queue.submit([enc3.finish()]);
      await st.mapAsync(GPUMapMode.READ);
      const u = new Float32Array(st.getMappedRange().slice(0)); st.unmap();
      log(`uniform: n=${u[0]} L=${u[1]} h=${u[2]} dt=${u[3]} g=${u[4]}`);
      log(`         shipX=${u[5]} shipZ=${u[6]} sx=${u[7]} sz=${u[8]} pAmp=${u[9]}`);
      log(`         spongeW=${u[10]} damp=${u[11]} time=${u[12]}`);
    }

    // 推进到船接近消波带前（避免回绕切断尾迹）
    const STEPS = 2400;
    const t0 = performance.now();
    for (let i = 0; i < STEPS; i++) sim.step();
    await gpu.device.queue.onSubmittedWorkDone();
    const ms = (performance.now() - t0) / STEPS;
    log(`推进 ${STEPS} 步完成，单步 ${ms.toFixed(2)} ms（等效 ${(1000 / ms).toFixed(1)} FPS）`);
    log(`船位=${sim.shipPosition.x.toFixed(1)}m（域 120m，回绕限 103m）`);

    // 300 步后读真实 uniform
    await gpu.device.queue.onSubmittedWorkDone();
    {
      const ub = (sim as unknown as { uniformBuffer: GPUBuffer }).uniformBuffer;
      const st = gpu.device.createBuffer({ size: 64, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const enc3 = gpu.device.createCommandEncoder();
      enc3.copyBufferToBuffer(ub, 0, st, 0, 64);
      gpu.device.queue.submit([enc3.finish()]);
      await gpu.device.queue.onSubmittedWorkDone();
      await st.mapAsync(GPUMapMode.READ);
      const u = new Float32Array(st.getMappedRange().slice(0)); st.unmap();
      log(`uniform: n=${u[0]} L=${u[1]} h=${u[2]} dt=${u[3]} g=${u[4]} shipX=${u[5].toFixed(2)} pAmp=${u[9]} time=${u[12].toFixed(2)}`);
    }

    const heights = await sim.readbackHeights();
    let maxAbs = 0;
    let sumSq = 0;
    let nanCount = 0;
    for (const v of heights) {
      if (!Number.isFinite(v)) nanCount++;
      maxAbs = Math.max(maxAbs, Math.abs(v));
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / heights.length);
    log(`heightBuf: max|η|=${maxAbs.toExponential(4)}m RMS=${rms.toExponential(5)}m NaN=${nanCount} 样本数=${heights.length}`);

    // 直接读 etaBuf 对比
    {
      const N2 = sim.n;
      const st = gpu.device.createBuffer({ size: N2 * N2 * 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const enc2 = gpu.device.createCommandEncoder();
      enc2.copyBufferToBuffer((sim as unknown as { etaBuf: GPUBuffer }).etaBuf, 0, st, 0, N2 * N2 * 8);
      gpu.device.queue.submit([enc2.finish()]);
      await st.mapAsync(GPUMapMode.READ);
      const raw = new Float32Array(st.getMappedRange().slice(0)); st.unmap();
      let em = 0; for (let i = 0; i < N2 * N2; i++) em = Math.max(em, Math.abs(raw[i * 2]));
      log(`etaBuf 直接读 max=${em.toExponential(4)}（对比 heightBuf ${maxAbs.toExponential(4)}）`);
    }
    if (nanCount > 0) throw new Error('高度场出现 NaN');
    if (maxAbs < 1e-6) throw new Error('波高场几乎为零，压力源/FFT 可能失效');

    // 在当前（回绕前）高度场上测尾迹角
    const sp2 = sim.shipPosition;
    const wake2 = measureWakeAngleSpectral(heights, N, 120, sp2.x, sp2.z, { stepDeg: 0.25 });
    log(`Radon 尾迹半角 = ${wake2.halfAngleDeg.toFixed(2)}°（理论深水 19.47°）`);
    const curve = wake2.energyCurve.filter((_, i) => i % 8 === 0);
    log('能量曲线: ' + curve.map((p) => `${p.angleDeg.toFixed(0)}°:${p.energy.toExponential(1)}`).join(' '));
    const dev = Math.abs(wake2.halfAngleDeg - 19.47);
    log(`与理论偏差 = ${dev.toFixed(2)}° ${dev < 1 ? '✅ 满足 <1° 验收' : '⚠️ 偏差 >1°'}`);

    log('ALL PASS');
    document.title = 'SELFTEST PASS';
  } catch (e) {
    log('FAIL: ' + (e as Error).message);
    document.title = 'SELFTEST FAIL';
  }
}
void main();
