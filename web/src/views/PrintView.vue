<template>
  <main class="print-view">
    <div class="toolbar no-print">
      <RouterLink :to="`/character/${id}`" class="btn ghost">← Back to sheet</RouterLink>
      <button class="primary" :disabled="!ready" @click="print">Print or save as PDF</button>
      <label class="row"><input v-model="withFeatures" type="checkbox" /> Add pages with full feature text</label>
      <label class="row"><input v-model="withSpells" type="checkbox" /> Add spell descriptions</label>
      <p class="hint">In the print dialog, choose <strong>Letter</strong> paper and 100% scale. To get a PDF, pick <strong>Save as PDF</strong> as the printer.</p>
    </div>

    <p v-if="ctx.error.value" class="error-text no-print">{{ ctx.error.value }}</p>
    <p v-else-if="!ready" class="muted no-print">Loading character…</p>

    <template v-else>
      <!-- ============================== PAGE 1 ============================== -->
      <section class="sheet-page p1">
        <header class="top">
          <div class="box ident">
            <div class="cname"><span class="val big">{{ c.name || 'Unnamed' }}</span><span class="lbl">Character name</span></div>
            <div class="pairs">
              <div><span class="val">{{ background }}</span><span class="lbl">Background</span></div>
              <div><span class="val">{{ classLine }}</span><span class="lbl">Class</span></div>
              <div><span class="val">{{ species }}</span><span class="lbl">Species</span></div>
              <div><span class="val">{{ subclass }}</span><span class="lbl">Subclass</span></div>
            </div>
          </div>
          <div class="box lvl">
            <span class="lbl">Level</span><span class="num huge">{{ level }}</span>
            <span class="rule" /><span class="num">{{ xp }}</span><span class="lbl">XP</span>
          </div>
          <div class="box ac">
            <span class="lbl">Armor class</span><span class="num huge">{{ ac }}</span>
            <span class="lbl">Shield <span class="dia" :class="{ on: shieldEquipped }" /></span>
          </div>
          <div class="box hp">
            <span class="title">Hit points</span>
            <div class="hp-grid">
              <div class="cur"><span class="num huge">{{ hp?.value ?? '' }}</span><span class="lbl">Current</span></div>
              <div><span class="num">{{ temp?.value || '' }}</span><span class="lbl">Temp</span></div>
              <div><span class="num">{{ hp?.total ?? '' }}</span><span class="lbl">Max</span></div>
            </div>
          </div>
          <div class="box hd">
            <span class="title">Hit dice</span>
            <div><span class="num">{{ hitDice.spent }}</span><span class="lbl">Spent</span></div>
            <div><span class="num">{{ hitDice.max }}</span><span class="lbl">Max</span></div>
          </div>
          <div class="box ds">
            <span class="title">Death saves</span>
            <div class="dsrow"><span class="dias"><span v-for="i in 3" :key="i" class="dia" /></span><span class="lbl">Successes</span></div>
            <div class="dsrow"><span class="dias"><span v-for="i in 3" :key="i" class="dia" /></span><span class="lbl">Failures</span></div>
          </div>
        </header>

        <div class="body1">
          <div class="abil-cols">
            <div class="acol">
              <div class="box pb">
                <span class="title">Proficiency bonus</span>
                <span class="num huge">{{ signed(prof) }}</span>
              </div>
              <AbilityBox v-for="a in abilityBlocks.slice(0, 3)" :key="a.key" :block="a" />
              <div class="box insp">
                <span class="title">Heroic inspiration</span>
                <span class="dia big" :class="{ on: inspired }" />
              </div>
            </div>
            <div class="acol">
              <AbilityBox v-for="a in abilityBlocks.slice(3)" :key="a.key" :block="a" />
            </div>
            <div class="box training">
              <span class="title">Equipment training &amp; proficiencies</span>
              <p class="armor">
                <span class="lbl">Armor training</span>
                <span v-for="a in armorTypes" :key="a.label" class="chk"><span class="dia" :class="{ on: a.on }" />{{ a.label }}</span>
              </p>
              <p><span class="lbl">Weapons</span> {{ weaponProfs || '—' }}</p>
              <p><span class="lbl">Tools</span> {{ toolProfs || '—' }}</p>
            </div>
          </div>

          <div class="right1">
            <div class="quick">
              <div class="box"><span class="title">Initiative</span><span class="num huge">{{ initiative }}</span></div>
              <div class="box"><span class="title">Speed</span><span class="num huge">{{ speed }}</span><span class="sub">{{ otherSpeeds }}</span></div>
              <div class="box"><span class="title">Size</span><span class="huge word">{{ size }}</span></div>
              <div class="box"><span class="title">Passive perception</span><span class="num huge">{{ passivePerception }}</span></div>
            </div>

            <div class="box weapons">
              <span class="title">Weapons &amp; damage cantrips</span>
              <FitList :items="weapons" @overflow="r => overflow.weapons = r">
                <template #default="{ items }">
                  <table>
                    <thead><tr><th>Name</th><th>Atk bonus / DC</th><th>Damage &amp; type</th><th>Notes</th></tr></thead>
                    <tbody><tr v-for="w in items" :key="w.id"><td>{{ w.name }}</td><td class="num">{{ w.hit }}</td><td>{{ w.damage }}</td><td>{{ w.notes }}</td></tr></tbody>
                  </table>
                </template>
              </FitList>
            </div>

            <div class="box feats-box classf">
              <span class="title">Class features</span>
              <FitList :items="featureGroups.class" class="two-col" @overflow="r => overflow.class = r">
                <template #default="{ items }"><FeatureLine v-for="f in items" :key="f._id" :f="f" /></template>
              </FitList>
            </div>

            <div class="pair">
              <div class="box feats-box">
                <span class="title">Species traits</span>
                <FitList :items="featureGroups.species" @overflow="r => overflow.species = r">
                  <template #default="{ items }"><FeatureLine v-for="f in items" :key="f._id" :f="f" /></template>
                </FitList>
              </div>
              <div class="box feats-box">
                <span class="title">Feats</span>
                <FitList :items="featureGroups.feats" @overflow="r => overflow.feats = r">
                  <template #default="{ items }"><FeatureLine v-for="f in items" :key="f._id" :f="f" /></template>
                </FitList>
              </div>
            </div>
          </div>
        </div>
        <footer class="foot">{{ c.name }} · DiceSheet · page 1</footer>
      </section>

      <!-- ============================== PAGE 2 ============================== -->
      <section class="sheet-page p2">
        <div class="left2">
          <div class="spell-top">
            <div class="box casting">
              <span class="lbl">Spellcasting ability</span>
              <span class="val">{{ casting.ability || '—' }}</span>
              <dl>
                <dt>Spellcasting modifier</dt><dd class="num">{{ casting.mod }}</dd>
                <dt>Spell save DC</dt><dd class="num">{{ casting.dc }}</dd>
                <dt>Spell attack bonus</dt><dd class="num">{{ casting.attack }}</dd>
              </dl>
              <p v-if="casting.others" class="sub">{{ casting.others }}</p>
            </div>
            <div class="box slots">
              <span class="title">Spell slots</span>
              <div class="slot-grid">
                <div v-for="s in spellSlots" :key="s.level" class="slot">
                  <span class="lbl">{{ ordinal(s.level) }}</span>
                  <span class="num tot">{{ s.total || '' }}</span>
                  <span class="dias"><span v-for="i in Math.max(s.total, 1)" :key="i" class="dia" :class="{ on: i <= s.expended, ghost: !s.total }" /></span>
                </div>
              </div>
              <p class="sub">Filled diamonds are slots already spent.</p>
            </div>
          </div>

          <div class="box spells">
            <span class="title">Cantrips &amp; prepared spells</span>
            <FitList :items="spells" @overflow="r => overflow.spells = r">
              <template #default="{ items }">
                <table>
                  <thead><tr><th>Lvl</th><th>Name</th><th>Casting time</th><th>Range</th><th title="Concentration, Ritual, Material">C R M</th><th>Notes</th></tr></thead>
                  <tbody>
                    <tr v-for="s in items" :key="s._id">
                      <td class="num">{{ s.level || 'C' }}</td><td class="sname">{{ s.name }}</td><td>{{ cap(s.castingTime) }}</td><td>{{ s.range }}</td>
                      <td class="crm"><span class="dia" :class="{ on: s.concentration }" /><span class="dia" :class="{ on: s.ritual }" /><span class="dia" :class="{ on: !!s.material }" /></td>
                      <td>{{ spellNotes(s) }}</td>
                    </tr>
                  </tbody>
                </table>
              </template>
            </FitList>
          </div>
        </div>

        <div class="right2">
          <div class="box appearance">
            <span class="title">Appearance</span>
            <div class="app-body">
              <img v-if="portrait" :src="portrait" alt="" class="portrait" referrerpolicy="no-referrer" @error="($event.target as HTMLImageElement).style.display = 'none'" />
              <FitList :items="appearance" :class="{ lined: !appearance.length }" @overflow="r => overflow.appearance = r">
                <template #default="{ items }"><p v-for="(t, i) in items" :key="i" class="txt">{{ t }}</p></template>
              </FitList>
            </div>
          </div>
          <div class="box backstory">
            <span class="title">Backstory &amp; personality</span>
            <FitList :items="persona" :class="{ lined: !persona.length }" @overflow="r => overflow.persona = r">
              <template #default="{ items }"><p v-for="p in items" :key="p.label + p.text" class="txt"><strong v-if="p.label">{{ p.label }}.</strong> {{ p.text }}</p></template>
            </FitList>
            <p class="align"><span class="lbl">Alignment</span> {{ c.alignment || '' }}</p>
          </div>
          <div class="box langs">
            <span class="title">Languages</span>
            <p class="txt">{{ languages }}</p>
          </div>
          <div class="box equipment">
            <span class="title">Equipment</span>
            <FitList :items="equipment" class="two-col" @overflow="r => overflow.equipment = r">
              <template #default="{ items }">
                <p v-for="it in items" :key="it._id" class="eq">{{ itemName(it) }}<span v-if="(it.quantity ?? 1) !== 1" class="num"> ×{{ it.quantity }}</span><span v-if="it.equipped" class="tag"> E</span></p>
              </template>
            </FitList>
            <div class="attune">
              <span class="lbl">Magic item attunement</span>
              <p v-for="i in 3" :key="i" class="aline"><span class="dia" :class="{ on: !!attuned[i - 1] }" />{{ attuned[i - 1]?.name || '' }}</p>
            </div>
          </div>
          <div class="box coins">
            <span class="title">Coins</span>
            <div class="coin-row">
              <div v-for="k in coinKeys" :key="k" class="coin"><span class="lbl">{{ k.toUpperCase() }}</span><span class="num">{{ coins[k] ?? '' }}</span></div>
            </div>
          </div>
        </div>
        <footer class="foot">{{ c.name }} · DiceSheet · page 2</footer>
      </section>

      <!-- ===================== CONTINUED PAGES (flow onto as many pages as needed) ===================== -->
      <section v-if="hasAppendix" class="sheet-page appendix">
        <h2>{{ c.name }}: continued</h2>
        <div class="cols">
          <template v-if="overflow.weapons.length">
            <h3>Weapons &amp; damage cantrips (continued)</h3>
            <p v-for="w in overflow.weapons" :key="w.id" class="entry"><strong>{{ w.name }}</strong> {{ [w.hit, w.damage, w.notes].filter(Boolean).join(' · ') }}</p>
          </template>
          <template v-if="overflow.spells.length">
            <h3>Spells (continued)</h3>
            <p v-for="s in overflow.spells" :key="s._id" class="entry"><strong>{{ s.name }}</strong> {{ [s.level ? `Level ${s.level}` : 'Cantrip', s.castingTime, s.range, spellNotes(s)].filter(Boolean).join(' · ') }}</p>
          </template>
          <template v-if="overflow.equipment.length">
            <h3>Equipment (continued)</h3>
            <p class="entry">{{ overflow.equipment.map(it => itemName(it) + ((it.quantity ?? 1) !== 1 ? ` ×${it.quantity}` : '')).join(' · ') }}</p>
          </template>
          <template v-if="overflow.persona.length || overflow.appearance.length">
            <h3>Appearance, backstory &amp; personality (continued)</h3>
            <p v-for="(t, i) in overflow.appearance" :key="'a' + i" class="entry">{{ t }}</p>
            <p v-for="p in overflow.persona" :key="p.label + p.text" class="entry"><strong v-if="p.label">{{ p.label }}.</strong> {{ p.text }}</p>
          </template>

          <template v-for="g in fullFeatureGroups" :key="g.label">
            <h3>{{ g.label }}</h3>
            <article v-for="f in g.items" :key="f._id" class="entry full">
              <h4>{{ f.name }}<span v-if="usesOf(f)" class="uses"> · {{ usesOf(f) }}</span></h4>
              <div class="prose" v-html="renderMarkdown(fieldText(f.description) || fieldText(f.summary))" />
            </article>
          </template>

          <template v-if="withSpells && spells.length">
            <h3>Spell descriptions</h3>
            <article v-for="s in spells" :key="s._id" class="entry full">
              <h4>{{ s.name }}</h4>
              <p class="meta">{{ [s.level ? `Level ${s.level}` : 'Cantrip', s.school, s.castingTime, s.range, components(s), s.duration].filter(Boolean).join(' · ') }}</p>
              <div class="prose" v-html="renderMarkdown(fieldText(s.description) || fieldText(s.summary))" />
            </article>
          </template>

          <template v-if="extraNotes.length">
            <h3>Notes</h3>
            <article v-for="n in extraNotes" :key="n._id" class="entry full">
              <h4 v-if="n.name">{{ n.name }}</h4>
              <div class="prose" v-html="renderMarkdown(fieldText(n.summary) || fieldText(n.description))" />
            </article>
          </template>
        </div>
      </section>
    </template>
  </main>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, reactive, ref, watch } from 'vue';
