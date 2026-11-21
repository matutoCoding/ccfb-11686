// 全局状态中心（发布订阅），聚合 localStorage 持久化
import type {
  AppData,
  HullParams,
  Project,
  SimSettings,
  TestCondition,
} from './types';
import { loadData, saveData, uid } from './storage';
import { defaultHullParams } from './hull';

type Listener = () => void;

class Store {
  data: AppData;
  private listeners = new Set<Listener>();

  constructor() {
    this.data = loadData();
    if (this.data.hulls.length === 0) this.seedDemo();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    saveData(this.data);
    this.listeners.forEach((fn) => fn());
  }

  private seedDemo() {
    const hullId = uid('hull');
    const hull = defaultHullParams(hullId);
    const cond1: TestCondition = {
      id: uid('cond'),
      hullId,
      name: '深水工况 Fr=0.30',
      updatedAt: Date.now(),
      speed: 2.06,
      waterDepth: 60,
      pressureAmp: 0.6,
      pressureLength: 0.12,
      pressureWidth: 0.55,
      notes: '深水开尔文尾迹标定工况',
    };
    const cond2: TestCondition = {
      id: uid('cond'),
      hullId,
      name: '浅水工况 Fr_h=0.7',
      updatedAt: Date.now(),
      speed: 2.06,
      waterDepth: 0.88,
      pressureAmp: 0.6,
      pressureLength: 0.12,
      pressureWidth: 0.55,
      notes: '有限水深尾迹角增大验证',
    };
    const project: Project = {
      id: uid('proj'),
      name: 'Wigley 船型水池方案',
      description: '演示方案：同一船型挂载深水/浅水两组工况',
      hullId,
      conditionIds: [cond1.id, cond2.id],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.data.hulls = [hull];
    this.data.conditions = [cond1, cond2];
    this.data.projects = [project];
    this.data.activeProjectId = project.id;
    this.data.activeConditionId = cond1.id;
    this.emit();
  }

  // —— 方案 ——
  addProject(name: string): Project {
    const hullId = this.data.hulls[0]?.id ?? uid('hull');
    if (this.data.hulls.length === 0) {
      this.data.hulls.push(defaultHullParams(hullId));
    }
    const p: Project = {
      id: uid('proj'),
      name,
      description: '',
      hullId,
      conditionIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.data.projects.push(p);
    this.data.activeProjectId = p.id;
    this.emit();
    return p;
  }

  removeProject(id: string) {
    const p = this.data.projects.find((x) => x.id === id);
    if (!p) return;
    this.data.conditions = this.data.conditions.filter((c) => !p.conditionIds.includes(c.id));
    this.data.projects = this.data.projects.filter((x) => x.id !== id);
    if (this.data.activeProjectId === id) {
      this.data.activeProjectId = this.data.projects[0]?.id ?? null;
      this.data.activeConditionId = null;
    }
    this.emit();
  }

  updateProject(id: string, patch: Partial<Project>) {
    const p = this.data.projects.find((x) => x.id === id);
    if (!p) return;
    Object.assign(p, patch, { updatedAt: Date.now() });
    this.emit();
  }

  setActive(projectId: string, conditionId?: string) {
    this.data.activeProjectId = projectId;
    if (conditionId !== undefined) this.data.activeConditionId = conditionId;
    this.emit();
  }

  // —— 船型 ——
  getHull(id: string): HullParams | undefined {
    return this.data.hulls.find((h) => h.id === id);
  }

  upsertHull(hull: HullParams) {
    const i = this.data.hulls.findIndex((h) => h.id === hull.id);
    hull.updatedAt = Date.now();
    if (i >= 0) this.data.hulls[i] = hull;
    else this.data.hulls.push(hull);
    this.emit();
  }

  // —— 工况 ——
  addCondition(projectId: string): TestCondition | undefined {
    const project = this.data.projects.find((p) => p.id === projectId);
    if (!project) return;
    const base = this.data.conditions.find((c) => c.hullId === project.hullId);
    const cond: TestCondition = {
      id: uid('cond'),
      hullId: project.hullId,
      name: `工况 ${project.conditionIds.length + 1}`,
      updatedAt: Date.now(),
      speed: base?.speed ?? 2,
      waterDepth: base?.waterDepth ?? 40,
      pressureAmp: base?.pressureAmp ?? 0.6,
      pressureLength: base?.pressureLength ?? 0.12,
      pressureWidth: base?.pressureWidth ?? 0.55,
    };
    this.data.conditions.push(cond);
    project.conditionIds.push(cond.id);
    project.updatedAt = Date.now();
    this.data.activeConditionId = cond.id;
    this.emit();
    return cond;
  }

  updateCondition(id: string, patch: Partial<TestCondition>) {
    const c = this.data.conditions.find((x) => x.id === id);
    if (!c) return;
    Object.assign(c, patch, { updatedAt: Date.now() });
    this.emit();
  }

  removeCondition(projectId: string, conditionId: string) {
    const project = this.data.projects.find((p) => p.id === projectId);
    this.data.conditions = this.data.conditions.filter((c) => c.id !== conditionId);
    if (project) project.conditionIds = project.conditionIds.filter((id) => id !== conditionId);
    if (this.data.activeConditionId === conditionId) {
      this.data.activeConditionId = project?.conditionIds[0] ?? null;
    }
    this.emit();
  }

  getCondition(id: string | null): TestCondition | undefined {
    if (!id) return undefined;
    return this.data.conditions.find((c) => c.id === id);
  }

  activeProject(): Project | undefined {
    return this.data.projects.find((p) => p.id === this.data.activeProjectId);
  }

  activeCondition(): TestCondition | undefined {
    return this.getCondition(this.data.activeConditionId);
  }

  // —— 设置 ——
  updateSettings(patch: Partial<SimSettings>) {
    Object.assign(this.data.settings, patch);
    this.emit();
  }
}

export const store = new Store();
