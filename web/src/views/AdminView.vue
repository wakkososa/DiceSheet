<template>
  <main class="page stack">
    <div class="admin-head">
      <h1>Admin</h1>
      <p v-if="about" class="version" :title="aboutTitle">
        <strong>DiceSheet {{ about.version }}</strong>
        <span>DiceCloud engine {{ about.engine }}</span>
        <span>Database v{{ about.database }}</span>
        <span>{{ about.counts.characters }} characters · {{ about.counts.users }} users · {{ about.counts.libraries }} libraries</span>
      </p>
    </div>
    <nav class="subnav" aria-label="Admin sections">
      <RouterLink to="/admin" :class="{ active: tab === 'users' }">Users</RouterLink>
      <RouterLink to="/admin/settings" :class="{ active: tab === 'settings' }">Registration and limits</RouterLink>
      <RouterLink to="/admin/libraries" :class="{ active: tab === 'libraries' }">Libraries</RouterLink>
      <RouterLink to="/admin/logs" :class="{ active: tab === 'logs' }">Logs</RouterLink>
    </nav>

    <!-- USERS -->
    <template v-if="tab === 'users'">
      <section class="panel">
        <div class="section-head"><h3>Add a user</h3></div>
        <form class="row add-user" @submit.prevent="createUser">
          <input v-model.trim="nu.username" placeholder="Username" autocomplete="off" required minlength="3" maxlength="32" />
          <input v-model="nu.password" type="password" placeholder="Temporary password (8+ characters)" autocomplete="new-password" required minlength="8" />
          <label class="row lim">Character limit
            <select v-model="nu.limit">
              <option value="">Default ({{ settings.defaultCharacterLimit }})</option>
              <option v-for="n in presetLimits" :key="n" :value="n">{{ n }}</option>
            </select>
          </label>
          <label class="row"><input v-model="nu.isAdmin" type="checkbox" /> Admin</label>
          <button class="primary">Add user</button>
        </form>
      </section>

      <section class="panel">
        <div class="table-wrap">
          <table class="users">
            <thead><tr><th>User</th><th>Characters</th><th>Limit</th><th>Role</th><th>Last login</th><th><span class="sr-only">Actions</span></th></tr></thead>
            <tbody>
              <tr v-for="u in users" :key="u.id" :class="{ disabled: u.disabled }">
                <td><strong>{{ u.username }}</strong><span v-if="u.disabled" class="pill">Disabled</span></td>
                <td class="num">{{ u.characters }}</td>
                <td>
                  <div class="row limit">
                    <input type="number" min="1" max="999" step="1" class="num" :value="u.character_limit ?? ''" :placeholder="String(settings.defaultCharacterLimit)"
                           :aria-label="`Character limit for ${u.username}`" @change="setLimit(u, ($event.target as HTMLInputElement).value)" />
                    <span v-if="u.character_limit === null" class="hint">default</span>
                  </div>
                </td>
                <td>
                  <label class="row"><input type="checkbox" :checked="!!u.is_admin" :disabled="u.id === session.user?.id" @change="patch(u, { isAdmin: ($event.target as HTMLInputElement).checked })" /> Admin</label>
                </td>
                <td class="faint">{{ u.last_login_at ? new Date(u.last_login_at).toLocaleDateString() : 'Never' }}</td>
                <td class="acts">
                  <button class="small ghost" @click="resetPassword(u)">Reset password</button>
                  <button v-if="u.id !== session.user?.id" class="small ghost" @click="patch(u, { disabled: !u.disabled })">{{ u.disabled ? 'Enable' : 'Disable' }}</button>
                  <button v-if="u.id !== session.user?.id" class="small ghost danger" @click="removeUser(u)">Delete</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="hint">Limits are whole numbers from 1 to 999. Leave a limit empty to use the default.</p>
      </section>
    </template>

    <!-- SETTINGS -->
    <div v-else-if="tab === 'settings'" class="settings-grid">
      <div class="stack col">
        <section class="panel">
          <div class="section-head">
            <h3>Sign-ups</h3>
            <span class="pill state" :class="settings.registrationOpen ? 'open' : 'closed'">{{ settings.registrationOpen ? 'Open' : 'Closed' }}</span>
          </div>
          <div class="reg">
            <p class="muted">{{ settings.registrationOpen ? 'Anyone who can reach this site can create an account.' : 'Only admins can add users, from the Users tab. The sign-up page is turned off.' }}</p>
            <button :class="settings.registrationOpen ? 'danger' : 'primary'" @click="saveSettings({ registrationOpen: !settings.registrationOpen })">
              {{ settings.registrationOpen ? 'Close sign-ups' : 'Open sign-ups' }}
            </button>
          </div>
        </section>

        <section class="panel">
          <div class="section-head"><h3>Defaults</h3></div>
          <form class="defaults" @submit.prevent="saveSettings({ defaultCharacterLimit: Number(defLimit), siteName })">
            <label class="field">
              <span>Character limit</span>
              <input v-model="defLimit" type="number" min="1" max="999" step="1" required class="num limit-input" />
              <small class="hint">For users without their own limit. 1 to 999.</small>
            </label>
            <label class="field">
              <span>Site name</span>
              <input v-model.trim="siteName" maxlength="60" required />
              <small class="hint">Shown in the top bar and the browser tab.</small>
            </label>
            <div class="form-foot">
              <button class="primary" :disabled="!defaultsDirty">Save</button>
            </div>
          </form>
        </section>
      </div>

      <section class="panel origins">
        <div class="section-head"><h3>Other addresses</h3><span class="faint">{{ origins.length }}</span></div>
        <p class="muted intro">Sign-ins only work from addresses listed here. Add any other address players use to reach DiceSheet, such as a Cloudflare Worker or a second domain.</p>

        <ul class="addr-list">
          <li class="addr current">
            <code>{{ here }}</code>
            <span class="faint">This address · always allowed</span>
          </li>
          <li v-for="o in origins" :key="o" class="addr">
            <code>{{ o }}</code>
            <button class="ghost small danger" :disabled="savingOrigins" :aria-label="`Remove ${o}`" @click="removeOrigin(o)">Remove</button>
          </li>
        </ul>

        <form class="add-addr" @submit.prevent="addOrigin">
          <input v-model.trim="newOrigin" type="text" inputmode="url" spellcheck="false" autocomplete="off" placeholder="https://dicesheet.yourname.workers.dev" aria-label="Address to allow" />
          <button class="primary" :disabled="!newOrigin || savingOrigins">Add</button>
        </form>

        <details class="examples">
          <summary>Examples</summary>
          <dl>
            <dt><code>https://dicesheet.yourname.workers.dev</code></dt><dd>One Cloudflare Worker</dd>
            <dt><code>https://*.yourname.workers.dev</code></dt><dd>All of your Workers</dd>
            <dt><code>https://*.yourdomain.com</code></dt><dd>Every subdomain of a domain you own</dd>
          </dl>
        </details>
        <p class="warn-note">Only add addresses you control. A listed site can act for any player who is signed in.</p>
      </section>
    </div>

    <!-- LOGS -->
    <AdminLogs v-else-if="tab === 'logs'" />

    <!-- LIBRARIES -->
    <AdminLibraries v-else />
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../api';
import { session, toast, toastError, loadSession } from '../session';
import AdminLibraries from '../components/AdminLibraries.vue';
import AdminLogs from '../components/AdminLogs.vue';