import { createSheetContext } from '../lib/context';
import { ABILITY_ORDER, isRulesNote, speciesName, type Prop } from '../lib/sheet';
import { signed } from '../lib/dice';
import { renderMarkdown, fieldText } from '../lib/markdown';
import FitList from '../components/print/FitList.vue';

const props = defineProps<{ id: string }>();
const ctx = createSheetContext(props.id);
ctx.load();
const S = ctx.sheet;
const withFeatures = ref(true);
const withSpells = ref(false);

const ready = computed(() => !!ctx.creature.value);
const c = computed(() => ctx.creature.value || {});
const v = (name: string) => S.byVar.value.get(name);
const clean = (s?: string) => (s || '').replace(/^!+\s*/, '').trim();
watch(() => c.value.name, n => { if (n) document.title = `${n} – character sheet`; });

function print() { window.print(); }

// ---------------------------------------------------------------- identity
const slotChildren = (re: RegExp) => S.ofType('propertySlot')
  .filter(s => !s.ignored && (s.slotTags || []).some((t: string) => re.test(t)))
  .flatMap(s => (S.children.value.get(s._id) || []).filter(ch => !ch.removed && !ch.inactive))
  .map(ch => clean(ch.name)).filter(Boolean);
const background = computed(() => slotChildren(/^background/i).join(', '));
const species = computed(() => speciesName(S, ctx.variables.value));
const subclass = computed(() => slotChildren(/^subclass$/i).join(', '));
const classLine = computed(() => S.ofType('class').map(k => `${k.name} ${k.level ?? ''}`.trim()).join(' / '));
const level = computed(() => ctx.variables.value.level?.value ?? '');
const xp = computed(() => c.value.denormalizedStats?.xp || '');
const ac = computed(() => (v('armor') ?? v('armorClass'))?.value ?? '');
const shieldEquipped = computed(() => S.ofType('item').some(i => i.equipped && /shield/i.test(i.name || '')));
const hp = computed(() => v('hitPoints') || S.ofType('attribute').find(p => p.attributeType === 'healthBar'));
const temp = computed(() => v('tempHP') || v('tempHitPoints'));
const hitDice = computed(() => {
  const list = S.ofType('attribute').filter(a => a.attributeType === 'hitDice' && a.total > 0);
  return {
    max: list.map(a => `${a.total}${a.hitDiceSize || ''}`).join(' + '),
    spent: list.map(a => a.total - a.value).join(' + '),
  };
});
const prof = computed(() => v('proficiencyBonus')?.value ?? 0);
const inspired = computed(() => (v('heroicInspiration')?.value ?? 0) > 0);
const initiative = computed(() => { const i = v('initiative'); return i ? signed(i.value) : ''; });
const speed = computed(() => (v('speed') ? `${v('speed')!.value} ft` : ''));
const otherSpeeds = computed(() => [['fly', 'flySpeed'], ['swim', 'swimSpeed'], ['climb', 'climbSpeed'], ['burrow', 'burrowSpeed']]
  .map(([n, k]) => [n, v(k)?.value]).filter(([, x]) => x).map(([n, x]) => `${n} ${x}`).join(' · '));
