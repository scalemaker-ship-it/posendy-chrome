/**
 * POSENDY bridge: the part of the extension that publishes Naver Blog posts for posendy.com.
 *
 * Flow: popup stores a POSENDY API key → every 30 s (alarm) the background sends a heartbeat
 * and claims one queued job (GET /api/ext/jobs) → opens blog.naver.com/<blogId>/postwrite in a
 * background tab → injects inject-scripts/naver-publish.js in the page's MAIN world → polls
 * window.__posendyResult → reports the outcome (POST /api/ext/jobs/<id>). If Naver asks for a
 * login the job is parked as `needs_login` and the tab is left open for the person.
 */
export const POSENDY_STORAGE_KEY = 'posendy_bridge';
const ALARM = 'posendy-poll';
const POLL_MINUTES = 0.5;
const VERSION = chrome.runtime.getManifest().version;

export type PosendySettings = { apiKey?: string; baseUrl?: string; lastHeartbeat?: string; lastResult?: string; lastError?: string; workspace?: string };
export type PosendyJob = {
  id: string;
  blogId: string;
  title: string;
  content: string;
  tags: string[];
  category?: string;
  openType?: 'public' | 'private' | 'neighbor';
  mode: 'publish' | 'draft';
  media: { url: string; type: 'image' | 'video'; name?: string }[];
};

const DEFAULT_BASE = 'https://posendy.com';
let running = false;

export async function getSettings(): Promise<PosendySettings> {
  const r = await chrome.storage.local.get(POSENDY_STORAGE_KEY);
  return (r[POSENDY_STORAGE_KEY] as PosendySettings) || {};
}
export async function saveSettings(patch: Partial<PosendySettings>) {
  const cur = await getSettings();
  await chrome.storage.local.set({ [POSENDY_STORAGE_KEY]: { ...cur, ...patch } });
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const s = await getSettings();
  if (!s.apiKey) throw new Error('no_api_key');
  const res = await fetch(`${(s.baseUrl || DEFAULT_BASE).replace(/\/$/, '')}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${s.apiKey}`, 'content-type': 'application/json', 'x-posendy-ext': VERSION, ...(init?.headers || {}) },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(body?.error?.message || body?.error || `http_${res.status}`);
  return body as T;
}

/** Popup "연결 확인": validates the key and returns the workspace name + naver accounts. */
export async function testConnection() {
  const me = await api<{ workspace: { id: string; name: string }; accounts: { username: string; projectName?: string }[] }>('/api/ext/me');
  await saveSettings({ workspace: me.workspace.name, lastError: undefined });
  return me;
}

async function waitTabComplete(tabId: number, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete' && tab.url) return tab;
    await new Promise((r) => setTimeout(r, 300));
  }
  return chrome.tabs.get(tabId);
}

async function mainWorld<T>(tabId: number, func: (...a: any[]) => T, args: any[] = []): Promise<T> {
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func, args });
  return r?.result as T;
}

async function runJob(job: PosendyJob) {
  const url = `https://blog.naver.com/${job.blogId}/postwrite`;
  const tab = await chrome.tabs.create({ url, active: false });
  const tabId = tab.id!;
  try {
    const loaded = await waitTabComplete(tabId);
    if (/nid\.naver\.com|\/login/i.test(loaded.url || '')) {
      await chrome.tabs.update(tabId, { active: true });
      return { status: 'needs_login' as const, error: '네이버 로그인이 필요해요. 열린 탭에서 로그인해 주세요.' };
    }
    // the editor is a SPA; give it a moment, then hand the job over
    await new Promise((r) => setTimeout(r, 2500));
    await mainWorld(tabId, (j: PosendyJob) => {
      (window as any).__posendyJob = j;
      (window as any).__posendyResult = { id: j.id, status: 'running' };
    }, [job]);
    await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', files: ['/inject-scripts/naver-publish.js'] });
    const t0 = Date.now();
    let last: any = {};
    while (Date.now() - t0 < 6 * 60 * 1000) {
      await new Promise((r) => setTimeout(r, 1500));
      const cur = await chrome.tabs.get(tabId).catch(() => null);
      if (!cur) return { status: 'failed' as const, error: 'tab_closed' };
      // after "발행" the editor navigates to the new post URL
      if (cur.url && /blog\.naver\.com\/[^/]+\/(\d{6,})/.test(cur.url)) {
        return { status: 'done' as const, url: cur.url.split('?')[0] };
      }
      if (cur.url && /PostView|logNo=/.test(cur.url)) return { status: 'done' as const, url: cur.url };
      try {
        last = await mainWorld(tabId, () => (window as any).__posendyResult);
      } catch {
        continue; // page navigating
      }
      if (last?.status === 'failed') return { status: 'failed' as const, error: last.error, step: last.step };
      if (last?.status === 'needs_login') {
        await chrome.tabs.update(tabId, { active: true });
        return { status: 'needs_login' as const, error: last.error };
      }
      if (last?.status === 'done') return { status: 'done' as const, url: last.url, mode: last.mode };
      await saveSettings({ lastResult: `${job.id}: ${last?.step || 'running'}` });
    }
    return { status: 'failed' as const, error: 'timeout', step: last?.step };
  } finally {
    const final = await chrome.tabs.get(tabId).catch(() => null);
    // keep the tab when the person must log in; otherwise close it to leave no trace
    let parked = false;
    try {
      parked = Boolean(await mainWorld(tabId, () => (window as any).__posendyResult?.status === 'needs_login'));
    } catch {
      /* navigated */
    }
    if (final && !parked && !/nid\.naver\.com/.test(final.url || '')) await chrome.tabs.remove(tabId).catch(() => undefined);
  }
}

export async function pollOnce(): Promise<void> {
  if (running) return;
  const s = await getSettings();
  if (!s.apiKey) return;
  running = true;
  try {
    const r = await api<{ job: PosendyJob | null; pending: number }>('/api/ext/jobs?claim=1');
    await saveSettings({ lastHeartbeat: new Date().toISOString(), lastError: undefined });
    if (!r.job) return;
    const out = await runJob(r.job);
    await api(`/api/ext/jobs/${encodeURIComponent(r.job.id)}`, { method: 'POST', body: JSON.stringify(out) });
    await saveSettings({ lastResult: `${r.job.title}: ${out.status}${out.status === 'failed' ? ' (' + out.error + ')' : ''}` });
  } catch (e: any) {
    await saveSettings({ lastError: e?.message || String(e) });
  } finally {
    running = false;
  }
}

export function initPosendyBridge() {
  chrome.alarms.create(ALARM, { periodInMinutes: POLL_MINUTES });
  chrome.alarms.onAlarm.addListener((a) => {
    if (a.name === ALARM) pollOnce();
  });
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('posendy:')) return;
    (async () => {
      switch (msg.type) {
        case 'posendy:getSettings':
          return getSettings();
        case 'posendy:saveKey':
          await saveSettings({ apiKey: msg.apiKey, baseUrl: msg.baseUrl || DEFAULT_BASE });
          return testConnection();
        case 'posendy:test':
          return testConnection();
        case 'posendy:pollNow':
          await pollOnce();
          return getSettings();
        case 'posendy:disconnect':
          await chrome.storage.local.remove(POSENDY_STORAGE_KEY);
          return {};
      }
    })()
      .then((r) => sendResponse({ ok: true, data: r }))
      .catch((e) => sendResponse({ ok: false, error: e?.message || String(e) }));
    return true;
  });
  // first poll shortly after startup
  setTimeout(() => pollOnce(), 5000);
}
