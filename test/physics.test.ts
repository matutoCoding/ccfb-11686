import { describe, it, expect } from 'vitest';
import {
  GRAVITY,
  lengthFroude,
  depthFroude,
  phaseSpeed,
  groupSpeed,
  matchWavenumber,
  theoreticalWakeHalfAngle,
  theoreticalWakeCurve,
  wakeRayAngle,
  KELVIN_HALF_ANGLE_DEEP,
} from '../src/core/physics';

describe('弗劳德数', () => {
  it('长度弗劳德数 Fr_L = U/√(gL)', () => {
    expect(lengthFroude(2.06, 48)).toBeCloseTo(2.06 / Math.sqrt(GRAVITY * 48), 6);
  });
  it('水深弗劳德数 Fr_h = U/√(gh)', () => {
    expect(depthFroude(2, 0.88)).toBeCloseTo(2 / Math.sqrt(GRAVITY * 0.88), 6);
  });
});

describe('色散关系', () => {
  it('深水相速度随 k 减小而增大，极限 √(gh)', () => {
    const cp1 = phaseSpeed(0.01, 60);
    const cp2 = phaseSpeed(2, 60);
    expect(cp1).toBeGreaterThan(cp2);
    expect(cp1).toBeLessThan(Math.sqrt(GRAVITY * 60) + 0.5);
  });
  it('matchWavenumber 反解满足 U cosχ = c_p(k)', () => {
    const chi = 0.6;
    const h = 40;
    const U = 2.1;
    const k = matchWavenumber(chi, h, U);
    expect(phaseSpeed(k, h)).toBeCloseTo(U * Math.cos(chi), 4);
  });
  it('深水群速度≈相速度一半', () => {
    const k = 3;
    const h = 200; // kh=600 → 深水
    expect(groupSpeed(k, h) / phaseSpeed(k, h)).toBeCloseTo(0.5, 2);
  });
});

describe('开尔文尾迹半角（核心验收项）', () => {
  it('深水极限 = 19.47°（arcsin 1/3）', () => {
    const angle = theoreticalWakeHalfAngle(200, 2);
    expect(angle).toBeCloseTo(KELVIN_HALF_ANGLE_DEEP, 1);
    expect(Math.abs(angle - KELVIN_HALF_ANGLE_DEEP)).toBeLessThan(0.1);
  });

  it('深水多航速均稳定在 19.47° ±0.1°', () => {
    for (const U of [1, 1.5, 2.5, 4]) {
      const angle = theoreticalWakeHalfAngle(300, U);
      expect(Math.abs(angle - KELVIN_HALF_ANGLE_DEEP)).toBeLessThan(0.1);
    }
  });

  it('浅水 Fr_h 增大时尾迹角单调增大', () => {
    const U = 2;
    const deep = theoreticalWakeHalfAngle(60, U);   // Fr_h≈0.08
    const mid = theoreticalWakeHalfAngle(1.5, U);   // Fr_h≈0.52
    const shallow = theoreticalWakeHalfAngle(0.6, U); // Fr_h≈0.82
    expect(deep).toBeLessThan(mid);
    expect(mid).toBeLessThan(shallow);
    expect(shallow).toBeGreaterThan(25);
  });

  it('近临界 Fr_h→1 时尾迹半角趋近 90°', () => {
    const angle = theoreticalWakeHalfAngle(0.42, 2); // Fr_h≈0.985
    expect(angle).toBeGreaterThan(60);
  });

  it('ψ(χ) 曲线在深水 χ*=35.26° 处取峰', () => {
    const curve = theoreticalWakeCurve(200, 2, 720);
    let peak = curve[0];
    for (const p of curve) if (p.psiDeg > peak.psiDeg) peak = p;
    expect(peak.chiDeg).toBeCloseTo(35.264, 1);
    expect(peak.psiDeg).toBeCloseTo(19.471, 1);
  });

  it('wakeRayAngle 输出 α 深水极限 0.5', () => {
    const r = wakeRayAngle(0.6, 200, 2);
    expect(r.alpha).toBeCloseTo(0.5, 2);
  });
});
