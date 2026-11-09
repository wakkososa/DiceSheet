// Stand-in for DiceCloud server/client-only modules (Discord, snackbars, S3...) that the lite build drops.
const noop = () => undefined;
export const sendWebhookAsCreature = noop, sendWebhook = noop, snackbar = noop;
export default new Proxy({}, { get: () => noop });