const props = defineProps<{ section?: string }>();
const tab = computed(() => (['settings', 'libraries', 'logs'].includes(props.section || '') ? props.section! : 'users'));
const users = ref<any[]>([]);
const about = ref<any>(null);
const fmtDate = (d?: string) => { try { return d ? new Date(d).toLocaleString() : '?'; } catch { return d || '?'; } };
const aboutTitle = computed(() => about.value ? `Built ${fmtDate(about.value.builtAt)} · running since ${fmtDate(about.value.startedAt)} · Node ${about.value.node}` : '');
onMounted(() => api.get('/api/admin/about').then(r => { about.value = r; }).catch(() => {}));
const settings = ref<any>({ defaultCharacterLimit: 5, registrationOpen: false, siteName: '' });
const nu = reactive({ username: '', password: '', limit: '' as any, isAdmin: false });
const presetLimits = [1, 2, 3, 5, 10, 20, 50, 100, 999];
const defLimit = ref('5'), siteName = ref('');
const origins = ref<string[]>([]);
const newOrigin = ref('');
const savingOrigins = ref(false);
const defaultsDirty = computed(() => String(settings.value.defaultCharacterLimit) !== String(defLimit.value) || settings.value.siteName !== siteName.value);
const here = location.origin;

async function loadUsers() {
  const r = await api.get('/api/admin/users');
  users.value = r.users; settings.value = r.settings;
  defLimit.value = String(r.settings.defaultCharacterLimit); siteName.value = r.settings.siteName;
  origins.value = r.settings.allowedOrigins || [];
}
onMounted(() => loadUsers().catch(toastError));

