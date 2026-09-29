/** Meme raison que `codegenNativeComponent` : rien a piloter sur le bureau. */
module.exports = function codegenNativeCommands() {
  return new Proxy({}, { get: () => () => undefined });
};
module.exports.default = module.exports;
