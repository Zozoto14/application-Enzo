import type { Profil } from '../../profils/profils';
import { avecEvenement, donneesVides, ecrireDonnees, lireDonnees } from '../admin/donnees';
import { fusionsDonnees, donneesDepuisEntites, entitesDonnees } from '../admin/fusionDonnees';
import { ErreurPermission, autorise } from '../admin/roles';
import { fusionner, noterLocal, etatLwwVide } from '../../sync/relais/fusionLww';
import {
  abonnementsVides,
  ajouterMois,
  centimesDepuisTexte,
  compteVide,
  configurerCompte,
  dateDuJour,
  definirMode,
  echeanceSuivante,
  enregistrerPaiement,
  exporterPaiementsCsv,
  filtrerLignes,
  fusionnerCompteAbo,
  lignesAbo,
  lireAbonnements,
  lireProjection,
  marquerPaye,
  messageRappel,
  modifierEcheance,
  notificationDuJour,
  projectionPour,
  rappelPourAmi,
  rendreModele,
  resteDu,
  resumeRappels,
  statutDe,
  statutProjection,
  type CompteAbo,
  type DonneesAbo,
} from './abonnements';
import { comptesSuivis, exporterPaiementsPar, modifierCompteAboPar, modifierReglagesAboPar, peutVoirAbonnements, suspendrePourImpayePar } from './actionsAbo';

const T = Date.parse('2026-10-05T12:00:00');
const MAINT = new Date(T).toISOString();
const fondateur: Profil = { id: 'principal', nom: 'Enzo', admin: true, creeLe: '' };
const admin: Profil = { id: 'adm0000001', nom: 'Ada', admin: false, creeLe: '', role: 'administrateur', actif: true };
const gest: Profil = { id: 'lea0000001', nom: 'Léa', admin: false, creeLe: '', role: 'gestionnaire', actif: true };
const hugo: Profil = { id: 'hugo000002', nom: 'Hugo', admin: false, creeLe: '', actif: true };
const zoe: Profil = { id: 'zoe0000003', nom: 'Zoé', admin: false, creeLe: '', actif: true };
const profils = [fondateur, admin, gest, hugo, zoe];
const R = abonnementsVides().reglages;

function compte(surcharge: Partial<CompteAbo> = {}): CompteAbo {
  return { ...compteVide(R, MAINT), montant: 500, ...surcharge };
}

