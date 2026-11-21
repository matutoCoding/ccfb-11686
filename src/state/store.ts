// 轻量响应式 store + localStorage 持久化(无外部框架依赖)
import type { ProjectData, HullSpec, TrialCondition, AppSettings } from '../core/types.ts';
import { defaultSettings, uid } from '../core/types.ts';

const STORAGE_KEY = 'ship-wake-sim-project-v1';

type Listener = () => void;

class Store {
  data: ProjectData;
  private listeners = new Set<Listener>();

  constructor() {
    this.data = this.load();
    this.persist(); // 首次加载的种子数据也落盘, 保证刷新/跨标签可读
  }

  private load(): ProjectData {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ProjectData;
        if (parsed.version === 1 && Array.isArray(parsed.hulls)) return parsed;
      }
    } catch {
      /* 损坏数据则回退默认 */
    }
    return seedProject();
  }

  private persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      /* 配额满时静默 */
    }
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    this.persist();
    this.listeners.forEach((fn) => fn());
  }

  // ---- hulls ----
  addHull(partial: Partial<HullSpec>): HullSpec {
    const hull: HullSpec = { ...defaultHull(), ...partial, id: uid('hull'), updatedAt: Date.now() };
    this.data.hulls.push(hull);
    this.emit();
    return hull;
  }

  updateHull(id: string, patch: Partial<HullSpec>) {
    const h = this.data.hulls.find((x) => x.id === id);
    if (!h) return;
    Object.assign(h, patch, { updatedAt: Date.now() });
    this.emit();
  }

  removeHull(id: string) {
    this.data.hulls = this.data.hulls.filter((h) => h.id !== id);
    this.data.conditions = this.data.conditions.filter((c) => c.hullId !== id);
    this.emit();
  }

  // ---- conditions ----
  addCondition(hullId: string, partial: Partial<TrialCondition> = {}): TrialCondition {
    const cond: TrialCondition = {
      ...defaultCondition(hullId),
      ...partial,
      id: uid('cond'),
      hullId,
      measured: partial.measured ?? [],
    };
    this.data.conditions.push(cond);
    this.emit();
    return cond;
  }

  updateCondition(id: string, patch: Partial<TrialCondition>) {
    const c = this.data.conditions.find((x) => x.id === id);
    if (!c) return;
    Object.assign(c, patch, { updatedAt: Date.now() });
    this.emit();
  }

  removeCondition(id: string) {
    this.data.conditions = this.data.conditions.filter((c) => c.id !== id);
    this.emit();
  }

  addMeasured(condId: string, measured: TrialCondition['measured'][number]) {
    const c = this.data.conditions.find((x) => x.id === condId);
    if (!c) return;
    c.measured.push(measured);
    this.emit();
  }

  removeMeasured(condId: string, measuredId: string) {
    const c = this.data.conditions.find((x) => x.id === condId);
    if (!c) return;
    c.measured = c.measured.filter((m) => m.id !== measuredId);
    this.emit();
  }

  // ---- settings ----
  updateSettings(patch: Partial<AppSettings>) {
    Object.assign(this.data.settings, patch);
    this.emit();
  }

  resetAll() {
    this.data = seedProject();
    this.emit();
  }

  exportJson(): string {
    return JSON.stringify(this.data, null, 2);
  }

  importJson(json: string): boolean {
    try {
      const parsed = JSON.parse(json) as ProjectData;
      if (parsed.version !== 1 || !Array.isArray(parsed.hulls)) return false;
      this.data = parsed;
      this.emit();
      return true;
    } catch {
      return false;
    }
  }
}

export function defaultHull(): HullSpec {
  return {
    id: '',
    name: '新船型',
    Lpp: 16,
    B: 2.4,
    T: 0.9,
    Cb: 0.62,
    Cm: 0.92,
    Cwp: 0.78,
    LCB: 0.5,
    sectionShape: 0.5,
    bulb: 0.3,
    transom: 0.4,
    updatedAt: Date.now(),
  };
}

export function defaultCondition(hullId: string): TrialCondition {
  return {
    id: '',
    hullId,
    name: '工况 1',
    speedKnots: 7.8,
    deepWater: true,
    waterDepth: 8,
    pressureAmp: 0.12,
    sourceScale: 3,
    nearFieldRatio: 0.35,
    measured: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function seedProject(): ProjectData {
  const hull: HullSpec = {
    ...defaultHull(),
    id: uid('hull'),
    name: '示范巡逻艇 16m',
  };
  const cond: TrialCondition = {
    ...defaultCondition(hull.id),
    id: uid('cond'),
    name: '深水 Fr=0.32',
  };
  const cond2: TrialCondition = {
    ...defaultCondition(hull.id),
    id: uid('cond'),
    name: '浅水 Fh=0.6',
    deepWater: false,
    waterDepth: 3.2,
    speedKnots: 6.5,
  };
  return {
    version: 1,
    hulls: [hull],
    conditions: [cond, cond2],
    settings: defaultSettings(),
  };
}

export const store = new Store();
