/**
 * Convocations explicites (migration 0009) et correctif des statistiques de
 * présence :
 *  - règles pures (groupes, Propriétaires jamais par défaut, arrivée tardive) ;
 *  - toutes les surfaces : RSVP, réponses attendues, alertes, rappels in-app
 *    et Discord J-1 / H-1, liste de présence, statistiques, CSV, accueil,
 *    Dashboard, notifications — avec les tests négatifs (un Propriétaire non
 *    coché n'est jamais attendu, relancé ni compté) ;
 *  - récurrence (liste de la série, liste propre à une date) ;
 *  - migration des événements existants ;
 *  - le cas du Fondateur : Réunion et Scrim le mardi 20/10, « présent » marqué
 *    pour lui-même et pour un joueur, période 3 mois par mois.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseSqlite, lireMigrations } from '../adaptateurs/sqlite.mjs';
import { traiterFile } from '../noyau/discord/file.mjs';
import { rappelsDiscord } from '../noyau/discord/rappels.mjs';
import { distribuer } from '../noyau/evenements.mjs';
import { appliquerMigrations } from '../noyau/migrations.mjs';
import { CONVOCATION_DEFAUT, convocationDe, convoques, estConvoque, groupeDe, preparerConvocation } from '../noyau/planning/convocations.mjs';
import { rappelsPresence } from '../noyau/planning/rappels.mjs';
import { banc, CLE, teamAvecMembres } from './aide.mjs';
import { URL_TEST } from './discord-aide.mjs';

const occ = cle => encodeURIComponent(cle);
const MEMBRES = {
  own12345: { pseudo: 'Olga', role: 'proprietaire' },
  max12345: { pseudo: 'Max', role: 'manager' },
  coach123: { pseudo: 'Zed', role: 'coach' },
  lea12345: { pseudo: 'Léa', role: 'joueur' },
  kai12345: { pseudo: 'Kai', role: 'joueur' },
  tom12345: { pseudo: 'Tom', role: 'remplacant' },
};

function fauxDiscord() {
  const appels = [];
  const fetch = async (url, init) => {
    appels.push({ url, corps: JSON.parse(init.body) });
    return new Response(null, { status: 204 });
  };
  return { appels, fetch, contenus: () => appels.map(a => a.corps.content) };
}

async function preparer() {
  const discord = fauxDiscord();
  const b = await banc({ fetchDiscord: discord.fetch });
  const A = await teamAvecMembres(b, { nom: 'Team Alpha', membres: MEMBRES });
  const B = await teamAvecMembres(b, { nom: 'Team Bravo', membres: { bob12345: { pseudo: 'Bob', role: 'joueur' } } });
  const s = { ...A.sessions, bob12345: B.sessions.bob12345 };
  const api = (chemin, jeton, options = {}) => b.appel(chemin, { jeton, ...options });
  const t = `/teams/${A.teamId}`;
  const creer = (corps, jeton = s.fondateur) => api(`${t}/planning`, jeton, { methode: 'POST', corps });
  const rsvp = (qui, ev, cle, valeur = 'oui') => api(`${t}/planning/${ev}/occurrences/${occ(cle)}/rsvp`, s[qui], { methode: 'PUT', corps: { rsvp: valeur } });
  const marquer = (ev, cle, marques, jeton = s.fondateur) => api(`${t}/planning/${ev}/occurrences/${occ(cle)}/presence`, jeton, { methode: 'PUT', corps: { marques } });
  const avancer = async iso => {
    b.horloge.t = Date.parse(iso);
    for (const compte of Object.keys(s)) s[compte] = await b.session(compte === 'fondateur' ? 'principal' : compte);
  };
  return { b, A, B, s, api, t, creer, rsvp, marquer, avancer, discord };
}

// ------------------------------------------------------------------ Règles pures

test('règles : défaut « joueurs », Propriétaires et Fondateur seulement cochés, arrivée tardive, normalisation', () => {
  const m = (compte, cle, extra = {}) => ({ compte, cle, proprietaire: cle === 'proprietaire', perms: new Set(), rejointLe: '2026-10-01T00:00:00.000Z', ...extra });
  const membres = [
    m('principal', 'proprietaire'),
    m('own12345', 'proprietaire'),
    m('max12345', 'manager'),
    m('coach123', 'coach'),
    m('lea12345', 'joueur'),
    m('tom12345', 'remplacant'),
    m('cap12345', null, { perms: new Set(['attendance.rsvp_own']) }),
    m('ent12345', null, { perms: new Set(['attendance.mark', 'attendance.rsvp_own']) }),
    m('sup12345', 'joueur', { rejointLe: '2026-10-25T00:00:00.000Z' }),
  ];
  assert.deepEqual(membres.map(groupeDe), ['proprietaire', 'proprietaire', 'staff', 'staff', 'joueurs', 'joueurs', 'joueurs', 'staff', 'joueurs']);
  const noms = (c, fin) => convoques(c, membres, fin).map(x => x.compte);
  const fin = Date.parse('2026-10-20T20:00:00.000Z');
  // Défaut : les joueurs (Joueur, Remplaçant, rôle personnalisé qui répond), jamais un Propriétaire ni le Fondateur.
  assert.deepEqual(noms(CONVOCATION_DEFAUT, fin), ['lea12345', 'tom12345', 'cap12345']);
  assert.deepEqual(noms({ ...CONVOCATION_DEFAUT, groupes: ['staff'] }, fin), ['max12345', 'coach123', 'ent12345']);
  // « Tout le monde » : tous SAUF les Propriétaires.
  assert.deepEqual(noms({ ...CONVOCATION_DEFAUT, groupes: ['tous'] }, fin), ['max12345', 'coach123', 'lea12345', 'tom12345', 'cap12345', 'ent12345']);
  // Un Propriétaire coché, un exclu, un choix nominatif.
  assert.deepEqual(noms({ groupes: ['joueurs'], membres: ['coach123'], exclus: ['tom12345'], proprietaires: ['own12345'] }, fin), ['own12345', 'coach123', 'lea12345', 'cap12345']);
  assert.equal(estConvoque({ groupes: ['tous'], membres: [], exclus: [], proprietaires: [] }, membres[0], fin), false, 'le Fondateur n’est jamais convoqué par un groupe');
  // Arrivée tardive : convoqué aux séances qui suivent son arrivée, pas avant.
  assert.equal(estConvoque(CONVOCATION_DEFAUT, membres[8], fin), false);
  assert.equal(estConvoque(CONVOCATION_DEFAUT, membres[8], Date.parse('2026-10-27T20:00:00.000Z')), true);
  // Saisie : personne de choisi → joueurs ; un Propriétaire choisi nommément passe dans `proprietaires` ; inconnu → erreur.
  assert.deepEqual(preparerConvocation({}, membres), { ...CONVOCATION_DEFAUT });
  assert.deepEqual(preparerConvocation({ groupes: ['joueurs', 'tous'], membres: ['own12345', 'lea12345'] }, membres), { groupes: ['tous'], membres: ['lea12345'], exclus: [], proprietaires: ['own12345'] });
  assert.deepEqual(preparerConvocation({ proprietaires: ['principal'] }, membres), { groupes: [], membres: [], exclus: [], proprietaires: ['principal'] }, 'une réunion des seuls Propriétaires');
  assert.throws(() => preparerConvocation({ membres: ['zzz99999'] }, membres), /ne fait pas partie/);
  // Ancienne colonne `concernes` : '[]' = tous sauf les Propriétaires ; une liste reste nominative.
  assert.deepEqual(convocationDe({ concernes: '[]' }).groupes, ['tous']);
  assert.deepEqual(convocationDe({ concernes: '["lea12345"]' }), { groupes: [], membres: ['lea12345'], exclus: [], proprietaires: [] });
});

// ------------------------------------------------------------------ Toutes les surfaces

test('réunion : 2 joueurs et 1 Propriétaire choisis → seuls eux répondent, sont attendus, relancés (in-app, Discord) et comptés ; le Fondateur non coché jamais', async () => {
  const { b, A, s, api, t, creer, rsvp, marquer, avancer, discord } = await preparer();
  // Discord : webhook de la team ; on coupe l'annonce de création pour ne garder que les rappels.
  assert.equal((await api(`${t}/discord/webhook`, s.fondateur, { methode: 'PUT', corps: { url: URL_TEST } })).statut, 200);
  await api(`${t}/discord/parametres/event_created`, s.fondateur, { methode: 'PUT', corps: { actif: false } });

  // Mercredi 21 octobre, 08:00 à Paris (06:00Z) : 20 h après l'horloge.
  const DEBUT = '2026-10-21T06:00:00.000Z';
  const r = await creer({ type: 'meeting', titre: 'Réunion stratégie', date: '2026-10-21', heureDebut: '08:00', heureFin: '09:00', convocation: { membres: ['lea12345', 'kai12345'], proprietaires: ['own12345'] } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  const id = r.corps.id;
  assert.deepEqual(r.corps.convocation, { groupes: [], membres: ['kai12345', 'lea12345'], exclus: [], proprietaires: ['own12345'] });

  // Calendrier : le Fondateur VOIT l'événement (droit de la team) mais n'y est pas convoqué.
  const vu = (await api(`${t}/planning?debut=2026-10-19&fin=2026-10-26`, s.fondateur)).corps;
  const o = vu.occurrences.find(x => x.evenementId === id);
  assert.ok(o, 'visible au calendrier');
  assert.deepEqual([o.convoqueMoi, o.concerneMoi, o.monRsvp], [false, false, null]);
  assert.deepEqual(o.convoques.sort(), ['kai12345', 'lea12345', 'own12345']);
  assert.equal(o.reponses.attendues, 3);
  // Filtre « Mes convocations » : rien pour le Fondateur ; l'événement pour Olga.
  assert.equal((await api(`${t}/planning?debut=2026-10-19&fin=2026-10-26&membre=moi`, s.fondateur)).corps.occurrences.length, 0);
  assert.equal((await api(`${t}/planning?debut=2026-10-19&fin=2026-10-26&membre=moi`, s.own12345)).corps.occurrences.length, 1);
  // Le formulaire reçoit les groupes des membres (Propriétaires à part).
  assert.deepEqual(vu.membres.filter(m => m.groupe === 'proprietaire').map(m => m.compte).sort(), ['own12345', 'principal']);

  // RSVP : seuls les convoqués (le Fondateur et Tom, non cochés : 403).
  assert.equal((await rsvp('fondateur', id, DEBUT)).statut, 403);
  assert.equal((await rsvp('tom12345', id, DEBUT)).statut, 403);
  assert.equal((await rsvp('max12345', id, DEBUT)).statut, 403);
  assert.equal((await rsvp('lea12345', id, DEBUT)).statut, 200);

  // Accueil : réponses attendues (sans-reponse) = Kai et Olga ; le Fondateur n'a pas l'événement dans « ses » prochains.
  const accF = (await api(`${t}/planning/accueil`, s.fondateur)).corps;
  assert.ok(!accF.prochains.some(x => x.evenementId === id));
  assert.ok(!accF.alertes.some(a => a.genre === 'rsvp'));
  assert.equal(accF.alertes.find(a => a.genre === 'sans-reponse' && a.evenementId === id)?.sansReponse, 2);
  const accO = (await api(`${t}/planning/accueil`, s.own12345)).corps;
  assert.ok(accO.prochains.some(x => x.evenementId === id));
  assert.ok(accO.alertes.some(a => a.genre === 'rsvp' && a.evenementId === id));
  // Dashboard global : compté pour Olga, pas pour le Fondateur.
  assert.ok(!(await api('/dashboard', s.fondateur)).corps.global.evenementsSemaine.some(e => e.evenementId === id));
  assert.ok((await api('/dashboard', s.own12345)).corps.global.evenementsSemaine.some(e => e.evenementId === id));

  // Rappels in-app (cron) : Kai et Olga (Léa a répondu) ; jamais le Fondateur.
  assert.equal(await rappelsPresence(b.base, { maintenant: b.horloge.t }), 2);
  await distribuer(b.base, { maintenant: b.horloge.t });
  const notifs = async qui => (await api('/notifications', s[qui])).corps.liste;
  assert.ok((await notifs('kai12345')).some(n => n.type === 'rappel-rsvp'));
  assert.ok((await notifs('own12345')).some(n => n.type === 'rappel-rsvp'));
  assert.ok(!(await notifs('fondateur')).some(n => n.type === 'rappel-rsvp'));
  // Notification « nouvel événement » : les convoqués seulement (ni Tom, ni Max).
  assert.ok((await notifs('own12345')).some(n => n.type === 'evenement-nouveau'));
  assert.ok(!(await notifs('tom12345')).some(n => n.type === 'evenement-nouveau'));
  assert.ok(!(await notifs('max12345')).some(n => n.type === 'evenement-nouveau'));

  // Discord J-1 : le message nomme les convoqués, pas le Fondateur.
  assert.equal(await rappelsDiscord(b.base, { maintenant: b.horloge.t }), 1);
  await distribuer(b.base, { maintenant: b.horloge.t });
  await traiterFile(b.base, { cle: CLE, fetch: discord.fetch, maintenant: b.horloge.t });
  const j1 = discord.contenus().find(c => /Rappel/.test(c));
  assert.match(j1, /Réunion stratégie/);
  assert.match(j1, /Convoqués : /);
  for (const nom of ['Kai', 'Léa', 'Olga']) assert.ok(j1.includes(nom), nom);
  assert.ok(!j1.includes('Fondateur') && !j1.includes('Tom'));

  // Après la réunion : liste de présence = les convoqués ; le Fondateur ne se marque pas.
  await avancer('2026-10-21T08:00:00.000Z');
  const liste = (await api(`${t}/planning/${id}/occurrences/${occ(DEBUT)}/presence`, s.fondateur)).corps;
  assert.deepEqual(liste.lignes.map(l => l.pseudo), ['Kai', 'Léa', 'Olga']);
  assert.equal((await marquer(id, DEBUT, [{ compte: 'principal', reel: 'present' }])).corps.code, 'non-convoque');
  const acc = (await api(`${t}/planning/accueil`, s.fondateur)).corps;
  assert.equal(acc.alertes.find(a => a.genre === 'a-marquer' && a.evenementId === id)?.nonMarques, 3);
  assert.equal((await marquer(id, DEBUT, [{ compte: 'lea12345', reel: 'present' }, { compte: 'kai12345', reel: 'absent' }, { compte: 'own12345', reel: 'retard' }])).statut, 200);

  // Statistiques et CSV : les trois convoqués, pas le Fondateur.
  const st = (await api(`${t}/presence/stats?debut=2026-10-01&fin=2026-11-01`, s.fondateur)).corps;
  assert.deepEqual(st.joueurs.map(j => j.compte).sort(), ['kai12345', 'lea12345', 'own12345']);
  assert.equal(st.global.taux, 2 / 3);
  const csv = (await api(`${t}/presence/export.csv?debut=2026-10-01&fin=2026-11-01`, s.fondateur)).corps;
  assert.equal(csv.trim().split('\r\n').length, 1 + 3);
  assert.ok(!csv.includes('Fondateur'));
  // Isolation : la Team Bravo ne voit rien.
  assert.equal((await api(`${t}/planning/${id}/occurrences/${occ(DEBUT)}/presence`, s.bob12345)).statut, 404);
});

test('récurrence : la série garde ses convoqués à chaque date ; une date modifiée a sa propre liste ; un joueur arrivé plus tard est convoqué aux dates suivantes', async () => {
  const { A, s, api, t, creer, rsvp, avancer, b } = await preparer();
  // Mardis et jeudis, depuis le mardi 13 octobre (avant l'arrivée des joueurs, le 20 à 10:00Z).
  const r = await creer({ type: 'training', titre: 'Entraînement', date: '2026-10-13', heureDebut: '20:00', heureFin: '22:00', recurrence: { jours: [2, 4] } });
  assert.equal(r.statut, 200);
  const id = r.corps.id;
  assert.deepEqual(r.corps.convocation, { ...CONVOCATION_DEFAUT }, 'personne de choisi : les joueurs');
  const liste = async cle => {
    const r = await api(`${t}/planning/${id}/occurrences/${occ(cle)}/presence`, s.fondateur);
    assert.equal(r.statut, 200, `${cle} : ${JSON.stringify(r.corps)}`);
    return r.corps.lignes.map(l => l.compte).sort();
  };
  // Chaque date : les joueurs (pas le staff, pas les Propriétaires).
  assert.deepEqual(await liste('2026-10-20T18:00:00.000Z'), ['kai12345', 'lea12345', 'tom12345']);
  assert.deepEqual(await liste('2026-10-22T18:00:00.000Z'), ['kai12345', 'lea12345', 'tom12345']);
  // Avant leur arrivée (13 et 15 octobre) : personne n'était encore là.
  assert.deepEqual(await liste('2026-10-13T18:00:00.000Z'), []);
  // Jeudi 22 seulement : le Coach et Olga, sans Tom.
  const x = await api(`${t}/planning/${id}/occurrences/${occ('2026-10-22T18:00:00.000Z')}`, s.fondateur, { methode: 'PATCH', corps: { convocation: { groupes: ['joueurs'], membres: ['coach123'], exclus: ['tom12345'], proprietaires: ['own12345'] } } });
  assert.equal(x.statut, 200, JSON.stringify(x.corps));
  assert.deepEqual(await liste('2026-10-22T18:00:00.000Z'), ['coach123', 'kai12345', 'lea12345', 'own12345']);
  assert.deepEqual(await liste('2026-10-27T19:00:00.000Z'), ['kai12345', 'lea12345', 'tom12345'], 'les autres dates gardent la liste de la série');
  assert.equal((await rsvp('tom12345', id, '2026-10-22T18:00:00.000Z')).statut, 403);
  assert.equal((await rsvp('coach123', id, '2026-10-22T18:00:00.000Z')).statut, 200);
  const o22 = (await api(`${t}/planning?debut=2026-10-22&fin=2026-10-23`, s.fondateur)).corps.occurrences[0];
  assert.equal(o22.convocationPropre, true);
  // Revenir à la liste de la série.
  await api(`${t}/planning/${id}/occurrences/${occ('2026-10-22T18:00:00.000Z')}`, s.fondateur, { methode: 'PATCH', corps: { convocation: null } });
  assert.deepEqual(await liste('2026-10-22T18:00:00.000Z'), ['kai12345', 'lea12345', 'tom12345']);

  // Un joueur ajouté plus tard : convoqué aux dates qui suivent son arrivée (règle « joueurs »), pas aux précédentes.
  await avancer('2026-10-23T12:00:00.000Z');
  await b.session('noa12345', 'Noa');
  assert.equal((await api(`${t}/membres`, s.fondateur, { methode: 'POST', corps: { compte: 'noa12345', roleId: A.roles.joueur.id } })).statut, 200);
  assert.ok((await liste('2026-10-27T19:00:00.000Z')).includes('noa12345'));
  assert.ok(!(await liste('2026-10-22T18:00:00.000Z')).includes('noa12345'));
  // Ses statistiques ne se remplissent pas de séances d'avant lui.
  const st = (await api(`${t}/presence/stats?debut=2026-10-01&fin=2026-11-01`, s.fondateur)).corps;
  assert.ok(!st.joueurs.some(j => j.compte === 'noa12345'));
});

// ------------------------------------------------------------------ Le cas du Fondateur (statistiques)

test('statistiques : Réunion et Scrim le mardi 20/10, « présent » marqué par le Propriétaire pour lui-même et un joueur → comptés, taux calculé (3 mois, par mois), CSV juste', async () => {
  const { s, api, t, creer, rsvp, marquer, avancer } = await preparer();
  // Le Fondateur se coche dans « Propriétaires à convoquer » ; les joueurs (défaut) sont convoqués aussi.
  const conv = { groupes: ['joueurs'], proprietaires: ['principal'] };
  const reunion = (await creer({ type: 'meeting', titre: 'Réunion', date: '2026-10-20', heureDebut: '14:00', heureFin: '15:00', convocation: conv })).corps;
  const scrim = (await creer({ type: 'scrim', titre: 'Scrim', date: '2026-10-20', heureDebut: '15:00', heureFin: '16:00', convocation: conv })).corps;
  assert.equal(reunion.debut, '2026-10-20T12:00:00.000Z');
  // Il répond « Oui » aux deux (comme sur sa capture : réponses 100 %).
  assert.equal((await rsvp('fondateur', reunion.id, reunion.debut)).statut, 200);
  assert.equal((await rsvp('fondateur', scrim.id, scrim.debut)).statut, 200);
  await avancer('2026-10-20T18:00:00.000Z');
  // La liste de présence le contient (convoqué), il se marque présent, ainsi que Léa.
  for (const ev of [reunion, scrim]) {
    const liste = (await api(`${t}/planning/${ev.id}/occurrences/${occ(ev.debut)}/presence`, s.fondateur)).corps.lignes.map(l => l.compte);
    assert.ok(liste.includes('principal') && liste.includes('lea12345'));
    const m = await marquer(ev.id, ev.debut, [{ compte: 'principal', reel: 'present' }, { compte: 'lea12345', reel: 'present' }]);
    assert.equal(m.statut, 200, JSON.stringify(m.corps));
  }
  // Période « 3 mois » et regroupement « par mois » de la page Présence (du 23/07 au 28/10).
  const st = (await api(`${t}/presence/stats?debut=2026-07-23&fin=2026-10-28&granularite=mois&fuseau=Europe%2FParis`, s.fondateur)).corps;
  const par = Object.fromEntries(st.joueurs.map(j => [j.compte, j]));
  assert.equal(par.principal.present, 2);
  assert.equal(par.principal.taux, 1);
  assert.equal(par.principal.tauxReponse, 1);
  assert.equal(par.lea12345.present, 2);
  assert.equal(par.lea12345.taux, 1);
  // Kai et Tom, convoqués et non marqués : comptés « non marqué » (attendus), hors du taux.
  assert.equal(par.kai12345.evenements, 2);
  assert.equal(par.kai12345.marques, 0);
  assert.equal(par.kai12345.taux, null);
  assert.equal(st.global.present, 4);
  assert.equal(st.global.taux, 1);
  assert.deepEqual(st.parPeriode.map(p => [p.periode, p.present, p.taux]), [['2026-10', 4, 1]]);
  assert.deepEqual(st.parType.map(p => [p.type, p.present]).sort(), [['meeting', 2], ['scrim', 2]]);
  // Filtre par type : la Réunion seule.
  const reunions = (await api(`${t}/presence/stats?debut=2026-07-23&fin=2026-10-28&types=meeting`, s.fondateur)).corps;
  assert.equal(reunions.global.present, 2);
  // CSV : mêmes lignes que les statistiques (convoqués, dont les non-marqués), filtre de type compris.
  const csv = (await api(`${t}/presence/export.csv?debut=2026-07-23&fin=2026-10-28`, s.fondateur)).corps.trim().split('\r\n');
  assert.equal(csv.length, 1 + 2 * 4);
  assert.ok(csv.includes('"2026-10-20","14:00","Réunion","Réunion","Fondateur","Oui","Présent",""'));
  assert.ok(csv.includes('"2026-10-20","15:00","Scrim","Scrim","Kai","Sans réponse","Non marqué",""'));
  const csvReunion = (await api(`${t}/presence/export.csv?debut=2026-07-23&fin=2026-10-28&types=meeting`, s.fondateur)).corps.trim().split('\r\n');
  assert.equal(csvReunion.length, 1 + 4);
});

test('statistiques : un Propriétaire non coché n’est ni attendu ni compté (ancienne réponse ignorée), même après la migration', async () => {
  const { b, s, api, t, creer, marquer, avancer } = await preparer();
  const ev = (await creer({ type: 'meeting', titre: 'Réunion joueurs', date: '2026-10-20', heureDebut: '14:00', heureFin: '15:00' })).corps;
  // Une ancienne ligne (avant la migration : le Fondateur répondait à tout).
  await b.base.executer("INSERT INTO presences (evenement_id, occurrence, compte_id, team_id, rsvp, maj_le) VALUES (?, ?, 'principal', (SELECT team_id FROM planning_evenements WHERE id = ?), 'oui', ?)", [ev.id, ev.debut, ev.id, ev.debut]);
  await avancer('2026-10-20T18:00:00.000Z');
  await marquer(ev.id, ev.debut, [{ compte: 'lea12345', reel: 'present' }]);
  const st = (await api(`${t}/presence/stats?debut=2026-10-01&fin=2026-11-01`, s.fondateur)).corps;
  assert.ok(!st.joueurs.some(j => j.compte === 'principal'));
  assert.equal(st.global.present, 1);
  assert.equal(st.global.taux, 1);
});

// ------------------------------------------------------------------ Migration

test('migration 0009 : événements existants → convoqués = tous les membres actifs sauf les Propriétaires ; liste nominative gardée', async () => {
  const base = await baseSqlite();
  const toutes = lireMigrations();
  const avant = toutes.filter(m => m.nom < '0009');
  await appliquerMigrations(base, avant);
  const d = '2026-10-01T00:00:00.000Z';
  await base.executer("INSERT INTO teams (id, nom, slug, jeu, cree_par, cree_le, maj_le) VALUES ('t1', 'T', 't', 'valorant', 'principal', ?, ?)", [d, d]);
  const ev = (id, concernes) =>
    base.executer(
      "INSERT INTO planning_evenements (id, team_id, type, titre, debut, fin, fuseau, concernes, cree_par, cree_le, maj_le) VALUES (?, 't1', 'meeting', 'R', '2026-10-20T18:00:00.000Z', '2026-10-20T19:00:00.000Z', 'Europe/Paris', ?, 'principal', ?, ?)",
      [id, concernes, d, d],
    );
  await ev('e1', '[]');
  await ev('e2', '["lea12345","principal"]');
  await appliquerMigrations(base, toutes);
  const lu = async id => JSON.parse((await base.premier('SELECT convocation FROM planning_evenements WHERE id = ?', [id])).convocation);
  assert.deepEqual(await lu('e1'), { groupes: ['tous'], membres: [], exclus: [], proprietaires: [] });
  assert.deepEqual(await lu('e2'), { groupes: [], membres: ['lea12345', 'principal'], exclus: [], proprietaires: [] });
  // Résolution : « tous » exclut les Propriétaires et le Fondateur ; un Propriétaire nommé dans l'ancienne liste reste convoqué.
  const m = (compte, cle) => ({ compte, cle, proprietaire: cle === 'proprietaire', perms: new Set(), rejointLe: d });
  const membres = [m('principal', 'proprietaire'), m('own12345', 'proprietaire'), m('coach123', 'coach'), m('lea12345', 'joueur')];
  const fin = Date.parse('2026-10-20T19:00:00.000Z');
  assert.deepEqual(convoques(convocationDe({ convocation: JSON.stringify(await lu('e1')) }), membres, fin).map(x => x.compte), ['coach123', 'lea12345']);
  assert.deepEqual(convoques(convocationDe({ convocation: JSON.stringify(await lu('e2')) }), membres, fin).map(x => x.compte), ['principal', 'lea12345']);
  // La table des demandes de compte existe ; aucun rôle système ne reçoit members.create.
  assert.ok(await base.premier("SELECT name FROM sqlite_master WHERE name = 'demandes_compte'", []));
  assert.equal(Number((await base.premier("SELECT COUNT(*) AS n FROM role_permissions WHERE permission = 'members.create'", [])).n), 0);
});