describe('calcul des échéances', () => {
  it('mensuel : un mois plus tard, le jour visé est gardé malgré les mois courts', () => {
    expect(echeanceSuivante('2026-10-05', 'mensuel')).toBe('2026-11-05');
    expect(echeanceSuivante('2026-12-15', 'mensuel')).toBe('2027-01-15');
    // 31 janvier → fin février, puis retour au 31 mars (ancre).
    expect(echeanceSuivante('2026-01-31', 'mensuel', 31)).toBe('2026-02-28');
    expect(echeanceSuivante('2026-02-28', 'mensuel', 31)).toBe('2026-03-31');
    expect(echeanceSuivante('2028-01-31', 'mensuel', 31)).toBe('2028-02-29');
    expect(echeanceSuivante('2026-03-31', 'mensuel', 31)).toBe('2026-04-30');
  });
  it('annuel : un an plus tard, 29 février ramené au 28', () => {
    expect(echeanceSuivante('2026-10-05', 'annuel')).toBe('2027-10-05');
    expect(echeanceSuivante('2028-02-29', 'annuel', 29)).toBe('2029-02-28');
    expect(echeanceSuivante('2029-02-28', 'annuel', 29)).toBe('2030-02-28');
  });
  it('libre : aucune échéance automatique', () => {
    expect(echeanceSuivante('2026-10-05', 'libre')).toBeUndefined();
  });
  it('ajouterMois franchit les années', () => {
    expect(ajouterMois('2026-11-30', 3)).toBe('2027-02-28');
  });
  it('marquer payé avance d’une période à partir de l’ancienne échéance (pas de la date de paiement)', () => {
    const c = compte({ echeance: '2026-09-20', ancre: 20 });
    const p = marquerPaye(c, { date: '2026-10-05', moyen: 'virement', id: 'pay00001' }, MAINT);
    expect(p.echeance).toBe('2026-10-20');
    expect(p.paiements).toHaveLength(1);
    expect(p.paiements[0]).toMatchObject({ montant: 500, pour: '2026-09-20', moyen: 'virement' });
  });
  it('premier paiement sans échéance : elle se cale sur le versement', () => {
    const p = marquerPaye(compte(), { date: '2026-01-31', moyen: '', id: 'pay00002' }, MAINT);
    expect(p.echeance).toBe('2026-02-28');
    expect(p.ancre).toBe(31);
  });
  it('paiement partiel : l’échéance ne bouge pas tant que le reste dû n’est pas soldé ; une remise solde', () => {
    let c = compte({ echeance: '2026-10-10', ancre: 10 });
    c = enregistrerPaiement(c, { date: '2026-10-05', montant: 200, moyen: 'espèces', id: 'pay00003' }, MAINT);
    expect(c.echeance).toBe('2026-10-10');
    expect(resteDu(c)).toBe(300);
    c = enregistrerPaiement(c, { date: '2026-10-06', montant: 200, remise: 100, moyen: 'espèces', id: 'pay00004' }, MAINT);
    expect(c.echeance).toBe('2026-11-10');
    expect(resteDu(c)).toBe(500);
  });
  it('un même identifiant de paiement n’est jamais enregistré deux fois', () => {
    const c = marquerPaye(compte({ echeance: '2026-10-10' }), { date: '2026-10-05', moyen: '', id: 'pay00005' }, MAINT);
    expect(enregistrerPaiement(c, { date: '2026-10-05', montant: 500, moyen: '', id: 'pay00005' }, MAINT)).toBe(c);
  });
  it('refuse une date ou un montant invalide', () => {
    expect(() => enregistrerPaiement(compte(), { date: '2026-02-30', montant: 500, moyen: '', id: 'pay00006' }, MAINT)).toThrow(/Date/);
    expect(() => enregistrerPaiement(compte(), { date: '2026-10-05', montant: 0, moyen: '', id: 'pay00007' }, MAINT)).toThrow(/montant/);
    expect(() => modifierEcheance(compte(), 'demain', MAINT)).toThrow();
  });
  it('saisie de montants', () => {
    expect(centimesDepuisTexte('12,50')).toBe(1250);
    expect(centimesDepuisTexte('5')).toBe(500);
    expect(centimesDepuisTexte('abc')).toBeUndefined();
    expect(centimesDepuisTexte('1.234')).toBeUndefined();
  });
});

describe('statuts', () => {
  const auj = dateDuJour(T);
  it('à jour, échéance proche, en retard, offert, suspendu', () => {
    expect(statutDe(compte({ echeance: '2026-12-01' }), R, auj)).toBe('a-jour');
    expect(statutDe(compte({ echeance: '2026-10-12' }), R, auj)).toBe('echeance-proche');
    expect(statutDe(compte({ echeance: '2026-10-05' }), R, auj)).toBe('echeance-proche');
    expect(statutDe(compte({ echeance: '2026-10-04' }), R, auj)).toBe('en-retard');
    expect(statutDe(compte({ echeance: '2026-10-04', mode: 'offert' }), R, auj)).toBe('offert');
    expect(statutDe(compte({ echeance: '2026-10-04', mode: 'pause' }), R, auj)).toBe('suspendu');
    expect(statutDe(undefined, R, auj)).toBe('a-jour');
  });
  it('le délai du rappel est réglable', () => {
    expect(statutDe(compte({ echeance: '2026-10-20' }), { ...R, joursAvance: 15 }, auj)).toBe('echeance-proche');
  });
  it('filtres : en retard, échéance sous N jours', () => {
    const d: DonneesAbo = {
      ...abonnementsVides(),
      comptes: {
        hugo000002: compte({ echeance: '2026-10-01' }),
        zoe0000003: compte({ echeance: '2026-10-20' }),
      },
    };
    const l = lignesAbo([hugo, zoe], d, auj);
    expect(filtrerLignes(l, { statut: 'en-retard' }).map(x => x.nom)).toEqual(['Hugo']);
    expect(filtrerLignes(l, { echeanceSous: 30 }).map(x => x.nom)).toEqual(['Hugo', 'Zoé']);
    expect(filtrerLignes(l, { echeanceSous: 5 }).map(x => x.nom)).toEqual(['Hugo']);
  });
});

