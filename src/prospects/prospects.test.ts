import { donneesVides, ecrireDonnees, lireDonnees } from '../hub/admin/donnees';
import { donneesDepuisEntites, entitesDonnees, fusionsDonnees } from '../hub/admin/fusionDonnees';
import { appsVisibles, appsAttribuables, peutOuvrir } from '../hub/permissions';
import { REGISTRE } from '../hub/registre';
import type { ContexteHub, ServicesAdmin } from '../hub/types';
import type { Profil } from '../profils/profils';
import { ouvrirEnveloppe, sceller } from '../sync/relais/chiffrement';
import { etatLwwVide, fusionner, noterLocal } from '../sync/relais/fusionLww';
import { accesProspects, infoProspects, lireCarnet } from './acces';
import {
  MODELES_DEFAUT,
  aRelancer,
  ajouterEnLot,
  analyserListe,
  blocageEcrire,
  compter,
  emailValide,
  enregistrerModele,
  enregistrerProspect,
  entitesProspects,
  etiquettesUtilisees,
  exporterCsv,
  filtrerProspects,
  importerCsv,
  lienMailto,
  lireCsv,
  lireJour,
  lireProspects,
  modifierProspect,
  noterContact,
  prospectsDepuisEntites,
  prospectsVides,
  rendreModele,
  saisieVide,
  supprimerProspect,
  texteRelance,
  trierProspects,
  type DonneesProspects,
  type Prospect,
  type SaisieProspect,
} from './prospects';
import { ID_PROSPECTS } from './registre';

const T = Date.parse('2026-10-06T10:00:00.000Z');
const AUJ = '2026-10-06';
let graine = 0;
const alea = () => ((graine = (graine * 9301 + 49297) % 233280) / 233280);

function avec(d: DonneesProspects, s: Partial<SaisieProspect>, t = T): { d: DonneesProspects; p: Prospect } {
  const r = enregistrerProspect(d, { ...saisieVide(), ...s }, t, undefined, alea);
  return { d: r.donnees, p: r.prospect };
}

describe('validation des adresses', () => {
  it.each(['lea@exemple.fr', 'Lea.Martin+pro@sous.exemple.co.uk', "o'neil@exemple.ie", 'a_b-c@ex-emple.com'])('valide : %s', e => expect(emailValide(e)).toBe(true));
  it.each(['', 'lea', 'lea@', '@exemple.fr', 'lea@exemple', 'lea@exemple.f', 'lea exemple@ex.fr', 'lea..m@ex.fr', '.lea@ex.fr', 'lea@-ex.fr', 'lea@ex..fr', 'lea@@ex.fr', 'lea@ex.fr>'])(
    'invalide : « %s »',
    e => expect(emailValide(e)).toBe(false),
  );
  it('refuse une partie locale trop longue', () => expect(emailValide(`${'a'.repeat(65)}@ex.fr`)).toBe(false));
});

