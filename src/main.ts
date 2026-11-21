import './styles.css';
import { h, clear } from './ui/dom.ts';
import { store } from './state/store.ts';
import { renderProjectPage } from './ui/pages/projectPage.ts';
import { renderHullPage } from './ui/pages/hullPage.ts';
import { renderConditionPage } from './ui/pages/conditionPage.ts';
import { renderSimPage } from './ui/pages/simPage.ts';
import { renderAnalysisPage } from './ui/pages/analysisPage.ts';
import { renderSettingsPage } from './ui/pages/settingsPage.ts';

type Route =
  | { page: 'project' }
  | { page: 'hull'; id: string }
  | { page: 'condition'; id: string }
  | { page: 'sim'; id: string }
  | { page: 'analysis'; id?: string }
  | { page: 'settings' };

const NAV: { key: Route['page']; label: string }[] = [
  { key: 'project', label: '方案列表' },
  { key: 'hull', label: '船型编辑' },
  { key: 'condition', label: '工况设置' },
  { key: 'sim', label: '水面仿真' },
  { key: 'analysis', label: '波形分析' },
  { key: 'settings', label: '设置' },
];

const app = document.getElementById('app')!;
const main = h('main', { class: 'main' });

function parseHash(): Route {
  const raw = location.hash.replace(/^#\/?/, '');
  const [page, id] = raw.split('/');
  switch (page) {
    case 'hull': return { page: 'hull', id: id ?? '' };
    case 'condition': return { page: 'condition', id: id ?? '' };
    case 'sim': return { page: 'sim', id: id ?? '' };
    case 'analysis': return { page: 'analysis', id };
    case 'settings': return { page: 'settings' };
    default: return { page: 'project' };
  }
}

function navigate(route: Route) {
  const path = 'id' in route && route.id ? `${route.page}/${route.id}` : route.page;
  if (`#/${path}` !== location.hash) location.hash = `/${path}`;
  else render();
}

// 页面跳转辅助(传给各页)
const go = (page: string, id?: string) => navigate({ page, ...(id ? { id } : {}) } as Route);

function render() {
  const route = parseHash();
  clear(main);
  // 侧边导航高亮: 详情页归入对应顶层菜单
  const activeTop = route.page === 'hull' ? 'hull'
    : route.page === 'condition' ? 'condition'
    : route.page === 'sim' ? 'sim'
    : route.page;

  const sidebar = h('nav', { class: 'sidebar' },
    h('div', { class: 'brand' }, '船行波仿真系统'),
    ...NAV.map((n) =>
      h('div', {
        class: `nav-item${n.key === activeTop ? ' active' : ''}`,
        onclick: () => {
          if (n.key === 'hull') {
            const first = store_firstHull();
            navigate(first ? { page: 'hull', id: first } : { page: 'project' });
          } else if (n.key === 'condition' || n.key === 'sim') {
            const first = store_firstCondition();
            navigate(first ? { page: n.key, id: first } as Route : { page: 'project' });
          } else if (n.key === 'analysis') {
            navigate({ page: 'analysis' });
          } else {
            navigate({ page: n.key } as Route);
          }
        },
      }, n.label),
    ),
    h('div', { class: 'spacer' }),
    h('div', { class: 'meta' }, 'TypeScript + WebGPU\n船模拖曳水池辅助系统'),
  );

  app.replaceChildren(sidebar, main);

  try {
    switch (route.page) {
      case 'project': renderProjectPage(main, go); break;
      case 'hull': renderHullPage(main, route.id, go); break;
      case 'condition': renderConditionPage(main, route.id, go); break;
      case 'sim': renderSimPage(main, route.id, go); break;
      case 'analysis': renderAnalysisPage(main, route.id); break;
      case 'settings': renderSettingsPage(main); break;
    }
  } catch (err) {
    clear(main);
    main.append(h('div', { class: 'err-box' }, (err as Error).message));
  }
}

// 避免循环依赖, 延迟读取 store
function store_firstHull(): string | undefined {
  return store.data.hulls[0]?.id;
}
function store_firstCondition(): string | undefined {
  return store.data.conditions[0]?.id;
}

window.addEventListener('hashchange', render);
if (!location.hash) location.hash = '/project';
else render();
