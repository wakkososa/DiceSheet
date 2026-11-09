import SimpleSchema from 'simpl-schema';
// Minimal stand-ins for Meteor globals used by the vendored DiceCloud engine.
import { EJSON } from './ejson.js';
import { Random } from './random.js';
class MeteorError extends Error {
  constructor(error, reason, details) { super(reason || error); this.error = error; this.reason = reason; this.details = details; }
}
const collections = new Map();
class Collection {
  constructor(name) { this._name = name; this.docs = new Map(); collections.set(name, this); }
  attachSchema(schema, opts) {
    this._schemas = this._schemas || [];
    if (opts?.selector) this._schemas.push({ selector: opts.selector, schema });
    else this._defaultSchema = schema;
  }
  simpleSchema(doc) {
    for (const { selector, schema } of this._schemas || []) {
      if (doc && Object.entries(selector).every(([k, v]) => doc[k] === v)) return schema;
    }
    return this._defaultSchema;
  }
  attachBehaviour() {} helpers() {} deny() {} allow() {}
  createIndexAsync() { return Promise.resolve(); } createIndex() {}
  _ensureIndex() {}
  rawCollection() { return { createIndex() {} }; }
}
globalThis.Meteor = {
  isServer: true, isClient: false, isTest: false, isDevelopment: false, isProduction: true,
  settings: { public: {} },
  Error: MeteorError,
  startup(fn) { /* no-op */ },
  methods() {}, publish() {}, userId() { return null; }, user() { return null; },
  bindEnvironment: fn => fn, defer: fn => setTimeout(fn, 0),
  absoluteUrl: p => '/' + (p || ''),
  users: new Collection('users'),
};
globalThis.Mongo = {
  Collection,
  getCollection: name => collections.get(name) || new Collection(name),
};
globalThis.Random = Random;
globalThis.EJSON = EJSON;
globalThis.Package = {};
globalThis.Accounts = {
  onLogin() {}, onCreateUser() {}, validateNewUser() {}, config() {}, emailTemplates: {},
  urls: {}, ui: { config() {} }, onLogout() {},
};

// Options normally registered by Meteor packages (aldeed:collection2, aldeed:schema-index, denyclient)
SimpleSchema.extendOptions(['index', 'unique', 'sparse', 'denyInsert', 'denyUpdate']);
globalThis.DDP = { randomStream: () => ({ fraction: () => Math.random(), id: () => Random.id() }) };
// DiceCloud's VERSION constant shells out to git unless this is set
process.env.CONTAINER_VERSION ||= 'dicesheet';