describe('ajout en lot et dédoublonnage', () => {
  it('découpe lignes, virgules, points-virgules ; ignore doublons (casse) et invalides', () => {
    const a = analyserListe('lea@exemple.fr\nHUGO@exemple.com; paul@exemple.org,lea@EXEMPLE.fr\n\npas-une-adresse\n  ', ['hugo@exemple.com']);
    expect(a.nouvelles).toEqual(['lea@exemple.fr', 'paul@exemple.org']);
    expect(a.doublons).toEqual(['HUGO@exemple.com', 'lea@EXEMPLE.fr']);
    expect(a.invalides).toEqual(['pas-une-adresse']);
  });
  it('accepte « Nom <adresse> » et mailto:', () => {
    expect(analyserListe('Léa Martin <lea@exemple.fr>, mailto:hugo@exemple.com').nouvelles).toEqual(['lea@exemple.fr', 'hugo@exemple.com']);
  });
  it('crée une fiche « nouveau » par adresse, avec source et étiquettes communes', () => {
    let d = avec(prospectsVides(), { email: 'Deja@Exemple.fr', nom: 'Déjà', nePlusContacter: true }).d;
    const r = ajouterEnLot(d, 'deja@exemple.fr; neuf@exemple.fr; neuf2@exemple.fr', { source: 'Salon 2026', etiquettes: 'salon, b2b' }, T, alea);
    d = r.donnees;
    expect(r.ajoutes).toBe(2);
    expect(r.analyse.doublons).toEqual(['deja@exemple.fr']);
    const neufs = Object.values(d.prospects).filter(p => p.email.startsWith('neuf'));
    expect(neufs).toHaveLength(2);
    expect(neufs.every(p => p.statut === 'nouveau' && p.source === 'Salon 2026' && p.etiquettes.join() === 'salon,b2b')).toBe(true);
    // Le refus de l'adresse déjà connue est conservé.
    expect(Object.values(d.prospects).find(p => p.nom === 'Déjà')?.nePlusContacter).toBe(true);
  });
  it('une saisie à la main refuse un doublon et une adresse invalide', () => {
    const { d } = avec(prospectsVides(), { email: 'lea@exemple.fr' });
    expect(() => avec(d, { email: 'LEA@exemple.fr' })).toThrow(/déjà dans le carnet/);
    expect(() => avec(d, { email: 'lea@exemple' })).toThrow(/invalide/);
    expect(() => avec(d, {})).toThrow(/nom ou une adresse/);
    expect(() => avec(d, { nom: 'X', relance: '31/02/2026' })).toThrow(/relance/);
  });
});

describe('CSV', () => {
  it('export complet puis réimport : mêmes fiches, historique compris', () => {
    let { d, p } = avec(prospectsVides(), { nom: 'Léa Martin', entreprise: 'Atelier "Lune"', email: 'lea@exemple.fr', telephone: '06 12 34 56 78', source: 'Salon, Paris', etiquettes: 'salon, chaud', statut: 'repond', relance: '10/10/2026', notes: 'Ligne 1\nLigne 2' });
    d = modifierProspect(d, p.id, x => noterContact(x, { date: '2026-10-01', note: 'Appel' }, 'hist0001'), T);
    d = avec(d, { nom: 'Refus', email: 'non@exemple.fr', nePlusContacter: true }).d;
    const csv = exporterCsv(Object.values(d.prospects));
    expect(csv.split('\r\n')[0]).toBe('﻿nom,entreprise,email,telephone,source,etiquettes,statut,prochaine_relance,ne_plus_contacter,notes,historique,cree_le,modifie_le');
    const r = importerCsv(prospectsVides(), csv, T, alea);
    expect(r.bilan).toMatchObject({ ajoutes: 2, doublons: 0, invalides: 0 });
    const lea = Object.values(r.donnees.prospects).find(x => x.email === 'lea@exemple.fr')!;
    expect(lea).toMatchObject({ nom: 'Léa Martin', entreprise: 'Atelier "Lune"', source: 'Salon, Paris', etiquettes: ['salon', 'chaud'], statut: 'repond', relance: '2026-10-10', notes: 'Ligne 1\nLigne 2' });
    expect(lea.historique.map(h => [h.date, h.note])).toEqual([['2026-10-01', 'Appel']]);
    expect(Object.values(r.donnees.prospects).find(x => x.email === 'non@exemple.fr')?.nePlusContacter).toBe(true);
  });
  it('neutralise les formules à l’export', () => {
    const { d } = avec(prospectsVides(), { nom: '=HYPERLINK("x")', email: 'a@exemple.fr' });
    expect(exporterCsv(Object.values(d.prospects))).toContain(`"'=HYPERLINK(""x"")"`);
  });
  it('import simple au point-virgule, en-têtes français ou anglais ; doublons et invalides comptés', () => {
    const { d } = avec(prospectsVides(), { email: 'hugo@exemple.com' });
    const csv = 'Name;Company;E-mail;Tags;Status\nLéa;Lune;lea@exemple.fr;a|b;Rendez-vous\nHugo;X;HUGO@exemple.com;;\nBad;Y;pas-bon;;\n;;;;\n';
    const r = importerCsv(d, csv, T, alea);
    expect(r.bilan).toMatchObject({ ajoutes: 1, doublons: 1, invalides: 1 });
    const lea = Object.values(r.donnees.prospects).find(x => x.nom === 'Léa')!;
    expect(lea).toMatchObject({ entreprise: 'Lune', etiquettes: ['a', 'b'], statut: 'rendez-vous' });
  });
  it('refuse un en-tête inconnu', () => {
    expect(() => importerCsv(prospectsVides(), 'a,b\n1,2', T)).toThrow(/En-tête/);
  });
  it('lit guillemets, retours à la ligne et BOM', () => {
    expect(lireCsv('﻿a,b\r\n"x, ""y""","1\n2"\r\n')).toEqual([['a', 'b'], ['x, "y"', '1\n2']]);
  });
});

