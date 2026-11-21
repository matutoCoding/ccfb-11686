// 物理常量与水动力学公式（纯函数，可单测）

export const GRAVITY = 9.80665; // m/s²

/** 长度弗劳德数 Fr_L = U / sqrt(g L) */
export function lengthFroude(speed: number, length: number): number {
  if (length <= 0) return 0;
  return speed / Math.sqrt(GRAVITY * length);
}

/** 水深弗劳德数 Fr_h = U / sqrt(g h) */
export function depthFroude(speed: number, depth: number): number {
  if (depth <= 0) return 0;
  return speed / Math.sqrt(GRAVITY * depth);
}

/**
 * 有限水深重力波色散关系 ω(k)
 * ω² = g k tanh(k h)
 */
export function omega(k: number, depth: number): number {
  if (k <= 0 || depth <= 0) return 0;
  return Math.sqrt(GRAVITY * k * Math.tanh(k * depth));
}

/** 相速度 c = ω/k */
export function phaseSpeed(k: number, depth: number): number {
  if (k <= 0) return Math.sqrt(GRAVITY * depth);
  return omega(k, depth) / k;
}

/** 群速度 c_g = dω/dk = (1/2) c (1 + 2kh/sinh(2kh)) */
export function groupSpeed(k: number, depth: number): number {
  if (k <= 0) return Math.sqrt(GRAVITY * depth);
  const kh = k * depth;
  const c = phaseSpeed(k, depth);
  if (kh > 60) return c * 0.5; // 深水极限
  return 0.5 * c * (1 + (2 * kh) / Math.sinh(2 * kh));
}

/**
 * 有限水深开尔文尾迹射线角 ψ（相对航迹线，弧度）。
 * 物理定义：船随动系中满足 U cosθ = c_p(k;h) 的波数，其群速度方向即能量射线。
 *   波数矢 k̂ = (-cosθ, sinθ)（船后），群速度大小 c_g = α·c_p，α=(1/2)(1+2kh/sinh2kh)
 *   射线矢 = U·x̂ + c_g·k̂（船运动 + 群速度的伽利略合成）
 * ψ = 该射线矢与航迹线（x 轴）的夹角，全 θ 域最大值即尾迹半角。
 * 深水：θ*=35.26° 处 ψ_max=19.47°；浅水 α 增大，ψ_max 向 90° 展宽。
 */
export function wakeRayAngle(chi: number, depth: number, speed: number) {
  const k = matchWavenumber(chi, depth, speed);
  const kh = k * depth;
  const alpha = kh > 60 ? 0.5 : 0.5 * (1 + (2 * kh) / Math.sinh(2 * kh));
  const cg = alpha * phaseSpeed(k, depth);
  // 射线矢分量（x 沿航向，z 横向）
  const rx = speed - cg * Math.cos(chi);
  const rz = cg * Math.sin(chi);
  const psi = Math.atan2(Math.abs(rz), Math.abs(rx));
  return { chi, k, alpha, psi };
}

/** 求解 U cosχ = c_p(k;h) 的正根 k（牛顿迭代 + 二分兜底） */
export function matchWavenumber(chi: number, depth: number, speed: number): number {
  const target = speed * Math.cos(chi);
  const cShallow = Math.sqrt(GRAVITY * depth);
  if (target >= cShallow) return 0; // 超临界，无匹配重力波
  // 二分：cp(k) 从 sqrt(gh) 单调递减到 0
  let lo = 1e-6;
  let hi = 1e4;
  for (let i = 0; i < 60; i++) {
    const mid = Math.sqrt(lo * hi);
    const cp = phaseSpeed(mid, depth);
    if (cp > target) lo = mid;
    else hi = mid;
    if (hi / lo < 1 + 1e-9) break;
  }
  return Math.sqrt(lo * hi);
}

/**
 * 理论开尔文尾迹半角（度）。
 * 深水 = 19.471°；浅水随 Fr_h 增大而增大，Fr_h→1 时→90°。
 * 对 χ ∈ (0, π/2) 扫描取 ψ 最大值。
 */
export function theoreticalWakeHalfAngle(depth: number, speed: number): number {
  const frH = depthFroude(speed, depth);
  if (frH >= 0.999) return 90;
  let maxPsi = 0;
  const n = 4000;
  for (let i = 1; i < n; i++) {
    const chi = (i / n) * (Math.PI / 2);
    const { psi } = wakeRayAngle(chi, depth, speed);
    if (psi > maxPsi && Number.isFinite(psi)) maxPsi = psi;
  }
  return (maxPsi * 180) / Math.PI;
}

/** 生成理论 ψ(χ) 曲线，供分析页绘图 */
export function theoreticalWakeCurve(depth: number, speed: number, n = 360) {
  const pts: { chiDeg: number; psiDeg: number; k: number; alpha: number }[] = [];
  for (let i = 1; i < n; i++) {
    const chi = (i / n) * (Math.PI / 2);
    const r = wakeRayAngle(chi, depth, speed);
    if (r.k > 0) {
      pts.push({
        chiDeg: (chi * 180) / Math.PI,
        psiDeg: (r.psi * 180) / Math.PI,
        k: r.k,
        alpha: r.alpha,
      });
    }
  }
  return pts;
}

export const KELVIN_HALF_ANGLE_DEEP = 19.4712206; // arcsin(1/3)
