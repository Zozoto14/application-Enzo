/**
 * Rangs et relais : ce qu'un Administrateur reçoit dans SON espace pour
 * administrer depuis le site, et rien de plus. Aucune donnée d'un Fondateur
 * (ni d'un autre Administrateur) n'y est lisible.
 */

import { aleatoireDeterministe } from '../src/securite/aleatoire';
import { scellerPourAdmin } from '../src/securite/sequestre';
import { usageSequestre } from '../src/session/session';
import { appliquerProfilsAdmin, ecrireAnnuaire, lireAnnuaire, noterConnexionAmi, trouverCompte, type Annuaire, type ClesAdmin } from '../src/profils/annuaire';
import { ajouterProfil, type Profil } from '../src/profils/profils';
import {
  changerRang,
  clesDepuisCle,
  codeAccesTitulaire,
  ouvrirAnnuaireAdmin,
  ouvrirAnnuaireTitulaire,
  ouvrirSequestreTitulaire,
} from '../src/profils/rangs';
import { encoderLiaison, type Liaison } from '../src/sync/relais/liaison';
import { liaisonPourProfil } from '../src/sync/relais/portees';
import { espacesDuRelais } from '../src/sync/relais/espaces';
import { JETON_TEST, RELAIS_TEST, relaisPortees } from '../src/sync/relais/__fixtures__/relaisPortees';
import { avantOuverture, delegationsDe, lireAnnuaireFichier, preparerLiaison, synchroniserCompteAmi, synchroniserComptesAdmin, type Fichiers, type Memoire } from './synchroComptes';

const MAITRE: Liaison = { relais: RELAIS_TEST, jeton: JETON_TEST };
const encodeur = new TextEncoder();
const ENZO: ClesAdmin = { annuaire: new Uint8Array(32).fill(7), sequestre: new Uint8Array(32).fill(9) };
const copie = (c: ClesAdmin) => ({ annuaire: c.annuaire.slice(), sequestre: c.sequestre.slice() });
const LEA = 'lea0000001';
const HUGO = 'hugo000002';
const EVE = 'eve0000003';
const MAX = 'max0000004';
/** Clés maîtresses des amis (ce que leur session tiendrait). */
const K: Record<string, Uint8Array> = { [LEA]: new Uint8Array(32).fill(21), [HUGO]: new Uint8Array(32).fill(22), [EVE]: new Uint8Array(32).fill(23), [MAX]: new Uint8Array(32).fill(24) };
let t = Date.parse('2026-09-30T08:00:00Z');
const horloge = () => new Date((t += 60_000));

function memoire(): Memoire {
  const m = new Map<string, string>();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: k => void m.delete(k) };
}
function disque(): Fichiers & { f: Map<string, Uint8Array> } {
  const f = new Map<string, Uint8Array>();
  return { f, lire: async n => f.get(n), ecrire: async (n, o) => void f.set(n, o) };
}
function appareil() {
  const fichiers = disque();
  return {
    fichiers,
    mem: memoire(),
    lire: () => lireAnnuaireFichier(fichiers),
    ecrire: async (a: Annuaire) => fichiers.ecrire('profils', encodeur.encode(ecrireAnnuaire(a))),
  };
}