describe('filtres, tri, relances, compteurs', () => {
  const base = () => {
    let d = prospectsVides();
    d = avec(d, { nom: 'Léa Martin', entreprise: 'Atelier Lune', email: 'lea@exemple.fr', etiquettes: 'salon', relance: '2026-10-06' }, T).d;
    d = avec(d, { nom: 'Hugo', entreprise: 'Béton SA', email: 'hugo@exemple.com', etiquettes: 'web', relance: '2026-10-01', statut: 'contacte' }, T + 1).d;
    d = avec(d, { nom: 'Zoé', email: 'zoe@exemple.org', relance: '2026-10-20', statut: 'repond' }, T + 2).d;
    d = avec(d, { nom: 'Ana', email: 'ana@exemple.org', relance: '2026-10-02', statut: 'gagne' }, T + 3).d;
    d = avec(d, { nom: 'Refus', email: 'non@exemple.org', relance: '2026-10-02', nePlusContacter: true }, T + 4).d;
    return Object.values(d.prospects);
  };
  it('à relancer aujourd’hui : échues, ni closes ni refusées', () => {
    const l = base();
    expect(filtrerProspects(l, { aRelancer: true }, AUJ).map(p => p.nom).sort()).toEqual(['Hugo', 'Léa Martin']);
    expect(compter(l, AUJ)).toMatchObject({ total: 5, aRelancer: 2, enRetard: 1, nePlusContacter: 1 });
    expect(compter(l, AUJ).parStatut).toMatchObject({ nouveau: 2, contacte: 1, repond: 1, gagne: 1 });
  });
  it('recherche sans accents ni casse, filtres statut et étiquette', () => {
    const l = base();
    expect(filtrerProspects(l, { recherche: 'beton' }, AUJ).map(p => p.nom)).toEqual(['Hugo']);
    expect(filtrerProspects(l, { recherche: 'LEA lune' }, AUJ).map(p => p.nom)).toEqual(['Léa Martin']);
    expect(filtrerProspects(l, { statut: 'repond' }, AUJ).map(p => p.nom)).toEqual(['Zoé']);
    expect(filtrerProspects(l, { etiquette: 'SALON' }, AUJ).map(p => p.nom)).toEqual(['Léa Martin']);
    expect(etiquettesUtilisees(l)).toEqual(['salon', 'web']);
  });
  it('tris', () => {
    const l = base();
    expect(trierProspects(l, 'relance').map(p => p.nom)).toEqual(['Hugo', 'Ana', 'Refus', 'Léa Martin', 'Zoé']);
    expect(trierProspects(l, 'nom').map(p => p.nom)).toEqual(['Ana', 'Hugo', 'Léa Martin', 'Refus', 'Zoé']);
    expect(trierProspects(l, 'entreprise')[0].entreprise).toBe('Atelier Lune');
    expect(trierProspects(l, 'statut')[0].statut).toBe('nouveau');
    expect(trierProspects(l, 'recent')[0].nom).toBe('Refus');
  });
  it('noter un contact : historique, statut qui avance, relance suivante', () => {
    const p = base().find(x => x.nom === 'Léa Martin')!;
    const apres = noterContact(p, { date: AUJ, note: 'E-mail', relanceDans: 7 }, 'hist0002');
    expect(apres.statut).toBe('contacte');
    expect(apres.relance).toBe('2026-10-13');
    expect(aRelancer(apres, AUJ)).toBe(false);
    expect(noterContact(apres, { date: AUJ, note: '' }, 'hist0003').statut).toBe('relance');
    const sansRelance = noterContact({ ...p, relance: AUJ }, { date: AUJ, note: '' }, 'hist0004');
    expect(sansRelance.relance).toBeUndefined();
    expect(texteRelance(apres, AUJ)).toBe('Relance le 13/10/2026 (dans 7 j)');
    expect(texteRelance(base().find(x => x.nom === 'Hugo')!, AUJ)).toMatch(/en retard de 5 j/);
  });
  it('dates : JJ/MM/AAAA ou ISO', () => {
    expect(lireJour('6/10/2026')).toBe('2026-10-06');
    expect(lireJour('2026-10-06')).toBe('2026-10-06');
    expect(lireJour('31/02/2026')).toBeUndefined();
  });
  it('supprimer retire la fiche', () => {
    const { d, p } = avec(prospectsVides(), { email: 'a@exemple.fr' });
    expect(supprimerProspect(d, p.id).prospects[p.id]).toBeUndefined();
  });
});