// Only the size the character chose; libraries number sizes differently, so don't guess from creatureSize
const size = computed(() => slotChildren(/^size$/i)[0] || '');
const passivePerception = computed(() => {
  const p = v('perception');
  return p ? 10 + (p.value || 0) + (p.passiveBonus || 0) : '';
});
const portrait = computed(() => c.value.picture || c.value.avatarPicture);

// ---------------------------------------------------------------- abilities, saves, skills
const skillsOf = (t: string) => S.ofType('skill').filter(s => s.skillType === t && !s.overridden);
type Row = { name: string, value: string, prof: number };
const abilityBlocks = computed(() => ABILITY_ORDER.map(key => {
  const a = v(key);
  const save = skillsOf('save').find(s => s.ability === key);
  return {
    key, name: a?.name || key, score: a?.value ?? '', mod: a ? signed(a.modifier) : '',
    save: save ? { name: 'Saving throw', value: signed(save.value), prof: save.proficiency || 0 } as Row : undefined,
    skills: skillsOf('skill').filter(s => s.ability === key).sort((x, y) => x.name.localeCompare(y.name))
      .map(s => ({ name: s.name, value: signed(s.value), prof: s.proficiency || 0 }) as Row),
  };
}));

const AbilityBox = defineComponent({
  props: { block: { type: Object, required: true } },
  setup(p) {
    const row = (r: Row, cls = '') => h('div', { class: `srow ${cls}` }, [
      h('span', { class: ['pm', profClass(r.prof)] }), h('span', { class: 'sv num' }, r.value), h('span', { class: 'sn' }, r.name),
    ]);
    return () => {
      const b = p.block as any;
      return h('div', { class: 'box ability' }, [
        h('span', { class: 'title' }, b.name),
        h('div', { class: 'ab-top' }, [
          h('div', { class: 'ab-mod' }, [h('span', { class: 'num huge' }, b.mod), h('span', { class: 'lbl' }, 'Modifier')]),
          h('div', { class: 'ab-score' }, [h('span', { class: 'num' }, b.score), h('span', { class: 'lbl' }, 'Score')]),
        ]),
        b.save ? row(b.save, 'save') : null,
        ...b.skills.map((s: Row) => row(s)),
      ]);
    };
  },
});
const profClass = (p: number) => (p >= 2 ? 'expert' : p >= 1 ? 'full' : p > 0 ? 'half' : '');

