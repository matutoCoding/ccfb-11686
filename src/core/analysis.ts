// 波形分析：纵剖面提取、Radon 变换尾迹角测量、CSV 导出

export interface ProfileResult {
  x: Float32Array;       // 相对船位的纵向坐标（米，艏正艉负）
  eta: Float32Array;     // 波高（米）
  yOffset: number;       // 横向位置（米）
}

/**
 * 从高度场取一条沿 x 的纵剖面（双线性插值）。
 * 高度场行优先，域原点在角点，船位 (shipX, shipZ)。
 * @param xWindowM 相对船位的前后采样窗口（米），取 [-xWindowM, +xWindowM]
 */
export function extractLongitudinalProfile(
  heights: Float32Array,
  n: number,
  domain: number,
  shipX: number,
  shipZ: number,
  yOffset: number,
  xWindowM: number,
): ProfileResult {
  const cell = domain / n;
  const samples = n;
  const x = new Float32Array(samples);
  const eta = new Float32Array(samples);
  const zWorld = shipZ + yOffset;

  for (let i = 0; i < samples; i++) {
    const rel = -xWindowM + (2 * xWindowM * i) / (samples - 1);
    const xWorld = shipX + rel;
    x[i] = rel;
    // 高度场与船位同为角点原点域坐标 [0,domain)，直接换算网格索引
    const gx = xWorld / cell;
    const gz = zWorld / cell;
    eta[i] = bilinear(heights, n, gx, gz);
  }
  return { x, eta, yOffset };
}

function bilinear(field: Float32Array, n: number, gx: number, gz: number): number {
  const x0 = Math.floor(gx);
  const z0 = Math.floor(gz);
  const tx = gx - x0;
  const tz = gz - z0;
  const cx = Math.max(0, Math.min(n - 1, x0));
  const cx1 = Math.max(0, Math.min(n - 1, x0 + 1));
  const cz = Math.max(0, Math.min(n - 1, z0));
  const cz1 = Math.max(0, Math.min(n - 1, z0 + 1));
  const a = field[cz * n + cx];
  const b = field[cz * n + cx1];
  const c = field[cz1 * n + cx];
  const d = field[cz1 * n + cx1];
  return a * (1 - tx) * (1 - tz) + b * tx * (1 - tz) + c * (1 - tx) * tz + d * tx * tz;
}

export interface WakeAngleResult {
  halfAngleDeg: number;      // 测得尾迹半角
  energyCurve: { angleDeg: number; energy: number }[];
  peakDetail: string;
}

/**
 * 谱域开尔文尾迹半角测量（稳健，抗近轴横波干扰）。
 * 原理：对船后远场窗口做二维 DFT，在波数平面按「射线角 ψ」分扇区累加 |η̂|²。
 * 散波/cusp 能量集中在理论尾迹楔边缘，扇区能量曲线的局地峰即尾迹半角。
 * 纯 CPU 实现（分析页快照离线测量，一次性开销可接受）。
 */
