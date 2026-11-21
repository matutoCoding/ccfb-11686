// 全局数据模型与常量

export const GRAVITY = 9.80665; // 重力加速度 m/s^2
export const KNOT_TO_MPS = 0.514444;

/** 船型参数化定义(主尺度 + 型线参数) */
export interface HullSpec {
  id: string;
  name: string;
  Lpp: number; // 垂线间长 m
  B: number; // 型宽 m
  T: number; // 设计吃水 m
  Cb: number; // 方型系数 0.4..0.85
  Cm: number; // 中横剖面系数 0.7..0.98
  Cwp: number; // 水线面系数 0.6..0.95
  LCB: number; // 纵向浮心, 距船中 %Lpp, 艏为正 -3..3
  sectionShape: number; // 横剖面形状 0=V 型 .. 1=U 型
  bulb: number; // 球鼻艏强度 0..1
  transom: number; // 方艉宽度系数(相对 B/2) 0..1
  updatedAt: number;
}

/** 实测波高剖面(试验回填) */
export interface MeasuredProfile {
  id: string;
  label: string;
  /** 横向测点位置, 距舷侧或船中线的距离 m (船中线为 0) */
  yOffset: number;
  /** 纵向位置 x m(船中为 0, 艏为正), 波高 z m */
  points: { x: number; z: number }[];
  importedAt: number;
}

/** 水池试验工况(同一船型可挂多组) */
export interface TrialCondition {
  id: string;
  hullId: string;
  name: string;
  speedKnots: number; // 船速 节
  deepWater: boolean; // 深水标记
  waterDepth: number; // 水深 m (deepWater=true 时忽略)
  pressureAmp: number; // 移动压力源强度 p0/rho, m^2/s^2
  sourceScale: number; // 压力源高斯尺度 m (典型 0.15~0.35 Lpp)
  nearFieldRatio: number; // 近场伯努利波面比例 0..1
  measured: MeasuredProfile[];
  createdAt: number;
  updatedAt: number;
}

export interface AppSettings {
  gridSize: number; // 仿真网格 N x N
  domainLength: number; // 计算域纵向长度 m
  spectralComponents: number; // 谱积分分量数
  fdtdDamping: number; // 边界阻尼层宽度占比
  fdtdGain: number; // 动态层增益
  foamThreshold: number; // 白浪阈值(波陡)
  renderScale: number; // 渲染分辨率比例
  showFps: boolean;
}

export interface ProjectData {
  version: 1;
  hulls: HullSpec[];
  conditions: TrialCondition[];
  settings: AppSettings;
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function defaultSettings(): AppSettings {
  return {
    gridSize: 512,
    domainLength: 120,
    spectralComponents: 160,
    fdtdDamping: 0.08,
    fdtdGain: 0.35,
    foamThreshold: 0.55,
    renderScale: 1,
    showFps: true,
  };
}
