<template>
  <main class="page stack">
    <div class="row">
      <h1>Your characters</h1>
      <span class="spacer" />
      <span v-if="usage" class="muted num" :title="'Your character limit'">{{ usage.used }} of {{ usage.limit }} used</span>
    </div>

    <div class="row">
      <button class="primary" :disabled="full" @click="showNew = true">New character</button>
      <label class="btn" :class="{ disabled: full }">
        Import character file
        <input type="file" accept=".json,application/json" class="sr-only" :disabled="full" @change="importFile" />
      </label>
      <button v-if="characters.length" @click="newFolder">New folder</button>
      <span v-if="full" class="hint">You’ve reached your limit. Delete a character or ask an admin to raise it.</span>
    </div>

    <p v-if="loading" class="muted">Loading…</p>
    <div v-else-if="!characters.length" class="panel empty">
      <h3>No characters yet</h3>
      <p class="muted">Create one from your libraries, or import a character file exported from DiceCloud.</p>
    </div>

    <template v-else>
      <section v-for="g in groups" :key="g.id" class="group" :class="{ target: dragOver === g.id }"
               @dragover.prevent="dragOver = g.id" @dragleave="dragOver === g.id && (dragOver = null)" @drop.prevent="dropOn(g.id)">
        <div v-if="g.folder" class="folder-head">
          <button class="ghost fold" :aria-expanded="!g.folder.collapsed" @click="toggleFolder(g.folder)">
            <span class="chev" aria-hidden="true">{{ g.folder.collapsed ? '▸' : '▾' }}</span>
            <span class="folder-icon" aria-hidden="true">📁</span>
            <strong>{{ g.folder.name }}</strong>
            <span class="faint num">{{ g.items.length }}</span>
          </button>
          <span class="spacer" />
          <span class="folder-acts">
            <button class="ghost small" @click="renameFolder(g.folder)">Rename</button>
            <button class="ghost small danger" @click="removeFolder(g.folder)">Delete</button>
          </span>
        </div>
        <h2 v-else-if="folders.length && g.items.length" class="loose-head muted">Not in a folder</h2>

        <template v-if="!g.folder?.collapsed">
          <ul v-if="g.items.length" class="grid">
            <li v-for="c in g.items" :key="c._id" class="char" :style="{ '--accent': c.color || undefined }"
                draggable="true" @dragstart="dragging = c._id" @dragend="dragging = null; dragOver = null">
              <RouterLink :to="`/character/${c._id}`" class="char-link" draggable="false">
                <img v-if="c.picture" :src="c.picture" alt="" class="avatar" referrerpolicy="no-referrer" @error="($event.target as HTMLImageElement).style.visibility = 'hidden'" />
                <span v-else class="avatar initial">{{ (c.name || '?')[0] }}</span>
                <span class="who">
                  <strong class="serif">{{ c.name || 'Unnamed' }}</strong>
                  <span class="muted">{{ [c.level ? `Level ${c.level}` : '', c.race, c.alignment].filter(Boolean).join(', ') || 'Not built yet' }}</span>
                </span>
              </RouterLink>
              <div class="actions">
                <select v-if="folders.length" class="move" :value="c.folderId || ''" :aria-label="`Folder for ${c.name}`" @change="move(c, ($event.target as HTMLSelectElement).value)">
                  <option value="">No folder</option>
                  <option v-for="f in folders" :key="f._id" :value="f._id">📁 {{ f.name }}</option>
                </select>
                <button class="ghost small" @click="exportChar(c, 3)">Export</button>
                <button class="ghost small" title="For dicecloud.com and older DiceCloud servers" @click="exportChar(c, 2)">Export for DiceCloud.com</button>
                <button class="ghost small danger" @click="remove(c)">Delete</button>
              </div>
            </li>
          </ul>
          <p v-else-if="g.folder" class="hint empty-folder">Empty. Drag a character here, or pick this folder from a character’s folder menu.</p>
        </template>
      </section>
    </template>

    <dialog ref="dlg" class="dialog" @close="showNew = false">
      <form class="stack" @submit.prevent="create">
        <h2>New character</h2>
        <label class="field"><span>Name</span><input v-model.trim="form.name" maxlength="100" required /></label>
        <div class="row two">
          <label class="field"><span>Starting level</span><input v-model.number="form.startingLevel" type="number" min="0" max="20" /></label>
          <label class="field"><span>Alignment</span><input v-model.trim="form.alignment" maxlength="100" /></label>
        </div>
        <fieldset class="stack libs">
          <legend>Which rules can this character use?</legend>
          <label class="opt"><input v-model="form.libMode" type="radio" value="all" /> Every library on this server</label>
          <label v-for="col in collections" :key="col._id" class="opt">
            <input v-model="form.libMode" type="radio" :value="col._id" />
            <span>{{ col.name }} <span class="hint">({{ col.libraries.length }} libraries)</span></span>
          </label>
          <p class="hint">You can change this later on the Build tab.</p>
        </fieldset>
        <div class="row">
          <span class="spacer" />
          <button type="button" @click="dlg?.close()">Cancel</button>
          <button class="primary" type="submit" :disabled="busy">Create character</button>
        </div>
      </form>
    </dialog>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api';
