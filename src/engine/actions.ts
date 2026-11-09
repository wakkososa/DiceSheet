/**
 * Runs DiceCloud's own action engine (applyAction) on the server.
 *
 * Upstream runs an action in the browser as a simulation, opens a dialog when the
 * action needs the player's input, then replays it on the server with the saved
 * decisions and a dice roller seeded by the action id. We do the same in one
 * place: the server runs the action; if it needs input, it returns the question;
 * the browser asks the player and calls again with the answers and the same seed,
 * so dice come out identical on every replay.
 */
import './preload';
import applyAction from '/imports/api/engine/action/functions/applyAction';
import getDeterministicDiceRoller from '/imports/api/engine/action/functions/userInput/getDeterministicDiceRoller';
import mutationToPropUpdates from '/imports/api/engine/action/functions/mutationToPropUpdates';
import mutationToLogUpdates from '/imports/api/engine/action/functions/mutationToLogUpdates';
import { setLoadedCreature, unloadCreature } from './loadCreatures';
import { newId } from './ids';
import type { Doc } from './index';

export type Decision = any;

export type InputRequest =
  | { kind: 'choose', choices: { _id: string, name?: string, type?: string, summary?: string }[], quantity: [number, number] }
  | { kind: 'advantage', suggested: 0 | 1 | -1 };

export class NeedsInput {
  constructor(public request: InputRequest) {}
}

export type EngineTask =
  | { kind: 'prop', propId: string }
  | { kind: 'castSpell', propId: string, slotId?: string, ritual?: boolean, withoutSpellSlot?: boolean }
  | { kind: 'reset', eventName: 'shortRest' | 'longRest' };

export type ActionOutcome =
  | { status: 'needsInput', seed: string, request: InputRequest, decisions: Decision[] }
  | { status: 'done', seed: string, ops: any[], log: any[] };

/** Variables the way DiceCloud's writeScope stores them: properties become {_propId} links. */
function scopeToVariables(scope: Record<string, any>) {
  const vars: Record<string, any> = {};
  for (const key in scope) {
    if (key[0] === '$' || key[0] === '_') continue;
    const v = scope[key];
    if (v && typeof v === 'object' && v._id && v.type) vars[key] = { _propId: v._id };
    else if (v && typeof v === 'object') { const c = { ...v }; delete c.parent; vars[key] = c; }
    else vars[key] = v;
  }
  return vars;
}

export async function runEngineAction(opts: {
  creature: Doc, computedProps: Doc[], scope: Record<string, any>,
  task: EngineTask, seed?: string, decisions?: Decision[],
}): Promise<ActionOutcome> {
  const { creature, computedProps, scope } = opts;
  const seed = opts.seed && /^[A-Za-z0-9]{8,32}$/.test(opts.seed) ? opts.seed : newId();
  const answers = [...(opts.decisions || [])];
  const used: Decision[] = [];
  const byId = new Map(computedProps.map(p => [p._id, p]));

  const next = (request: InputRequest) => {
    if (answers.length) { const a = answers.shift(); used.push(a); return a; }
    throw new NeedsInput(request);
  };
  const dice = getDeterministicDiceRoller(seed);
  const input = {
    targetIds: async () => [],              // no shared tabletop: actions target only this character
    nextStep: async () => {},
    rollDice: (d: any) => dice(d),
    choose: async (choices: any[], quantity: [number, number] = [1, 1]) => next({
      kind: 'choose', quantity,
      choices: choices.map(c => ({ _id: c._id, name: c.name || c.cache?.node?.name, type: c.type, summary: c.summary?.value ?? c.summary?.text ?? c.description?.value })),
    }),
    advantage: async (suggested: 0 | 1 | -1) => next({ kind: 'advantage', suggested }),
    // Checks prompted by an action: accept the suggested ability/skill and DC
    check: async (suggested: any) => suggested,
  };

  let task: any;
  if (opts.task.kind === 'reset') {
    task = { subtaskFn: 'reset', eventName: opts.task.eventName, targetIds: [creature._id] };
  } else {
    const prop = byId.get(opts.task.propId);
    if (!prop || prop.removed) throw new Error('That property no longer exists');
    if (opts.task.kind === 'castSpell') {
      if (prop.type !== 'spell') throw new Error('Only spells can be cast');
      task = { prop, subtaskFn: 'castSpell', targetIds: [], params: { slotId: opts.task.slotId, ritual: !!opts.task.ritual, withoutSpellSlot: !!opts.task.withoutSpellSlot } };
    } else {
      task = { prop, targetIds: [], subtaskFn: undefined };
    }
  }

  const action: any = { _id: seed, creatureId: creature._id, task, results: [], taskCount: 0 };
  setLoadedCreature(creature._id, creature, computedProps as any, scopeToVariables(scope));
  try {
    await applyAction(action, input as any);
  } catch (e) {
    if (e instanceof NeedsInput) return { status: 'needsInput', seed, request: e.request, decisions: used };
    throw e;
  } finally {
    unloadCreature(creature._id);
  }

  const ops: any[] = [];
  const log: any[] = [];
  for (const result of action.results) {
    for (const mutation of result.mutations) {
      ops.push(...mutationToPropUpdates(mutation));
      log.push(...mutationToLogUpdates(mutation));
    }
  }
  return { status: 'done', seed, ops, log };
}