// ---------------------------------------------------------------- proficiencies
const profNames = (t: string) => skillsOf(t).filter(s => (s.proficiency || 0) > 0 || s.baseProficiency).map(s => s.name);
const armorTypes = computed(() => {
  const names = profNames('armor').join(' ').toLowerCase();
  return ['Light', 'Medium', 'Heavy', 'Shields'].map(l => ({ label: l, on: names.includes(l.toLowerCase().replace(/s$/, '')) }));
});
const weaponProfs = computed(() => profNames('weapon').join(', '));
const toolProfs = computed(() => profNames('tool').join(', '));
const languages = computed(() => skillsOf('language').map(s => s.name).join(', '));

// ---------------------------------------------------------------- weapons & damage cantrips
const shortDmg = (t?: string) => t || '';
function attackRow(p: Prop) {
  const desc = S.descendants(p).filter(d => !d.deactivatedByToggle && !d.deactivatedBySelf);
  const branchSkip = (d: Prop) => S.ancestors(d).some(a => a.type === 'branch' && a.left > p.left && ['miss', 'successfulSave'].includes(a.branchType));
  const dmg = desc.filter(d => d.type === 'damage' && d.target !== 'self' && d.amount && !branchSkip(d))
    .map(d => `${d.amount.value ?? d.amount.calculation} ${shortDmg(d.damageType)}`.trim()).slice(0, 2).join(' + ');
  const save = desc.find(d => d.type === 'savingThrow' && d.dc?.value !== undefined);
  const hit = typeof p.attackRoll?.value === 'number' ? signed(p.attackRoll.value) : save ? `DC ${save.dc.value} ${String(save.stat || '').slice(0, 3).toUpperCase()}` : '';
  const notes = [p.actionType === 'bonus' ? 'Bonus action' : p.actionType === 'reaction' ? 'Reaction' : '', p.type === 'spell' ? 'Cantrip' : '', p.range].filter(Boolean).join(', ');
  return { id: p._id, name: p.name, hit, damage: dmg, notes };
}
const weapons = computed(() => [
  ...S.ofType('action').filter(a => a.actionType !== 'event' && (typeof a.attackRoll?.value === 'number' || S.descendants(a).some(d => d.type === 'damage' && d.target !== 'self'))),
  ...visibleSpells.value.filter(s => (s.level ?? 0) === 0 && (typeof s.attackRoll?.value === 'number' || S.descendants(s).some(d => d.type === 'damage' && d.target !== 'self'))),
].map(attackRow));

