/**
 * Diagnostic des connexions depuis le terminal cPanel (docs/diagnostic-comptes.md), sans rien
 * afficher de secret : ni mot de passe (le relais n'en reçoit jamais), ni jeton, ni adresse IP
 * complète, ni le contenu de relais.env.
 *
 *   cd ~/application-enzo && node relais/serveur/diagnostic-connexions.mjs            # verrous en cours, dernières tentatives
 *   cd ~/application-enzo && node relais/serveur/diagnostic-connexions.mjs <compte>   # tentatives d'un compte
 *   cd ~/application-enzo && node relais/serveur/diagnostic-connexions.mjs --tout-debloquer
 *
 * Lit DATABASE_URL (ou PGHOST…) dans ~/.appdashboard/relais.env, comme le relais.
 */

import { basePostgres, optionsDepuisEnv } from '../../esport/adaptateurs/postgres.mjs';
import { chargerEnv, fichierEnvParDefaut } from '../../esport/serveur/commun.mjs';

const date = ms => new Date(Number(ms)).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });

export async function diagnostiquer(base, { compte, toutDebloquer = false, maintenant = Date.now(), ecrire = console.log } = {}) {
  const verrous = await base.tous("SELECT cle, valeur FROM relais_kv WHERE cle LIKE 'limite:%' AND (expire_le IS NULL OR expire_le > ?)", [maintenant]);
  const actifs = verrous
    .map(v => {
      try {
        const o = JSON.parse(v.valeur);
        return { genre: v.cle.startsWith('limite:ip:') ? 'adresse' : 'identifiant', echecs: Number(o.echecs) || 0, jusqua: Number(o.jusqua) || 0 };
      } catch {
        return undefined;
      }
    })
    .filter(Boolean);
  const bloques = actifs.filter(v => v.jusqua > maintenant);
  ecrire(`Verrous en cours : ${bloques.length} (${bloques.filter(v => v.genre === 'identifiant').length} identifiant(s), ${bloques.filter(v => v.genre === 'adresse').length} adresse(s)) ; compteurs d'échecs suivis : ${actifs.length}.`);
  for (const v of bloques) ecrire(`  - ${v.genre} : ${v.echecs} échecs, bloqué jusqu'à ${date(v.jusqua)}`);
  if (toutDebloquer) {
    const r = await base.executer("DELETE FROM relais_kv WHERE cle LIKE 'limite:%'", []);
    ecrire(`Débloqué : ${Number(r?.changements ?? 0)} compteur(s) effacé(s).`);
  }
  const cle = compte ? `journal-connexion:${compte}` : 'journal-connexion:%';
  const lignes = await base.tous(`SELECT cle, valeur FROM relais_kv WHERE cle ${compte ? '=' : 'LIKE'} ?`, [cle]);
  const tentatives = [];
  for (const l of lignes) {
    if (l.cle === 'journal-connexion:~inconnus') continue;
    try {
      for (const t of JSON.parse(l.valeur)) tentatives.push({ qui: l.cle.slice('journal-connexion:'.length), ...t });
    } catch {
      // ligne illisible : ignorée
    }
  }
  tentatives.sort((a, b) => b.le - a.le);
  ecrire(compte ? `Tentatives du compte ${compte} :` : 'Dernières tentatives (tous comptes) :');
  for (const t of tentatives.slice(0, compte ? 30 : 40)) {
    const qui = t.qui.startsWith('h:') ? `identifiant ${t.qui.slice(2, 10)}…` : t.qui;
    ecrire(`  ${date(t.le)}  ${qui.padEnd(18)} ${String(t.issue).padEnd(22)} ${t.ip}`);
  }
  const echecs = tentatives.filter(t => !String(t.issue).startsWith('succes') && t.issue !== 'invitation-ouverte' && t.issue !== 'debloque');
  const parCause = {};
  for (const t of echecs) parCause[t.issue] = (parCause[t.issue] ?? 0) + 1;
  ecrire(`Échecs par cause : ${Object.entries(parCause).map(([c, n]) => `${c} ${n}`).join(', ') || 'aucun'}.`);
  return { bloques: bloques.length, tentatives: tentatives.length, parCause };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  chargerEnv(process.env.RELAIS_ENV || fichierEnvParDefaut('relais'));
  const args = process.argv.slice(2);
  const base = await basePostgres(optionsDepuisEnv());
  try {
    await diagnostiquer(base, { compte: args.find(a => !a.startsWith('--')), toutDebloquer: args.includes('--tout-debloquer') });
  } finally {
    await base.fermer();
  }
}
