/**
 * Public API over the vendored DiceCloud engine. Everything the server needs
 * from DiceCloud goes through this file, so the rest of the app never imports
 * vendored code directly.
 */
import './preload';
import { cloneDeep } from 'lodash';
import migrateArchiveUpstream from '/imports/migrations/archive/migrateArchive';
import SCHEMA_VERSION from '/imports/constants/SCHEMA_VERSION';
import { buildComputationFromProps } from '/imports/api/engine/computation/buildCreatureComputation';
import computeCreatureComputation from '/imports/api/engine/computation/computeCreatureComputation';
import type CreatureComputation from '/imports/api/engine/computation/CreatureComputation';
import { parse, prettifyParseError } from '/imports/parser/parser';
import resolve from '/imports/parser/resolve';
import toString from '/imports/parser/toString';
import getSlotFillFilterUpstream from '/imports/api/creature/creatureProperties/methods/getSlotFillFilter';
import defaultCharacterPropertiesUpstream from '/imports/api/creature/creatures/defaultCharacterProperties';
import { renewDocIds as renewDocIdsUpstream, applyNestedSetProperties } from '/imports/api/parenting/parentingFunctions';
import CreatureProperties from '/imports/api/creature/creatureProperties/CreatureProperties';
import Creatures from '/imports/api/creature/creatures/Creatures';
import { newId } from './ids';
import getDefaultSlotFillerUpstream from '/imports/api/library/methods/getDefaultSlotFiller';

export { SCHEMA_VERSION };
export type Doc = Record<string, any> & { _id: string };

const MAX_PROPS_WARNING = 1000;

/** Migrate any DiceCloud archive (schema v1-v3) to the current schema, in place. */
export function migrateArchive(archive: any) {
  const warn = console.warn;
  const warnings: string[] = [];
  console.warn = (...a: any[]) => { warnings.push(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')); };
  try {
    migrateArchiveUpstream(archive);
  } finally {
    console.warn = warn;
  }
  return warnings;
}

export type ComputeResult = {
  props: Doc[];
  scope: Record<string, any>;
  errors: any[];
  computation: CreatureComputation;
};

/**
 * Compute a creature exactly as DiceCloud's server does.
 * `props` must be the creature's non-removed properties; they are not mutated.
 */
export async function computeCreature(creature: Doc, props: Doc[]): Promise<ComputeResult> {
  const sorted = [...props].sort((a, b) => (a.left ?? 0) - (b.left ?? 0));
  const computation = buildComputationFromProps(sorted as any, creature as any, { _creatureId: creature._id } as any);
  try {
    await computeCreatureComputation(computation);
  } catch (e: any) {
    computation.errors.push({ type: 'crash', details: { error: e?.message || String(e) } });
  }
  if (computation.props.length > MAX_PROPS_WARNING) {
    computation.errors.push({
      type: 'warning',
      details: { error: `This character sheet has too many properties and may perform poorly ( ${computation.props.length} / ${MAX_PROPS_WARNING} )` },
    });
  }
  return {
    props: computation.props as any,
    scope: computation.scope as any,
    errors: computation.errors.map(e => (e instanceof Error ? { type: 'crash', details: { error: e.message } } : e)),
    computation,
  };
}

/** Serialize a computed scope the way DiceCloud stores creatureVariables, but with values kept. */
export function serializeScope(scope: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const key in scope) {
    if (key[0] === '$' || key[0] === '_') continue;
    const v = scope[key];
    if (!v || typeof v !== 'object') { out[key] = v; continue; }
    if (v._id && v.type) {
      // Keep a compact, display-friendly view of the property, including computed values
      out[key] = pick(v, ['_id', 'type', 'name', 'variableName', 'value', 'total', 'modifier', 'proficiency',
        'level', 'damage', 'attributeType', 'skillType', 'enabled', 'disabled']);
      if (v.type === 'constant' && v.valueNode?.parseType === 'constant') out[key].value = v.valueNode.value;
      // Constants store their value as a parse node; keep the plain value
      if (out[key].value && typeof out[key].value === 'object' && out[key].value.parseType === 'constant') out[key].value = out[key].value.value;
    } else {
      const copy = { ...v };
      delete copy.parent;
      out[key] = copy;
    }
  }
  return out;
}

function pick(o: any, keys: string[]) {
  const r: any = {};
  for (const k of keys) if (o[k] !== undefined) r[k] = o[k];
  return r;
}

export type ConditionResult = { ok: boolean, note?: string, error?: string };

/**
 * Evaluate a slot-filler requirement (slotFillerCondition) against a computed
 * creature scope. Mirrors SlotFillDialog.vue, but awaits the async resolver
 * (upstream called it synchronously, which made every requirement fail).
 */
export async function evaluateCondition(condition: string, note: string | undefined, scope: Record<string, any>): Promise<ConditionResult> {
  if (!condition) return { ok: true };
  try {
    const { result } = await resolve('reduce', parse(condition), scope as any);
    if (result?.parseType === 'constant') {
      if (result.value) return { ok: true };
      return { ok: false, note: note || condition };
    }
    return { ok: false, note: note || toString(result) };
  } catch (e: any) {
    let msg: string;
    try { msg = prettifyParseError(e); } catch { msg = e?.message || String(e); }
    return { ok: false, error: 'Condition error: ' + msg };
  }
}

/** Evaluate any calculation string to a display value. */
export async function evaluate(formula: string, scope: Record<string, any>) {
  const { result } = await resolve('reduce', parse(formula), scope as any);
  return result?.parseType === 'constant' ? result.value : toString(result);
}

export function getSlotFillFilter(slot: Doc, libraryIds: string[]) {
  return getSlotFillFilterUpstream({ slot, libraryIds });
}

export function defaultCharacterProperties(creatureId: string): Doc[] {
  return defaultCharacterPropertiesUpstream(creatureId).map((p: any) => ({ _id: p._id || newId(), ...p }));
}

export function getDefaultSlotFiller(slot: Doc) {
  return getDefaultSlotFillerUpstream(slot);
}

export function renewDocIds(args: { docArray: Doc[], collectionMap?: Record<string, string>, idMap?: Record<string, string> }) {
  renewDocIdsUpstream(args as any);
}

/** Renumber left/right for a creature's property tree; returns docs whose numbering changed. */
export function rebuildNestedSets(docs: Doc[]): Set<string> {
  const before = new Map(docs.map(d => [d._id, `${d.left}:${d.right}:${d.parentId ?? ''}`]));
  const sorted = [...docs].sort((a, b) => (a.left ?? 0) - (b.left ?? 0));
  applyNestedSetProperties(sorted as any);
  const changed = new Set<string>();
  for (const d of docs) if (before.get(d._id) !== `${d.left}:${d.right}:${d.parentId ?? ''}`) changed.add(d._id);
  return changed;
}

/** Clean and validate a creature property against DiceCloud's schema for its type. */
export function cleanProperty(prop: Doc): Doc {
  const schema = (CreatureProperties as any).simpleSchema(prop);
  const clean = schema.clean(cloneDeep(prop));
  clean._id = prop._id; // _id is not part of DiceCloud's schema; clean() would drop it
  schema.validate(clean);
  return clean;
}

export function propertySchemaKeys(prop: Doc): string[] {
  return (CreatureProperties as any).simpleSchema(prop).objectKeys();
}

export function cleanCreature(creature: Doc): Doc {
  const schema = (Creatures as any).simpleSchema();
  const clean = schema.clean(cloneDeep(creature));
  clean._id = creature._id;
  return clean;
}

export { newId } from './ids';
