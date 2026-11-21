// 全局数据模型：方案 / 船型 / 工况 / 实测数据

/** 船型主尺度与型线参数（参数化生成） */
export interface HullParams {
  id: string;
  name: string;
  updatedAt: number;
  // —— 主尺度（米）——
  lengthBP: number;        // 垂线间长 Lpp
  beam: number;            // 型宽 B
  draft: number;           // 吃水 T
  blockCoeff: number;      // 方形系数 Cb (0.4–0.85)
  midshipCoeff: number;    // 中横剖面系数 Cm (0.7–0.98)
  // —— 型线形状参数 ——
  entranceAngle: number;   // 进流段半角（度），影响首部外飘
  prismaticCurve: number;  // 棱形曲线饱满度 (-1 偏V形 … +1 偏U形)
  bulb: number;            // 球鼻艏强度 0–1
  transom: number;         // 方艉宽度比 0–1
}

/** 水池试验工况 */
export interface TestCondition {
  id: string;
  hullId: string;
  name: string;
  updatedAt: number;
  // —— 工况参数 ——
  speed: number;           // 船速 U (m/s)
  waterDepth: number;      // 水深 h (m)
  pressureAmp: number;     // 等效压力源幅值系数（×ρg 量纲参考，0.1–10）
  pressureLength: number;  // 压力斑沿船长方向特征长度（×L）
  pressureWidth: number;   // 压力斑横向特征宽度（×B）
  // —— 回填实测 ——
  measured?: MeasuredCut[];
  notes?: string;
}

/** 实测波高剖面：一条纵剖线（沿船长 x 方向） */
export interface MeasuredCut {
  id: string;
  label: string;           // 例如 "y/L = 0.10"
  yOffset: number;         // 横向位置（米，相对船中纵剖面）
  xStart: number;          // 剖面起点 x（米，船中为 0，艏为正）
  dx: number;              // 采样间距（米）
  values: number[];        // 实测波高（米）
  measuredAt: number;
}

/** 仿真方案：一个船型挂多组工况 */
export interface Project {
  id: string;
  name: string;
  description: string;
  hullId: string;
  conditionIds: string[];
  createdAt: number;
  updatedAt: number;
}

/** 仿真网格与数值设置 */
export interface SimSettings {
  gridN: number;           // 网格分辨率（2 的幂：128/256/512/1024）
  domainLength: number;    // 水池域长（米）
  cfl: number;             // 时间步长系数（dt = cfl * dx/c_g,max 近似）
  spongeWidth: number;     // 消波层宽度占比 0.05–0.25
  dampingStrength: number; // 消波强度
  renderFoam: boolean;     // 白浪泡沫
  renderReflection: boolean;
  foamThreshold: number;   // 起泡沫波陡阈值
  cameraFollow: boolean;   // 相机跟随船体
}

/** 波高快照（IndexedDB 存储，供分析页离线对比） */
export interface SnapshotMeta {
  id: string;
  conditionId: string;
  projectId: string;
  createdAt: number;
  simTime: number;
  gridN: number;
  domainLength: number;
  speed: number;
  waterDepth: number;
  depthFroude: number;
  lengthFroude: number;
  shipX: number;          // 快照时船位 x（域坐标，米）
  shipZ: number;
  hullLength: number;
  hullBeam: number;
}

export interface SnapshotBundle extends SnapshotMeta {
  /** Float32 高度场，行优先，长度 gridN*gridN，单位米 */
  heights: Float32Array;
}

export interface AppData {
  projects: Project[];
  hulls: HullParams[];
  conditions: TestCondition[];
  settings: SimSettings;
  activeProjectId: string | null;
  activeConditionId: string | null;
}

export const DEFAULT_SETTINGS: SimSettings = {
  gridN: 512,
  domainLength: 200,
  cfl: 0.9,
  spongeWidth: 0.12,
  dampingStrength: 3.0,
  renderFoam: true,
  renderReflection: true,
  foamThreshold: 0.012,
  cameraFollow: true,
};