describe('droits par rang', () => {
  it('seul un Fondateur agit, sur les rangs inférieurs', () => {
    expect(autorise(fondateur, 'abonnements-voir').ok).toBe(true);
    expect(autorise(fondateur, 'abonnements-reglages').ok).toBe(true);
    for (const cible of [admin, gest, hugo]) expect(autorise(fondateur, 'abonnements-gerer', cible).ok).toBe(true);
    expect(autorise(fondateur, 'abonnements-gerer', fondateur).ok).toBe(false);
  });
  it('Administrateur, Gestionnaire, Ami et inconnu sont refusés partout', () => {
    for (const acteur of [admin, gest, hugo, undefined]) {
      for (const action of ['abonnements-voir', 'abonnements-reglages'] as const) expect(autorise(acteur, action).ok).toBe(false);
      for (const cible of [gest, hugo, zoe]) expect(autorise(acteur, 'abonnements-gerer', cible).ok).toBe(false);
    }
    expect(peutVoirAbonnements(admin)).toBe(false);
    expect(comptesSuivis(admin, profils)).toEqual([]);
  });
  it('les actions lèvent ErreurPermission pour un non-Fondateur, sans rien modifier', () => {
    const d = donneesVides();
    for (const acteur of [admin, gest, hugo]) {
      expect(() => modifierCompteAboPar(acteur, d, profils, 'hugo000002', c => c, 'x', T)).toThrow(ErreurPermission);
      expect(() => modifierReglagesAboPar(acteur, d, { devise: '$' }, T)).toThrow(ErreurPermission);
      expect(() => exporterPaiementsPar(acteur, d, profils)).toThrow(ErreurPermission);
    }
    expect(d.abonnements.comptes).toEqual({});
  });
  it('le Fondateur enregistre un paiement ; il est journalisé', () => {
    const d = modifierCompteAboPar(fondateur, donneesVides(), profils, 'hugo000002', c => marquerPaye(c, { date: '2026-10-05', moyen: 'virement', id: 'pay00010' }, MAINT), 'Paiement de Hugo enregistré', T);
    expect(d.abonnements.comptes.hugo000002.paiements).toHaveLength(1);
    expect(d.journal.at(-1)).toMatchObject({ type: 'abonnement', cible: 'hugo000002' });
  });
  it('« Suspendre pour impayé » : seulement avec la règle « restreindre », durée bornée, jamais sur un autre Fondateur', () => {
    const d = donneesVides();
    expect(() => suspendrePourImpayePar(fondateur, d, profils, 'hugo000002', 30, T)).toThrow(/rappel seulement/);
    const r = modifierReglagesAboPar(fondateur, d, { actionRetard: 'restreindre' }, T);
    expect(() => suspendrePourImpayePar(admin, r, profils, 'hugo000002', 30, T)).toThrow(ErreurPermission);
    expect(() => suspendrePourImpayePar(fondateur, r, profils, 'hugo000002', 0, T)).toThrow();
    const suivants = suspendrePourImpayePar(fondateur, r, profils, 'hugo000002', 30, T);
    expect(suivants.find(p => p.id === 'hugo000002')).toMatchObject({ actif: false });
    expect(suivants.find(p => p.id === 'zoe0000003')?.actif).toBe(true);
  });
  it('par défaut : rappel seulement, rien de bloquant', () => {
    expect(abonnementsVides().reglages.actionRetard).toBe('rappel');
  });
});