describe('modèles et « Écrire »', () => {
  const lea: Prospect = avec(prospectsVides(), { nom: 'Léa Martin', entreprise: 'Atelier Lune', email: 'lea@exemple.fr' }).p;
  it('variables {prenom} et {entreprise} ; une variable vide disparaît proprement', () => {
    expect(rendreModele('Bonjour {prenom}, chez {entreprise} !', lea)).toBe('Bonjour Léa, chez Atelier Lune !');
    expect(rendreModele('Bonjour {prenom}, je vous écris ({Entreprise}) .', { nom: '', entreprise: '', email: 'x@y.fr' })).toBe('Bonjour, je vous écris ().');
  });
  it('lien mailto : un destinataire, objet et corps encodés', () => {
    const lien = lienMailto(lea, MODELES_DEFAUT[0])!;
    expect(lien.startsWith('mailto:lea@exemple.fr?subject=Bonjour%20L%C3%A9a&body=')).toBe(true);
    expect(decodeURIComponent(lien.split('body=')[1])).toContain('Atelier Lune');
    expect(decodeURIComponent(lien.split('body=')[1])).toMatch(/stop/);
  });
  it('« Ne plus contacter » bloque Écrire', () => {
    const refus = { ...lea, nePlusContacter: true };
    expect(blocageEcrire(refus)).toMatch(/ne plus être contactée/);
    expect(lienMailto(refus, MODELES_DEFAUT[0])).toBeUndefined();
    expect(lienMailto({ ...lea, email: '' })).toBeUndefined();
  });
  it('modèles personnalisables : création, modification, identifiant unique', () => {
    let d = enregistrerModele(prospectsVides(), { nom: 'Relance', sujet: 'x', corps: 'Bonjour {prenom}' });
    const ajoute = d.modeles[d.modeles.length - 1];
    expect(ajoute.id).toBe('relance-2');
    d = enregistrerModele(d, { ...ajoute, corps: 'Nouveau' });
    expect(d.modeles.find(m => m.id === 'relance-2')?.corps).toBe('Nouveau');
    expect(() => enregistrerModele(d, { nom: '', sujet: '', corps: 'x' })).toThrow();
  });
});

