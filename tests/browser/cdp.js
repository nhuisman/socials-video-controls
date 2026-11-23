'use strict';

// A small Chrome DevTools Protocol client: connect to a page, evaluate code in
// it, navigate, and send real input.
//
// No dependencies. Node 22+ has a built-in WebSocket, which is all this needs.

const DEFAULT_PORT = Number(process.env.IGVC_CDP_PORT || 9223);

async function listTargets(port = DEFAULT_PORT) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  return res.json();
}

async function cdpVersion(port = DEFAULT_PORT) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2500) });
    return res.ok ? res.json() : null;
  } catch (e) {
    return null;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class Page {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.initScripts = [];
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.error) entry.reject(new Error(`${entry.method}: ${msg.error.message}`));
      else entry.resolve(msg.result);
    });
  }

  send(method, params = {}, timeoutMs = 60000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  // Evaluates an expression in the page and returns its value. An async
  // expression is awaited. A page-side exception becomes a rejection here, so a
  // broken expression fails the test rather than returning undefined.
  async eval(expression, { label = 'eval' } = {}) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (result.exceptionDetails) {
      const ex = result.exceptionDetails.exception || {};
      throw new Error(`${label}: ${ex.description || ex.value || 'page exception'}`);
    }
    return result.result.value;
  }

  // Registers a script to run before any page script on the next document,
  // which is how a document_start content script is reproduced.
  async addInitScript(source) {
    const { identifier } = await this.send('Page.addScriptToEvaluateOnNewDocument', { source });
    this.initScripts.push(identifier);
    return identifier;
  }

  async clearInitScripts() {
    for (const identifier of this.initScripts.splice(0)) {
      await this.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }).catch(() => {});
    }
  }

  // Navigates and waits. Always goes via about:blank first, because a
  // navigation to the same URL differing only in its fragment is a
  // same-document change: no new document is created, so init scripts never
  // run and a document_start capture is never exercised.
  async goto(url, { settleMs = 9000 } = {}) {
    await this.send('Page.navigate', { url: 'about:blank' });
    await sleep(600);
    await this.send('Page.navigate', { url });
    await sleep(settleMs);
  }

  async mouseMove(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  }

  // Real input, not a synthesised PointerEvent. A constructed PointerEvent
  // carries a pointerId that was never a live pointer, so setPointerCapture
  // throws and any drag handler aborts before it starts.
  async drag(from, to, { steps = 10, stepMs = 110, onStep = null } = {}) {
    await this.mouseMove(from.x, from.y);
    await sleep(120);
    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1
    });
    await sleep(150);
    for (let i = 1; i <= steps; i++) {
      const x = Math.round(from.x + ((to.x - from.x) * i) / steps);
      const y = Math.round(from.y + ((to.y - from.y) * i) / steps);
      await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
      await sleep(stepMs);
      if (onStep) await onStep(i);
    }
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1
    });
    await sleep(250);
  }

  async key(key, { text = null, holdMs = 40, code = null, keyCode = null } = {}) {
    const down = { type: 'keyDown', key };
    if (text !== null) down.text = text;
    else if (key.length === 1) down.text = key;
    if (code) down.code = code;
    if (keyCode) down.windowsVirtualKeyCode = keyCode;
    await this.send('Input.dispatchKeyEvent', down);
    await sleep(holdMs);
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, ...(code ? { code } : {}), ...(keyCode ? { windowsVirtualKeyCode: keyCode } : {}) });
    await sleep(120);
  }

  // Holds a key down for a given time, for anything that distinguishes a tap
  // from a hold.
  async holdKey(key, holdMs) {
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key, text: key.length === 1 ? key : undefined });
    await sleep(holdMs);
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key });
    await sleep(200);
  }

  async escape() {
    await this.key('Escape', { text: '', keyCode: 27 });
  }

  close() {
    try { this.ws.close(); } catch (e) {}
  }
}

async function attachToPage({ port = DEFAULT_PORT, match = null } = {}) {
  const targets = await listTargets(port);
  const candidates = targets.filter((t) => t.type === 'page');
  if (!candidates.length) throw new Error('no page target open in the debug browser');
  const target = match ? (candidates.find((t) => t.url.includes(match)) || candidates[0]) : candidates[0];
  const ws = await new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    socket.addEventListener('open', () => resolve(socket));
    socket.addEventListener('error', () => reject(new Error('could not open a CDP websocket')));
  });
  const page = new Page(ws);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  return page;
}

module.exports = { attachToPage, listTargets, cdpVersion, sleep, DEFAULT_PORT };
