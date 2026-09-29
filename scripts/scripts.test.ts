/**
 * Garde-fou : chaque scripts/*.mjs doit avoir une syntaxe valide (node --check),
 * pour qu'une fonction dupliquée ou une faute de frappe ne parte plus en ligne.
 */
export {};
// Le tsconfig du projet n'inclut pas les types Node : on les déclare a minima.
declare const __dirname: string;
declare const process: { execPath: string };
const { execFileSync } = require('child_process');
const { readdirSync } = require('fs');
const { join } = require('path');

const scripts: string[] = readdirSync(__dirname).filter((nom: string) => nom.endsWith('.mjs'));

describe('scripts/*.mjs', () => {
  it('trouve des scripts à vérifier', () => {
    expect(scripts.length).toBeGreaterThan(0);
  });

  it.each(scripts)('%s : syntaxe valide (node --check)', (nom: string) => {
    expect(() => execFileSync(process.execPath, ['--check', join(__dirname, nom)], { stdio: 'pipe' })).not.toThrow();
  });
});

describe('src/config/site.json', () => {
  const config = JSON.parse(require('fs').readFileSync(join(__dirname, '..', 'src', 'config', 'site.json'), 'utf8'));

  it('l’adresse est celle du projet déclaré, jamais une adresse de tiers', () => {
    expect(config.projetPages).toMatch(/^[a-z0-9-]+$/);
    expect(config.site).toBe(`https://${config.projetPages}.pages.dev`);
    const domaines: string[] = JSON.stringify(config).match(/[a-z0-9-]+\.pages\.dev/g) ?? [];
    expect(domaines.filter(d => d !== `${config.projetPages}.pages.dev`)).toEqual([]);
    expect(JSON.stringify(config)).not.toContain('appdashboard');
  });

  it('est marqué vérifié', () => {
    expect(config.verifie).toBe(true);
  });
});