import { toast, toastError } from '../session';

const router = useRouter();
const characters = ref<any[]>([]);
const folders = ref<any[]>([]);
const dragging = ref<string | null>(null), dragOver = ref<string | null>(null);
const collections = ref<any[]>([]);
const usage = ref<{ used: number, limit: number } | null>(null);
const loading = ref(true), busy = ref(false), showNew = ref(false);
const dlg = ref<HTMLDialogElement>();
const form = reactive({ name: '', startingLevel: 1, alignment: '', libMode: 'all' });
const full = computed(() => !!usage.value && usage.value.used >= usage.value.limit);

watch(showNew, v => { if (v) dlg.value?.showModal(); });

async function load() {
  const [c, l] = await Promise.all([api.get('/api/characters'), api.get('/api/libraries')]);
  characters.value = c.characters; folders.value = c.folders || []; usage.value = c.usage; collections.value = l.collections;
  loading.value = false;
}
onMounted(() => load().catch(toastError));

// Characters outside any folder come first, then one section per folder (A–Z)
const groups = computed(() => {
  const known = new Set(folders.value.map(f => f._id));
  return [
    { id: 'none', folder: null as any, items: characters.value.filter(c => !c.folderId || !known.has(c.folderId)) },
    ...folders.value.map(f => ({ id: f._id, folder: f, items: characters.value.filter(c => c.folderId === f._id) })),
  ];
});

async function newFolder() {
  const name = prompt('Name the new folder', 'Campaign')?.trim();
  if (!name) return;
  try { await api.post('/api/folders', { name }); await load(); } catch (e) { toastError(e); }
}
async function renameFolder(f: any) {
  const name = prompt('Rename folder', f.name)?.trim();
  if (!name || name === f.name) return;
  try { await api.patch(`/api/folders/${f._id}`, { name }); await load(); } catch (e) { toastError(e); }
}
async function toggleFolder(f: any) {
  f.collapsed = !f.collapsed;
  api.patch(`/api/folders/${f._id}`, { collapsed: f.collapsed }).catch(toastError);
}
async function removeFolder(f: any) {
  if (!confirm(`Delete the folder "${f.name}"? Its characters aren’t deleted; they move back to the main list.`)) return;
  try { await api.del(`/api/folders/${f._id}`); toast(`Deleted folder ${f.name}`); await load(); } catch (e) { toastError(e); }
}
async function move(c: any, folderId: string) {
  const before = c.folderId;
  c.folderId = folderId || null;
  try { await api.put(`/api/characters/${c._id}/folder`, { folderId: folderId || null }); } catch (e) { c.folderId = before; toastError(e); }
}
function dropOn(groupId: string) {
  const c = characters.value.find(x => x._id === dragging.value);
  dragOver.value = null;
  if (c && (c.folderId || 'none') !== groupId) move(c, groupId === 'none' ? '' : groupId);
}

