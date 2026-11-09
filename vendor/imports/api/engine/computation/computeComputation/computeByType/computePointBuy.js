import { has } from 'lodash';
import { resolveCalculationNode } from '/imports/api/engine/computation/computeComputation/computeByType/computeCalculation';
import toPrimitiveOrString from '/imports/parser/toPrimitiveOrString';

export default async function computePointBuy(computation, node) {
  const prop = node.data;
  const min = has(prop, 'min.value') ? prop.min.value : null;
  const max = has(prop, 'max.value') ? prop.max.value : null;
  prop.spent = 0;
  for (const row of prop.values || []) {
    row.spent = 0;
    if (row.value === undefined) return;
    const costFunction = EJSON.clone(prop.cost);
    // DiceSheet patch: resolveCalculationNode reads `_parseLevel` and writes `valueNode` (develop);
    // this file still used `parseLevel`/`value`, so every row cost came out as 0.
    if (costFunction) costFunction._parseLevel = 'reduce';

    // Check min and max
    if (min !== null && row.value < min) {
      row.value = min;
    }
    if (max !== null && row.value > max) {
      row.value = max;
    }
    // Evaluate the cost function
    if (!costFunction) return;
    await resolveCalculationNode(costFunction, costFunction.parseNode, {
      ...computation.scope, value: row.value
    });
    // Write calculation errors
    costFunction.errors?.forEach(error => {
      if (error?.message) {
        row.errors = row.errors || [];
        error.message = 'Cost calculation error.\n' + error.message;
        row.errors.push(error);
      }
    });
    costFunction.value = toPrimitiveOrString(costFunction.valueNode);
    if (Number.isFinite(costFunction.value)) {
      row.spent = costFunction.value;
      prop.spent += costFunction.value;
    }
  }
  prop.pointsLeft = (prop.total?.value || 0) - (prop.spent || 0);
  if (prop.spent > prop.total?.value) {
    prop.errors = prop.errors || [];
    prop.errors.push({
      type: 'pointBuyError',
      message: 'Spent more than total points available',
    });
  }
}
