// 应用主页面冒烟测试：逐页导航，捕获控制台错误与异常
const port = process.env.CDP_PORT ?? 9225;
const routes = ['projects', 'hull', 'condition', 'simulation', 'analysis', 'settings'];
const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket((tabs.find((t) => t.type === 'page') ?? tabs[0]).webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });
let mid = 0;
const pending = new Map();
const errors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') {
    errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    errors.push('console.error: ' + (m.params.args ?? []).map((a) => a.value ?? a.description).join(' '));
  }
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
};
function send(method, params = {}) {
  const id = ++mid;
  return new Promise((res) => { pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
await send('Runtime.enable');
await send('Page.enable');

for (const route of routes) {
  errors.length = 0;
  await send('Page.navigate', { url: `http://127.0.0.1:5199/#/${route}` });
  await new Promise((r) => setTimeout(r, 2500));
  const title = await send('Runtime.evaluate', { expression: 'document.querySelector(".page-title")?.textContent ?? "无标题"', returnByValue: true });
  const bodyLen = await send('Runtime.evaluate', { expression: 'document.querySelector("main.page")?.children.length ?? 0', returnByValue: true });
  console.log(`[${route}] 标题="${title.result.value}" 子元素=${bodyLen.result.value} 错误=${errors.length}`);
  for (const err of errors.slice(0, 3)) console.log('   ⚠', err.split('\n')[0]);
}
ws.close();
