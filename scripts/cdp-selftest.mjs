// 极简 CDP 客户端（纯 JS）：导航到自检页并轮询 document.title / #result
const base = `http://127.0.0.1:${process.env.CDP_PORT ?? 9222}`;

async function getWsUrl() {
  const tabs = await (await fetch(`${base}/json/list`)).json();
  const page = tabs.find((t) => t.type === 'page') ?? tabs[0];
  return page.webSocketDebuggerUrl;
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const ready = new Promise((res) => { ws.onopen = () => res(); });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = (msg.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ');
      console.log('[browser]', text);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const ex = msg.params.exceptionDetails;
      console.log('[exception]', ex?.exception?.description ?? ex?.text);
    }
    if (msg.id && pending.has(msg.id)) {
      const entry = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? entry.reject(new Error(JSON.stringify(msg.error))) : entry.resolve(msg.result);
    }
  };
  function send(method, params = {}) {
    const myId = ++id;
    return new Promise((resolve, reject) => {
      pending.set(myId, { resolve, reject });
      ws.send(JSON.stringify({ id: myId, method, params }));
    });
  }
  return { ready, send, close: () => ws.close() };
}

const wsUrl = await getWsUrl();
const client = cdp(wsUrl);
await client.ready;
await client.send('Page.enable');
await client.send('Runtime.enable');
await client.send('Page.navigate', { url: process.env.TEST_URL ?? 'http://127.0.0.1:5199/selftest.html' });

const passTitle = process.env.PASS_TITLE ?? 'SELFTEST';
const deadline = Date.now() + 90000;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 2000));
  const title = await client.send('Runtime.evaluate', { expression: 'document.title' });
  if (String(title.result?.value ?? '').includes(passTitle)) {
    const body = await client.send('Runtime.evaluate', {
      expression: 'document.getElementById("result").textContent',
    });
    console.log('\n===== 自检结果 =====');
    console.log(body.result.value);
    client.close();
    process.exit(0);
  }
}
console.log('TIMEOUT waiting for selftest');
client.close();
process.exit(1);
