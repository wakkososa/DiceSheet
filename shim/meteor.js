export const Meteor = globalThis.Meteor;
export const Mongo = globalThis.Mongo;
export { EJSON } from './ejson.js';
export { Random } from './random.js';
export class ValidatedMethod { constructor(o) { Object.assign(this, o); } call() { throw new Error('Method calls unavailable in lite build'); } callAsync() { return this.call(); } }
export const Roles = { userIsInRoleAsync: async () => false, userIsInRole: () => false, createRoleAsync: async () => {}, addRolesToParentAsync: async () => {}, getRolesForUserAsync: async () => [] };
export const FilesCollection = class {};
export const Migrations = { add() {} };
export const fetch = globalThis.fetch;
export default {};
export const Accounts = globalThis.Accounts;