describe('synchronisation et chiffrement', () => {
  const fondateurDonnees = () => {
    const d = donneesVides();
    const { d: carnet } = avec(d.prospects, { nom: 'Léa Secrète', email: 'lea.secrete@exemple.fr', notes: 'NOTE-PROSPECT-XYZ' });
    return { ...d, prospects: carnet };
  };
  it('les fiches voyagent comme entités prospect:<id> et se relisent à l’identique', () => {
    const d = fondateurDonnees();
    const e = entitesDonnees(d);
    const cles = Object.keys(e).filter(c => c.startsWith('prospect:'));
    expect(cles).toHaveLength(1);
    expect(e['prospects-modeles']).toBeUndefined();
    expect(donneesDepuisEntites(e, T).prospects).toEqual(d.prospects);
    expect(lireDonnees(ecrireDonnees(d)).prospects).toEqual(d.prospects);
    expect(prospectsDepuisEntites(entitesProspects(d.prospects))).toEqual(d.prospects);
  });
  it('deux appareils : ajouts des deux côtés réunis, suppression propagée', () => {
    const maintenant = '2026-10-06T10:00:00.000Z';
    const A = fondateurDonnees();
    const fusions = fusionsDonnees(A.reglages, T);
    // B part de A (premier tour), ajoute une fiche.
    const eA = entitesDonnees(A);
    const etatA = noterLocal(etatLwwVide(), eA, maintenant, fusions);
    const docA = fusionner(eA, etatA, undefined, fusions);
    const B = { ...A, prospects: avec(A.prospects, { email: 'hugo@exemple.com' }, T + 5).d };
    const eB = entitesDonnees(B);
    const resB = fusionner(eB, noterLocal(docA.etat, eB, '2026-10-06T10:01:00.000Z', fusions), docA.document, fusions);
    expect(Object.keys(resB.entites).filter(c => c.startsWith('prospect:'))).toHaveLength(2);
    // A supprime Léa ensuite, puis reçoit le document de B.
    const idLea = Object.keys(A.prospects.prospects)[0];
    const A2 = { ...A, prospects: supprimerProspect(A.prospects, idLea) };
    const eA2 = entitesDonnees(A2);
    const resA = fusionner(eA2, noterLocal(docA.etat, eA2, '2026-10-06T10:02:00.000Z', fusions), resB.document, fusions);
    const final = donneesDepuisEntites(resA.entites, T).prospects;
    expect(Object.values(final.prospects).map(p => p.email)).toEqual(['hugo@exemple.com']);
    expect(resA.document.supprimes[`prospect:${idLea}`]).toBeDefined();
  });
  it('le document déposé sur le relais est scellé : ni adresse ni note en clair', () => {
    const d = fondateurDonnees();
    const fusions = fusionsDonnees(d.reglages, T);
    const e = entitesDonnees(d);
    const doc = fusionner(e, noterLocal(etatLwwVide(), e, '2026-10-06T10:00:00.000Z', fusions), undefined, fusions).document;
    const cle = 'ab'.repeat(32);
    const enveloppe = sceller(cle, doc, 'admin', '2026-10-06T10:00:00.000Z');
    const brut = JSON.stringify(enveloppe);
    expect(brut).not.toContain('lea.secrete');
    expect(brut).not.toContain('NOTE-PROSPECT-XYZ');
    expect(brut).not.toContain('Secrète');
    expect(JSON.stringify(ouvrirEnveloppe(cle, enveloppe))).toContain('lea.secrete@exemple.fr');
    expect(() => ouvrirEnveloppe('cd'.repeat(32), enveloppe)).toThrow();
  });
  it('anciennes données d’administration sans prospects : carnet vide, modèles par défaut', () => {
    const ancien = lireDonnees(JSON.stringify({ version: 1, reglages: {}, notes: {}, journal: [], connexionsVues: {} }));
    expect(ancien.prospects).toEqual(prospectsVides());
  });
  it('données corrompues : fiches illisibles écartées, champs bornés', () => {
    const d = lireProspects({ prospects: { '!!': { email: 'a@b.fr' }, abcd1234: { email: 'x@exemple.fr', statut: 'inconnu', relance: '2026-13-01', historique: [{ id: 'h', date: 'x' }, 3], etiquettes: 'a,a,b' }, vide0000: {} }, modeles: 'x' });
    expect(Object.keys(d.prospects)).toEqual(['abcd1234']);
    expect(d.prospects.abcd1234).toMatchObject({ statut: 'nouveau', etiquettes: ['a', 'b'], historique: [] });
    expect(d.prospects.abcd1234.relance).toBeUndefined();
    expect(d.modeles).toEqual(MODELES_DEFAUT);
  });
});