describe('isolation : un utilisateur ne reçoit que sa ligne', () => {
  const d: DonneesAbo = {
    ...abonnementsVides(),
    reglages: { ...R, moyens: ['virement'] },
    comptes: {
      hugo000002: compte({ echeance: '2026-10-01', notes: 'NOTE-SECRETE-HUGO', paiements: [{ id: 'pay00020', date: '2026-09-01', montant: 500, remise: 0, moyen: 'virement', pour: '2026-09-01' }] }),
      zoe0000003: compte({ echeance: '2026-11-10', notes: 'NOTE-SECRETE-ZOE' }),
    },
  };
  it('la projection ne contient ni notes, ni historique, ni autre compte', () => {
    const brut = JSON.stringify(projectionPour(d, 'hugo000002'));
    expect(brut).not.toMatch(/NOTE-SECRETE/);
    expect(brut).not.toMatch(/pay00020|paiements|notes|zoe0000003|Zoé|2026-11-10/);
    expect(brut).toContain('2026-10-01');
    expect(Object.keys(JSON.parse(brut)).sort()).toEqual(['echeance', 'joursAvance', 'message', 'mode', 'rappel', 'v']);
  });
  it('la projection d’un ami est relue telle quelle et son statut se recalcule sur sa date', () => {
    const p = lireProjection(JSON.parse(JSON.stringify(projectionPour(d, 'hugo000002'))))!;
    expect(statutProjection(p, '2026-10-05')).toBe('en-retard');
    expect(statutProjection(p, '2026-09-28')).toBe('echeance-proche');
    expect(lireProjection({ v: 2 })).toBeUndefined();
    expect(lireProjection('x')).toBeUndefined();
  });
  it('un compte inconnu reçoit une projection vide, pas celle d’un autre', () => {
    const p = projectionPour(d, 'inconnu0001');
    expect(p.echeance).toBeUndefined();
    expect(JSON.stringify(p)).not.toMatch(/2026-10-01|2026-11-10/);
  });
});