// ---------------------------------------------------------------- features
const tagsOf = (a: Prop) => [...(a.slotTags || []), ...(a.tags || [])];
const features = computed(() => [
  ...S.ofType('feature'),
  ...S.ofType('note').filter(n => {
    const anc = S.ancestors(n);
    return isRulesNote(n, anc) && !anc.some(a => ['feature', 'action', 'spell', 'item', 'note'].includes(a.type));
  }),
].filter(f => !S.ancestors(f).some(a => a.type === 'propertySlot' && a.ignored)).sort((a, b) => a.left - b.left));
function featureKind(f: Prop): 'class' | 'species' | 'feats' {
  const slots = S.ancestors(f).filter(a => a.type === 'propertySlot').reverse();
  for (const s of slots) {
    const t = tagsOf(s).join(' ');
    if (/feat|fightingStyle|ASI/i.test(t)) return 'feats';
    if (/race|species|lineage|size|CLvariableTrait/i.test(t)) return 'species';
  }
  return 'class';
}
const featureGroups = computed(() => {
  const g = { class: [] as Prop[], species: [] as Prop[], feats: [] as Prop[] };
  for (const f of features.value) g[featureKind(f)].push(f);
  return g;
});
const fullFeatureGroups = computed(() => (withFeatures.value ? [
  { label: 'Class features', items: featureGroups.value.class },
  { label: 'Species traits', items: featureGroups.value.species },
  { label: 'Feats', items: featureGroups.value.feats },
] : [
  // Without full text, still continue anything that didn't fit on page 1
  { label: 'Class features (continued)', items: overflow.class },
  { label: 'Species traits (continued)', items: overflow.species },
  { label: 'Feats (continued)', items: overflow.feats },
]).filter(g => g.items.length));
const usesOf = (f: Prop) => {
  const res = S.descendants(f).find(d => d.type === 'attribute' && d.attributeType === 'resource' && !d.inactive);
  return res ? `${res.total} uses${res.reset === 'longRest' ? ', long rest' : res.reset === 'shortRest' ? ', short rest' : ''}` : '';
};
const plain = (md: string) => {
  const el = document.createElement('div');
  el.innerHTML = renderMarkdown(md);
  return (el.textContent || '').replace(/\s+/g, ' ').trim();
};
const FeatureLine = defineComponent({
  props: { f: { type: Object, required: true } },
  setup(p) {
    return () => {
      const f = p.f as Prop;
      const text = plain(fieldText(f.summary) || fieldText(f.description));
      return h('p', { class: 'fline' }, [h('strong', clean(f.name)), usesOf(f) ? h('span', { class: 'uses' }, ` (${usesOf(f)})`) : null, text ? h('span', { class: 'ftext' }, ` ${text}`) : null]);
    };
  },
});

// ---------------------------------------------------------------- spells
const spellListOf = (sp: Prop) => S.ancestors(sp).reverse().find(a => a.type === 'spellList');
const visibleSpells = computed(() => S.sorted.value.filter(sp => sp.type === 'spell' && !sp.removed
  && (!sp.inactive || (sp.deactivatedBySelf && !sp.deactivatedByAncestor && !sp.deactivatedByToggle))));
const spells = computed(() => visibleSpells.value
  .filter(sp => (sp.level ?? 0) === 0 || sp.prepared || sp.alwaysPrepared || !spellListOf(sp)?.maxPrepared)
  .sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || a.name.localeCompare(b.name)));
