<template>
  <section class="panel logs-panel">
    <div class="toolbar">
      <div class="filters" role="radiogroup" aria-label="Show">
        <button v-for="f in FILTERS" :key="f.id" class="small" :class="{ on: filter === f.id }" role="radio" :aria-checked="filter === f.id" @click="filter = f.id">
          {{ f.label }}<span v-if="counts[f.id]" class="count num">{{ counts[f.id] }}</span>
        </button>
      </div>
      <input v-model.trim="search" type="search" placeholder="Search the log" aria-label="Search the log" class="search" />
      <div class="actions">
        <span class="live" :class="{ paused, offline }" :title="offline ? 'Can’t reach the server; retrying' : paused ? 'Paused' : 'Updating live'">
          <span class="dot" aria-hidden="true" />{{ offline ? 'Offline' : paused ? 'Paused' : 'Live' }}
        </span>
        <button class="small" @click="paused = !paused">{{ paused ? 'Resume' : 'Pause' }}</button>
        <label class="row follow"><input v-model="follow" type="checkbox" /> Follow</label>
        <button class="small ghost" title="Hide the lines shown so far (they stay in the server log)" @click="clearView">Clear</button>
        <button class="small ghost" :disabled="!shown.length" @click="download">Download</button>
      </div>
    </div>

    <div ref="box" class="log" role="log" aria-live="off" :aria-busy="loading" @scroll="onScroll">
      <p v-if="loading" class="empty muted">Loading…</p>
      <p v-else-if="!shown.length" class="empty muted">{{ entries.length ? 'Nothing matches.' : 'Nothing logged yet since the server started.' }}</p>
      <div v-for="e in shown" :key="e.seq" class="line" :class="e.level">
        <time class="t num" :datetime="e.time" :title="new Date(e.time).toLocaleString()">{{ clock(e.time) }}</time>
        <span class="cat" :class="catClass(e.category)">{{ e.category }}</span>
        <span class="msg">{{ e.message }}</span>
      </div>
    </div>
    <p class="hint foot">
      Recent lines since the server started (up to 2,000), newest at the bottom. The full log is also in
      <code>docker logs dicesheet</code>.
      <button v-if="!follow && newBelow" class="small primary jump" @click="jumpToEnd">{{ newBelow }} new ↓</button>
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { api } from '../api';

type Entry = { seq: number, time: string, level: 'info' | 'warn' | 'error', category: string, message: string };
const FILTERS = [
  { id: 'all', label: 'Everything' },
  { id: 'people', label: 'Sign-ins and admin' },
  { id: 'problems', label: 'Warnings and errors' },
] as const;
type FilterId = typeof FILTERS[number]['id'];

const entries = ref<Entry[]>([]);
const filter = ref<FilterId>('all');
const search = ref('');
const paused = ref(false);
const follow = ref(true);
const offline = ref(false);
const loading = ref(true);
const newBelow = ref(0);
const box = ref<HTMLElement>();
const floor = ref(0);
let last = 0, timer: any, stopped = false;

const matches = (e: Entry, f: FilterId) =>
  f === 'all' ? true
  : f === 'people' ? e.category === 'auth' || e.category === 'admin'
  : e.level !== 'info';
const visible = computed(() => entries.value.filter(e => e.seq > floor.value));
const counts = computed(() => ({ all: 0, people: 0, problems: visible.value.filter(e => e.level !== 'info').length } as Record<FilterId, number>));
const shown = computed(() => {
  const q = search.value.toLowerCase();
  return visible.value.filter(e => matches(e, filter.value) && (!q || `${e.category} ${e.message}`.toLowerCase().includes(q)));
});

const clock = (t: string) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const catClass = (c: string) => (c === 'library update' ? 'lib' : c === 'auth' ? 'auth' : c === 'admin' ? 'admin' : '');

