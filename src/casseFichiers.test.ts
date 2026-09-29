/**
 * Garde-fou de casse : Windows et macOS ont un système de fichiers insensible
 * à la casse, Linux non. Deux chemins suivis qui ne diffèrent que par la casse
 * (ou un import qui n'a pas la casse exacte du fichier) cassent le build.
 */
// Le tsconfig du projet n'inclut pas les types Node : on les déclare a minima.
declare const __dirname: string;
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const racine = path.resolve(__dirname, '..');
const suivis: string[] = (execFileSync('git', ['ls-files'], { cwd: racine, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }) as string)
  .split('\n')
  .filter(Boolean)
  .filter((f: string) => fs.existsSync(path.join(racine, f)));

function doublons(chemins: string[]): string[] {
  const vus = new Map<string, string>();
  const res: string[] = [];
  for (const c of chemins) {
    const k = c.toLowerCase();
    const avant = vus.get(k);
    if (avant !== undefined && avant !== c) {
      res.push(`${avant} <-> ${c}`);
    }
    vus.set(k, c);
  }
  return res;
}

describe('casse des chemins suivis', () => {
  it('aucun fichier suivi ne diffère d\'un autre par la casse seule', () => {
    expect(doublons(suivis)).toEqual([]);
  });

  it('aucun dossier suivi ne diffère d\'un autre par la casse seule', () => {
    const dossiers = new Set<string>();
    for (const f of suivis) {
      const parts = f.split('/').slice(0, -1);
      for (let i = 1; i <= parts.length; i++) {
        dossiers.add(parts.slice(0, i).join('/'));
      }
    }
    expect(doublons([...dossiers])).toEqual([]);
  });

  it('aucun fichier ne partage son nom (hors extension) avec un autre à la casse près', () => {
    // devblog.ts / Devblog.tsx : `./devblog` retombe sur le mauvais fichier.
    const sansExt = suivis
      .filter(f => /\.(tsx?|jsx?|mjs)$/.test(f))
      .map(f => f.replace(/\.(tsx?|jsx?|mjs)$/, ''));
    const uniques = [...new Set(sansExt)];
    expect(doublons(uniques)).toEqual([]);
  });
});

describe('casse exacte des imports relatifs', () => {
  const ensemble = new Set(suivis);
  const EXTS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.json', '/index.ts', '/index.tsx', '/index.js'];
  const motif = /(?:from\s+|import\s*\(\s*|require\(\s*|jest\.(?:mock|requireActual)\(\s*|import\s+)(['"])(\.{1,2}\/[^'"]*)\1/g;

  const sources = suivis.filter(
    f => /^(src|bureau)\/.*\.(tsx?|jsx?)$/.test(f),
  );

  it('chaque import relatif de src/ et bureau/ existe avec la casse exacte', () => {
    const erreurs: string[] = [];
    for (const f of sources) {
      const texte = fs.readFileSync(path.join(racine, f), 'utf8');
      let m: RegExpExecArray | null;
      motif.lastIndex = 0;
      while ((m = motif.exec(texte)) !== null) {
        const cible = m[2].split('?')[0];
        const base = path.posix.normalize(path.posix.join(path.posix.dirname(f), cible));
        const ok = EXTS.some(e => ensemble.has(base + e)) ||
          // dossier contenant des fichiers suivis
          suivis.some(s => s.startsWith(base + '/'));
        if (!ok) {
          erreurs.push(`${f} -> ${m[2]}`);
        }
      }
    }
    expect(erreurs).toEqual([]);
  });
});