describe('droits : Fondateur du compte historique seulement', () => {
  const stockage = () => {
    const m = new Map<string, string>();
    return { lire: (c: string) => m.get(c), ecrire: (c: string, v: string) => void m.set(c, v) };
  };
  const services = (): ServicesAdmin => ({ stockage: stockage(), verifierIdentite: () => undefined, etatCoffre: () => undefined });
  const fondateur: Profil = { id: 'principal', nom: 'Enzo', admin: true, creeLe: '2026-01-01' };
  const ami: Profil = { id: 'ami00001', nom: 'Léa', admin: false, creeLe: '2026-01-01', apps: ['portefeuille', ID_PROSPECTS] };
  const autres: Profil[] = (['gestionnaire', 'administrateur', 'fondateur'] as const).map((role, i) => ({ id: `rang000${i}`, nom: role, admin: false, creeLe: '2026-01-01', role, apps: [ID_PROSPECTS] }));

  it('le Fondateur voit la tuile ; un ami non, même si sa liste d’apps a été retouchée', () => {
    const app = REGISTRE.find(a => a.id === ID_PROSPECTS)!;
    expect(app.adminSeulement).toBe(true);
    expect(appsVisibles(REGISTRE, { profil: fondateur, admin: services() }).map(a => a.id)).toContain(ID_PROSPECTS);
    expect(appsVisibles(REGISTRE, { profil: ami }).map(a => a.id)).not.toContain(ID_PROSPECTS);
    // Même avec des services d'administration fournis par erreur.
    expect(appsVisibles(REGISTRE, { profil: ami, admin: services() }).map(a => a.id)).not.toContain(ID_PROSPECTS);
    expect(peutOuvrir(app, ami)).toBe(false);
    expect(appsAttribuables(REGISTRE).map(a => a.id)).not.toContain(ID_PROSPECTS);
  });
  it.each(autres)('rang $role (hors compte historique) : ni tuile ni données', profil => {
    const contexte: ContexteHub = { profil, admin: services() };
    expect(appsVisibles(REGISTRE, contexte).map(a => a.id)).not.toContain(ID_PROSPECTS);
    expect(accesProspects(contexte)).toBe(false);
    expect(lireCarnet(contexte)).toBeUndefined();
    expect(infoProspects(contexte)).toBeUndefined();
  });
  it('sans services d’administration (plateforme sans profils) : indisponible', () => {
    expect(appsVisibles(REGISTRE, { profil: fondateur }).map(a => a.id)).not.toContain(ID_PROSPECTS);
  });
  it('un ami ne lit jamais le carnet, même s’il recevait le stockage du Fondateur', () => {
    const s = services();
    const contexteFondateur: ContexteHub = { profil: fondateur, admin: s, maintenant: T };
    const admin = donneesVides();
    s.stockage.ecrire('admin.donnees', ecrireDonnees({ ...admin, prospects: avec(admin.prospects, { email: 'lea@exemple.fr', relance: AUJ }).d }));
    expect(Object.keys(lireCarnet(contexteFondateur)!.prospects)).toHaveLength(1);
    expect(infoProspects(contexteFondateur)?.sousTitre).toBe('1 à relancer aujourd’hui');
    expect(lireCarnet({ profil: ami, admin: s })).toBeUndefined();
  });
});
