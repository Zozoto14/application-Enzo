/**
 * Sponsors & partenaires (migration 0024, rubrique de l'espace CM) :
 *  - règles pures : périodes des contreparties, montants, CSV (lecture malformée, écriture sûre) ;
 *  - migration sur une base existante (étapes, permissions du Responsable CM) ;
 *  - PERMISSIONS : un joueur, un Propriétaire de team, un correspondant de team, un rédacteur CM ne voient rien
 *    (404) ; lecture seule (403 en écriture) ; anti-escalade ; retrait des permissions du Responsable CM ;
 *  - pipeline : prospects, contacts, échanges, prochaine action, étapes éditables, raison de perte, conversion ;
 *  - partenaires : contrats, contreparties, comptage par les posts CM publiés (« mention sponsor »), suivi manuel,
 *    retards ; tableau de bord ;
 *  - rappels (prochaine action, contrepartie, fin de contrat) : notification une seule fois, récapitulatif ;
 *  - import CSV (correspondance, lignes malformées, doublons) et export CSV (formules neutralisées) ;
 *  - pièces jointes (portée « sponsors » : jamais lisibles par la seule section CM), RGPD, export / import.
 *
 * Tourne sur SQLite (défaut) et sur PostgreSQL (ESPORT_TEST_PG, esport/test/pg/lancer.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc, teamAvecMembres } from './aide.mjs';
import { baseMigree, baseVierge, lireMigrations } from './base.mjs';
import { morceau, sha } from './medias-aide.mjs';
import { appliquerMigrations } from '../noyau/migrations.mjs';
import { distribuer } from '../noyau/evenements.mjs';
import { TABLES, exporterBase, importerBase } from '../noyau/transfert.mjs';
import { TYPES_IMPORTANTS } from '../noyau/recap.mjs';
import { rappelsSponsors } from '../noyau/sponsors/rappels.mjs';
import { CsvInvalide, champCsvSur, correspondanceProposee, ecrireCsv, etatPeriode, lireCsv, lireMontant, periodeDe, periodesEntre } from '../noyau/sponsors/regles.mjs';

// ------------------------------------------------------------------ Règles pures

test('périodes : semaine ISO, mois, trimestre, année, unique ; bornes de l’obligation ; état', () => {
  assert.deepEqual(periodeDe('mensuelle', '2026-02-14'), { cle: '2026-02', debut: '2026-02-01', fin: '2026-02-28' });
  assert.deepEqual(periodeDe('trimestrielle', '2026-11-03'), { cle: '2026-T4', debut: '2026-10-01', fin: '2026-12-31' });
  assert.deepEqual(periodeDe('annuelle', '2026-06-01'), { cle: '2026', debut: '2026-01-01', fin: '2026-12-31' });
  assert.deepEqual(periodeDe('hebdomadaire', '2026-10-27'), { cle: '2026-S44', debut: '2026-10-26', fin: '2026-11-01' });
  assert.equal(periodeDe('hebdomadaire', '2027-01-01').cle, '2026-S53');
  assert.equal(periodeDe('hebdomadaire', '2024-12-30').cle, '2025-S01');
  const p = periodesEntre('mensuelle', '2026-08-15', '2026-12-10', '2026-10-27');
  assert.deepEqual(p.map(x => x.cle), ['2026-08', '2026-09', '2026-10']);
  assert.equal(p[0].debut, '2026-08-15', 'bornée au début de l’obligation');
  assert.equal(periodesEntre('mensuelle', '2026-08-15', '2026-12-10', '2027-03-01').at(-1).fin, '2026-12-10', 'bornée à sa fin');
  assert.deepEqual(periodesEntre('unique', '2026-09-01', '2026-12-31', '2026-10-27'), [{ cle: 'unique', debut: '2026-09-01', fin: '2026-12-31' }]);
  assert.deepEqual(periodesEntre('mensuelle', '2027-01-01', null, '2026-10-27'), []);
  assert.equal(etatPeriode({ fait: 2, quantite: 2, fin: '2026-09-30' }, '2026-10-27'), 'fait');
  assert.equal(etatPeriode({ fait: 1, quantite: 2, fin: '2026-09-30' }, '2026-10-27'), 'en_retard');
  assert.equal(etatPeriode({ fait: 0, quantite: 2, fin: '2026-10-31' }, '2026-10-27'), 'a_faire');
});

test('montants (centimes) et CSV : lecture tolérante, entrées malformées refusées, formules neutralisées à l’écriture', () => {
  assert.equal(lireMontant('1 500,50'), 150050);
  assert.equal(lireMontant('2000 €'), 200000);
  assert.equal(lireMontant(12.5), 1250);
  assert.equal(lireMontant(''), 0);
  for (const x of ['-5', '1e9', 'abc', '1,234,5', {}]) assert.equal(lireMontant(x), undefined, String(x));
  const { lignes, separateur } = lireCsv('﻿nom;email\r\n"Brasserie ""Zéphyr""";a@b.fr\r\n\r\n"Multi\nligne";\n');
  assert.equal(separateur, ';');
  assert.deepEqual(lignes, [['nom', 'email'], ['Brasserie "Zéphyr"', 'a@b.fr'], ['Multi\nligne', '']]);
  assert.throws(() => lireCsv('nom\n"jamais fermé\n'), e => e instanceof CsvInvalide && e.code === 'guillemet-non-ferme');
  assert.throws(() => lireCsv(`nom\n${'x\n'.repeat(30)}`, { maxLignes: 10 }), e => e.code === 'trop-de-lignes');
  assert.throws(() => lireCsv(`${'a,'.repeat(60)}a\n`), e => e.code === 'trop-de-colonnes');
  assert.deepEqual(correspondanceProposee(['Entreprise', 'E-mail', 'Téléphone', 'Inconnue', 'Valeur estimée']), { 0: 'nom', 1: 'contact_email', 2: 'contact_telephone', 4: 'valeur' });
  for (const hostile of ['=1+2', '+33', '-2', '@SOMME(A1)', '\t=1', ' =HYPERLINK("https://site-exemple.fr")', '\r=1']) assert.ok(champCsvSur(hostile).startsWith(`"'`), hostile);
  assert.equal(champCsvSur('Atelier "Nimbus"'), '"Atelier ""Nimbus"""');
  assert.equal(ecrireCsv(['a'], [['=x']]), '﻿"a"\r\n"\'=x"\r\n');
});

// ------------------------------------------------------------------ Migration

test('migration 0024 sur une base existante : étapes par défaut, Responsable CM reçoit les permissions Sponsors', async () => {
  const base = await baseVierge();
  const migrations = lireMigrations();
  await appliquerMigrations(base, migrations.filter(m => m.nom < '0024'));
  assert.deepEqual(await appliquerMigrations(base, migrations.filter(m => m.nom < '0025')), ['0024_sponsors.sql']);
  const etapes = await base.tous('SELECT cle, issue FROM sp_etapes ORDER BY position', []);
  assert.deepEqual(etapes.map(e => e.cle), ['a_contacter', 'contacte', 'discussion', 'proposition', 'negociation', 'signe', 'perdu']);
  assert.deepEqual(etapes.filter(e => e.issue !== 'ouverte').map(e => [e.cle, e.issue]), [['signe', 'gagnee'], ['perdu', 'perdue']]);
  const perms = async role => (await base.tous("SELECT permission FROM cm_role_permissions WHERE role_id = ? AND permission LIKE 'sponsors.%' ORDER BY permission", [role])).map(l => l.permission);
  assert.deepEqual(await perms('cm-role-responsable'), ['sponsors.gerer', 'sponsors.voir']);
  assert.deepEqual(await perms('cm-role-correspondant'), []);
  for (const t of ['sp_etapes', 'sp_prospects', 'sp_partenaires', 'sp_contrats', 'sp_obligations', 'sp_suivi', 'sp_contacts', 'sp_echanges', 'sp_pieces']) assert.ok(TABLES.some(([n]) => n === t), `export : ${t}`);
  for (const t of ['sp-action', 'sp-obligation', 'sp-contrat', 'sp-responsable']) assert.ok(TYPES_IMPORTANTS.includes(t), `récap : ${t}`);
});

// ------------------------------------------------------------------ Banc

async function preparer() {
  const b = await banc();
  const A = await teamAvecMembres(b, {
    membres: {
      own12345: { pseudo: 'Olga', role: 'proprietaire' },
      lea12345: { pseudo: 'Léa', role: 'joueur' },
      man12345: { pseudo: 'Max', role: 'manager' },
    },
  });
  const s = { ...A.sessions };
  s.cm123456 = await b.session('cm123456', 'Clara');
  s.red12345 = await b.session('red12345', 'Remi');
  s.lec12345 = await b.session('lec12345', 'Lou');
  const api = (chemin, jeton, o = {}) => b.appel(chemin, { jeton, methode: o.methode, corps: o.corps });
  const ok = async (chemin, jeton, o = {}) => {
    const r = await api(chemin, jeton, o);
    assert.equal(r.statut, 200, `${o.methode ?? 'GET'} ${chemin} : ${r.statut} ${JSON.stringify(r.corps)}`);
    return r.corps;
  };
  // Responsable CM du club (Sponsors par défaut) ; un rédacteur CM (cm.editer, sans Sponsors) ; un lecteur Sponsors.
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'cm123456', roleId: 'cm-role-responsable', portee: 'club' } });
  const redacteur = await ok('/cm/roles', s.fondateur, { methode: 'POST', corps: { nom: 'Rédacteur', couleur: '#123456', permissions: ['cm.voir', 'cm.editer', 'cm.gerer'] } });
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'red12345', roleId: redacteur.id, portee: 'club' } });
  const lecteur = await ok('/cm/roles', s.fondateur, { methode: 'POST', corps: { nom: 'Lecteur sponsors', couleur: '#654321', permissions: ['sponsors.voir'] } });
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'lec12345', roleId: lecteur.id, portee: 'club' } });
  return { b, A, s, api, ok, roles: { redacteur: redacteur.id, lecteur: lecteur.id } };
}

const ROUTES_LECTURE = ['/sponsors/pipeline', '/sponsors/partenaires', '/sponsors/tableau-de-bord', '/sponsors/etapes', '/sponsors/comptes'];

// ------------------------------------------------------------------ Permissions

test('permissions : un joueur, le Propriétaire de la team, un correspondant, un rédacteur CM ne voient rien (404)', async () => {
  const { A, s, api, ok, roles } = await preparer();
  const p = await ok('/sponsors/prospects', s.cm123456, { methode: 'POST', corps: { nom: 'Brasserie Zéphyr', valeurEstimee: '3000', contact: { nom: 'Ana Test', email: 'ana@site-exemple.fr' } } });
  const pid = p.prospect.id;
  // Correspondant de team avec un rôle qui porte sponsors.voir : une affectation de TEAM n'ouvre rien ici.
  const tricheur = await ok('/cm/roles', s.fondateur, { methode: 'POST', corps: { nom: 'Correspondant étendu', couleur: '#abcdef', permissions: ['cm.voir', 'sponsors.voir', 'sponsors.gerer'] } });
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'man12345', roleId: tricheur.id, portee: A.teamId } });
  for (const qui of ['lea12345', 'own12345', 'man12345', 'red12345']) {
    for (const chemin of [...ROUTES_LECTURE, `/sponsors/prospects/${pid}`, '/sponsors/export/prospects.csv', '/sponsors/journal']) {
      assert.equal((await api(chemin, s[qui])).statut, 404, `${qui} ${chemin}`);
    }
    for (const [chemin, corps] of [['/sponsors/prospects', { nom: 'X' }], ['/sponsors/import/apercu', { contenu: 'nom\nX' }], ['/sponsors/rgpd/export', { email: 'ana@site-exemple.fr' }]]) {
      assert.equal((await api(chemin, s[qui], { methode: 'POST', corps })).statut, 404, `${qui} POST ${chemin}`);
    }
    const moi = await ok('/cm/moi', s[qui]);
    assert.deepEqual(moi.sponsors, [], qui);
    assert.equal(JSON.stringify(await ok('/notifications', s[qui])).includes('Zéphyr'), false, `${qui} : aucune notification Sponsors`);
  }
  assert.equal((await ok('/cm/moi', s.lea12345)).espace, false, 'le joueur n’a pas d’espace CM');
  // Un joueur ne lit pas non plus la liste des partenaires mentionnables ; un rédacteur CM, si (nom seulement).
  assert.equal((await api('/sponsors/mentionnables', s.lea12345)).statut, 404);
  assert.deepEqual((await ok('/sponsors/mentionnables', s.red12345)).partenaires, []);
  // Lecteur (sponsors.voir seulement) : lit tout, n'écrit rien ; l'espace CM s'ouvre pour lui (rubrique Sponsors seule).
  const moiLecteur = await ok('/cm/moi', s.lec12345);
  assert.deepEqual([moiLecteur.espace, moiLecteur.sponsors, moiLecteur.club], [true, ['sponsors.voir'], []]);
  for (const chemin of ROUTES_LECTURE) await ok(chemin, s.lec12345);
  assert.equal((await ok(`/sponsors/prospects/${pid}`, s.lec12345)).gerer, false);
  assert.equal((await api(`/sponsors/prospects/${pid}`, s.lec12345, { methode: 'PATCH', corps: { nom: 'Y' } })).statut, 403);
  assert.equal((await api('/sponsors/export/prospects.csv', s.lec12345)).statut, 403);
  assert.equal((await api('/sponsors/tableaux', s.lec12345)).statut, 404);
  assert.equal((await api('/cm/tableaux', s.lec12345)).corps.tableaux?.length ?? 0, 0, 'aucun tableau CM pour un lecteur Sponsors');
  // Anti-escalade : le rédacteur (cm.gerer sans Sponsors) n'accorde pas sponsors.voir.
  assert.equal((await api('/cm/roles', s.red12345, { methode: 'POST', corps: { nom: 'Pirate', couleur: '#111111', permissions: ['sponsors.voir'] } })).corps.code, 'escalade');
  assert.equal((await api(`/cm/roles/${roles.redacteur}`, s.red12345, { methode: 'PATCH', corps: { permissions: ['cm.voir', 'cm.editer', 'cm.gerer', 'sponsors.gerer'] } })).corps.code, 'escalade');
  // Rôle éditable : le Fondateur retire les Sponsors au Responsable CM, puis « Rétablir » les rend.
  const resp = (await ok('/cm/roles', s.fondateur)).roles.find(r => r.cle === 'responsable');
  assert.ok(resp.permissions.includes('sponsors.voir') && resp.permissionsParDefaut.includes('sponsors.gerer'));
  await ok('/cm/roles/cm-role-responsable', s.fondateur, { methode: 'PATCH', corps: { permissions: resp.permissions.filter(x => !x.startsWith('sponsors.')) } });
  assert.equal((await api('/sponsors/pipeline', s.cm123456)).statut, 404);
  await ok('/cm/roles/cm-role-responsable/retablir', s.fondateur, { methode: 'POST' });
  await ok('/sponsors/pipeline', s.cm123456);
  // Le Fondateur voit tout.
  assert.equal((await ok('/sponsors/pipeline', s.fondateur)).prospects.length, 1);
});

// ------------------------------------------------------------------ Pipeline

test('pipeline : prospects, contacts, échanges, prochaine action, étapes éditables, perte motivée, conversion en partenaire', async () => {
  const { s, api, ok } = await preparer();
  const c = s.cm123456;
  let p = await ok('/sponsors/prospects', c, {
    methode: 'POST',
    corps: { nom: 'Atelier Nimbus', secteur: 'Mobilier', taille: 'pme', source: 'Salon', interet: 3, priorite: 'haute', valeurEstimee: '5 000', site: 'https://nimbus.site-exemple.fr', contact: { nom: 'Paul Essai', role: 'Marketing', email: 'paul@site-exemple.fr', telephone: '+33 6 00 00 00 00', reseaux: ['@paul_essai'] } },
  });
  const id = p.prospect.id;
  assert.deepEqual([p.prospect.valeurEstimee, p.prospect.responsable, p.contacts[0].principal, p.prospect.etapeId], [500000, 'cm123456', true, 'sp-etape-a-contacter']);
  for (const [corps, code] of [
    [{ nom: '' }, 'nom'],
    [{ nom: 'X', site: 'javascript:alert(1)' }, 'site'],
    [{ nom: 'X', valeurEstimee: '-3' }, 'valeur'],
    [{ nom: 'X', taille: 'geante' }, 'taille'],
    [{ nom: 'X', responsable: 'lea12345' }, 'responsable'],
    [{ nom: 'X', contact: { nom: 'Y', email: 'pas-une-adresse' } }, 'email'],
    [{ nom: 'X', contact: { nom: 'Y', reseaux: ['javascript:1'] } }, 'reseaux'],
    [{ nom: 'X', etapeId: 'sp-etape-signe' }, 'etape'],
  ]) assert.equal((await api('/sponsors/prospects', c, { methode: 'POST', corps })).corps.code, code, JSON.stringify(corps));
  // Échange + prochaine action en même temps.
  await ok('/sponsors/echanges', c, { methode: 'POST', corps: { prospectId: id, genre: 'appel', resume: 'Premier appel : intéressé par le maillot.', contactId: p.contacts[0].id, prochaineAction: 'Envoyer le deck', prochaineActionLe: '2026-10-22 09:00' } });
  p = await ok(`/sponsors/prospects/${id}`, c);
  assert.equal(p.echanges[0].genre, 'appel');
  assert.equal(p.prospect.prochaineAction, 'Envoyer le deck');
  assert.equal(p.prospect.actionEnRetard, false);
  assert.equal((await api('/sponsors/echanges', c, { methode: 'POST', corps: { prospectId: id, genre: 'fax', resume: 'x' } })).corps.code, 'genre');
  // Étapes éditables : renommer, ajouter, réordonner, archiver (vide seulement).
  await ok('/sponsors/etapes/sp-etape-discussion', c, { methode: 'PATCH', corps: { nom: 'Échanges en cours' } });
  let et = (await ok('/sponsors/etapes', c, { methode: 'POST', corps: { nom: 'Rendez-vous pris' } })).etapes;
  const rdv = et.find(e => e.nom === 'Rendez-vous pris');
  const ouvertes = et.filter(e => e.issue === 'ouverte');
  assert.equal(ouvertes.at(-1).id, rdv.id, 'ajoutée avant Signé / Perdu');
  et = (await ok(`/sponsors/etapes/${rdv.id}`, c, { methode: 'PATCH', corps: { index: 1 } })).etapes;
  assert.equal(et.filter(e => e.issue === 'ouverte')[1].id, rdv.id);
  assert.equal((await api('/sponsors/etapes/sp-etape-signe', c, { methode: 'PATCH', corps: { index: 0 } })).corps.code, 'etape-systeme');
  assert.equal((await api('/sponsors/etapes/sp-etape-perdu', c, { methode: 'PATCH', corps: { archive: true } })).corps.code, 'etape-systeme');
  await ok(`/sponsors/prospects/${id}/deplacer`, c, { methode: 'POST', corps: { etapeId: rdv.id } });
  assert.equal((await api(`/sponsors/etapes/${rdv.id}`, c, { methode: 'PATCH', corps: { archive: true } })).corps.code, 'etape-non-vide');
  // Perdu : raison obligatoire.
  assert.equal((await api(`/sponsors/prospects/${id}/deplacer`, c, { methode: 'POST', corps: { etapeId: 'sp-etape-perdu' } })).corps.code, 'raison-perte');
  await ok(`/sponsors/prospects/${id}/deplacer`, c, { methode: 'POST', corps: { etapeId: 'sp-etape-perdu', raisonPerte: 'Budget gelé cette année' } });
  p = await ok(`/sponsors/prospects/${id}`, c);
  assert.deepEqual([p.prospect.issue, p.prospect.raisonPerte], ['perdue', 'Budget gelé cette année']);
  // Relance : retour dans une étape ouverte, la raison s'efface ; puis « Signé » et conversion en un clic.
  await ok(`/sponsors/prospects/${id}/deplacer`, c, { methode: 'POST', corps: { etapeId: 'sp-etape-negociation' } });
  assert.equal((await ok(`/sponsors/prospects/${id}`, c)).prospect.raisonPerte, null);
  const dep = await ok(`/sponsors/prospects/${id}/deplacer`, c, { methode: 'POST', corps: { etapeId: 'sp-etape-signe' } });
  assert.equal(dep.convertible, true);
  const { partenaireId } = await ok(`/sponsors/prospects/${id}/convertir`, c, { methode: 'POST', corps: { niveau: 'officiel' } });
  const fiche = await ok(`/sponsors/partenaires/${partenaireId}`, c);
  assert.deepEqual([fiche.partenaire.nom, fiche.partenaire.niveau, fiche.partenaire.prospectId, fiche.contacts[0].email, fiche.echanges.length], ['Atelier Nimbus', 'officiel', id, 'paul@site-exemple.fr', 1]);
  const r = await api(`/sponsors/prospects/${id}/convertir`, c, { methode: 'POST', corps: {} });
  assert.deepEqual([r.statut, r.corps.code, r.corps.details.partenaireId], [409, 'deja-converti', partenaireId]);
  p = await ok(`/sponsors/prospects/${id}`, c);
  assert.deepEqual([p.prospect.partenaireId, p.prospect.issue], [partenaireId, 'gagnee']);
  // Tableau de bord : pipeline par étape, conversion.
  await ok('/sponsors/prospects', c, { methode: 'POST', corps: { nom: 'Café Orbite', valeurEstimee: 1200 } });
  const tdb = await ok('/sponsors/tableau-de-bord', c);
  assert.equal(tdb.pipeline.etapes.find(e => e.cle === 'a_contacter').valeur, 120000);
  assert.equal(tdb.pipeline.ouverts, 1);
  assert.deepEqual([tdb.conversion.signes, tdb.conversion.perdus, tdb.conversion.taux], [1, 0, 100]);
  // Filtre texte (sans accents) et journal de la rubrique (jamais dans le journal d'une team).
  assert.equal((await ok('/sponsors/pipeline?q=cafe', c)).prospects.length, 1);
  const journal = await ok('/sponsors/journal', c);
  assert.ok(journal.entrees.some(e => e.action === 'sponsors.prospect_converti'));
  assert.equal(JSON.stringify(journal).includes('paul@site-exemple.fr'), false, 'aucune adresse dans le journal');
  // Suppression d'un prospect : ses contacts disparaissent.
  const autre = await ok('/sponsors/prospects', c, { methode: 'POST', corps: { nom: 'Éphémère', contact: { nom: 'Zoé Essai', email: 'zoe@site-exemple.fr' } } });
  await ok(`/sponsors/prospects/${autre.prospect.id}`, c, { methode: 'DELETE' });
  assert.equal((await api(`/sponsors/prospects/${autre.prospect.id}`, c)).statut, 404);
  assert.equal((await ok('/sponsors/rgpd/export', c, { methode: 'POST', corps: { email: 'zoe@site-exemple.fr' } })).contacts.length, 0);
});

// ------------------------------------------------------------------ Partenaires, contreparties, cartes CM

test('contreparties : comptage par les posts CM publiés (mention sponsor), suivi manuel, retards, tableau de bord', async () => {
  const { b, s, api, ok } = await preparer();
  const c = s.cm123456;
  const part = (await ok('/sponsors/partenaires', c, { methode: 'POST', corps: { nom: 'Brasserie Zéphyr', niveau: 'principal' } })).partenaire;
  let fiche = await ok(`/sponsors/partenaires/${part.id}/contrats`, c, { methode: 'POST', corps: { intitule: 'Saison 2026', debut: '2026-07-01', fin: '2027-06-30', montant: '12000', dotation: 'Boissons pour les LAN', valeurDotation: '1200' } });
  const contrat = fiche.contrats[0];
  assert.deepEqual([contrat.montant, contrat.valeurDotation, contrat.enCours], [1200000, 120000, true]);
  assert.equal((await api(`/sponsors/partenaires/${part.id}/contrats`, c, { methode: 'POST', corps: { debut: '2026-07-01', fin: '2026-06-01' } })).corps.code, 'fin');
  fiche = await ok(`/sponsors/partenaires/${part.id}/obligations`, c, { methode: 'POST', corps: { intitule: '2 posts par mois', genre: 'posts', comptage: 'cartes', frequence: 'mensuelle', quantite: 2, contratId: contrat.id, debut: '2026-09-01' } });
  fiche = await ok(`/sponsors/partenaires/${part.id}/obligations`, c, { methode: 'POST', corps: { intitule: 'Logo sur le maillot', genre: 'maillot', frequence: 'unique', quantite: 1, contratId: contrat.id } });
  const [posts, maillot] = fiche.obligations;
  assert.deepEqual(posts.periodes.map(x => x.cle), ['2026-09', '2026-10']);
  assert.deepEqual([maillot.debut, maillot.fin, maillot.courante.cle], ['2026-07-01', '2027-06-30', 'unique']);

  // Une carte post CM coche « mention sponsor » ; publiée, elle compte pour la contrepartie.
  const club = (await ok('/cm/tableaux', c)).tableaux.find(t => t.portee === 'club');
  const tb = await ok(`/cm/tableaux/${club.id}`, c);
  assert.equal((await api(`/cm/tableaux/${club.id}/cartes`, c, { methode: 'POST', corps: { listeId: tb.listes[0].id, titre: 'X', post: true, liens: { sponsors: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'] } } })).corps.code, 'sponsor-inconnu');
  // Le rédacteur (sans Sponsors) voit les partenaires mentionnables (nom seulement) et coche la mention.
  const mentions = (await ok('/sponsors/mentionnables', s.red12345)).partenaires;
  assert.deepEqual(mentions, [{ id: part.id, nom: 'Brasserie Zéphyr', niveau: 'principal' }]);
  let carte = (await ok(`/cm/tableaux/${club.id}/cartes`, s.red12345, { methode: 'POST', corps: { listeId: tb.listes[0].id, titre: 'Merci à notre sponsor', post: true, reseaux: ['x'], textes: { x: { fr: 'Merci !', en: 'Thanks!' } }, liens: { sponsors: [part.id] } } })).carte;
  assert.deepEqual(carte.sponsors, [{ id: part.id, nom: 'Brasserie Zéphyr' }]);
  let pc = await ok(`/cm/cartes/${carte.id}/soumettre`, s.red12345, { methode: 'POST' });
  pc = await ok(`/cm/cartes/${carte.id}/valider`, c, { methode: 'POST', corps: { versionAttendue: pc.carte.version } });
  // Non publiée : ne compte pas encore.
  assert.equal((await ok(`/sponsors/partenaires/${part.id}`, c)).obligations[0].courante.fait, 0);
  await ok(`/cm/cartes/${carte.id}/publier`, s.red12345, { methode: 'POST', corps: { publications: { x: 'https://x.com/club/status/1' } } });
  fiche = await ok(`/sponsors/partenaires/${part.id}`, c);
  let courante = fiche.obligations[0].courante;
  assert.deepEqual([courante.cle, courante.fait, courante.etat, courante.cartes[0].id], ['2026-10', 1, 'a_faire', carte.id]);
  // Suivi manuel en plus (même période) : atteint ; période inconnue refusée.
  fiche = await ok(`/sponsors/obligations/${posts.id}/suivi`, c, { methode: 'PUT', corps: { periode: '2026-10', fait: 1, note: 'Story Instagram' } });
  courante = fiche.obligations[0].courante;
  assert.deepEqual([courante.fait, courante.manuel, courante.etat], [2, 1, 'fait']);
  assert.equal((await api(`/sponsors/obligations/${posts.id}/suivi`, c, { methode: 'PUT', corps: { periode: '2025-01', fait: 1 } })).corps.code, 'periode');
  assert.equal((await api(`/sponsors/obligations/${posts.id}/suivi`, s.lec12345, { methode: 'PUT', corps: { periode: '2026-10', fait: 0 } })).statut, 403);
  // Septembre est passé sans rien : en retard (fiche, liste, tableau de bord).
  assert.equal(fiche.obligations[0].periodes[0].etat, 'en_retard');
  assert.equal((await ok('/sponsors/partenaires', c)).partenaires[0].obligationsEnRetard, 1);
  const tdb = await ok('/sponsors/tableau-de-bord?annee=2026', c);
  assert.deepEqual(tdb.obligationsEnRetard.map(o => [o.intitule, o.periode]), [['2 posts par mois', '2026-09']]);
  // Revenus : 12 000 € sur 365 jours, juillet → décembre 2026 = 184 jours.
  assert.equal(tdb.revenus.numeraire, tdb.revenus.mois.reduce((x, m) => x + m.numeraire, 0));
  assert.ok(Math.abs(tdb.revenus.numeraire - Math.round((1200000 * 184) / 365)) <= 6, String(tdb.revenus.numeraire));
  assert.equal(tdb.revenus.mois[0].numeraire, 0, 'janvier : pas de contrat');
  assert.equal(tdb.partenairesActifs, 1);
  // Contrat bientôt expiré.
  await ok(`/sponsors/contrats/${contrat.id}`, c, { methode: 'PATCH', corps: { fin: '2026-11-15' } });
  assert.deepEqual((await ok('/sponsors/tableau-de-bord', c)).contratsExpirant.map(x => [x.partenaire.nom, x.joursRestants]), [['Brasserie Zéphyr', 26]]);
  // Suppression du partenaire : la carte garde ses liens mais ne montre plus le nom ; elle reste modifiable.
  await ok(`/sponsors/partenaires/${part.id}`, c, { methode: 'DELETE' });
  carte = (await ok(`/cm/cartes/${carte.id}`, c)).carte;
  assert.deepEqual(carte.sponsors, []);
  await ok(`/cm/cartes/${carte.id}/depublier`, s.red12345, { methode: 'POST' });
  await ok(`/cm/cartes/${carte.id}`, s.red12345, { methode: 'PATCH', corps: { liens: { ...carte.liens, membres: ['lea12345'] } } });
  assert.equal((await api(`/cm/cartes/${carte.id}`, s.red12345, { methode: 'PATCH', corps: { liens: { sponsors: [part.id, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'] } } })).corps.code, 'sponsor-inconnu');
  assert.equal((await b.base.tous('SELECT id FROM sp_obligations', [])).length, 0);
});

// ------------------------------------------------------------------ Rappels

test('rappels : prochaine action, contrepartie avant l’échéance, fin de contrat — une seule notification, au responsable', async () => {
  const { b, s, ok } = await preparer();
  const c = s.cm123456;
  // Horloge du banc : 2026-10-20 10:00 UTC.
  const t = b.horloge.t;
  // Prospect confié au lecteur (il voit la rubrique), action prévue aujourd'hui.
  const p = await ok('/sponsors/prospects', c, { methode: 'POST', corps: { nom: 'Café Orbite', responsable: 'lec12345', prochaineAction: 'Relancer par téléphone', prochaineActionLe: '2026-10-20 15:00' } });
  assert.ok((await ok('/notifications', s.lec12345)).liste.some(n => n.type === 'sp-responsable' && n.charge.titre === 'Café Orbite'));
  await ok('/sponsors/prospects', c, { methode: 'POST', corps: { nom: 'Plus tard', prochaineAction: 'Rappeler', prochaineActionLe: '2026-11-10 10:00' } });
  const part = (await ok('/sponsors/partenaires', c, { methode: 'POST', corps: { nom: 'Brasserie Zéphyr' } })).partenaire;
  await ok(`/sponsors/partenaires/${part.id}/contrats`, c, { methode: 'POST', corps: { debut: '2026-01-01', fin: '2026-11-15', preavisJours: 30 } });
  await ok(`/sponsors/partenaires/${part.id}/obligations`, c, { methode: 'POST', corps: { intitule: 'Mention en stream', genre: 'stream', frequence: 'mensuelle', quantite: 4, debut: '2026-01-01', rappelJours: 15 } });
  // Contrepartie à 7 jours seulement : pas encore de rappel (fin de période dans 11 jours).
  await ok(`/sponsors/partenaires/${part.id}/obligations`, c, { methode: 'POST', corps: { intitule: 'Logo sur les affiches', genre: 'affiche', frequence: 'mensuelle', quantite: 1, debut: '2026-01-01', rappelJours: 7 } });
  for (let i = 0; i < 2; i++) {
    const r = await rappelsSponsors(b.base, { maintenant: t });
    assert.equal(r.poses, i === 0 ? 3 : 0, `passage ${i + 1}`);
    await distribuer(b.base, { maintenant: t });
  }
  const lou = (await ok('/notifications', s.lec12345)).liste.filter(n => n.type === 'sp-action');
  assert.equal(lou.length, 1);
  assert.equal(lou[0].charge.titre, 'Café Orbite');
  const clara = (await ok('/notifications', c)).liste;
  assert.equal(clara.filter(n => n.type === 'sp-action').length, 0, 'le responsable seul');
  assert.equal(clara.filter(n => n.type === 'sp-obligation' && n.charge.periode === '2026-10').length, 1);
  assert.equal(clara.filter(n => n.type === 'sp-contrat' && n.charge.fin === '2026-11-15').length, 1);
  assert.equal(clara.filter(n => n.type === 'sp-obligation').length, 1, 'la contrepartie à 7 jours attend');
  // Personne d'autre (joueur, rédacteur) n'est prévenu.
  for (const qui of ['lea12345', 'red12345']) assert.equal((await ok('/notifications', s[qui])).liste.filter(n => n.type.startsWith('sp-')).length, 0);
  // Une nouvelle date réarme le rappel.
  await ok(`/sponsors/prospects/${p.prospect.id}`, c, { methode: 'PATCH', corps: { prochaineActionLe: '2026-10-21 09:00' } });
  assert.equal((await rappelsSponsors(b.base, { maintenant: t })).poses, 0);
  assert.equal((await rappelsSponsors(b.base, { maintenant: Date.parse('2026-10-21T06:00:00.000Z') })).poses, 1);
  // Le récapitulatif e-mail reprend ces notifications.
  const { tacheRecap } = await import('../noyau/recap.mjs');
  await ok('/moi/recap-courriel', c, { methode: 'PUT', corps: { actif: true, adresse: 'clara@site-exemple.fr' } });
  const envoyes = [];
  await tacheRecap(b.base, { cle: 'cle-de-session-esport-de-test-0123456789abcdef', envoyer: async m => envoyes.push(m), maintenant: t + 60_000, lienApp: 'https://app.site-exemple.fr' });
  assert.equal(envoyes.length, 1);
  assert.match(envoyes[0].texte, /Sponsors : contrepartie à faire · Brasserie Zéphyr/);
});

// ------------------------------------------------------------------ Import / export CSV

test('import CSV : correspondance des colonnes, lignes malformées, doublons ; export : formules neutralisées', async () => {
  const { b, s, api, ok } = await preparer();
  const c = s.cm123456;
  await ok('/sponsors/prospects', c, { methode: 'POST', corps: { nom: 'Café Orbite' } });
  const csv = [
    'Entreprise;Secteur;E-mail;Contact;Valeur estimée;Priorité;Étape',
    'Brasserie Zéphyr;Boissons;ana@site-exemple.fr;Ana Test;1 500,50;haute;contacté',
    'cafe orbite;Café;;;;;',
    ';Sans nom;;;;;',
    'Atelier Nimbus;Mobilier;pas-une-adresse;Paul;;;',
    'Studio Pixel;Graphisme;;;abc;;',
    '"=HYPERLINK(""https://site-exemple.fr"";""clic"")";Formules;;;;;',
    'Studio Lune;Vidéo;;;;moyenne;étape inconnue',
  ].join('\r\n');
  const apercu = await ok('/sponsors/import/apercu', c, { methode: 'POST', corps: { contenu: csv } });
  assert.equal(apercu.separateur, ';');
  assert.equal(apercu.lignes, 7);
  assert.deepEqual(apercu.correspondance, { 0: 'nom', 1: 'secteur', 2: 'contact_email', 3: 'contact_nom', 4: 'valeur', 5: 'priorite', 6: 'etape' });
  // Malformés : guillemet non fermé, contenu vide, correspondance sans nom, champ inconnu.
  assert.equal((await api('/sponsors/import/apercu', c, { methode: 'POST', corps: { contenu: 'nom\n"Zéphyr' } })).corps.details.raison, 'guillemet-non-ferme');
  assert.equal((await api('/sponsors/import', c, { methode: 'POST', corps: { contenu: '' } })).corps.code, 'csv-vide');
  assert.equal((await api('/sponsors/import', c, { methode: 'POST', corps: { contenu: csv, correspondance: { 1: 'secteur' } } })).corps.code, 'correspondance');
  assert.equal((await api('/sponsors/import', c, { methode: 'POST', corps: { contenu: csv, correspondance: { 0: 'nom', 1: 'mot_de_passe' } } })).corps.code, 'correspondance');
  assert.equal((await api('/sponsors/import', c, { methode: 'POST', corps: { contenu: csv, correspondance: { 0: 'nom', 1: 'nom' } } })).corps.code, 'correspondance');
  const bilan = await ok('/sponsors/import', c, { methode: 'POST', corps: { contenu: csv, correspondance: apercu.correspondance } });
  assert.equal(bilan.crees, 2, JSON.stringify(bilan));
  assert.deepEqual(bilan.doublons.map(d => d.ligne), [3]);
  assert.deepEqual(bilan.invalides.map(i => [i.ligne, i.code]), [[4, 'nom'], [5, 'email'], [6, 'valeur'], [8, 'etape']]);
  const pipe = await ok('/sponsors/pipeline', c);
  const zephyr = pipe.prospects.find(p => p.nom === 'Brasserie Zéphyr');
  assert.deepEqual([zephyr.valeurEstimee, zephyr.priorite, zephyr.etapeId, zephyr.contact.nom], [150050, 'haute', 'sp-etape-contacte', 'Ana Test']);
  assert.ok(pipe.prospects.some(p => p.nom.startsWith('=HYPERLINK')), 'le texte est gardé tel quel en base');
  // Export : la formule est neutralisée (apostrophe), les guillemets doublés ; BOM UTF-8.
  const r = await b.appel('/sponsors/export/prospects.csv', { jeton: c });
  assert.equal(r.statut, 200);
  assert.match(r.entetes.get('Content-Type'), /text\/csv/);
  assert.ok(r.corps.replace(/^\uFEFF/, '').startsWith('"nom"'));
  assert.ok(r.corps.includes('"\'=HYPERLINK(""https://site-exemple.fr"";""clic"")"'));
  assert.equal(/(^|,)"=/m.test(r.corps), false, 'aucune cellule ne commence par =');
  const json = await ok('/sponsors/export/partenaires.csv?format=json', c);
  assert.equal(json.type, 'text/csv; charset=utf-8');
});

// ------------------------------------------------------------------ Pièces, RGPD, export / import

test('pièces jointes (portée sponsors), logo, RGPD des contacts et des comptes, export / import de la base', async () => {
  const { b, s, api, ok } = await preparer();
  const c = s.cm123456;
  const part = (await ok('/sponsors/partenaires', c, { methode: 'POST', corps: { nom: 'Brasserie Zéphyr' } })).partenaire;
  // Un rédacteur CM ni un joueur n'envoient de fichier dans la portée « sponsors ».
  for (const qui of ['red12345', 'lea12345']) assert.equal((await api('/cm/portees/sponsors/envois', s[qui], { methode: 'POST', corps: { nom: 'x.png', taille: 100 } })).statut, 404, qui);
  const png = new Uint8Array(200);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const env = await ok('/cm/portees/sponsors/envois', c, { methode: 'POST', corps: { nom: 'logo.png', taille: png.length } });
  await morceau(b, c, `/cm/portees/sponsors/envois/${env.id}`, 0, png);
  await ok(`/cm/portees/sponsors/envois/${env.id}/fin`, c, { methode: 'POST', corps: { sha256: sha(png) } });
  const { pieces } = await ok('/sponsors/pieces', c, { methode: 'POST', corps: { partenaireId: part.id, genre: 'fichier', envoi: env.id, categorie: 'logo' } });
  assert.equal(pieces[0].fichier.type, 'image/png');
  await ok('/sponsors/pieces', c, { methode: 'POST', corps: { partenaireId: part.id, genre: 'lien', url: 'https://docs.site-exemple.fr/deck.pdf', nom: 'Deck', categorie: 'deck' } });
  assert.equal((await api('/sponsors/pieces', c, { methode: 'POST', corps: { partenaireId: part.id, genre: 'lien', url: 'javascript:alert(1)' } })).corps.code, 'lien');
  const fiche = await ok(`/sponsors/partenaires/${part.id}`, c, { methode: 'PATCH', corps: { logoPieceId: pieces[0].id } });
  assert.equal(fiche.partenaire.logoPieceId, pieces[0].id);
  const deck = fiche.pieces.find(x => x.genre === 'lien');
  assert.equal((await api(`/sponsors/partenaires/${part.id}`, c, { methode: 'PATCH', corps: { logoPieceId: deck.id } })).corps.code, 'logo');
  // Lien signé : lisible avec sponsors.voir ; refusé à un compte qui n'a que la section CM.
  const lien = await ok(`/sponsors/pieces/${pieces[0].id}/lien`, c, { methode: 'POST', corps: {} });
  assert.equal((await b.brut(lien.url)).status, 200);
  const lienLecteur = await ok(`/sponsors/pieces/${pieces[0].id}/lien`, s.lec12345, { methode: 'POST', corps: {} });
  assert.equal((await b.brut(lienLecteur.url)).status, 200);
  assert.equal((await api(`/sponsors/pieces/${pieces[0].id}/lien`, s.red12345, { methode: 'POST', corps: {} })).statut, 404);
  const { cheminSigne } = await import('../noyau/fichiers.mjs');
  const forge = await cheminSigne('cle-de-session-esport-de-test-0123456789abcdef', { fichierId: pieces[0].fichier.id, compte: 'red12345', maintenant: b.horloge.t, duree: 3600_000, genre: 'cm' });
  assert.equal((await b.brut(`https://esport.test${forge.chemin}`)).status, 403, 'un lien signé pour un rédacteur CM ne lit pas un fichier Sponsors');

  // RGPD d'un contact (personne externe) : export puis effacement par adresse, sans casse.
  await ok('/sponsors/contacts', c, { methode: 'POST', corps: { partenaireId: part.id, nom: 'Ana Test', email: 'Ana@Site-Exemple.fr', telephone: '0600000000', principal: true } });
  const contact = (await ok(`/sponsors/partenaires/${part.id}`, c)).contacts[0];
  await ok('/sponsors/echanges', c, { methode: 'POST', corps: { partenaireId: part.id, genre: 'reunion', resume: 'Point annuel', contactId: contact.id } });
  const exp = await ok('/sponsors/rgpd/export', c, { methode: 'POST', corps: { email: 'ana@site-exemple.fr' } });
  assert.deepEqual([exp.contacts.length, exp.contacts[0].partenaire, exp.contacts[0].echanges[0].resume], [1, 'Brasserie Zéphyr', 'Point annuel']);
  assert.equal((await api('/sponsors/rgpd/export', s.lec12345, { methode: 'POST', corps: { email: 'ana@site-exemple.fr' } })).statut, 403);
  // Export / import de la base : toutes les tables Sponsors suivent (étapes de la migration remplacées, pas doublées).
  await ok('/sponsors/etapes/sp-etape-contacte', c, { methode: 'PATCH', corps: { nom: 'Premier contact' } });
  const sauvegarde = await exporterBase(b.base);
  const neuve = await baseMigree();
  const bilan = await importerBase(neuve, JSON.parse(JSON.stringify(sauvegarde)));
  assert.equal(bilan.sp_etapes, 7);
  assert.equal((await neuve.tous('SELECT id FROM sp_etapes', [])).length, 7);
  assert.equal((await neuve.premier("SELECT nom FROM sp_etapes WHERE id = 'sp-etape-contacte'", [])).nom, 'Premier contact');
  assert.equal((await neuve.premier('SELECT email FROM sp_contacts', [])).email, 'Ana@Site-Exemple.fr');
  const eff = await ok('/sponsors/rgpd/effacer', c, { methode: 'POST', corps: { email: 'ANA@site-exemple.fr' } });
  assert.equal(eff.effaces, 1);
  const apres = await ok(`/sponsors/partenaires/${part.id}`, c);
  assert.deepEqual([apres.contacts.length, apres.echanges.length], [0, 0]);
  // RGPD d'un compte : export de ce qu'il suit ; suppression : plus responsable de rien.
  await ok('/sponsors/prospects', c, { methode: 'POST', corps: { nom: 'Café Orbite' } });
  const moi = await ok('/moi/export', c);
  assert.deepEqual(moi.sponsorsProspectsSuivis.map(x => x.nom), ['Café Orbite']);
  await ok('/moi', c, { methode: 'DELETE' });
  assert.equal((await b.base.premier("SELECT responsable_id FROM sp_prospects WHERE nom = 'Café Orbite'", [])).responsable_id, null);
});
