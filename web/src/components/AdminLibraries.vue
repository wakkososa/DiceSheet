<template>
  <div class="stack">
    <!-- File import -->
    <section class="panel stack">
      <div class="section-head"><h3>Import libraries</h3></div>
      <p class="muted">Libraries can only be added from an export file: the <code>.tgz</code> made with <code>mongoexport</code>, or <code>.json</code>/<code>.jsonl</code> files. Existing libraries are replaced, keeping their IDs, so characters stay linked. To update a library, import a newer export of it.</p>
      <label class="btn" :class="{ disabled: uploading }">
        {{ uploading ? 'Importing…' : 'Choose file' }}
        <input type="file" accept=".tgz,.gz,.json,.jsonl" class="sr-only" :disabled="uploading" @change="upload" />
      </label>
    </section>
    <!-- Collections -->
    <section class="panel">
      <div class="section-head">
        <h3>Collections</h3>
        <button class="small" @click="newCollection">New collection</button>
      </div>
      <p class="hint">Players pick a collection when they create a character. Collections in an imported file are added too, or make your own here.</p>
      <div v-for="c in libs.collections" :key="c._id" class="collection">
        <div class="row">
          <input v-model="drafts[c._id].name" class="colname" maxlength="100" :aria-label="`Name of ${c.name}`" />
          <span class="faint small-text">{{ drafts[c._id].libraries.length }} libraries</span>
          <span class="spacer" />
          <button class="small ghost" @click="editing = editing === c._id ? null : c._id">{{ editing === c._id ? 'Done choosing' : 'Choose libraries' }}</button>
          <button class="small primary" :disabled="!dirty(c)" @click="saveCollection(c)">Save</button>
          <button class="small ghost danger" @click="removeCollection(c)">Delete</button>
        </div>
        <div v-if="editing === c._id" class="pick">
          <label v-for="l in libs.libraries" :key="l._id" class="small-text"><input v-model="drafts[c._id].libraries" type="checkbox" :value="l._id" /> {{ l.name }}</label>
        </div>
        <p v-else class="faint small-text members">{{ drafts[c._id].libraries.map((id: string) => libName(id)).join(' · ') || 'No libraries yet' }}</p>
      </div>
    </section>

    <!-- Libraries -->
    <section class="panel">
      <div class="section-head"><h3>Libraries</h3><span class="faint">{{ libs.libraries.length }}</span></div>
      <div class="table-wrap">
        <table class="libs">
          <thead><tr><th>Name</th><th>Entries</th><th>Last changed</th><th><span class="sr-only">Actions</span></th></tr></thead>
          <tbody>
            <tr v-for="l in libs.libraries" :key="l._id">
              <td><a :href="`https://dicecloud.com/library/${l._id}`" target="_blank" rel="noopener noreferrer">{{ l.name }}</a></td>
              <td class="num">{{ l.nodeCount.toLocaleString() }}</td>
              <td class="faint">{{ l.updatedAt ? when(l.updatedAt) : 'Imported from file' }}</td>
              <td class="acts">
                <button class="small ghost danger" @click="removeLibrary(l)">Remove</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { api } from '../api';
import { toast, toastError } from '../session';

const libs = ref<{ libraries: any[], collections: any[] }>({ libraries: [], collections: [] });
const drafts = reactive<Record<string, { name: string, libraries: string[] }>>({});
const editing = ref<string | null>(null);
const uploading = ref(false);

async function load() {
  libs.value = await api.get('/api/libraries');
  for (const c of libs.value.collections) drafts[c._id] = { name: c.name, libraries: [...c.libraries] };
}
onMounted(() => { load().catch(toastError); });

const libName = (id: string) => libs.value.libraries.find(l => l._id === id)?.name || id;
const when = (d?: string) => { try { return d ? new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : ''; } catch { return ''; } };

async function removeLibrary(l: any) {
  if (!confirm(`Remove ${l.name}? Characters keep anything they already took from it, but it won’t be offered for new choices.`)) return;
  try { await api.del(`/api/admin/libraries/${l._id}`); toast(`Removed ${l.name}`); await load(); } catch (e) { toastError(e); }
}
const dirty = (c: any) => drafts[c._id] && (drafts[c._id].name !== c.name || drafts[c._id].libraries.join() !== c.libraries.join());
async function saveCollection(c: any) {
  try { await api.patch(`/api/admin/collections/${c._id}`, drafts[c._id]); toast('Collection saved'); editing.value = null; await load(); } catch (e) { toastError(e); }
}
async function newCollection() {
  const name = prompt('Name of the new collection');
  if (!name) return;
  try { const c = await api.post('/api/admin/collections', { name, libraries: [] }); await load(); editing.value = c._id; } catch (e) { toastError(e); }
}
async function removeCollection(c: any) {
  if (!confirm(`Delete the collection "${c.name}"? The libraries stay; characters limited to this collection will see every library.`)) return;
  try { await api.del(`/api/admin/collections/${c._id}`); await load(); } catch (e) { toastError(e); }
}
async function upload(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0]; input.value = '';
  if (!file) return;
  uploading.value = true;
  try {
    const fd = new FormData(); fd.append('file', file);
    const r = await api.post('/api/admin/libraries/import', fd);
    toast(`Imported ${r.libraries} libraries, ${r.nodes.toLocaleString()} entries, ${r.collections} collections`);
    await load();
  } catch (e) { toastError(e); } finally { uploading.value = false; }
}
</script>

<style scoped>
.collection { padding: .6rem 0; border-bottom: 1px solid var(--line); }
.collection:last-child { border-bottom: 0; }
.colname { max-width: 360px; }
.members { margin: .35rem 0 0; }
.pick { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: .2rem .8rem; margin-top: .5rem; padding: .5rem; border: 1px solid var(--line); border-radius: var(--r-sm); max-height: 320px; overflow: auto; }
.pick label { display: flex; gap: .4rem; align-items: baseline; }
.small-text { font-size: var(--step--1); }
.table-wrap { overflow-x: auto; }
.libs { width: 100%; border-collapse: collapse; }
.libs th { text-align: left; font-size: var(--step--1); color: var(--muted); font-weight: 500; padding: .4rem .5rem; border-bottom: 1px solid var(--line); }
.libs td { padding: .4rem .5rem; border-bottom: 1px solid var(--line); }
.libs a { color: var(--ink); text-decoration: none; }
.libs a:hover { color: var(--accent); text-decoration: underline; }
.acts { white-space: nowrap; text-align: right; }
.btn.disabled { opacity: .6; pointer-events: none; }
</style>