const ordinal = (n: number) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);
const cap = (t?: string) => (t ? t[0].toUpperCase() + t.slice(1) : '');
const spellNotes = (s: Prop) => [s.duration && !/^instantaneous$/i.test(s.duration) ? s.duration : '', s.alwaysPrepared && s.level ? 'always prepared' : ''].filter(Boolean).join('; ');
const components = (s: Prop) => [s.verbal && 'V', s.somatic && 'S', s.material && `M (${s.material})`].filter(Boolean).join(', ');
const spellSlots = computed(() => {
  const slots = S.ofType('attribute').filter(a => a.attributeType === 'spellSlot');
  return Array.from({ length: 9 }, (_, i) => {
    const s = slots.find(x => (x.spellSlotLevel?.value ?? 0) === i + 1);
    const total = s?.total || 0;
    return { level: i + 1, total, expended: total - (s?.value ?? total) };
  });
});
const casting = computed(() => {
  const lists = S.ofType('spellList').filter(l => l.dc?.value !== undefined || l.attackRollBonus?.value !== undefined);
  const describe = (l: Prop) => {
    const m = /(\w+)\.modifier/.exec(l.dc?.calculation || l.attackRollBonus?.calculation || '');
    const ab = m ? v(m[1]) : undefined;
    return {
      ability: ab?.name || '', mod: ab ? signed(ab.modifier) : '',
      dc: l.dc?.value ?? '', attack: typeof l.attackRollBonus?.value === 'number' ? signed(l.attackRollBonus.value) : '',
    };
  };
  if (!lists.length) return { ability: '', mod: '', dc: '', attack: '', others: '' };
  const first = describe(lists[0]);
  const others = lists.slice(1).map(l => { const d = describe(l); return `${l.name}: ${[d.ability, d.dc && `DC ${d.dc}`, d.attack].filter(Boolean).join(', ')}`; });
  const same = lists.slice(1).every(l => { const d = describe(l); return d.dc === first.dc && d.attack === first.attack; });
  return { ...first, others: same ? '' : others.join(' · ') };
});

// ---------------------------------------------------------------- persona, equipment, coins
const notes = computed(() => S.ofType('note').filter(n => !isRulesNote(n, S.ancestors(n))));
const noteText = (n: Prop) => plain(fieldText(n.summary) || fieldText(n.description));
const isAppearance = (n: Prop) => /physical description|appearance/i.test(n.name || '');
const PERSONA = /^(personality traits?|ideals?|bonds?|flaws?|backstory|background story|personality)$/i;
const appearance = computed(() => notes.value.filter(isAppearance).map(noteText).filter(Boolean));
const persona = computed(() => notes.value.filter(n => PERSONA.test((n.name || '').trim())).map(n => ({ label: clean(n.name), text: noteText(n) })).filter(p => p.text));
const isLibraryHelp = (n: Prop) => S.ancestors(n).some(a => ['buff', 'toggle', 'action', 'spell', 'item'].includes(a.type)
  || (a.type === 'propertySlot' && (a.ignored || tagsOf(a).some((t: string) => /tutorial|libraryIntro/i.test(t)))));
const extraNotes = computed(() => notes.value.filter(n => n.name && !isAppearance(n) && !PERSONA.test((n.name || '').trim()) && !isLibraryHelp(n) && noteText(n)));

const COIN: [string, RegExp][] = [['cp', /^copper (piece|coin)/i], ['sp', /^silver (piece|coin)/i], ['ep', /^electrum (piece|coin)/i], ['gp', /^gold (piece|coin)/i], ['pp', /^platinum (piece|coin)/i]];
const coinKeys = COIN.map(([k]) => k);
const isCoin = (it: Prop) => COIN.some(([, re]) => re.test(it.name || ''));
const coins = computed(() => {
  const out: Record<string, number> = {};
  for (const it of S.ofType('item')) for (const [k, re] of COIN) if (re.test(it.name || '')) out[k] = (out[k] || 0) + (it.quantity ?? 0);
  return out;
});
const equipment = computed(() => S.ofType('item').filter(it => !isCoin(it)).sort((a, b) => Number(!!b.equipped) - Number(!!a.equipped)));
const itemName = (it: Prop) => ((it.quantity ?? 1) !== 1 && it.plural ? it.plural : it.name);
const attuned = computed(() => S.ofType('item').filter(it => it.attuned));

// ---------------------------------------------------------------- overflow onto continued pages
const overflow = reactive({ weapons: [] as any[], class: [] as Prop[], species: [] as Prop[], feats: [] as Prop[], spells: [] as Prop[], equipment: [] as Prop[], persona: [] as any[], appearance: [] as string[] });
const hasAppendix = computed(() => fullFeatureGroups.value.length > 0 || extraNotes.value.length > 0 || (withSpells.value && spells.value.length > 0)
  || overflow.weapons.length > 0 || overflow.spells.length > 0 || overflow.equipment.length > 0 || overflow.persona.length > 0 || overflow.appearance.length > 0);
</script>

