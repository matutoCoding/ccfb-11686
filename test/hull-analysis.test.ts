import { describe, it, expect } from 'vitest';
import { generateHull, hullSummary } from '../src/core/hull';
import { defaultHullParams } from '../src/core/hull';
import { uid } from '../src/core/storage';
import { measureWakeAngle, measureWakeAngleSpectral, extractLongitudinalProfile, profilesToCsv } from '../src/core/analysis';

describe('参数化船型', () => {
  it('生成 21 站网格且实际 Cb 收敛到目标值 ±0.06', () => {
    const geo = generateHull(defaultHullParams(uid('h')));
    expect(geo.stations.length).toBe(21);
    const { cbActual, displacedVolume } = hullSummary(geo);
    expect(cbActual).toBeGreaterThan(0.3);
    expect(cbActual).toBeLessThan(0.85);
    expect(Math.abs(cbActual - geo.params.blockCoeff)).toBeLessThan(0.06);
    expect(displacedVolume).toBeGreaterThan(0);
    // 网格顶点/索引合法
    expect(geo.mesh.positions.length).toBeGreaterThan(100);
    const maxIdx = Math.max(...geo.mesh.indices);
    expect(maxIdx).toBeLessThan(geo.mesh.positions.length / 3);
  });

  it('首尾站封闭（半宽为 0）', () => {
    const geo = generateHull(defaultHullParams(uid('h')));
    const first = geo.stations[0];
    const last = geo.stations[geo.stations.length - 1];
    expect(Math.max(...first.halfBreadths)).toBe(0);
    expect(Math.max(...last.halfBreadths)).toBe(0);
  });
});

describe('Radon 尾迹角测量', () => {
  it('合成 19.47° 双射线波场能正确回收角度（±1°）', () => {
    const n = 256;
    const domain = 100;
    const heights = new Float32Array(n * n);
    const shipX = domain * 0.5;
    const shipZ = domain * 0.5;
    const cell = domain / n;
    const target = (19.47 * Math.PI) / 180;

    // 域坐标（角点原点）下，在船后两条 cusp 射线上放高斯波包
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const xw = (ix + 0.5) * cell;
        const zw = (iz + 0.5) * cell;
        const dx = xw - shipX;   // 船后为负
        const dz = zw - shipZ;
        if (dx >= -cell) continue;
        for (const sign of [1, -1]) {
          const d = Math.abs(dz - sign * Math.tan(target) * (-dx));
          const along = -dx;
          if (along > 4 && along < domain * 0.4) {
            heights[iz * n + ix] += Math.exp(-(d * d) / (2 * cell * cell * 1.5))
              * Math.cos(along * 1.2) * 0.5;
          }
        }
      }
    }
    const res = measureWakeAngle(heights, n, domain, shipX, shipZ, { stepDeg: 0.2 });
    expect(Math.abs(res.halfAngleDeg - 19.47)).toBeLessThan(1);
  });
});

describe('谱域尾迹角测量', () => {
  it('合成 cusp 波场（χ*=35.26° 平面波叠加）回收 19.47° ±2°', () => {
    const n = 256;
    const domain = 120;
    const heights = new Float32Array(n * n);
    const shipX = domain * 0.5;
    const shipZ = domain * 0.5;
    const cell = domain / n;
    // 深水 cusp 波数矢角 χ*=35.26°，左右舷两束平面波，波向船后
    const chi = (35.26 * Math.PI) / 180;
    const kMag = (2 * Math.PI * 8) / domain;
    const kx = -kMag * Math.cos(chi);
    const kz = kMag * Math.sin(chi);
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const xw = (ix + 0.5) * cell;
        const zw = (iz + 0.5) * cell;
        const dx = xw - shipX;
        if (dx > -cell) continue; // 仅船后
        const phase1 = kx * (xw - shipX) + kz * (zw - shipZ);
        const phase2 = kx * (xw - shipX) - kz * (zw - shipZ);
        heights[iz * n + ix] = 0.5 * (Math.cos(phase1) + Math.cos(phase2));
      }
    }
    const res = measureWakeAngleSpectral(heights, n, domain, shipX, shipZ, { stepDeg: 0.5 });
    expect(Math.abs(res.halfAngleDeg - 19.47)).toBeLessThan(2);
  });
});

describe('纵剖面与 CSV', () => {
  it('剖面采样数 = N，且在零波场上恒为 0', () => {
    const n = 128;
    const h = new Float32Array(n * n);
    const p = extractLongitudinalProfile(h, n, 64, 32, 32, 2, 20);
    expect(p.x.length).toBe(n);
    expect(p.eta.every((v) => v === 0)).toBe(true);
  });

  it('CSV 含元信息头与 BOM', () => {
    const n = 8;
    const h = new Float32Array(n * n).fill(0.01);
    const p = extractLongitudinalProfile(h, n, 64, 32, 32, 1, 10);
    const csv = profilesToCsv([p], [], { 工况: 't1' });
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('工况: t1');
    expect(csv).toContain('sim_eta_y1.00m_m');
  });
});