async function createUser() {
  try {
    await api.post('/api/admin/users', { username: nu.username, password: nu.password, isAdmin: nu.isAdmin, characterLimit: nu.limit === '' ? undefined : Number(nu.limit) });
    toast(`Added ${nu.username}. Give them the temporary password.`);
    Object.assign(nu, { username: '', password: '', limit: '', isAdmin: false });
    await loadUsers();
  } catch (e) { toastError(e); }
}
async function patch(u: any, body: any) {
  try { await api.patch(`/api/admin/users/${u.id}`, body); await loadUsers(); } catch (e) { toastError(e); await loadUsers(); }
}
function setLimit(u: any, raw: string) {
  if (raw.trim() === '') return patch(u, { characterLimit: null });
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 999) { toastError(new Error('Character limit must be a whole number from 1 to 999')); return loadUsers(); }
  return patch(u, { characterLimit: n }).then(() => toast(`${u.username} can now have ${n} character${n === 1 ? '' : 's'}`));
}
async function resetPassword(u: any) {
  const pw = prompt(`New temporary password for ${u.username} (8+ characters). They will be logged out everywhere.`);
  if (!pw) return;
  try { await api.patch(`/api/admin/users/${u.id}`, { password: pw }); toast(`Password for ${u.username} changed`); } catch (e) { toastError(e); }
}
async function removeUser(u: any) {
  if (!confirm(`Delete ${u.username} and their ${u.characters} character${u.characters === 1 ? '' : 's'}? This can’t be undone.`)) return;
  try { await api.del(`/api/admin/users/${u.id}`); toast(`Deleted ${u.username}`); await loadUsers(); } catch (e) { toastError(e); }
}
async function saveOrigins(list: string[], message: string) {
  savingOrigins.value = true;
  try {
    const r = await api.patch('/api/admin/settings', { allowedOrigins: list });
    settings.value = r; origins.value = r.allowedOrigins || [];
    toast(message);
    return true;
  } catch (e) { toastError(e); return false; } finally { savingOrigins.value = false; }
}
async function addOrigin() {
  const value = newOrigin.value.replace(/\/+$/, '');
  if (!value) return;
  if (origins.value.includes(value.toLowerCase())) { toast('That address is already listed'); newOrigin.value = ''; return; }
  if (await saveOrigins([...origins.value, value], `Added ${value}`)) newOrigin.value = '';
}
function removeOrigin(o: string) {
  if (!confirm(`Remove ${o}? Players using that address won't be able to sign in through it.`)) return;
  saveOrigins(origins.value.filter(x => x !== o), `Removed ${o}`);
}

async function saveSettings(body: any) {
  try { settings.value = await api.patch('/api/admin/settings', body); toast('Settings saved'); await loadSession(); await loadUsers(); } catch (e) { toastError(e); }
}
</script>

