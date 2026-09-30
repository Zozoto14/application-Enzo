import { hexToBytes } from '@noble/hashes/utils.js';
import { ouvrirBaseNode } from '../db/pilotes/node';
import { aleatoireDeterministe } from '../securite/aleatoire';
import type { ParametresKdf } from '../securite/kdf';
import { Session } from '../session/session';
import { stockageMemoire } from '../session/stockage-coffre';
import { ecrireAnnuaire, lireAnnuaire, noterConnexionAmi, trouverCompte, type Annuaire, type ClesAdmin } from './annuaire';
import { ajouterProfil, ecrireProfils, lireProfils, ID_PRINCIPAL } from './profils';
import {
  changerRang,
  codeAccesTitulaire,
  comptesScellesPour,
  ouvrirAnnuaireAdmin,
  ouvrirAnnuaireTitulaire,
  ouvrirSequestreTitulaire,
  registreDe,
  regenererCodeTitulaire,
  revoquerSequestreTitulaire,
} from './rangs';
import { projectionAmi } from './synchroAnnuaire';

const KDF: ParametresKdf = { algorithme: 'argon2id', passes: 1, memoireKio: 64, fils: 1, longueurCle: 32 };
const T = 1_700_000_000_000;
const ISO = new Date(T).toISOString();
const LEA = 'lea0000001';
const HUGO = 'hugo000002';
const MAX = 'max0000003';
const ZOE = 'zoe0000004';

function session(profil: string, graine: number) {
  const s = new Session({ stockage: stockageMemoire(), ouvrirBase: () => ouvrirBaseNode(), horloge: () => T, alea: aleatoireDeterministe(graine), kdf: KDF, profil });
  s.initialiser({ motDePasse: `mot-de-passe-${profil}-long` });
  return s;
}

function clesDe(s: Session): ClesAdmin {
  return { annuaire: hexToBytes(s.cleDerivee('annuaire')), sequestre: hexToBytes(s.cleDerivee('sequestre')) };
}

const disque = (a: Annuaire) => lireAnnuaire(ecrireAnnuaire(a));

/**
 * Fondateur « Enzo » (compte historique) et quatre amis ; Léa, Hugo et Max se
 * sont connectés (dépôt pour le Fondateur), Zoé jamais.
 */
function monter() {
  let liste = lireProfils(undefined).map(p => ({ ...p, nom: 'Enzo' }));
  liste = ajouterProfil(liste, 'Léa', LEA, '2026-09-01');
  liste = ajouterProfil(liste, 'Hugo', HUGO, '2026-09-02');
  liste = ajouterProfil(liste, 'Max', MAX, '2026-09-03');
  liste = ajouterProfil(liste, 'Zoé', ZOE, '2026-09-04');
  const enzo = session(ID_PRINCIPAL, 1);
  const sessions: Record<string, Session> = { [LEA]: session(LEA, 2), [HUGO]: session(HUGO, 3), [MAX]: session(MAX, 4), [ZOE]: session(ZOE, 5) };
  let annuaire = ouvrirAnnuaireAdmin(lireAnnuaire(ecrireProfils(liste)), clesDe(enzo), aleatoireDeterministe(10), ISO).annuaire;
  for (const id of [LEA, HUGO, MAX]) {
    annuaire = noterConnexionAmi(annuaire, id, ISO, 1, pub => sessions[id].deposerPourSequestre(pub, id));
  }
  annuaire = disque(ouvrirAnnuaireAdmin(annuaire, clesDe(enzo), aleatoireDeterministe(11), ISO).annuaire);
  return { enzo, sessions, annuaire };
}

/** Le Fondateur change un rang, puis rouvre (conversion, re-scellement), comme l'hôte. */
function parFondateur(annuaire: Annuaire, enzo: Session, cible: string, rang: 'administrateur' | 'fondateur' | 'gestionnaire' | 'ami', graine = 20) {
  const r = changerRang(annuaire, ID_PRINCIPAL, clesDe(enzo), cible, rang, aleatoireDeterministe(graine), ISO);
  return { enAttente: r.enAttente, annuaire: disque(ouvrirAnnuaireAdmin(r.annuaire, clesDe(enzo), aleatoireDeterministe(graine + 1), ISO).annuaire) };
}

/** Un titulaire ouvre l'annuaire (conversion de ses dépôts). */
function parTitulaire(annuaire: Annuaire, s: Session, id: string, nom: string, graine = 40) {
  return ouvrirAnnuaireTitulaire(annuaire, id, nom, clesDe(s), aleatoireDeterministe(graine), ISO);
}

