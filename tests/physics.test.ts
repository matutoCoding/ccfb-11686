import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEEP_WATER_KEVIN_ANGLE_DEG,
  computeSimNumbers,
  froudeDepth,
  froudeLength,
  wavenumberAt,
} from '../src/core/physics.ts';
import {
  buildSpectrum,
  componentWavenumber,
  cuspAngleDeg,
  measureWakeAngle,
  rayTangent,
  sampleHeight,
  type KelvinParams,
} from '../src/core/kelvin.ts';
import { GRAVITY } from '../src/core/types.ts';

const deepParams = (over: Partial<KelvinParams> = {}): KelvinParams => ({
  speedMps: 2.0,
  depth: Infinity,
  pressureAmp: 0.12,
  sourceScale: 1.2,
  components: 320,
  nearFieldRatio: 0,
  ...over,
});

test('深水波数退化为 omega^2/g', () => {
  const omega = 1.5;
  const k = wavenumberAt(omega, Infinity);
  assert.ok(Math.abs(k - (omega * omega) / GRAVITY) < 1e-12);
});

test('有限水深波数求解满足色散关系(机器精度)', () => {
  for (const [om, h] of [[1.2, 3], [1.0, 3], [2.0, 1.0]] as const) {
    const k = wavenumberAt(om, h);
    const lhs = GRAVITY * k * Math.tanh(k * h);
    assert.ok(Math.abs(lhs - om * om) / (om * om) < 1e-10);
    assert.ok(k > (om * om) / GRAVITY); // 浅水 k 大于深水值
  }
});

test('越界条件(omega^2>=gh)返回 NaN', () => {
  assert.ok(Number.isNaN(wavenumberAt(4, 1)));
});

test('弗劳德数定义正确', () => {
  assert.ok(Math.abs(froudeLength(2, 16) - 2 / Math.sqrt(GRAVITY * 16)) < 1e-12);
  assert.ok(Math.abs(froudeDepth(2, 4) - 2 / Math.sqrt(GRAVITY * 4)) < 1e-12);
  const n = computeSimNumbers(2 / 0.514444, 16, false, 4);
  assert.ok(Math.abs(n.speedMps - 2) < 1e-6);
  assert.equal(n.regime, 'subcritical');
});

test('深水 cusp 几何: beta*=35.264° 处射线角 = 19.471°', () => {
  const betaStar = Math.atan(Math.SQRT1_2);
  const v = 2;
  const k = componentWavenumber(betaStar, v, Infinity);
  const theta = (Math.atan(rayTangent(betaStar, k, Infinity)) * 180) / Math.PI;
  assert.ok(Math.abs(theta - DEEP_WATER_KEVIN_ANGLE_DEG) < 1e-6);
});

test('cuspAngleDeg 深水极限 = 19.471°(理论参考值)', () => {
  assert.ok(Math.abs(cuspAngleDeg(0.001) - DEEP_WATER_KEVIN_ANGLE_DEG) < 0.1);
});

test('实测波场尾迹角在中等浅水(Fh 0.5→0.7)随 Fh 增大而张开', () => {
  const v = 2;
  const angles = [0.5, 0.7].map((fh) => {
    const h = (v * v) / (GRAVITY * fh * fh);
    const p = deepParams({ depth: h });
    return measureWakeAngle(buildSpectrum(p), p).angleDeg;
  });
  const deepMeas = measureWakeAngle(buildSpectrum(deepParams()), deepParams()).angleDeg;
  assert.ok(angles[0] >= deepMeas - 1.5, `${angles} vs deep ${deepMeas}`);
  assert.ok(angles[1] > angles[0] + 2, `Fh 增大应张开: ${angles.join(',')}`);
});

test('合成波场实测尾迹半角与 19.47° 理论值偏差 < 1° (核心验收项)', () => {
  const p = deepParams();
  const { angleDeg } = measureWakeAngle(buildSpectrum(p), p);
  assert.ok(
    Math.abs(angleDeg - DEEP_WATER_KEVIN_ANGLE_DEG) < 1.0,
    `measured ${angleDeg} vs 19.471`,
  );
});

test('Froude 相似尺度下尾迹角保持开尔文值(尺度无关性)', () => {
  // 严格相似: 源尺度与测量距离都按 V^2/g 缩放, 无量纲问题完全一致
  const refV = 2;
  const refScale = (refV * refV) / GRAVITY;
  for (const v of [1, 1.5, 3]) {
    const scale = (v * v) / GRAVITY;
    const p = deepParams({
      speedMps: v,
      sourceScale: 1.2 * (scale / refScale),
    });
    const { angleDeg } = measureWakeAngle(buildSpectrum(p), p, {
      xList: [40, 50, 60].map((x) => x * (scale / refScale)),
    });
    assert.ok(
      Math.abs(angleDeg - DEEP_WATER_KEVIN_ANGLE_DEG) < 1.5,
      `v=${v} measured ${angleDeg}`,
    );
  }
});

test('波面关于 y=0 对称, 艏前无尾迹波动', () => {
  const p = deepParams();
  const comps = buildSpectrum(p);
  const zp = sampleHeight(-20, 3, comps, p);
  const zn = sampleHeight(-20, -3, comps, p);
  assert.ok(Math.abs(zp - zn) < 1e-12);
  const ahead = sampleHeight(5, 0, comps, p);
  assert.ok(Math.abs(ahead) < 1e-12);
});

test('超临界(Fh>1)谱分量自动截断且仍可测量', () => {
  const v = 4;
  const h = 1;
  const p = deepParams({ speedMps: v, depth: h });
  const comps = buildSpectrum(p);
  assert.ok(comps.length > 10);
  assert.ok(comps.every((c) => Number.isFinite(c.k)));
  const { angleDeg } = measureWakeAngle(comps, p);
  assert.ok(angleDeg > 0 && angleDeg < 90);
});
