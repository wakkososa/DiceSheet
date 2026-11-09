<template>
  <header v-if="session.user" class="topbar">
    <RouterLink to="/" class="brand">
      <img src="/favicon.svg" alt="" width="22" height="22" />
      <span>{{ session.siteName }}</span>
    </RouterLink>
    <nav class="row">
      <RouterLink to="/" class="navlink">Characters</RouterLink>
      <RouterLink v-if="session.user.isAdmin" to="/admin" class="navlink">Admin</RouterLink>
    </nav>
    <span class="spacer" />
    <button class="ghost small theme" :title="`Theme: ${theme}`" @click="cycleTheme">
      {{ theme === 'auto' ? 'Auto theme' : theme === 'dark' ? 'Dark' : 'Light' }}
    </button>
    <RouterLink to="/account" class="navlink who">{{ session.user.username }}</RouterLink>
    <button class="ghost small" @click="doLogout">Log out</button>
  </header>

  <RouterView />

  <div class="toasts" role="status" aria-live="polite">
    <div v-for="t in toasts" :key="t.id" class="toast" :class="t.kind" @click="dismissToast(t.id)">
      <strong>{{ t.text }}</strong>
      <div v-if="t.detail" class="detail">{{ t.detail }}</div>
      <div v-if="t.rows?.length" class="rows">
        <template v-for="(r, i) in t.rows" :key="i">
          <div v-if="r.kind === 'roll'" class="rrow" :class="r.nat">
            <span class="rlabel">{{ r.label }}</span>
            <span class="rtotal num">{{ r.total }}</span>
            <span v-if="r.suffix" class="rsuffix">{{ r.suffix }}</span>
            <span v-if="r.nat" class="rnat">{{ r.nat === 'crit' ? 'nat 20' : 'nat 1' }}</span>
            <span v-if="r.breakdown" class="rbreak num">{{ r.breakdown }}</span>
          </div>
          <div v-else-if="r.kind === 'divider'" class="rdiv">{{ r.text }}</div>
          <div v-else class="rnote">{{ r.text }}</div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { session, logout, toasts, dismissToast } from './session';

const router = useRouter();
const readTheme = () => { try { return localStorage.getItem('theme') || 'auto'; } catch { return 'auto'; } };
const theme = ref(readTheme());
applyTheme();

function applyTheme() {
  if (theme.value === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme.value;
}
function cycleTheme() {
  theme.value = theme.value === 'auto' ? 'light' : theme.value === 'light' ? 'dark' : 'auto';
  try { localStorage.setItem('theme', theme.value); } catch { /* private mode */ }
  applyTheme();
}
async function doLogout() {
  await logout();
  router.push('/login');
}
</script>

<style scoped>
.topbar {
  display: flex; align-items: center; gap: .75rem; padding: .45rem 1rem;
  background: var(--surface); border-bottom: 1px solid var(--line);
}
.brand { display: flex; align-items: center; gap: .5rem; text-decoration: none; color: var(--ink); font-family: var(--serif); font-weight: 700; font-size: 1.1rem; }
.navlink { color: var(--muted); text-decoration: none; padding: .3em .5em; border-radius: var(--r-sm); font-weight: 500; }
.navlink:hover { color: var(--ink); background: var(--surface-2); }
.navlink.router-link-exact-active { color: var(--ink); }
.toasts { position: fixed; right: 1rem; bottom: 1rem; display: grid; gap: .5rem; z-index: 100; max-width: min(380px, calc(100vw - 2rem)); }
.toast { background: var(--ink); color: var(--paper); padding: .65rem .9rem; border-radius: var(--r); box-shadow: var(--shadow); animation: pop .18s ease-out; }
.toast.error { background: var(--bad); color: #fff; }
.toast.roll strong { font-family: var(--serif); font-size: 1.1rem; }
.toast .detail { opacity: .85; font-size: var(--step--1); margin-top: .15rem; }
.toast { cursor: pointer; }
.rows { display: grid; gap: .3rem; margin-top: .4rem; }
.rrow { display: grid; grid-template-columns: 1fr auto; column-gap: .6rem; align-items: baseline; }
.rlabel { font-size: var(--step--1); opacity: .85; }
.rtotal { font-family: var(--serif); font-size: 1.45rem; font-weight: 700; line-height: 1; justify-self: end; }
.rsuffix { grid-column: 1 / 3; justify-self: end; font-size: var(--step--1); opacity: .9; margin-top: -.1rem; }
.rnat { grid-column: 1 / 3; justify-self: end; font-size: .68rem; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; padding: 0 .45em; border-radius: 99px; color: #fff; background: #2B7A3D; }
.rrow.fumble .rnat { background: #B42318; }
.rbreak { grid-column: 1 / 3; font-size: .75rem; opacity: .6; }
.rdiv { font-size: .7rem; text-transform: uppercase; letter-spacing: .08em; opacity: .65; border-top: 1px solid currentColor; padding-top: .2rem; margin-top: .1rem; }
.rnote { font-size: var(--step--1); opacity: .8; }
@keyframes pop { from { transform: translateY(6px); opacity: 0; } }
@media (max-width: 640px) {
  .brand span, .theme { display: none; }
  .topbar { gap: .25rem; padding: .35rem .6rem; }
  .topbar nav { flex-wrap: nowrap; gap: 0; }
  .toasts { bottom: 4.5rem; }
}
</style>
