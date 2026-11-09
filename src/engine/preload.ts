// Load order matters: DiceCloud has circular imports that Meteor's module
// loader happens to resolve. Entering each cycle from the right module first
// reproduces the same initialization order in a standard ESM bundle.
//
// - parser: call -> functions -> resolve -> parseTree/index -> call
// - schemas: Icons -> sharingPermissions -> ... -> CreatureProperties -> Icons
import '/imports/parser/parseTree/index';
import '/imports/api/simpleSchemaConfig';
import '/imports/api/sharing/sharingPermissions';
