import { computed, type Ref } from 'vue';

export type Prop = Record<string, any> & { _id: string, type: string };

export const calc = (c: any) => (c && typeof c === 'object' ? c.value : c);

/** Builds indexes over a creature's computed properties for the sheet views. */
export function useSheet(props: Ref<Prop[]>) {
  const sorted = computed(() => [...props.value].sort((a, b) => a.left - b.left));
  const byId = computed(() => new Map(sorted.value.map(p => [p._id, p])));
  const children = computed(() => {
    const m = new Map<string | undefined, Prop[]>();
    for (const p of sorted.value) {
      const k = p.parentId && byId.value.has(p.parentId) ? p.parentId : undefined;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(p);
    }
    return m;
  });
  /** Active properties: what the sheet should show. */
  const active = computed(() => sorted.value.filter(p => !p.inactive && !p.removed));
  const ofType = (t: string) => active.value.filter(p => p.type === t);
  const descendants = (p: Prop) => sorted.value.filter(d => d.left > p.left && d.right < p.right);
  const ancestors = (p: Prop) => { const out: Prop[] = []; let cur = p.parentId && byId.value.get(p.parentId); while (cur) { out.unshift(cur); cur = cur.parentId && byId.value.get(cur.parentId); } return out; };
  const byVar = computed(() => {
    const m = new Map<string, Prop>();
    for (const p of active.value) if (p.variableName && !p.overridden && !m.has(p.variableName)) m.set(p.variableName, p);
    return m;
  });
  return { sorted, byId, children, active, ofType, descendants, ancestors, byVar };
}

export type Sheet = ReturnType<typeof useSheet>;

const RULES_ANCESTOR_TYPES = new Set(['class', 'classLevel', 'feature', 'action', 'spell', 'item', 'buff']);
const RULES_SLOT_TAG = /race|species|lineage|class|background|feat|subclass|mastery/i;
/**
 * A note is rules content (shown under Features) when it comes from a class, feature,
 * action, spell, item or buff, or from a species/class/background/feat choice.
 * Everything else (the player's own notes, persona notes) belongs in the Journal.
 */
export function isRulesNote(note: Prop, ancestors: Prop[]) {
  // Optional slots (e.g. LoV's Tutorial) keep DiceCloud's behaviour: their notes stay in the Journal
  if (ancestors.some(a => a.type === 'propertySlot' && a.ignored)) return false;
  return ancestors.some(a => RULES_ANCESTOR_TYPES.has(a.type)
    || (a.type === 'propertySlot' && (a.slotTags || []).concat(a.tags || []).some((t: string) => RULES_SLOT_TAG.test(t))));
}

/**
 * Whether a slot should be offered at all, as in DiceCloud: a slot whose condition is false
 * (e.g. Mystic Arcanum 6th level needs warlock.level >= 11) is hidden, and so is a full
 * slot marked "hide when full". Conditions that only track tutorial progress (LoV's
 * jonStatus/tutorialStatus) are ignored: DiceSheet doesn't enforce the tutorial.
 */
const TUTORIAL_VAR = /^(jonStatus|tutorialStatus|tutorial\w*)$/i;
/** True when a condition only refers to tutorial-progress variables. */
export function tutorialOnly(calc?: string) {
  const names = (String(calc || '').match(/[A-Za-z_]\w*/g) || []).filter(w => !/^(true|false|and|or|not)$/i.test(w));
  return names.length > 0 && names.every(w => TUTORIAL_VAR.test(w));
}

export function slotAvailable(s: Prop) {
  if (s.slotCondition && s.slotCondition.value === false && !tutorialOnly(s.slotCondition.calculation)) return false;
  if (s.hideWhenFull && (s.quantityExpected?.value ?? 0) > 0 && !(s.spaceLeft > 0)) return false;
  return true;
}

/** "tiefling" / "halfElf" / "high_elf" -> "Tiefling" / "Half Elf" / "High Elf" */
export const titleCase = (v: string) => v.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\b\w/g, c => c.toUpperCase()).trim();

/**
 * The character's species/race for display: what fills the Race/Species slot, else the
 * library's `race`/`species` variable. Libraries often store that as a constant whose
 * *value* is the race ("tiefling"); its name is just "Race".
 */
export function speciesName(sheet: Sheet, variables: Record<string, any>): string {
  const fromSlot = sheet.ofType('propertySlot')
    .filter(s => (s.slotTags || []).some((t: string) => /^(race|species|lineage)$/i.test(t)))
    .flatMap(s => (sheet.children.value.get(s._id) || []).filter(c => !c.removed && !c.inactive && c.type !== 'effect'))
    .map(c => (c.name || '').replace(/^!+\s*/, '').trim()).filter(Boolean);
  if (fromSlot.length) return fromSlot.join(', ');
  for (const k of ['species', 'race', 'lineage']) {
    const x = variables[k];
    if (!x) continue;
    if (typeof x.value === 'string' && x.value) return titleCase(x.value);
    if (x.type !== 'constant' && x.name) return x.name;
  }
  return '';
}

export const ABILITY_ORDER = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
export const ABILITY_SHORT: Record<string, string> = { strength: 'STR', dexterity: 'DEX', constitution: 'CON', intelligence: 'INT', wisdom: 'WIS', charisma: 'CHA' };

export const ACTION_TYPE_LABEL: Record<string, string> = {
  action: 'Actions', attack: 'Attacks', bonus: 'Bonus actions', reaction: 'Reactions',
  free: 'Free actions', long: 'Longer actions', event: 'Other',
};
export const ACTION_TYPE_ORDER = ['attack', 'action', 'bonus', 'reaction', 'free', 'long', 'event'];

export const RESET_LABEL: Record<string, string> = { shortRest: 'Short rest', longRest: 'Long rest' };

export function propTitle(p: Prop) {
  return p.name || p.variableName || p.cache?.node?.name || typeName(p.type);
}

const TYPE_NAMES: Record<string, string> = {
  action: 'Action', adjustment: 'Attribute damage', attribute: 'Attribute', branch: 'Branch', buff: 'Buff',
  buffRemover: 'Remove buff', class: 'Class', classLevel: 'Class level', constant: 'Constant', container: 'Container',
  damage: 'Damage', damageMultiplier: 'Resistance / vulnerability', effect: 'Effect', feature: 'Feature', folder: 'Folder',
  item: 'Item', note: 'Note', pointBuy: 'Point buy', proficiency: 'Proficiency', propertySlot: 'Slot', reference: 'Reference',
  roll: 'Roll', savingThrow: 'Saving throw', skill: 'Skill', spell: 'Spell', spellList: 'Spell list', toggle: 'Toggle', trigger: 'Trigger',
  creature: 'Creature template',
};
export const typeName = (t: string) => TYPE_NAMES[t] || t;
