// 仿真页深度验证：进入仿真页等待 GPU 引擎启动，检查 canvas 渲染与 HUD FPS
const port = process.env.CDP_PORT ?? 9225;
const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket((tabs.find((t) => t.type === 'page') ?? tabs[0]).webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });
let mid = 0;
const pending = new Map();
const errors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
};
function send(method, params = {}) { const id = ++mid; return new Promise((res) => { pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:5199/#/simulation' });
await new Promise((r) => setTimeout(r, 9000)); // 等引擎启动+多帧

const evalExpr = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.value;
const canvasSize = await evalExpr('(() => { const c=document.querySelector(".sim-view canvas"); return c?`${c.width}x${c.height}`:"无canvas"; })()');
const hudText = await evalExpr('document.querySelector(".hud")?.textContent?.replace(/\\s+/g," ").trim() ?? "无HUD"');
const hasErrorBox = await evalExpr('!!document.querySelector(".error-box")');
const errorBoxText = await evalExpr('document.querySelector(".error-box")?.textContent ?? ""');
console.log('canvas 尺寸:', canvasSize);
console.log('HUD:', hudText);
console.log('错误框:', hasErrorBox, errorBoxText.slice(0, 200));
console.log('运行时异常:', errors.length, errors.slice(0, 2).join(' | '));
ws.close();