async function poll() {
  if (stopped) return;
  if (!paused.value && document.visibilityState === 'visible') {
    try {
      const r = await api.get(`/api/admin/logs?after=${last}`);
      offline.value = false;
      if (r.entries.length) {
        const atEnd = isAtEnd();
        entries.value = [...entries.value, ...r.entries].slice(-2000);
        last = r.entries[r.entries.length - 1].seq;
        if (follow.value || atEnd) { await nextTick(); jumpToEnd(); } else newBelow.value += r.entries.length;
      }
    } catch { offline.value = true; }
    loading.value = false;
  }
  timer = setTimeout(poll, offline.value ? 5000 : 1500);
}

function isAtEnd() { const el = box.value; return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 24; }
function jumpToEnd() { const el = box.value; if (el) el.scrollTop = el.scrollHeight; newBelow.value = 0; }
function onScroll() { if (isAtEnd()) newBelow.value = 0; else if (follow.value) follow.value = false; }
function clearView() { floor.value = last; newBelow.value = 0; }
function download() {
  const text = shown.value.map(e => `${e.time} ${e.level.toUpperCase().padEnd(5)} [${e.category}] ${e.message}`).join('\n') + '\n';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = `dicesheet-log-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

watch(follow, f => { if (f) nextTick(jumpToEnd); });
watch([filter, search], () => nextTick(() => { if (follow.value) jumpToEnd(); }));
onMounted(poll);
onUnmounted(() => { stopped = true; clearTimeout(timer); });
</script>

<style scoped>
.logs-panel { display: grid; gap: .75rem; }
.toolbar { display: flex; flex-wrap: wrap; gap: .6rem 1rem; align-items: center; }
.filters { display: flex; flex-wrap: wrap; gap: .3rem; }
.filters button { border-radius: 99px; }
.filters button.on { background: var(--accent); border-color: var(--accent); color: #fff; }
.count { margin-left: .35rem; font-size: .75em; opacity: .85; }
.search { flex: 1 1 14rem; min-width: 10rem; max-width: 22rem; }
.actions { display: flex; flex-wrap: wrap; gap: .4rem .6rem; align-items: center; margin-left: auto; }
.follow { gap: .3rem; font-size: var(--step--1); }
.live { display: inline-flex; align-items: center; gap: .35rem; font-size: var(--step--1); color: var(--good); font-weight: 600; }
.live .dot { width: .55rem; height: .55rem; border-radius: 50%; background: currentColor; animation: pulse 1.6s ease-in-out infinite; }
.live.paused { color: var(--muted); }
.live.paused .dot { animation: none; }
.live.offline { color: var(--warn); }
@keyframes pulse { 50% { opacity: .35; } }
@media (prefers-reduced-motion: reduce) { .live .dot { animation: none; } }

.log {
  height: min(62vh, 640px); overflow: auto; background: var(--surface-2); border: 1px solid var(--line); border-radius: var(--r-sm);
  padding: .4rem 0; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .8rem; line-height: 1.45;
}
.empty { padding: 1rem; margin: 0; font-family: var(--sans); }
.line { display: grid; grid-template-columns: auto auto minmax(0, 1fr); gap: .7rem; padding: .08rem .75rem; border-left: 3px solid transparent; }
.line:hover { background: color-mix(in srgb, var(--ink) 5%, transparent); }
.line.warn { border-left-color: var(--warn); }
.line.warn .msg { color: var(--warn); }
.line.error { border-left-color: var(--bad); background: color-mix(in srgb, var(--bad) 8%, transparent); }
.line.error .msg { color: var(--bad); }
.t { color: var(--faint); }
.cat { color: var(--muted); min-width: 7.5rem; }
.cat.lib { color: var(--accent); }
.cat.auth { color: var(--good); }
.cat.admin { color: var(--warn); }
.msg { white-space: pre-wrap; overflow-wrap: anywhere; color: var(--ink); }
.foot { margin: 0; display: flex; align-items: center; gap: .75rem; flex-wrap: wrap; }
.jump { margin-left: auto; }
@media (max-width: 640px) {
  .line { grid-template-columns: auto minmax(0, 1fr); gap: 0 .6rem; }
  .cat { min-width: 0; }
  .msg { grid-column: 1 / -1; }
  .actions { margin-left: 0; }
}
</style>