async function create() {
  busy.value = true;
  try {
    const { id } = await api.post('/api/characters', {
      name: form.name, startingLevel: form.startingLevel || 0, alignment: form.alignment || undefined,
      allowedLibraryCollections: form.libMode === 'all' ? undefined : [form.libMode],
    });
    dlg.value?.close();
    router.push(`/character/${id}/build`);
  } catch (e) { toastError(e); } finally { busy.value = false; }
}

async function importFile(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const json = JSON.parse(await file.text());
    const { id, warnings } = await api.post('/api/characters/import', json);
    toast(`Imported ${json.creature?.name || 'character'}`, 'info', warnings?.length ? `${warnings.length} properties needed fixing` : undefined);
    router.push(`/character/${id}`);
  } catch (e: any) {
    toastError(e instanceof SyntaxError ? new Error('That file isn’t valid JSON') : e);
  }
}

function exportChar(c: any, version: 2 | 3) {
  const a = document.createElement('a');
  a.href = `/api/characters/${c._id}/export?version=${version}`;
  a.download = '';
  a.click();
}

async function remove(c: any) {
  if (!confirm(`Delete ${c.name}? This can’t be undone. Export it first if you want a backup.`)) return;
  try { await api.del(`/api/characters/${c._id}`); toast(`Deleted ${c.name}`); await load(); } catch (e) { toastError(e); }
}
</script>

<style scoped>
.group { border-radius: var(--r); padding: .25rem; margin: 0 -.25rem; transition: background .15s; }
.group.target { background: var(--accent-soft); outline: 2px dashed var(--accent); }
.folder-head { display: flex; align-items: center; gap: .4rem; flex-wrap: wrap; border-bottom: 1px solid var(--line); padding: .3rem 0; margin-top: .75rem; }
.fold { display: flex; align-items: center; gap: .45rem; padding: .2rem .3rem; font-size: var(--step-1); color: var(--ink); }
.fold strong { font-family: var(--serif); }
.chev { color: var(--faint); width: 1rem; }
.folder-icon { font-size: 1rem; }
.folder-acts { display: flex; gap: .2rem; white-space: nowrap; }
.loose-head { font-size: var(--step-0); font-weight: 500; margin: .5rem 0 0; }
.empty-folder { margin: .5rem .3rem; }
.move { width: auto; max-width: 12rem; padding: .2rem .4rem; font-size: var(--step--1); }
.char[draggable="true"] { cursor: grab; }
.grid { list-style: none; padding: 0; margin: .75rem 0 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: .75rem; }
.char { background: var(--surface); border: 1px solid var(--line); border-left: 4px solid var(--accent); border-radius: var(--r); display: grid; }
.char-link { display: flex; gap: .8rem; align-items: center; padding: .9rem; text-decoration: none; color: var(--ink); }
.char-link:hover strong { text-decoration: underline; }
.avatar { width: 52px; height: 52px; border-radius: 50%; object-fit: cover; flex: none; background: var(--surface-2); }
.initial { display: grid; place-items: center; font-family: var(--serif); font-size: 1.5rem; color: var(--accent); }
.who { display: grid; }
.who strong { font-size: var(--step-1); }
.actions { display: flex; gap: .25rem; padding: 0 .5rem .5rem; flex-wrap: wrap; }
.empty { text-align: center; padding: 2rem; }
.btn.disabled { opacity: .5; pointer-events: none; }
.dialog { border: 1px solid var(--line); border-radius: var(--r); background: var(--surface); color: var(--ink); width: min(480px, calc(100vw - 2rem)); padding: 1.5rem; box-shadow: var(--shadow); }
.dialog::backdrop { background: rgb(18 22 29 / 45%); }
.two { flex-wrap: nowrap; }
.libs { border: 1px solid var(--line); border-radius: var(--r-sm); padding: .75rem; --gap: .4rem; }
.libs legend { font-weight: 500; padding: 0 .3rem; }
.opt { display: flex; gap: .5rem; align-items: baseline; }
</style>