describe('fusion et synchronisation', () => {
  const base = compte({ echeance: '2026-10-10', ancre: 10 });
  it('union des paiements sans doublon ; le reste vient de la version la plus récente', () => {
    const a = marquerPaye(base, { date: '2026-10-05', moyen: 'a', id: 'pay00030' }, '2026-10-05T10:00:00.000Z');
    const b = enregistrerPaiement({ ...base, modifieLe: '2026-10-06T10:00:00.000Z', montant: 600 }, { date: '2026-10-05', montant: 100, moyen: 'b', id: 'pay00031' }, '2026-10-06T10:00:00.000Z');
    const fusion = fusionnerCompteAbo(a, b) as CompteAbo;
    expect(fusion.paiements.map(p => p.id)).toEqual(['pay00030', 'pay00031']);
    expect(fusion.montant).toBe(600);
    expect(fusionnerCompteAbo(b, a)).toEqual(fusion);
    expect((fusionnerCompteAbo(fusion, a) as CompteAbo).paiements).toHaveLength(2);
  });
  it('deux appareils convergent vers les mêmes données (entités abo:<id>)', () => {
    const maintenant = '2026-10-05T12:00:00.000Z';
    const A = modifierCompteAboPar(fondateur, donneesVides(), profils, 'hugo000002', c => marquerPaye(c, { date: '2026-10-05', moyen: 'virement', id: 'pay00041' }, maintenant), 'A', T);
    const B = modifierCompteAboPar(fondateur, donneesVides(), profils, 'hugo000002', c => enregistrerPaiement(c, { date: '2026-10-06', montant: 300, moyen: 'espèces', id: 'pay00041' }, '2026-10-06T08:00:00.000Z'), 'B', T + 1);
    const fusions = fusionsDonnees(A.reglages, T);
    const eA = entitesDonnees(A);
    const eB = entitesDonnees(B);
    const etatA = noterLocal(etatLwwVide(), eA, maintenant, fusions);
    const docB = fusionner(eB, noterLocal(etatLwwVide(), eB, maintenant, fusions), undefined, fusions).document;
    const resultat = fusionner(eA, etatA, docB, fusions);
    const fusionne = donneesDepuisEntites(resultat.entites, T);
    const ids = fusionne.abonnements.comptes.hugo000002.paiements.map(p => p.id).sort();
    expect(ids).toEqual(['pay00041', 'pay00041']);
    // Dans l'autre sens : même résultat.
    const etatB = noterLocal(etatLwwVide(), eB, maintenant, fusions);
    const docA = fusionner(eA, etatA, undefined, fusions).document;
    const inverse = donneesDepuisEntites(fusionner(eB, etatB, docA, fusions).entites, T);
    expect(inverse.abonnements.comptes.hugo000002.paiements.map(p => p.id).sort()).toEqual(ids);
  });
  it('compatibilité ascendante : d’anciennes données sans abonnements se relisent, et le format se relit à l’identique', () => {
    const ancien = lireDonnees(JSON.stringify({ version: 1, reglages: {}, notes: {}, journal: [], connexionsVues: {} }));
    expect(ancien.abonnements).toEqual(abonnementsVides());
    const d = modifierCompteAboPar(fondateur, donneesVides(), profils, 'hugo000002', c => configurerCompte(c, { montant: 700, notes: 'ok' }, MAINT), 'x', T);
    expect(lireDonnees(ecrireDonnees(d)).abonnements).toEqual(d.abonnements);
  });
  it('un ancien appareil qui ne connaît pas `abo:` conserve les entités à la fusion', () => {
    const A = modifierCompteAboPar(fondateur, donneesVides(), profils, 'hugo000002', c => definirMode(c, 'offert', MAINT), 'x', T);
    const maintenant = '2026-10-05T12:00:00.000Z';
    const doc = fusionner(entitesDonnees(A), noterLocal(etatLwwVide(), entitesDonnees(A), maintenant, fusionsDonnees(A.reglages, T)), undefined, fusionsDonnees(A.reglages, T)).document;
    // « Ancien » appareil : ses entités locales n'ont aucune clé abo:.
    const ancien = donneesVides();
    const eAncien = entitesDonnees(ancien);
    const sans: Record<string, unknown> = { ...eAncien };
    const r = fusionner(sans, noterLocal(etatLwwVide(), sans, maintenant, {}), doc, {});
    expect(Object.keys(r.document.entites)).toContain('abo:hugo000002');
  });
  it('données corrompues : retombent sur les défauts', () => {
    const d = lireAbonnements({ reglages: { joursAvance: 9999, devise: '', actionRetard: 'couper' }, comptes: { '!!': {}, hugo000002: { montant: 'x', echeance: 'n/a', paiements: [{ id: 'a' }, 12] } } });
    expect(d.reglages.joursAvance).toBe(60);
    expect(d.reglages.devise).toBe('€');
    expect(d.reglages.actionRetard).toBe('rappel');
    expect(Object.keys(d.comptes)).toEqual(['hugo000002']);
    expect(d.comptes.hugo000002.paiements).toEqual([]);
    expect(d.comptes.hugo000002.echeance).toBeUndefined();
  });
});