export function measureWakeAngleSpectral(
  heights: Float32Array,
  n: number,
  domain: number,
  shipX: number,
  shipZ: number,
  opts: { minDeg?: number; maxDeg?: number; stepDeg?: number; nearSkip?: number } = {},
): WakeAngleResult {
  const { minDeg = 14, maxDeg = 40, stepDeg = 0.25, nearSkip = 0.14 } = opts;
  const cell = domain / n;
  const gShipX = shipX / cell;
  const gShipZ = shipZ / cell;
  const rMin = n * nearSkip;
  const rMax = n * 0.4;

  // 1) 裁剪船后远场窗口并加 Hann 窗（抑制泄漏），居中到新网格
  const win = new Float32Array(n * n);
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const dx = ix - gShipX;
      const dz = iz - gShipZ;
      if (dx >= 0) continue;
      const r = Math.hypot(dx, dz);
      if (r < rMin || r > rMax) continue;
      // Hann 窗，沿径向平滑到零
      const t = (r - rMin) / (rMax - rMin);
      const w = 0.5 * (1 - Math.cos(2 * Math.PI * t));
      win[iz * n + ix] = heights[iz * n + ix] * w;
    }
  }

  // 2) 降采样到 M×M 控制 DFT 开销（远场角度测量对分辨率不敏感）
  const M = 96;
  const small = new Float32Array(M * M);
  const step = n / M;
  for (let jz = 0; jz < M; jz++) {
    for (let jx = 0; jx < M; jx++) {
      const ix = Math.min(n - 1, Math.floor(jx * step));
      const iz = Math.min(n - 1, Math.floor(jz * step));
      small[jz * M + jx] = win[iz * n + ix];
    }
  }
  // 去均值，消除窗口非零直流导致的低角泄漏
  let mean = 0;
  let meanCnt = 0;
  for (const v of small) { if (v !== 0) { mean += v; meanCnt++; } }
  if (meanCnt > 0) {
    mean /= meanCnt;
    for (let i = 0; i < small.length; i++) if (small[i] !== 0) small[i] -= mean;
  }

  // 3) M×M 二维 DFT，按波数矢角 χ 分箱，再经群速度几何映射为射线角 ψ
  const dk = (2 * Math.PI) / domain;
  const kMaxIdx = Math.floor(M / 3);
  // 先在 χ 空间（波数矢与航迹线夹角，0..90°）累加功率
  const chiMin = 5;
  const chiMax = 80;
  const chiSteps = Math.round((chiMax - chiMin) / stepDeg);
  const chiEnergy = new Array(chiSteps + 1).fill(0);

  for (let kzIdx = -kMaxIdx; kzIdx <= kMaxIdx; kzIdx++) {
    for (let kxIdx = -kMaxIdx; kxIdx < 0; kxIdx++) {
      const kx = kxIdx * dk;
      const kz = kzIdx * dk;
      let re = 0;
      let im = 0;
      for (let iz = 0; iz < M; iz++) {
        const row = iz * M;
        const angZ = kz * iz * step;
        for (let ix = 0; ix < M; ix++) {
          const v = small[row + ix];
          if (v === 0) continue;
          const ang = kx * ix * step + angZ;
          re += v * Math.cos(ang);
          im -= v * Math.sin(ang);
        }
      }
      const power = re * re + im * im;
      const chi = (Math.atan2(Math.abs(kz), Math.abs(kx)) * 180) / Math.PI;
      const cIdx = Math.round((chi - chiMin) / stepDeg);
      if (cIdx >= 0 && cIdx <= chiSteps) chiEnergy[cIdx] += power;
    }
  }

  // χ -> ψ 映射：深水 ψ(χ) 由群速度方向决定，尾迹半角是 ψ(χ) 的最大值
  // 直接对每个 χ 用 physics 的群速度几何求 ψ，再重采样到 ψ 等间隔网格
  const chiCurve = chiEnergy.map((e, i) => ({ chiDeg: chiMin + i * stepDeg, energy: e }));
  const energyCurve: { angleDeg: number; energy: number }[] = [];
  const steps = Math.round((maxDeg - minDeg) / stepDeg);
  for (let s = 0; s <= steps; s++) {
    const psiTarget = minDeg + s * stepDeg;
    // 找满足 ψ(χ)=psiTarget 的 χ（数值反解，深水近似 ψ=χ-15.8° 不通用，用群速度公式）
    let acc = 0;
    for (const p of chiCurve) {
      const chiRad = (p.chiDeg * Math.PI) / 180;
      // 深水群速度 c_g=c_p/2 沿 k 方向；射线矢 = U x̂ + c_g k̂
      // ψ = atan(c_g sinχ / (U - c_g cosχ))，匹配波 U cosχ=c_p => c_g=U cosχ/2
      const cgOverU = Math.cos(chiRad) / 2;
      const psiRad = Math.atan2(cgOverU * Math.sin(chiRad), 1 - cgOverU * Math.cos(chiRad));
      const psiDeg = (psiRad * 180) / Math.PI;
      if (Math.abs(psiDeg - psiTarget) < stepDeg) acc += p.energy;
    }
    energyCurve.push({ angleDeg: psiTarget, energy: acc });
  }

  // 去趋势 + 找局地峰
  const winW = Math.max(3, Math.round(5 / stepDeg));
  const detrended = energyCurve.map((p, i) => {
    let sum = 0;
    let cnt = 0;
    for (let j = Math.max(0, i - winW); j <= Math.min(energyCurve.length - 1, i + winW); j++) {
      sum += energyCurve[j].energy;
      cnt++;
    }
    return { angleDeg: p.angleDeg, energy: p.energy - sum / cnt };
  });
  let best = detrended[0];
  for (const p of detrended) if (p.energy > best.energy) best = p;

  return {
    halfAngleDeg: best.angleDeg,
    energyCurve,
    peakDetail: `谱域扇区能量峰 @ ${best.angleDeg.toFixed(2)}°（扫描 ${minDeg}–${maxDeg}°）`,
  };
}

/**
 * Radon 变换测量开尔文尾迹半角。
 * 以船位为原点，对每条与航迹线夹角 θ 的直线积分 η²：
 * 能量峰值对应的 θ 即尾迹包络（cusp 波射线）角。
 */
