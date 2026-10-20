/**
 * Banc de test de l'Esport, sans Cloudflare : base SQLite en mémoire
 * (node:sqlite), VRAI relais (relais/worker.mjs, KV en mémoire) branché comme
 * la liaison de service, horloge réglable.
 */

import relais, { jetonDeProfil } from '../../relais/worker.mjs';
import { baseMigree } from './base.mjs';
import { stockageMemoire } from '../adaptateurs/stockage.mjs';
import { creerApi } from '../noyau/api.mjs';
import { verificateurRelais } from '../noyau/authentification.mjs';

export const JETON_MAITRE = 'jeton-maitre-de-test-esport-0123456789';
export const CLE = 'cle-de-session-esport-de-test-0123456789abcdef';

export function kvMemoire() {
  const donnees = new Map();
  return { donnees, get: async c => (donnees.has(c) ? donnees.get(c) : null), put: async (c, v) => void donnees.set(c, v), delete: async c => void donnees.delete(c) };
}

export async function banc({ creationTeams = 'fondateur', relaisAncien = false, sansStockage = false, fetchDiscord, cleDiscord, lienApp, discordBot, attenteDiffere } = {}) {
  const base = await baseMigree();
  const stockage = sansStockage ? undefined : stockageMemoire();
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
    stockage,
    cleSession: CLE,
    verifierJeton: verificateurRelais({ liaison }),
    creationTeams,
    maintenant: () => horloge.t,
    // Discord : jamais de réseau réel en test (fetch simulé ; sans lui, un appel échouerait bruyamment).
    fetchDiscord: fetchDiscord ?? (async () => { throw new Error('réseau Discord interdit en test'); }),
    cleDiscord,
    lienApp,
    discordBot,
    attenteDiffere,
  });
  let ipCompteur = 0;
  async function appel(chemin, { methode = 'GET', jeton, corps, ip, type = 'application/json', entetes = {} } = {}) {
    const headers = { 'Content-Type': type, 'CF-Connecting-IP': ip ?? `198.51.100.${(++ipCompteur % 200) + 1}`, ...entetes };
    if (jeton) headers.Authorization = `Bearer ${jeton}`;
    const r = await traiter(new Request(`https://esport.test${chemin}`, { method: methode, headers, body: corps === undefined ? undefined : JSON.stringify(corps) }));
    const texte = await r.text();
    const json = (r.headers.get('Content-Type') ?? '').includes('json');
    return { statut: r.status, corps: texte ? (json ? JSON.parse(texte) : texte) : null, entetes: r.headers };
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
  /** Envoi binaire (PDF) : `type` = Content-Type annoncé, `nom` = en-tête X-Nom-Fichier. */
  async function envoyer(chemin, { methode = 'PUT', jeton, octets, type = 'application/pdf', nom, entetes = {} } = {}) {
    const headers = { 'Content-Type': type, 'CF-Connecting-IP': '198.51.100.250', ...entetes };
    if (jeton) headers.Authorization = `Bearer ${jeton}`;
    if (nom) headers['X-Nom-Fichier'] = encodeURIComponent(nom);
    const r = await traiter(new Request(`https://esport.test${chemin}`, { method: methode, headers, body: octets }));
    const texte = await r.text();
    return { statut: r.status, corps: texte ? JSON.parse(texte) : null };
  }
  /** Requête GET brute (lien signé d'un fichier) : rend la Response. */
  const brut = url => traiter(new Request(url));
  return { base, stockage, envRelais, horloge, appel, envoyer, brut, session, traiter, jetonDeProfil: c => jetonDeProfil(JETON_MAITRE, c) };
}

/**
 * Une team créée par le Fondateur, ses rôles par clé, et des membres : chaque
 * compte ouvre sa session (pseudo), puis le Fondateur l'ajoute à la team avec
 * son rôle (invitation directe, sans code).
 */
export async function teamAvecMembres(b, { nom = 'Team Alpha', preset = 'valorant_complet', modules, membres = {} } = {}) {
  const fondateur = await b.session('principal', 'Fondateur');
  const creation = await b.appel('/teams', { methode: 'POST', jeton: fondateur, corps: { nom, jeu: 'valorant', preset, modules } });
  if (creation.statut !== 200) throw new Error(`création : ${creation.statut} ${JSON.stringify(creation.corps)}`);
  const teamId = creation.corps.team.id;
  const roles = Object.fromEntries((await b.appel(`/teams/${teamId}/roles`, { jeton: fondateur })).corps.roles.map(r => [r.cle ?? r.nom, r]));
  const sessions = { fondateur };
  for (const [compte, { pseudo, role }] of Object.entries(membres)) {
    const s = await b.session(compte, pseudo);
    const ajout = await b.appel(`/teams/${teamId}/membres`, { methode: 'POST', jeton: fondateur, corps: { compte, roleId: roles[role].id } });
    if (ajout.statut !== 200) throw new Error(`ajout ${compte} : ${ajout.statut} ${JSON.stringify(ajout.corps)}`);
    sessions[compte] = s;
  }
  const membresListe = (await b.appel(`/teams/${teamId}/membres`, { jeton: fondateur })).corps.membres;
  return { teamId, roles, sessions, membres: Object.fromEntries(membresListe.map(m => [m.compte, m])) };
}