<style>
/* Letter paper, printed edge to edge; each .sheet-page sets its own margins */
@page { size: letter; margin: .3in; }
@media print {
  .topbar, .toasts, .no-print { display: none !important; }
  html, body { background: #fff !important; }
}
</style>

<style scoped>
.print-view {
  --pi: #111; --pl: #2b2b2b; --pf: #666; --pbg: #fff;
  background: var(--paper); padding: 1rem 0 3rem; color: var(--pi);
}
.toolbar { max-width: 8.5in; margin: 0 auto 1rem; display: flex; flex-wrap: wrap; gap: .5rem 1rem; align-items: center; color: var(--ink); padding: 0 1rem; }
.toolbar .hint { flex-basis: 100%; margin: 0; }
.toolbar .btn { text-decoration: none; }

/* -------- the paper -------- */
.sheet-page {
  /* Letter minus .3in margins; on screen the padding stands in for the margins */
  width: 7.9in; height: 10.4in; margin: 0 auto 1rem; padding: .3in; box-sizing: content-box;
  background: var(--pbg); color: var(--pi); box-shadow: 0 2px 12px rgb(0 0 0 / 18%);
  font-family: var(--sans); font-size: 8pt; line-height: 1.25; position: relative; overflow: hidden;
  display: flex; flex-direction: column; gap: .07in;
  color-scheme: light;
}
.sheet-page.appendix { height: auto; min-height: 10.4in; overflow: visible; display: block; }
@media print {
  .print-view { padding: 0; background: #fff; }
  .sheet-page { margin: 0; padding: 0; box-shadow: none; break-after: page; }
  .sheet-page:last-child { break-after: auto; }
}
@media screen and (max-width: 8.8in) {
  .sheet-page { zoom: .45; }
}

.box { border: 1.2pt solid var(--pl); border-radius: 5pt; padding: .05in .07in; display: flex; flex-direction: column; min-height: 0; background: var(--pbg); }
.title { font-family: var(--serif); font-weight: 700; font-size: 7.6pt; text-transform: uppercase; letter-spacing: .06em; text-align: center; margin-bottom: .03in; }
.lbl { font-size: 6pt; text-transform: uppercase; letter-spacing: .07em; color: var(--pf); }
.val { font-size: 9pt; font-weight: 500; border-bottom: .6pt solid #999; min-height: 1.25em; }
.val.big { font-family: var(--serif); font-size: 15pt; font-weight: 700; }
.num { font-variant-numeric: tabular-nums; }
.huge { font-family: var(--serif); font-size: 17pt; font-weight: 700; line-height: 1.05; text-align: center; }
.huge.word { font-size: 12pt; padding-top: .04in; }
.sub { font-size: 6.5pt; color: var(--pf); text-align: center; margin: 0; }
.txt { margin: 0 0 .04in; font-size: 7.5pt; }
.dia { display: inline-block; width: 6.5pt; height: 6.5pt; border: 1pt solid var(--pl); transform: rotate(45deg); margin: 0 2.5pt; vertical-align: middle; flex: none; }
.dia.on { background: var(--pl); }
.dia.big { width: 13pt; height: 13pt; margin: .08in auto 0; }
.dia.ghost { opacity: .25; }
.dias { display: inline-flex; gap: 1pt; }
.foot { margin-top: auto; text-align: right; font-size: 6pt; color: var(--pf); }

/* -------- page 1 header -------- */
.top { display: grid; grid-template-columns: 1fr .62in .72in 1.95in .95in .8in; gap: .07in; height: 1.05in; }
.ident { justify-content: space-between; }
.cname { display: flex; flex-direction: column; }
.pairs { display: grid; grid-template-columns: 1fr 1fr; gap: .03in .12in; }
.pairs > div { display: flex; flex-direction: column; }
.pairs .val { font-size: 8pt; }
.lvl, .ac { align-items: center; justify-content: center; text-align: center; }
.lvl .rule { width: 80%; border-top: .6pt solid #999; margin: .03in 0; }
.ac { border-radius: 5pt 5pt 50% 50% / 5pt 5pt 30% 30%; }
.hp-grid { display: grid; grid-template-columns: 1.2fr 1fr 1fr; gap: .06in; align-items: end; flex: 1; }
.hp-grid > div, .hd > div { display: flex; flex-direction: column; align-items: center; border-bottom: .6pt solid #999; }
.hp-grid .num, .hd .num { font-size: 11pt; font-weight: 700; }
.hp-grid .cur .huge { font-size: 19pt; }
.hd { gap: .04in; }
.ds { align-items: center; gap: .05in; }
.dsrow { display: flex; flex-direction: column; align-items: center; gap: .02in; }

/* -------- page 1 body -------- */
.body1 { flex: 1; min-height: 0; display: grid; grid-template-columns: 3.05in minmax(0, 1fr); gap: .09in; }
.abil-cols { display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr auto; gap: .07in; min-height: 0; }
.acol { display: flex; flex-direction: column; gap: .07in; min-height: 0; }
.pb, .insp { align-items: center; }
.training { grid-column: 1 / 3; gap: .03in; }
.training p { margin: 0; font-size: 7.5pt; }
.training .armor { display: flex; align-items: center; gap: .06in; flex-wrap: wrap; }
.chk { display: inline-flex; align-items: center; }

.right1 { display: flex; flex-direction: column; gap: .07in; min-height: 0; }
.quick { display: grid; grid-template-columns: repeat(4, 1fr); gap: .07in; }
.quick .box { align-items: center; height: .72in; }
.weapons { height: 2.05in; }
.weapons .fit, .spells .fit { flex: 1; }
table { width: 100%; border-collapse: collapse; font-size: 7.5pt; }
th { font-size: 6pt; text-transform: uppercase; letter-spacing: .05em; color: var(--pf); text-align: left; font-weight: 500; border-bottom: .8pt solid var(--pl); padding: 0 .03in .02in; }
td { border-bottom: .5pt solid #bbb; padding: .025in .03in; vertical-align: top; }
.feats-box { flex: 1; }
.feats-box .fit { flex: 1; }
.classf { flex: 1.5; }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: .07in; flex: 1; min-height: 0; }
.two-col :deep(.fline), .two-col :deep(.eq) { break-inside: avoid; }
.two-col { column-count: 2; column-gap: .14in; column-fill: auto; }
:deep(.fline) { margin: 0 0 .035in; font-size: 7.2pt; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
:deep(.fline .uses) { color: var(--pf); }
:deep(.fline .ftext) { color: #333; }

/* ability boxes (rendered by AbilityBox) */
:deep(.ability) { gap: .015in; }
:deep(.ab-top) { display: flex; align-items: center; justify-content: center; gap: .08in; margin-bottom: .03in; }
:deep(.ab-mod) { width: .6in; height: .6in; border: 1.2pt solid var(--pl); border-radius: 50%; display: flex; flex-direction: column; align-items: center; justify-content: center; }
:deep(.ab-score) { border: 1pt solid var(--pl); border-radius: 4pt; padding: .02in .08in; display: flex; flex-direction: column; align-items: center; }
:deep(.ab-score .num) { font-size: 10pt; font-weight: 700; }
:deep(.srow) { display: flex; align-items: center; gap: .05in; font-size: 7.4pt; }
:deep(.srow.save) { font-weight: 700; border-bottom: .6pt solid #999; padding-bottom: .02in; margin-bottom: .01in; }
:deep(.srow .sv) { min-width: .24in; text-align: right; border-bottom: .5pt solid #999; }
:deep(.pm) { width: 6.5pt; height: 6.5pt; border-radius: 50%; border: 1pt solid var(--pl); flex: none; }
:deep(.pm.full) { background: var(--pl); }
:deep(.pm.half) { background: linear-gradient(90deg, var(--pl) 50%, transparent 50%); }
:deep(.pm.expert) { background: var(--pl); box-shadow: 0 0 0 1.2pt #fff, 0 0 0 2.2pt var(--pl); }

/* -------- page 2 -------- */
.p2 { display: grid; grid-template-columns: minmax(0, 1fr) 2.55in; grid-template-rows: 1fr auto; gap: .09in; }
.p2 .foot { grid-column: 1 / 3; }
.left2, .right2 { display: flex; flex-direction: column; gap: .07in; min-height: 0; }
.spell-top { display: grid; grid-template-columns: 1.6in minmax(0, 1fr); gap: .07in; }
.casting dl { display: grid; grid-template-columns: 1fr auto; gap: .02in .06in; margin: .04in 0 0; align-items: baseline; }
.casting dt { font-family: var(--serif); font-weight: 700; font-size: 7pt; text-transform: uppercase; }
.casting dd { margin: 0; font-size: 11pt; font-weight: 700; min-width: .32in; text-align: center; border-bottom: .6pt solid #999; }
.casting .sub { text-align: left; margin-top: .03in; }
.slot-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .04in .08in; }
.slot { display: flex; align-items: center; gap: .04in; }
.slot .lbl { width: .24in; }
.slot .dia { margin: 0 1.6pt; }
.slot .tot { min-width: .16in; text-align: center; border-bottom: .5pt solid #999; font-weight: 700; }
.spells { flex: 1; }
.spells .sname { font-weight: 500; }
.crm { white-space: nowrap; }
.crm .dia { width: 5.5pt; height: 5.5pt; margin: 0 2pt; }
.appearance { height: 1.55in; }
.app-body { display: flex; gap: .06in; min-height: 0; flex: 1; }
.app-body .fit { flex: 1; }
.portrait { width: .95in; height: .95in; object-fit: cover; border-radius: 4pt; flex: none; }
.backstory { flex: 1.3; }
.backstory .fit { flex: 1; }
.lined { background: repeating-linear-gradient(to bottom, transparent 0, transparent .21in, #c4c4c4 .21in, #c4c4c4 calc(.21in + .5pt)); }
.align { margin: .03in 0 0; border-top: .6pt solid #999; padding-top: .02in; font-size: 8pt; }
.langs p { margin: 0; }
.equipment { flex: 1.6; }
.equipment .fit { flex: 1; }
.eq { margin: 0 0 .02in; font-size: 7.4pt; }
.eq .tag { font-size: 6pt; font-weight: 700; color: var(--pf); }
.attune { border-top: .6pt solid #999; padding-top: .03in; }
.aline { margin: .02in 0 0; border-bottom: .5pt solid #bbb; min-height: 1.2em; font-size: 7.5pt; display: flex; align-items: center; gap: .04in; }
.coin-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: .05in; }
.coin { border: 1pt solid var(--pl); border-radius: 4pt; display: flex; flex-direction: column; align-items: center; padding: .02in 0; }
.coin .num { font-weight: 700; font-size: 9pt; min-height: 1.2em; }

/* -------- continued pages -------- */
.appendix h2 { font-family: var(--serif); font-size: 13pt; margin: 0 0 .08in; border-bottom: 1.2pt solid var(--pl); }
.appendix .cols { column-count: 2; column-gap: .25in; }
.appendix h3 { font-family: var(--serif); font-size: 9.5pt; text-transform: uppercase; letter-spacing: .05em; margin: .1in 0 .04in; break-after: avoid; column-span: none; }
.appendix .entry { margin: 0 0 .05in; font-size: 7.6pt; }
.appendix .full { break-inside: avoid-page; }
.appendix h4 { margin: 0; font-size: 8.2pt; }
.appendix .uses, .appendix .meta { color: var(--pf); font-weight: 400; }
.appendix .meta { margin: 0; font-size: 7pt; }
.appendix .prose { line-height: 1.3; }
.appendix .prose :deep(p) { margin: .02in 0; }
.appendix .prose :deep(img) { display: none; }
.appendix .prose :deep(table) { font-size: 7pt; }
.appendix .prose :deep(ul) { margin: .02in 0; padding-left: .15in; }
</style>
