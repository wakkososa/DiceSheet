export const EJSON = {
  clone: v => (v === undefined ? v : structuredClone(v)),
  equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  stringify: v => JSON.stringify(v), parse: s => JSON.parse(s),
};