export function measureWakeAngle(
  heights: Float32Array,
  n: number,
  domain: number,
  shipX: number,
  shipZ: number,
  opts: { minDeg?: number; maxDeg?: number; stepDeg?: number; nearSkip?: number } = {},
): WakeAngleResult {
  const { minDeg = 15, maxDeg = 42, stepDeg = 0.25, nearSkip = 0.16 } = opts;
  const cell = domain / n;
  // shipX/shipZ 与高度场同为角点原点的域坐标，直接换算网格坐标
  const gShipX = shipX / cell;
  const gShipZ = shipZ / cell;
  const energyCurve: { angleDeg: number; energy: number }[] = [];

  // 远场环形带：跳过近场横波/压力源主导区
  const rMin = n * nearSkip;
  const rMax = n * 0.38;
  // 扇区半宽（弧度），约 2°
  const halfSector = (1.5 * Math.PI) / 180;

  const steps = Math.round((maxDeg - minDeg) / stepDeg);
  for (let s = 0; s <= steps; s++) {
    const angleDeg = minDeg + s * stepDeg;
    const theta = (angleDeg * Math.PI) / 180;
    let energy = 0;
    let count = 0;
    // 遍历环形带内所有点，按极角落入扇区统计（左右舷对称）
    for (let iz = 0; iz < n; iz++) {
      const dz = iz - gShipZ;
      for (let ix = 0; ix < n; ix++) {
        const dx = ix - gShipX;
        if (dx >= 0) continue; // 只看船后
        const r = Math.hypot(dx, dz);
        if (r < rMin || r > rMax) continue;
        const ang = Math.atan2(Math.abs(dz), -dx); // 相对航迹线 0..π/2
        let d = Math.abs(ang - theta);
        if (d < halfSector) {
          const h = heights[iz * n + ix];
          // 面积权重 r·dθ·dr，按 r 归一抵消几何扩散
          energy += (h * h) / Math.max(r, 1);
          count++;
        }
      }
    }
    energyCurve.push({ angleDeg, energy: count > 0 ? energy / count : 0 });
  }

  // 平滑（3 点滑动）
  const smoothed = energyCurve.map((p, i) => {
    const a = energyCurve[Math.max(0, i - 1)].energy;
    const b = p.energy;
    const c = energyCurve[Math.min(energyCurve.length - 1, i + 1)].energy;
    return { angleDeg: p.angleDeg, energy: (a + b + c) / 3 };
  });

  // 去趋势：减宽窗滑动平均（横波随角度平滑衰减的基线），凸显 cusp 局地峰
  const win = Math.max(3, Math.round(6 / stepDeg));
  const detrended = smoothed.map((p, i) => {
    let sum = 0;
    let cnt = 0;
    for (let j = Math.max(0, i - win); j <= Math.min(smoothed.length - 1, i + win); j++) {
      sum += smoothed[j].energy;
      cnt++;
    }
    return { angleDeg: p.angleDeg, energy: p.energy - sum / cnt };
  });

  let best = detrended[0];
  for (const p of detrended) if (p.energy > best.energy) best = p;

  // 抛物线亚格点精修
  const idx = detrended.findIndex((p) => p.angleDeg === best.angleDeg);
  let refined = best.angleDeg;
  if (idx > 0 && idx < detrended.length - 1) {
    const e0 = detrended[idx - 1].energy;
    const e1 = detrended[idx].energy;
    const e2 = detrended[idx + 1].energy;
    const denom = e0 - 2 * e1 + e2;
    if (Math.abs(denom) > 1e-12) {
      const delta = 0.5 * (e0 - e2) / denom;
      refined = best.angleDeg + delta * stepDeg;
    }
  }

  return {
    halfAngleDeg: refined,
    energyCurve: smoothed,
    peakDetail: `Radon 能量峰值 @ ${refined.toFixed(2)}°（扫描 ${minDeg}–${maxDeg}°，步长 ${stepDeg}°，远场扇区+去趋势）`,
  };
}

/** 多纵剖面 CSV（含可选实测列），UTF-8 BOM 供 Excel 直接打开 */
export function profilesToCsv(
  simProfiles: ProfileResult[],
  measured: { label: string; x: Float32Array; eta: Float32Array }[],
  meta: Record<string, string>,
): string {
  const lines: string[] = [];
  lines.push('# 船行波仿真波高剖面导出');
  for (const [k, v] of Object.entries(meta)) lines.push(`# ${k}: ${v}`);
  lines.push('');

  const header = ['x_rel_m'];
  for (const p of simProfiles) header.push(`sim_eta_y${p.yOffset.toFixed(2)}m_m`);
  for (const m of measured) header.push(`meas_${m.label}_m`);
  lines.push(header.join(','));

  const maxLen = Math.max(
    ...simProfiles.map((p) => p.x.length),
    ...measured.map((m) => m.x.length),
  );
  for (let i = 0; i < maxLen; i++) {
    const row: string[] = [];
    const xRef = simProfiles[0]?.x[i] ?? measured[0]?.x[i];
    row.push(xRef !== undefined ? xRef.toFixed(4) : '');
    for (const p of simProfiles) row.push(i < p.eta.length ? p.eta[i].toFixed(5) : '');
    for (const m of measured) row.push(i < m.eta.length ? m.eta[i].toFixed(5) : '');
    lines.push(row.join(','));
  }
  return '﻿' + lines.join('\n');
}

export function downloadTextFile(filename: string, content: string, mime = 'text/csv') {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadDataUrl(filename: string, dataUrl: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
}
