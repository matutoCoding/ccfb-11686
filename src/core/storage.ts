// 持久化：方案/船型/工况存 localStorage，波高快照存 IndexedDB
import type {
  AppData,
  SnapshotBundle,
  SnapshotMeta,
} from './types';
import { DEFAULT_SETTINGS } from './types';

const LS_KEY = 'ship-wake-lab-v1';
const DB_NAME = 'swl-snapshots';
const DB_VERSION = 1;
const STORE = 'snapshots';

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppData>;
      return {
        projects: parsed.projects ?? [],
        hulls: parsed.hulls ?? [],
        conditions: parsed.conditions ?? [],
        settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
        activeProjectId: parsed.activeProjectId ?? null,
        activeConditionId: parsed.activeConditionId ?? null,
      };
    }
  } catch (e) {
    console.error('读取本地数据失败', e);
  }
  return {
    projects: [],
    hulls: [],
    conditions: [],
    settings: { ...DEFAULT_SETTINGS },
    activeProjectId: null,
    activeConditionId: null,
  };
}

export function saveData(data: AppData): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('保存本地数据失败（可能超出 localStorage 配额）', e);
    alert('数据保存失败：localStorage 配额不足，请减少实测数据点数或清理旧方案。');
  }
}

// —— IndexedDB 波高快照 ——

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id' });
        os.createIndex('conditionId', 'conditionId');
        os.createIndex('createdAt', 'createdAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putSnapshot(bundle: SnapshotBundle): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(bundle);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }).finally(() => db.close());
}

export async function getSnapshot(id: string): Promise<SnapshotBundle | undefined> {
  const db = await openDB();
  try {
    return await new Promise<SnapshotBundle | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result as SnapshotBundle | undefined);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function listSnapshotMeta(conditionId?: string): Promise<SnapshotMeta[]> {
  const db = await openDB();
  try {
    return await new Promise<SnapshotMeta[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      const req = conditionId
        ? store.index('conditionId').getAll(conditionId)
        : store.getAll();
      req.onsuccess = () => {
        const all = (req.result as SnapshotBundle[]).map(
          ({ heights, ...meta }) => {
            void heights;
            return meta as SnapshotMeta;
          },
        );
        all.sort((a, b) => b.createdAt - a.createdAt);
        resolve(all);
      };
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function deleteSnapshot(id: string): Promise<void> {
  const db = await openDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