describe('rangs : séquestre par rang', () => {
  it('le compte historique devient Fondateur : registre créé, inscrit, idempotent', () => {
    const { enzo, annuaire } = monter();
    expect(annuaire.fondateurs?.partage[ID_PRINCIPAL]).toBeDefined();
    const registre = registreDe(annuaire, ID_PRINCIPAL, clesDe(enzo));
    expect(registre).toEqual({ [ID_PRINCIPAL]: { rang: 'fondateur', cle: annuaire.admin.cleSequestre } });
    // Rouvrir ne change plus rien.
    expect(ouvrirAnnuaireAdmin(annuaire, clesDe(enzo), aleatoireDeterministe(99), ISO).modifie).toBe(false);
    // Aucun prénom en clair.
    expect(ecrireAnnuaire(annuaire)).not.toMatch(/Enzo|Léa|Hugo|Max|Zoé/);
  });

  it('promotion : la paire de Hugo est créée et les comptes inférieurs sont re-scellés pour lui', () => {
    const { enzo, sessions, annuaire: depart } = monter();
    const { annuaire, enAttente } = parFondateur(depart, enzo, HUGO, 'administrateur');
    expect(enAttente).toBe(false);
    const hugo = annuaire.comptes.find(c => c.id === HUGO)!;
    expect(hugo.acces.role).toBe('administrateur');
    expect(hugo.titulaire?.cle).toMatch(/^[0-9a-f]{64}$/);
    // Déposés pour Hugo : Léa et Max (ouverts par le Fondateur) ; pas Zoé (jamais connectée), pas lui-même.
    expect(comptesScellesPour(annuaire, HUGO).sort()).toEqual([LEA, MAX]);
    // Hugo reste scellé pour le Fondateur (un Administrateur l'est pour les Fondateurs).
    expect(hugo.sequestre.etat).toBe('actif');

    const vue = parTitulaire(annuaire, sessions[HUGO], HUGO, 'Hugo');
    expect(vue.profils.map(p => [p.nom, p.sequestre])).toEqual([
      ['Hugo', undefined],
      ['Léa', 'actif'],
      ['Max', 'actif'],
      // Jamais connectée : sa clé (et son prénom, qui voyage avec) n'est pas encore parvenue à Hugo.
      ['(prénom inconnu)', 'attendu'],
    ]);
    // Son propre code ouvre Léa : c'est bien la clé de Léa.
    const code = codeAccesTitulaire(vue.annuaire, HUGO, clesDe(sessions[HUGO]), LEA)!.code;
    const cle = ouvrirSequestreTitulaire(vue.annuaire, HUGO, clesDe(sessions[HUGO]), LEA, code);
    const autre = new Session({ stockage: stockageMemoire(sessions[LEA].coffreActuel()), ouvrirBase: () => ouvrirBaseNode(), profil: LEA });
    autre.ouvrirAvecCle(cle);
    expect(autre.cleDerivee('x')).toBe(sessions[LEA].cleDerivee('x'));
    // Le code du Fondateur n'est pas celui de Hugo : chacun a les siens.
    expect(codeAccesTitulaire(vue.annuaire, ID_PRINCIPAL, clesDe(enzo), LEA)!.code).not.toBe(code);
  });

  it('un Administrateur échoue sur un Fondateur et sur un autre Administrateur', () => {
    const { enzo, sessions, annuaire: depart } = monter();
    let annuaire = parFondateur(depart, enzo, HUGO, 'administrateur').annuaire;
    annuaire = parFondateur(annuaire, enzo, MAX, 'administrateur', 30).annuaire;
    annuaire = disque(parTitulaire(annuaire, sessions[HUGO], HUGO, 'Hugo').annuaire);
    annuaire = disque(parTitulaire(annuaire, sessions[MAX], MAX, 'Max', 50).annuaire);
    const clesHugo = clesDe(sessions[HUGO]);
    // Aucun Administrateur n'a de dépôt de l'autre, ni du Fondateur.
    expect(comptesScellesPour(annuaire, HUGO)).toEqual([LEA]);
    expect(comptesScellesPour(annuaire, MAX)).toEqual([LEA]);
    expect(annuaire.comptes.find(c => c.id === MAX)?.sequestres?.[HUGO]).toBeUndefined();
    expect(annuaire.comptes.find(c => c.id === HUGO)?.sequestres?.[MAX]).toBeUndefined();
    // La vue de Hugo ne contient ni Max ni le Fondateur.
    const vue = parTitulaire(annuaire, sessions[HUGO], HUGO, 'Hugo');
    expect(vue.profils.map(p => p.id)).toEqual([HUGO, LEA, ZOE]);
    for (const [id, motif] of [
      [ID_PRINCIPAL, /impossible/],
      [MAX, /rang égal ou supérieur/],
    ] as const) {
      expect(() => codeAccesTitulaire(annuaire, HUGO, clesHugo, id)).toThrow(motif);
      expect(() => ouvrirSequestreTitulaire(annuaire, HUGO, clesHugo, id, 'AAAA-BBBB-CCCC-DDDD')).toThrow(motif);
      expect(() => regenererCodeTitulaire(annuaire, HUGO, clesHugo, id)).toThrow(motif);
      expect(() => revoquerSequestreTitulaire(annuaire, HUGO, clesHugo, id)).toThrow(motif);
      expect(() => changerRang(annuaire, HUGO, clesHugo, id, 'ami')).toThrow(motif);
    }
    // Hugo ne nomme personne Administrateur, même un ami inférieur.
    expect(() => changerRang(annuaire, HUGO, clesHugo, LEA, 'administrateur')).toThrow(/Seul un Fondateur/);
    // Mais il nomme un Gestionnaire.
    expect(changerRang(annuaire, HUGO, clesHugo, LEA, 'gestionnaire').annuaire.comptes.find(c => c.id === LEA)?.acces.role).toBe('gestionnaire');
  });

  it('aucune clé de Fondateur n’est scellée pour un Administrateur, ni sur disque ni dans sa projection', () => {
    const { enzo, sessions, annuaire: depart } = monter();
    // Léa devient Fondatrice, Hugo Administrateur.
    let annuaire = parFondateur(depart, enzo, LEA, 'fondateur').annuaire;
    annuaire = parFondateur(annuaire, enzo, HUGO, 'administrateur', 30).annuaire;
    annuaire = disque(parTitulaire(annuaire, sessions[LEA], LEA, 'Léa', 60).annuaire);
    annuaire = disque(ouvrirAnnuaireAdmin(annuaire, clesDe(enzo), aleatoireDeterministe(61), ISO).annuaire);
    annuaire = disque(parTitulaire(annuaire, sessions[HUGO], HUGO, 'Hugo', 62).annuaire);
    const lea = annuaire.comptes.find(c => c.id === LEA)!;
    // Une Fondatrice n'est scellée pour personne : ni pour le compte historique, ni pour un titulaire.
    expect(lea.sequestre.etat).toBe('revoque');
    expect(lea.sequestres).toBeUndefined();
    expect(annuaire.fondateurs?.partage[LEA]).toBeDefined();
    expect(annuaire.fondateurs?.partage[HUGO]).toBeUndefined();
    // Hugo n'a que des comptes inférieurs : Max (et Zoé une fois connectée).
    expect(comptesScellesPour(annuaire, HUGO)).toEqual([MAX]);
    expect(comptesScellesPour(annuaire, LEA).sort()).toEqual([HUGO, MAX]);
    // La vue de Léa (Fondatrice) : Hugo et Max, avec leurs prénoms reçus par dépôt.
    const vueLea = parTitulaire(annuaire, sessions[LEA], LEA, 'Léa', 63);
    expect(vueLea.profils.map(p => [p.nom, p.role ?? 'ami', p.sequestre])).toEqual([
      ['Léa', 'fondateur', undefined],
      ['Hugo', 'administrateur', 'actif'],
      ['Max', 'ami', 'actif'],
      // Jamais connectée : ni sa clé ni son prénom ne sont encore parvenus à Léa.
      ['(prénom inconnu)', 'ami', 'attendu'],
    ]);
    expect(vueLea.profils.find(p => p.id === HUGO)?.titulaire).toBe('actif');
    // Hugo ne voit ni Léa ni le Fondateur historique.
    const vueHugo = parTitulaire(annuaire, sessions[HUGO], HUGO, 'Hugo', 64);
    expect(vueHugo.profils.map(p => p.id)).toEqual([HUGO, MAX, ZOE]);
    expect(() => ouvrirSequestreTitulaire(annuaire, HUGO, clesDe(sessions[HUGO]), LEA, 'AAAA-BBBB-CCCC-DDDD')).toThrow(/Fondateur/);
    // Le registre des Fondateurs ne s'ouvre pas avec les clés de Hugo.
    expect(registreDe(annuaire, HUGO, clesDe(sessions[HUGO]))).toBeUndefined();
    // La projection d'un ami ne contient rien des Fondateurs.
    const projection = JSON.stringify(projectionAmi(annuaire, MAX));
    expect(projection).not.toContain(lea.empreinte);
    expect(projection).not.toContain('fondateurs');
  });

  it('rétrogradation : tous les dépôts et la paire de l’ancien Administrateur disparaissent', () => {
    const { enzo, sessions, annuaire: depart } = monter();
    let annuaire = parFondateur(depart, enzo, HUGO, 'administrateur').annuaire;
    annuaire = disque(parTitulaire(annuaire, sessions[HUGO], HUGO, 'Hugo').annuaire);
    const code = codeAccesTitulaire(annuaire, HUGO, clesDe(sessions[HUGO]), LEA)!.code;
    annuaire = parFondateur(annuaire, enzo, HUGO, 'ami', 70).annuaire;
    expect(annuaire.comptes.find(c => c.id === HUGO)?.acces.role).toBeUndefined();
    expect(annuaire.comptes.find(c => c.id === HUGO)?.titulaire).toBeUndefined();
    expect(comptesScellesPour(annuaire, HUGO)).toEqual([]);
    expect(ecrireAnnuaire(annuaire)).not.toContain(`"${HUGO}":{"etat"`);
    expect(() => parTitulaire(annuaire, sessions[HUGO], HUGO, 'Hugo')).toThrow(/ni Administrateur ni Fondateur/);
    expect(() => ouvrirSequestreTitulaire(annuaire, HUGO, clesDe(sessions[HUGO]), LEA, code)).toThrow();
    expect(registreDe(annuaire, ID_PRINCIPAL, clesDe(enzo))?.[HUGO]).toBeUndefined();
  });

  it('promotion en attente : la paire est créée à la connexion du promu, puis confirmée par le Fondateur', () => {
    const { enzo, sessions, annuaire: depart } = monter();
    // Zoé ne s'est jamais connectée : le Fondateur ne peut pas l'ouvrir.
    const promu = parFondateur(depart, enzo, ZOE, 'administrateur');
    expect(promu.enAttente).toBe(true);
    let annuaire = promu.annuaire;
    expect(annuaire.comptes.find(c => c.id === ZOE)?.titulaire).toBeUndefined();
    expect(comptesScellesPour(annuaire, ZOE)).toEqual([]);
    // Zoé se connecte : dépôt pour le Fondateur, et sa paire (en attente).
    annuaire = noterConnexionAmi(annuaire, ZOE, ISO, 1, pub => sessions[ZOE].deposerPourSequestre(pub, ZOE));
    annuaire = disque(parTitulaire(annuaire, sessions[ZOE], ZOE, 'Zoé', 80).annuaire);
    const cleZoe = annuaire.comptes.find(c => c.id === ZOE)?.titulaire?.cle;
    expect(cleZoe).toBeDefined();
    // Le Fondateur n'a pas encore confirmé : rien n'est scellé pour Zoé.
    expect(comptesScellesPour(annuaire, ZOE)).toEqual([]);
    const vueFondateur = ouvrirAnnuaireAdmin(annuaire, clesDe(enzo), aleatoireDeterministe(81), ISO);
    annuaire = disque(vueFondateur.annuaire);
    expect(registreDe(annuaire, ID_PRINCIPAL, clesDe(enzo))?.[ZOE]).toEqual({ rang: 'administrateur', cle: cleZoe });
    expect(vueFondateur.profils.find(p => p.id === ZOE)?.titulaire).toBe('actif');
    expect(comptesScellesPour(annuaire, ZOE).sort()).toEqual([HUGO, LEA, MAX]);
  });

  it('se déclarer Administrateur en retouchant le fichier ne donne aucune clé', () => {
    const { enzo, sessions, annuaire: depart } = monter();
    // Max retouche le fichier : rang « administrateur » et une paire à lui.
    const retouche = disque({ ...depart, comptes: depart.comptes.map(c => (c.id === MAX ? { ...c, acces: { ...c.acces, role: 'administrateur' as const } } : c)) });
    const avecPaire = disque(parTitulaire(retouche, sessions[MAX], MAX, 'Max', 90).annuaire);
    const apres = disque(ouvrirAnnuaireAdmin(avecPaire, clesDe(enzo), aleatoireDeterministe(91), ISO).annuaire);
    // Le Fondateur ne le connaît pas au registre : rang retiré, paire effacée, aucun dépôt.
    const max = apres.comptes.find(c => c.id === MAX)!;
    expect(max.acces.role).toBeUndefined();
    expect(max.titulaire).toBeUndefined();
    expect(comptesScellesPour(apres, MAX)).toEqual([]);
  });

  it('annuaire restreint : seul le compte propriétaire s’ouvre par son prénom', () => {
    const { annuaire } = monter();
    const restreint = lireAnnuaire(ecrireAnnuaire({ ...annuaire, restreint: true, proprietaire: HUGO }));
    expect(trouverCompte(restreint, 'Hugo')?.id).toBe(HUGO);
    expect(trouverCompte(restreint, 'Léa')).toBeUndefined();
    expect(trouverCompte(restreint, 'Enzo')).toBeUndefined();
  });
});