/** Le PC du Fondateur Enzo : Léa, Hugo, Ève et Max connectés (dépôts faits), Ève Fondatrice, Hugo et Max Administrateurs. */
async function pc() {
  const a = appareil();
  const alea = aleatoireDeterministe(5);
  const vue = ouvrirAnnuaireAdmin(lireAnnuaire(undefined), copie(ENZO), alea);
  let profils: Profil[] = vue.profils.map(p => (p.admin ? { ...p, nom: 'Enzo' } : p));
  for (const [nom, id] of [['Léa', LEA], ['Hugo', HUGO], ['Ève', EVE], ['Max', MAX]]) profils = ajouterProfil(profils, nom, id, '2026-09-01');
  let annuaire = appliquerProfilsAdmin(vue.annuaire, profils, copie(ENZO), alea);
  for (const id of [LEA, HUGO, EVE, MAX]) {
    annuaire = noterConnexionAmi(annuaire, id, '2026-09-30T08:00:00Z', 1, pub => scellerPourAdmin(pub, K[id], usageSequestre(id), alea));
    await a.fichiers.ecrire(`coffre-${id}`, encodeur.encode(`{"coffre":"${id}"}`));
    await a.fichiers.ecrire(`portefeuille-${id}`, Uint8Array.from([1, 2, 3]));
  }
  annuaire = ouvrirAnnuaireAdmin(annuaire, copie(ENZO), alea).annuaire;
  annuaire = ouvrirAnnuaireAdmin(changerRang(annuaire, 'principal', copie(ENZO), EVE, 'fondateur', alea).annuaire, copie(ENZO), alea).annuaire;
  annuaire = ouvrirAnnuaireAdmin(changerRang(annuaire, 'principal', copie(ENZO), HUGO, 'administrateur', alea).annuaire, copie(ENZO), alea).annuaire;
  annuaire = ouvrirAnnuaireAdmin(changerRang(annuaire, 'principal', copie(ENZO), MAX, 'administrateur', alea).annuaire, copie(ENZO), alea).annuaire;
  await a.ecrire(annuaire);
  await a.fichiers.ecrire('coffre', encodeur.encode('{"coffre":"enzo"}'));
  return a;
}

function tour(a: ReturnType<typeof appareil>, relais: ReturnType<typeof relaisPortees>) {
  return synchroniserComptesAdmin({
    liaison: MAITRE,
    memoire: a.mem,
    fichiers: a.fichiers,
    lire: a.lire,
    ecrire: a.ecrire,
    cles: () => copie(ENZO),
    maintenant: horloge,
    requete: relais.requete,
    effacerFichiers: async () => undefined,
  });
}

