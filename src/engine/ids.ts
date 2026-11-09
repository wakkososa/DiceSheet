import crypto from 'node:crypto';

// Meteor's Random.id alphabet, so ids look and behave like DiceCloud's
const UNMISTAKABLE = '23456789ABCDEFGHJKLMNPQRSTWXYZabcdefghijkmnopqrstuvwxyz';

export function newId(length = 17): string {
  let s = '';
  for (let i = 0; i < length; i++) s += UNMISTAKABLE[crypto.randomInt(UNMISTAKABLE.length)];
  return s;
}
