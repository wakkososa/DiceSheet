# Changes to vendored DiceCloud code (vendor/imports)

Source: ThaumRystra/DiceCloud, branch `develop` @ 88fc9c8 (Jan 2026), GPL-3.0.
(`DC-16-migrate-to-meteor-3` was evaluated and rejected: unfinished, with an engine
regression — computeVariable.ts dropped `if (!node.data) node.data = {}`.)

Every edit to vendored files is listed here so upstream updates can be re-applied.

| File | Change | Reason |
|---|---|---|
| api/library/methods/copyLibraryNodeTo.js | Removed unused import `setLineageOfDocs` | Export no longer exists upstream; strict bundlers reject it |
| api/engine/action/applyProperties/applyTriggerProperty.ts | Skip inactive triggers and re-check `condition` when the trigger fires | Regression in develop: master's applyTriggers.js checked it. LoV's "All Stats Assigned" (`assignIndex > 6`) fired after the first Standard Array assignment |
| api/engine/action/tasks/applyResetTask.ts | Find hit dice as attributes with attributeType `hitDice`; `continue` past full dice | Regression in develop: long rests never restored hit dice (master's restCreature.js queried attributeType) |
| api/engine/action/applyProperties/applyBuffRemoverProperty.ts | Buff removers with `targetParentBuff` always act on the acting creature | Without a tabletop develop gives actions no targets, so "remove parent buff" with target `target` did nothing. LoV's Roll For Stats prompt never went away and its Assign buttons stayed hidden (dicecloud.com/master removes it) |
| api/engine/computation/computeComputation/computeByType/computePointBuy.js | Set `_parseLevel` and read the cost from `valueNode` | Regression in develop: resolveCalculationNode changed to `_parseLevel`/`valueNode`, so point-buy costs were always 0 and "points left" never moved |
| api/engine/action/functions/getEffectiveActionScope.ts | Seed the action scope with the acting property's ancestors as `#type` | Regression in develop: master's doAction adds them (getAncestorScope). Without it, buffs applied by spells froze `#spellList.dc` to 0 (LoV 2024 Toll the Dead showed DC 0) |
