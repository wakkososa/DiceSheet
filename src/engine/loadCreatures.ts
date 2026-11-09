/**
 * Drop-in replacement for DiceCloud's /imports/api/engine/loadCreatures.
 *
 * Upstream keeps creatures cached through Meteor subscriptions and falls back to
 * MongoDB. Here the server loads a creature from SQLite, computes it, and
 * registers the computed properties and variables below before running the
 * action engine. Function names and behaviour match upstream so the vendored
 * action engine runs unchanged. The build aliases the upstream module to this file.
 */
import { cloneDeep } from 'lodash';

type Prop = Record<string, any> & { _id: string, left: number, right: number };
type Loaded = { creature: any, properties: Map<string, Prop>, variables: any };

export const loadedCreatures: Map<string, Loaded> = new Map();

const clone = <T>(v: T): T => cloneDeep(v);

export function setLoadedCreature(creatureId: string, creature: any, props: Prop[], variables: any) {
  loadedCreatures.set(creatureId, {
    creature,
    properties: new Map(props.map(p => [p._id, p])),
    variables: { ...variables, _creatureId: creatureId },
  });
}

export function unloadCreature(creatureId: string) {
  loadedCreatures.delete(creatureId);
}

// Upstream API ---------------------------------------------------------------

export function loadCreature() { /* creatures are registered explicitly with setLoadedCreature */ }
export function unloadAllCreatures() { loadedCreatures.clear(); }

const get = (creatureId: string) => loadedCreatures.get(creatureId);

export function getSingleProperty(creatureId: string, propertyId: string) {
  const property = get(creatureId)?.properties.get(propertyId);
  if (!property || property.removed) return undefined;
  return clone(property);
}

export function getProperties(creatureId: string) {
  const c = get(creatureId);
  if (!c) return [];
  return clone([...c.properties.values()].filter(p => !p.removed).sort((a, b) => a.left - b.left));
}

export function getPropertiesOfType(creatureId: string, propType: string) {
  const c = get(creatureId);
  if (!c) return [];
  return clone([...c.properties.values()].filter(p => !p.removed && p.type === propType).sort((a, b) => a.left - b.left));
}

export function getPropertiesByFilter(creatureId: string, filterFn: (p: any, i: number, a: any[]) => unknown) {
  const c = get(creatureId);
  if (!c) return [];
  return clone([...c.properties.values()].filter(filterFn).sort((a, b) => a.left - b.left));
}

export function getCreature(creatureId: string) {
  const c = get(creatureId);
  return c ? clone(c.creature) : undefined;
}

export function getVariables(creatureId: string) {
  const c = get(creatureId);
  return c ? clone(c.variables) : { _creatureId: creatureId };
}

export function replaceLinkedVariablesWithProps(variables: any) {
  for (const key in variables) {
    const propId = variables[key]?._propId;
    if (!propId) continue;
    variables[key] = getSingleProperty(variables._creatureId, propId);
  }
}

export function getPropertyAncestors(creatureId: string, propertyId: string) {
  const out: Prop[] = [];
  let cur = getSingleProperty(creatureId, propertyId);
  while (cur?.parentId) {
    cur = getSingleProperty(creatureId, cur.parentId);
    if (cur) out.push(cur);
  }
  return out;
}

export function getPropertyDescendants(creatureId: string, propertyId: string) {
  const property = getSingleProperty(creatureId, propertyId);
  const c = get(creatureId);
  if (!property || !c) return [];
  return clone([...c.properties.values()]
    .filter(p => p.left > property.left && p.right < property.right && p.removed !== true)
    .sort((a, b) => a.left - b.left));
}

export function getPropertyChildren(creatureId: string, property: string | Prop | undefined) {
  if (typeof property === 'string') property = getSingleProperty(creatureId, property);
  const c = get(creatureId);
  if (!property || !c) return [];
  const id = property._id;
  return clone([...c.properties.values()].filter(p => p.parentId === id && p.removed !== true).sort((a, b) => a.left - b.left));
}

export default {};
