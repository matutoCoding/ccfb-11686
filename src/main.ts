// 应用入口：顶栏 + 侧栏 + 路由分发
import './styles.css';
import { store } from './core/store';
import { currentRoute, navigate, onRouteChange, ROUTES } from './ui/router';
import type { Route } from './ui/router';
import { h, clear } from './ui/dom';
import { renderProjectsPage } from './ui/pages/projects';
import { renderHullPage } from './ui/pages/hull';
import { renderConditionPage } from './ui/pages/condition';
import { renderSimulationPage } from './ui/pages/simulation';
import { renderAnalysisPage } from './ui/pages/analysis';
import { renderSettingsPage } from './ui/pages/settings';

const app = document.getElementById('app')!;
let cleanup: (() => void) | void;

function render() {
  const route = currentRoute();
  const project = store.activeProject();
  const cond = store.activeCondition();

  const nav = h('nav', { class: 'sidebar' });
  for (const r of ROUTES) {
    nav.append(h('div', {
      class: `nav-item ${route === r.id ? 'active' : ''}`,
      onclick: () => navigate(r.id),
    }, h('span', { class: 'ico' }, r.icon), r.label));
  }
  nav.append(h('div', { class: 'foot' },
    '船行波仿真实验室', h('br'), 'TypeScript + WebGPU', h('br'), 'v0.1.0'));

  const gpuSupported = !!navigator.gpu;
  const top = h('header', { class: 'topbar' },
    h('div', { class: 'logo' }, '船行波仿真实验室', h('small', {}, 'Ship Wake Lab')),
    h('div', { class: 'crumbs' },
      project ? `方案「${project.name}」` : '未选择方案',
      cond ? h('span', {}, '　/　工况「', h('b', {}, cond.name), '」') : null,
    ),
    h('div', { class: 'spacer' }),
    h('div', { class: `gpu-badge ${gpuSupported ? '' : 'bad'}` },
      gpuSupported ? 'WebGPU 可用' : 'WebGPU 不可用'),
  );

  const main = h('main', { class: 'page' });
  if (typeof cleanup === 'function') cleanup();
  cleanup = undefined;

  const pages: Record<Route, (el: HTMLElement) => unknown> = {
    projects: renderProjectsPage,
    hull: renderHullPage,
    condition: renderConditionPage,
    simulation: renderSimulationPage,
    analysis: renderAnalysisPage,
    settings: renderSettingsPage,
  };
  const result = pages[route](main);
  if (typeof result === 'function') cleanup = result as () => void;

  clear(app);
  app.append(top, h('div', { class: 'layout' }, nav, main));
}

store.subscribe(render);
onRouteChange(render);
if (!location.hash) location.hash = '#/projects';
render();
