/// <reference types="vite/client" />

/** Binaire WebAssembly de sql.js, importé par son URL résolue au build. */
declare module '*.wasm?url' {
  const url: string;
  export default url;
}