describe('rappels', () => {
  const auj = dateDuJour(T);
  const d: DonneesAbo = {
    ...abonnementsVides(),
    reglages: { ...R, moyens: ['virement', 'espèces'] },
    comptes: {
      hugo000002: compte({ echeance: '2026-10-01' }),
      zoe0000003: compte({ echeance: '2026-10-08' }),
      lea0000001: compte({ echeance: '2026-10-09' }),
      adm0000001: compte({ echeance: '2026-09-01', mode: 'offert' }),
    },
  };
  const lignes = lignesAbo([hugo, zoe, gest, admin], d, auj);
  it('résumé : retards et échéances de la semaine (offerts ignorés)', () => {
    const r = resumeRappels(lignes);
    expect(r).toMatchObject({ retard: 1, semaine: 2 });
    expect(r.texte).toBe('1 abonnement en retard, 2 échéances cette semaine');
    expect(resumeRappels([]).texte).toBe('');
  });
  it('notification locale : une fois par jour, seulement si quelque chose à dire et si activée', () => {
    const r = resumeRappels(lignes);
    expect(notificationDuJour(r, R, undefined, auj)?.corps).toBe('1 abonnement en retard, 2 échéances cette semaine.');
    expect(notificationDuJour(r, R, auj, auj)).toBeUndefined();
    expect(notificationDuJour(r, R, '2026-10-04', auj)).toBeDefined();
    expect(notificationDuJour(r, { notification: false }, undefined, auj)).toBeUndefined();
    expect(notificationDuJour(resumeRappels([]), R, undefined, auj)).toBeUndefined();
  });
  it('rappel dans le hub de l’ami : si approche ou dépassée, activé, une fois par jour', () => {
    const p = projectionPour(d, 'hugo000002');
    expect(rappelPourAmi(p, auj, undefined)?.statut).toBe('en-retard');
    expect(rappelPourAmi(p, auj, undefined, 'Hugo')?.message).toContain('01/10/2026');
    expect(p.message).toContain('{echeance}');
    expect(p.message).not.toContain('Hugo');
    expect(rappelPourAmi(p, auj, auj)).toBeUndefined();
    expect(rappelPourAmi({ ...p, rappel: false }, auj, undefined)).toBeUndefined();
    expect(rappelPourAmi(projectionPour(d, 'adm0000001'), auj, undefined)).toBeUndefined();
    expect(rappelPourAmi({ ...p, echeance: '2027-01-01' }, auj, undefined)).toBeUndefined();
    expect(rappelPourAmi(undefined, auj, undefined)).toBeUndefined();
  });
  it('message à copier : nom, montant, échéance, moyens, retard', () => {
    const m = messageRappel(lignes[0], d.reglages);
    expect(m).toContain('Hugo');
    expect(m).toContain('5,00');
    expect(m).toContain('01/10/2026');
    expect(m).toContain('virement, espèces');
    expect(m).toContain('en retard de 4 jours');
    expect(rendreModele('{prenom} {inconnu}', { prenom: 'A', montant: '', moyens: [] })).toBe('A {inconnu}');
  });
});

describe('export CSV', () => {
  it('historique sans secret (ni notes, ni identifiants), formules neutralisées', () => {
    const d: DonneesAbo = {
      ...abonnementsVides(),
      comptes: {
        hugo000002: compte({
          notes: 'NOTE-PRIVEE',
          paiements: [{ id: 'pay00050', date: '2026-09-01', montant: 1250, remise: 50, moyen: '=HYPERLINK("x")', pour: '2026-09-01' }],
        }),
        zoe0000003: compte({ paiements: [{ id: 'pay00051', date: '2026-09-02', montant: 500, remise: 0, moyen: 'virement, SEPA', pour: '2026-09-02' }] }),
      },
    };
    const csv = exporterPaiementsPar(fondateur, { ...donneesVides(), abonnements: d }, profils);
    expect(csv.split('\r\n')[0]).toBe('compte,date_paiement,montant,remise,moyen,echeance_couverte,periodicite');
    expect(csv).toContain('Hugo,2026-09-01,12.50,0.50');
    expect(csv).toContain('"virement, SEPA"');
    expect(csv).not.toMatch(/NOTE-PRIVEE|pay0005|hugo000002|zoe0000003/);
    expect(csv).not.toMatch(/,=HYPERLINK/);
    expect(exporterPaiementsCsv([], d)).toBe('compte,date_paiement,montant,remise,moyen,echeance_couverte,periodicite\r\n');
  });
  it('le CSV n’inclut que les comptes suivables par l’acteur', () => {
    const d: DonneesAbo = { ...abonnementsVides(), comptes: { 'adm0000001': compte({ paiements: [{ id: 'pay00060', date: '2026-09-01', montant: 500, remise: 0, moyen: '', pour: '2026-09-01' }] }) } };
    expect(exporterPaiementsPar(fondateur, { ...donneesVides(), abonnements: d }, profils)).toContain('Ada');
  });
});

describe('journal', () => {
  it('le type « abonnement » est relu par le journal', () => {
    const d = avecEvenement(donneesVides(), { type: 'abonnement', action: 'Test' }, T);
    expect(lireDonnees(ecrireDonnees(d)).journal[0].type).toBe('abonnement');
  });
});
