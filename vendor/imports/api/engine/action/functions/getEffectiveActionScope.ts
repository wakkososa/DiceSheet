import { EngineAction } from '/imports/api/engine/action/EngineActions';
import { getVariables, getPropertyAncestors } from '/imports/api/engine/loadCreatures';

// Combine all the action results into the scope at present
export async function getEffectiveActionScope(action: EngineAction) {
  const scope = await getVariables(action.creatureId);
  // DiceSheet patch: like master's doAction (getAncestorScope), start with the acting property's
  // ancestors as `#type` (e.g. a spell's `#spellList`). Without them, buffs applied by a spell
  // froze `#spellList.dc` to 0. Nearer ancestors win.
  const actingPropId = (action.task as any)?.prop?._id;
  if (actingPropId) {
    const ancestors = await getPropertyAncestors(action.creatureId, actingPropId);
    // Order root -> nearest, whatever order the loader returns them in
    [...ancestors].sort((a: any, b: any) => (a.left ?? 0) - (b.left ?? 0)).forEach((a: any) => {
      scope[`#${a.type}`] = { _propId: a._id };
    });
  }
  // delete scope._id;
  // delete scope._creatureId;
  // Combine the applied results
  for (const result of action.results) {
    // Pop keys that are not longer used by a busy property
    if (result.popScope) {
      for (const key in result.popScope) {
        if (!result.popScope[key]) continue;
        // If the popped keys have previous results, return to them
        if (scope[key]?.previous) {
          scope[key] = scope[key]?.previous;
        } else {
          // just remove the busy flag, the prop has been consumed
          delete scope[key]?._busy
        }
      }
    }
    // For keys that have just started being used by a busy property
    if (result.pushScope) {
      for (const key in result.pushScope) {
        // If the pushed keys already exist and are busy,
        // save the previous results and overwrite
        // the key
        if (scope[key]?._busy) {
          scope[key] = {
            ...result.pushScope[key],
            previous: scope[key],
            _busy: true,
          };
        } else {
          scope[key] = {
            ...result.pushScope[key],
            _busy: true,
          };
        }
      }
    }
    // Assign other scope changes without bashing the scope[key].previous field
    if (result.scope) {
      for (const key in result.scope) {
        if (scope[key]?.previous || scope[key]?._busy) {
          scope[key] = {
            ...result.scope[key],
            previous: scope[key].previous,
            _busy: scope[key]._busy,
          };
        } else {
          scope[key] = result.scope[key];
        }
      }
    }
  }
  return scope;
}