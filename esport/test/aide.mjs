/**
 * Banc de test de l'Esport, sans Cloudflare : base SQLite en mémoire
 * (node:sqlite), VRAI relais (relais/worker.mjs, KV en mémoire) branché comme
 * la liaison de service, horloge réglable.
 */

import relais, { jetonDeProfil } from '../../relais/worker.mjs';
import { baseSqliteMigree } from '../adaptateurs/sqlite.mjs';
import { stockageMemoire } from '../adaptateurs/stockage.mjs';
import { creerApi } from '../noyau/api.mjs';
import { verificateurRelais } from '../noyau/authentification.mjs';

export const JETON_MAITRE = 'jeton-maitre-de-test-esport-0123456789';
export const CLE = 'cle-de-session-esport-de-test-0123456789abcdef';

export function kvMemoire() {
  const donnees = new Map();
  return { donnees, get: async c => (donnees.has(c) ? donnees.get(c) : null), put: async (c, v) => void donnees.set(c, v), delete: async c => void donnees.delete(c) };
}

export async function banc({ creationTeams = 'fondateur', relaisAncien = false } = {}) {
  const base = await baseSqliteMigree();
  const envRelais = { JETON: JETON_MAITRE, BOITE: kvMemoire() };
  const horloge = { t: Date.parse('2026-10-20T10:00:00.000Z') };
  const liaison = {
    fetch: async (url, init) => {
      if (relaisAncien) return new Response(JSON.stringify({ erreur: 'Adresse inconnue.' }), { status: 404 });
      return relais.fetch(new Request(url, init), envRelais);
    },
  };
  const traiter = creerApi({
    base,
    stockage: stockageMemoire(),
    cleSession: CLE,
    verifierJeton: verificateurRelais({ liaison }),
    creationTeams,
    maintenant: () => horloge.t,
  });
  let ipCompteur = 0;
  async function appel(chemin, { methode = 'GET', jeton, corps, ip } = {}) {
    const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip ?? `198.51.100.${(++ipCompteur % 200) + 1}` };
    if (jeton) headers.Authorization = `Bearer ${jeton}`;
    const r = await traiter(new Request(`https://esport.test${chemin}`, { method: methode, headers, body: corps === undefined ? undefined : JSON.stringify(corps) }));
    const texte = await r.text();
    return { statut: r.status, corps: texte ? JSON.parse(texte) : null, entetes: r.headers };
  }
  /** Session Esport d'un compte (« principal » = Fondateur, jeton maître), avec pseudo si demandé. */
  async function session(compte, pseudo) {
    const jeton = compte === 'principal' ? JETON_MAITRE : await jetonDeProfil(JETON_MAITRE, compte);
    const r = await appel('/session', { methode: 'POST', jeton });
    if (r.statut !== 200) throw new Error(`session ${compte} : ${r.statut} ${JSON.stringify(r.corps)}`);
    if (pseudo) {
      const p = await appel('/moi', { methode: 'PUT', jeton: r.corps.session, corps: { pseudo } });
      if (p.statut !== 200) throw new Error(`pseudo ${pseudo} : ${p.statut} ${JSON.stringify(p.corps)}`);
    }
    return r.corps.session;
  }
  return { base, envRelais, horloge, appel, session, jetonDeProfil: c => jetonDeProfil(JETON_MAITRE, c) };
}

/** Une team créée par le Fondateur, ses rôles par clé, et un code d'invitation par rôle demandé. */
export async function teamAvecMembres(b, { nom = 'Team Alpha', preset = 'valorant_complet', modules, membres = {} } = {}) {
  const fondateur = await b.session('principal', 'Fondateur');
  const creation = await b.appel('/teams', { methode: 'POST', jeton: fondateur, corps: { nom, jeu: 'valorant', preset, modules } });
  if (creation.statut !== 200) throw new Error(`création : ${creation.statut} ${JSON.stringify(creation.corps)}`);
  const teamId = creation.corps.team.id;
  const roles = Object.fromEntries((await b.appel(`/teams/${teamId}/roles`, { jeton: fondateur })).corps.roles.map(r => [r.cle ?? r.nom, r]));
  const sessions = { fondateur };
  for (const [compte, { pseudo, role }] of Object.entries(membres)) {
    const s = await b.session(compte, pseudo);
    const inv = await b.appel(`/teams/${teamId}/invitations`, { methode: 'POST', jeton: fondateur, corps: { roleId: roles[role].id } });
    const acc = await b.appel('/invitations/accepter', { methode: 'POST', jeton: s, corps: { code: inv.corps.code } });
    if (acc.statut !== 200) throw new Error(`acceptation ${compte} : ${acc.statut} ${JSON.stringify(acc.corps)}`);
    sessions[compte] = s;
  }
  const membresListe = (await b.appel(`/teams/${teamId}/membres`, { jeton: fondateur })).corps.membres;
  return { teamId, roles, sessions, membres: Object.fromEntries(membresListe.map(m => [m.compte, m])) };
}
