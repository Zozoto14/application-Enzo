/// <reference types="vite/client" />

/** Binaire WebAssembly de sql.js, importé par son URL résolue au build. */
declare module '*.wasm?url' {
  const url: string;
  export default url;
}

/** Identifiant du build (aussi publié dans version.json) : sert à repérer une nouvelle version déployée. */
declare const __BUILD_ID__: string;
