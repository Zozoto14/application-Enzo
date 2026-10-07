import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recupererCode } from './interface.mjs';

const git = (dossier, ...args) => execFileSync('git', ['-C', dossier, ...args], { encoding: 'utf8' }).trim();

function depots() {
  const racine = mkdtempSync(join(tmpdir(), 'maj-'));
  const origine = join(racine, 'origine');
  const pc = join(racine, 'pc');
  execFileSync('git', ['init', '-q', '-b', 'main', origine]);
  git(origine, 'config', 'user.email', 't@t');
  git(origine, 'config', 'user.name', 't');
  writeFileSync(join(origine, 'ecran.txt'), 'v1\n');
  writeFileSync(join(origine, 'package.json'), '{"name":"x"}\n');
  git(origine, 'add', '.');
  git(origine, 'commit', '-qm', 'Première version');
  execFileSync('git', ['clone', '-q', origine, pc]);
  git(pc, 'config', 'user.email', 't@t');
  git(pc, 'config', 'user.name', 't');
  writeFileSync(join(origine, 'ecran.txt'), 'v2\n');
  git(origine, 'commit', '-qam', 'Nouvel écran');
  return { origine, pc };
}

test('récupère la nouvelle version', async () => {
  const { pc } = depots();
  assert.deepEqual(await recupererCode(pc), ['Nouvel écran']);
  assert.equal(readFileSync(join(pc, 'ecran.txt'), 'utf8'), 'v2\n');
});

test('un fichier modifié sur le PC est mis de côté au lieu de tout bloquer', async () => {
  const { pc } = depots();
  writeFileSync(join(pc, 'package.json'), '{"name":"x","retouche":true}\n');
  assert.deepEqual(await recupererCode(pc), ['Nouvel écran']);
  assert.equal(readFileSync(join(pc, 'ecran.txt'), 'utf8'), 'v2\n');
  assert.match(git(pc, 'stash', 'list'), /mis de côté avant mise à jour \(package\.json\)/);
});

test('un commit local absent de GitHub bloque toujours, avec un message', async () => {
  const { pc } = depots();
  writeFileSync(join(pc, 'autre.txt'), 'local\n');
  git(pc, 'add', '.');
  git(pc, 'commit', '-qm', 'Travail local');
  await assert.rejects(recupererCode(pc), /modifications absentes de GitHub/);
});