describe('rangs sur le relais', () => {
  it('l’espace d’un Administrateur : ses comptes inférieurs, rien d’un Fondateur ni d’un autre Administrateur', async () => {
    const relais = relaisPortees();
    const p = await pc();
    const complet = await p.lire();
    const bilan = await tour(p, relais);
    expect(bilan.erreurs).toEqual([]);
    const brut = JSON.parse(relais.boite.get(`p:${HUGO}:annuaire`)!).charge as string;
    const projection = lireAnnuaire(brut);
    expect(projection.restreint).toBe(true);
    expect(projection.proprietaire).toBe(HUGO);
    expect(projection.comptes.map(c => c.id)).toEqual([HUGO, LEA]);
    // Rien du Fondateur historique hormis sa clé PUBLIQUE ; ni registre, ni bloc privé, ni journal.
    expect(Object.keys(projection.admin)).toEqual(['cleSequestre']);
    expect(brut).not.toContain(complet.admin.empreinte!);
    expect(brut).not.toContain(complet.admin.priveeScellee!);
    for (const cle of ['fondateurs', 'prive', 'journalGestion', 'partage', 'registre']) expect(brut).not.toContain(`"${cle}"`);
    // Rien d'Ève (Fondatrice) ni de Max (autre Administrateur) : ni entrée, ni empreinte, ni paire, ni séquestre.
    for (const id of [EVE, MAX]) {
      const e = complet.comptes.find(c => c.id === id)!;
      expect(brut).not.toContain(id);
      expect(brut).not.toContain(e.empreinte);
      if (e.titulaire?.cle) expect(brut).not.toContain(e.titulaire.cle);
    }
    // Pour Léa : seulement le séquestre de Hugo (pas celui du Fondateur, ni d'Ève, ni de Max).
    const lea = projection.comptes.find(c => c.id === LEA)!;
    expect(Object.keys(lea.sequestres ?? {})).toEqual([HUGO]);
    expect(lea.sequestre).toEqual({ etat: 'attendu' });
    expect(lea.suivi).toBeUndefined();
    // Délégations : Hugo et Max sur Léa ; Ève sur Hugo, Max et Léa ; jamais un égal ou un supérieur.
    expect(delegationsDe(complet)).toEqual({ [EVE]: [HUGO, LEA, MAX], [HUGO]: [LEA], [MAX]: [LEA] });
    expect(JSON.parse(relais.boite.get('rangs')!).delegations).toEqual(delegationsDe(complet));
  });

  it('Hugo administre depuis son navigateur : ouvre Léa (séquestre et fichiers par délégation), jamais Ève ni Max ; rétrogradé, il n’a plus rien', async () => {
    const relais = relaisPortees();
    const p = await pc();
    await tour(p, relais);
    // Navigateur de Hugo, relié avec SON code.
    const code = encoderLiaison(liaisonPourProfil(MAITRE, HUGO));
    const relie = await preparerLiaison(code, relais.requete);
    const nav = appareil();
    await nav.ecrire(relie.annuaire);
    // Écran prénom : seul Hugo s'ouvre ici (Léa mène au leurre).
    expect(trouverCompte(relie.annuaire, 'Hugo')?.id).toBe(HUGO);
    expect(trouverCompte(relie.annuaire, 'Léa')).toBeUndefined();
    expect(trouverCompte(relie.annuaire, 'Enzo')).toBeUndefined();
    // Hugo ouvre son compte : dépôts convertis avec SES codes.
    const clesHugo = clesDepuisCle(K[HUGO], HUGO);
    const vue = ouvrirAnnuaireTitulaire(relie.annuaire, HUGO, 'Hugo', copie(clesHugo), aleatoireDeterministe(8));
    expect(vue.profils.map(x => [x.nom, x.sequestre])).toEqual([
      ['Hugo', undefined],
      ['Léa', 'actif'],
    ]);
    await nav.ecrire(vue.annuaire);
    const codeLea = codeAccesTitulaire(vue.annuaire, HUGO, copie(clesHugo), LEA)!.code;
    expect(Array.from(ouvrirSequestreTitulaire(vue.annuaire, HUGO, copie(clesHugo), LEA, codeLea))).toEqual(Array.from(K[LEA]));
    // Les fichiers de Léa arrivent par délégation (avant l'ouverture).
    const liaisonHugo = liaisonPourProfil(MAITRE, HUGO);
    await avantOuverture({ memoire: nav.mem, fichiers: nav.fichiers, compte: LEA, liaison: liaisonHugo, requete: relais.requete });
    expect(nav.fichiers.f.get(`coffre-${LEA}`)).toBeDefined();
    // Ève (Fondatrice), Max (Administrateur), le Fondateur historique : 403.
    const espaces = espacesDuRelais(liaisonHugo, relais.requete);
    for (const id of [EVE, MAX, 'principal']) await expect(espaces.lire(id, 'coffre')).rejects.toThrow(/ne donne pas accès/);
    await expect(espaces.lire(LEA, 'annuaire')).rejects.toThrow(/ne donne pas accès/);
    // Son retour (conversion) part, et le Fondateur le reprend.
    await synchroniserCompteAmi({ liaison: liaisonHugo, id: HUGO, memoire: nav.mem, fichiers: nav.fichiers, lire: nav.lire, ecrire: nav.ecrire, maintenant: horloge, requete: relais.requete });
    await tour(p, relais);
    expect((await p.lire()).comptes.find(c => c.id === LEA)?.sequestres?.[HUGO]?.etat).toBe('actif');

    // Le Fondateur rétrograde Hugo : plus de délégation, plus de séquestre, projection d'ami.
    const avant = await p.lire();
    await p.ecrire(ouvrirAnnuaireAdmin(changerRang(avant, 'principal', copie(ENZO), HUGO, 'ami').annuaire, copie(ENZO)).annuaire);
    await tour(p, relais);
    await expect(espaces.lire(LEA, 'coffre')).rejects.toThrow(/ne donne pas accès/);
    await synchroniserCompteAmi({ liaison: liaisonHugo, id: HUGO, memoire: nav.mem, fichiers: nav.fichiers, lire: nav.lire, ecrire: nav.ecrire, maintenant: horloge, requete: relais.requete });
    const ici = await nav.lire();
    expect(ici.comptes.map(c => c.id)).toEqual([HUGO]);
    expect(() => ouvrirAnnuaireTitulaire(ici, HUGO, 'Hugo', copie(clesHugo))).toThrow(/ni Administrateur/);
    expect((await p.lire()).comptes.some(c => c.sequestres?.[HUGO])).toBe(false);
  });
});
