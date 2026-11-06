<template>
  <div class="section posendy-section">
    <h2 class="section-title">포샌디 연결</h2>
    <div class="config-card posendy-card">
      <template v-if="settings.apiKey">
        <div class="posendy-row">
          <span class="posendy-dot" :class="{ on: online }" />
          <span class="posendy-status">{{ online ? '연결됨' : '확인 중' }}</span>
          <span v-if="settings.workspace" class="posendy-muted">{{ settings.workspace }}</span>
        </div>
        <p class="posendy-muted">마지막 확인: {{ settings.lastHeartbeat ? fmt(settings.lastHeartbeat) : '아직 없음' }}</p>
        <p v-if="settings.lastResult" class="posendy-muted">최근 작업: {{ settings.lastResult }}</p>
        <p v-if="settings.lastError" class="posendy-error">{{ settings.lastError }}</p>
        <div class="posendy-actions">
          <button class="posendy-btn" :disabled="busy" @click="pollNow">지금 확인</button>
          <button class="posendy-btn posendy-btn--ghost" :disabled="busy" @click="disconnect">연결 끊기</button>
        </div>
      </template>
      <template v-else>
        <p class="posendy-muted">posendy.com 대시보드 &gt; API 키에서 만든 키를 넣으면, 네이버 블로그 글을 이 크롬에서 올려요.</p>
        <input v-model="key" class="posendy-input" type="password" placeholder="psd_live_..." autocomplete="off" />
        <div class="posendy-actions">
          <button class="posendy-btn" :disabled="busy || !key.startsWith('psd_')" @click="connect">연결</button>
        </div>
        <p v-if="error" class="posendy-error">{{ error }}</p>
      </template>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';

type Settings = { apiKey?: string; workspace?: string; lastHeartbeat?: string; lastResult?: string; lastError?: string };
const settings = ref<Settings>({});
const key = ref('');
const busy = ref(false);
const error = ref('');
let timer: number | undefined;

const online = computed(() => {
  const t = settings.value.lastHeartbeat ? Date.parse(settings.value.lastHeartbeat) : 0;
  return Boolean(t) && Date.now() - t < 2 * 60 * 1000 && !settings.value.lastError;
});
const fmt = (iso: string) => new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

async function send(type: string, extra: Record<string, unknown> = {}) {
  const r = await chrome.runtime.sendMessage({ type, ...extra });
  if (!r?.ok) throw new Error(r?.error || '실패');
  return r.data;
}
async function load() {
  settings.value = (await send('posendy:getSettings')) || {};
}
async function connect() {
  busy.value = true;
  error.value = '';
  try {
    await send('posendy:saveKey', { apiKey: key.value.trim() });
    key.value = '';
    await send('posendy:pollNow');
    await load();
  } catch (e: any) {
    error.value = e?.message || String(e);
    await send('posendy:disconnect').catch(() => undefined);
  } finally {
    busy.value = false;
  }
}
async function pollNow() {
  busy.value = true;
  try {
    settings.value = await send('posendy:pollNow');
  } finally {
    busy.value = false;
  }
}
async function disconnect() {
  await send('posendy:disconnect');
  await load();
}
onMounted(() => {
  load();
  timer = window.setInterval(load, 5000);
});
onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<style scoped>
.posendy-card {
  padding: 12px;
}
.posendy-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}
.posendy-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: #d1d5db;
}
.posendy-dot.on {
  background: #22c55e;
}
.posendy-muted {
  color: #6b7280;
  font-size: 12px;
  margin: 6px 0 0;
}
.posendy-error {
  color: #dc2626;
  font-size: 12px;
  margin: 6px 0 0;
}
.posendy-input {
  width: 100%;
  margin-top: 8px;
  padding: 8px 10px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  font-size: 13px;
}
.posendy-actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.posendy-btn {
  background: #ffd400;
  color: #111;
  border: 0;
  border-radius: 999px;
  padding: 7px 14px;
  font-weight: 700;
  font-size: 12px;
  cursor: pointer;
}
.posendy-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.posendy-btn--ghost {
  background: #f3f4f6;
}
</style>