<style scoped>
.subnav { display: flex; gap: .25rem; border-bottom: 1px solid var(--line); overflow-x: auto; }
.subnav a { white-space: nowrap; }
@media (max-width: 520px) { .subnav a { padding: .5rem .45rem; font-size: var(--step--1); } }
.subnav a { padding: .5rem .8rem; text-decoration: none; color: var(--muted); font-weight: 500; border-bottom: 3px solid transparent; }
.subnav a.active { color: var(--ink); border-bottom-color: var(--accent); }
.add-user input:not([type="checkbox"]) { width: auto; flex: 1; min-width: 12rem; }
.lim select { width: auto; }
.table-wrap { overflow-x: auto; }
.users { width: 100%; border-collapse: collapse; }
.users th { text-align: left; font-size: var(--step--1); color: var(--muted); font-weight: 500; padding: .4rem .5rem; border-bottom: 1px solid var(--line); }
.users td { padding: .45rem .5rem; border-bottom: 1px solid var(--line); vertical-align: middle; }
.users tr.disabled td { opacity: .6; }
.users .pill { margin-left: .4rem; }
.limit input { width: 5.5rem; }
.acts { white-space: nowrap; text-align: right; }
.settings-grid { display: grid; gap: 1rem; grid-template-columns: minmax(0, 1fr); align-items: start; }
@media (min-width: 960px) { .settings-grid { grid-template-columns: minmax(0, 5fr) minmax(0, 6fr); } }
.col { --gap: 1rem; }
.pill.state { font-size: var(--step--1); padding: .05rem .55rem; border-radius: 99px; font-weight: 600; }
.pill.state.open { background: color-mix(in srgb, var(--good) 18%, transparent); color: var(--good); }
.pill.state.closed { background: var(--surface-2); color: var(--muted); }
.reg { display: flex; gap: .75rem 1rem; align-items: center; justify-content: space-between; flex-wrap: wrap; }
.reg p { margin: 0; flex: 1 1 16rem; }
.defaults { display: grid; grid-template-columns: 9rem minmax(0, 1fr); gap: .9rem 1rem; align-items: start; }
.defaults .hint { font-weight: 400; }
.limit-input { width: 100%; }
.form-foot { grid-column: 1 / -1; display: flex; justify-content: flex-end; }
@media (max-width: 520px) { .defaults { grid-template-columns: 1fr; } .form-foot { justify-content: stretch; } .form-foot button { width: 100%; } }
.short { max-width: 8rem; }
.collection { padding: .5rem 0; border-bottom: 1px solid var(--line); }
.colname { max-width: 420px; }
.small-text { font-size: var(--step--1); margin: .3rem 0 0; }
.btn.disabled { opacity: .6; pointer-events: none; }
.admin-head { display: flex; align-items: baseline; justify-content: space-between; gap: .5rem 1.5rem; flex-wrap: wrap; }
.version { margin: 0; display: flex; flex-wrap: wrap; gap: .2rem .9rem; font-size: var(--step--1); color: var(--muted); }
.version strong { color: var(--ink); }
.origins { display: grid; gap: .8rem; }
.origins .section-head { margin: 0; }
.origins .intro { margin: 0; }
.origins code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .85em; overflow-wrap: anywhere; }
.addr-list { list-style: none; margin: 0; padding: 0; border: 1px solid var(--line); border-radius: var(--r-sm); }
.addr { display: flex; align-items: center; justify-content: space-between; gap: .4rem 1rem; flex-wrap: wrap; padding: .5rem .7rem; }
.addr + .addr { border-top: 1px solid var(--line); }
.addr.current { background: var(--surface-2); border-radius: var(--r-sm) var(--r-sm) 0 0; }
.addr.current .faint { font-size: var(--step--1); }
.add-addr { display: flex; gap: .5rem; }
.add-addr input { flex: 1; min-width: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: var(--step--1); }
.examples summary { cursor: pointer; color: var(--muted); font-size: var(--step--1); }
.examples dl { display: grid; grid-template-columns: auto 1fr; gap: .3rem 1rem; margin: .5rem 0 0; font-size: var(--step--1); }
.examples dt { margin: 0; }
.examples dd { margin: 0; color: var(--muted); }
@media (max-width: 520px) { .examples dl { grid-template-columns: 1fr; } .examples dd { margin-bottom: .3rem; } }
.warn-note { margin: 0; font-size: var(--step--1); color: var(--muted); border-left: 3px solid var(--warn); padding: .1rem 0 .1rem .6rem; }
</style>
