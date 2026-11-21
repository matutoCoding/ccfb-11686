// Hash 路由
export type Route =
  | 'projects'
  | 'hull'
  | 'condition'
  | 'simulation'
  | 'analysis'
  | 'settings';

export const ROUTES: { id: Route; label: string; icon: string }[] = [
  { id: 'projects', label: '方案列表', icon: '▤' },
  { id: 'hull', label: '船型编辑', icon: '⛵' },
  { id: 'condition', label: '工况设置', icon: '⚙' },
  { id: 'simulation', label: '水面仿真', icon: '🌊' },
  { id: 'analysis', label: '波形分析', icon: '∿' },
  { id: 'settings', label: '设置', icon: '✦' },
];

export function currentRoute(): Route {
  const r = location.hash.replace('#/', '') as Route;
  return (ROUTES.some((x) => x.id === r) ? r : 'projects') as Route;
}

export function navigate(route: Route) {
  location.hash = `#/${route}`;
}

export function onRouteChange(fn: (r: Route) => void): () => void {
  const handler = () => fn(currentRoute());
  window.addEventListener('hashchange', handler);
  return () => window.removeEventListener('hashchange', handler);
}
