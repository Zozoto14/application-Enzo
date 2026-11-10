/**
 * Séquestre PAR RANG : la clé maîtresse de chaque compte est scellée pour
 * chaque titulaire de rang STRICTEMENT supérieur qui possède une paire de
 * séquestre X25519 (Administrateurs et Fondateurs).
 *
 *   Ami, Gestionnaire  → scellés pour les Administrateurs ET les Fondateurs
 *   Administrateur     → scellé pour les Fondateurs seulement
 *   Fondateur          → scellé pour personne
 *
 * Le compte historique (`principal`) est Fondateur : sa paire est celle de
 * toujours (`annuaire.admin`), ses dépôts et enveloppes aussi (`sequestre`).
 * Les autres titulaires ont leur paire dans leur entrée (`titulaire`), leurs
 * dépôts et enveloppes dans `sequestres[<titulaire>]`, et leurs propres codes
 * d'accès dans leur propre bloc privé (`titulaire.prive`, scellé par LEUR clé).
 *
 * Confiance : les rangs de l'annuaire (`acces.role`) ne sont pas protégés en
 * intégrité (le fichier se lit avant tout déverrouillage). Les Fondateurs
 * tiennent donc à part un REGISTRE des titulaires (rang + clé publique
 * CONFIRMÉE), scellé par une clé commune aux Fondateurs, elle-même déposée
 * pour chacun d'eux. Seule une clé du registre reçoit des dépôts, et un
 * Fondateur ne confirme une clé qu'après avoir ouvert le compte concerné et
 * vérifié que sa clé privée y est bien scellée par la clé de ce compte.
 * S'attribuer « administrateur » en retouchant le fichier ne donne donc
 * aucune clé.
 *
 * Tout est pur : l'aléa est injectable, rien n'est stocké ici. Schéma et
 * limites : `docs/hub/sequestre.md` (« Rangs »).
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { aleatoireParDefaut, type SourceAleatoire } from '../securite/aleatoire';
import {
  bytesToHex,
  cleEnveloppeAcces,
  descellerAvecContexte,
  descellerTexte,
  genererCodeAcces,
  genererPaireSequestre,
  ouvrirDepot,
  publiqueDepuisPrivee,
  scellerAvecContexte,
  scellerPourAdmin,
  scellerTexte,
  utf8DepuisOctets,
} from '../securite/sequestre';
import { contexteDerivation, usageDepotTitulaire } from '../session/session';
import { NIVEAU_RANG, type Rang } from '../hub/admin/roles';
import {
  ErreurAnnuaire,
  ajouterCompteGere,
  codeAcces,
  internes,
  lireContenuDepot,
  ouvrirAnnuaireAdmin as ouvrirAnnuaireAdminBase,
  ouvrirSequestre,
  regenererCodeAcces,
  retablirSequestre,
  revoquerSequestre,
  type AccesPublic,
  type Annuaire,
  type ClesAdmin,
  type EntreeCompte,
  type NouveauCompteGere,
  type SequestreCompte,
  type VueAdmin,
} from './annuaire';
import { ID_PRINCIPAL, NOM_INCONNU, type Profil } from './profils';

export { usageDepotTitulaire };

export type RangTitulaire = 'administrateur' | 'fondateur';

export interface EntreeRegistre {
  rang: RangTitulaire;
  /** Clé publique de séquestre CONFIRMÉE ; absente tant que la promotion est en attente. */
  cle?: string;
}
export type Registre = Record<string, EntreeRegistre>;

interface PriveTitulaire {
  noms: Record<string, string>;
  creeLe: Record<string, string>;
  codes: Record<string, { code: string; creeLe: string }>;
}

const usagePriveeTitulaire = (id: string) => `sequestre/cle-privee/${id}`;
const usagePriveTitulaire = (id: string) => `annuaire/prive-titulaire/${id}`;
const usageEnveloppeTitulaire = (titulaire: string, id: string) =>
  titulaire === ID_PRINCIPAL ? internes.usageEnveloppe(id) : `sequestre/enveloppe/${titulaire}/${id}`;
const usagePartage = (id: string) => `fondateurs/partage/${id}`;
const usageRegistre = (id: string) => `fondateurs/registre/${id}`;

// --- Petites briques --------------------------------------------------------------

/** Clés d'usage d'un compte tirées de sa clé maîtresse (mêmes que `Session.cleDerivee`). À effacer. */
export function clesDepuisCle(cle: Uint8Array, id: string): ClesAdmin {
  const derivee = (usage: string) => sha256(concatBytes(utf8ToBytes(contexteDerivation(usage, id)), cle));
  return { annuaire: derivee('annuaire'), sequestre: derivee('sequestre') };
}

function effacerCles(cles: ClesAdmin): void {
  cles.annuaire.fill(0);
  cles.sequestre.fill(0);
}

/** Rang lu dans l'annuaire (le compte historique est toujours Fondateur). */
export function rangFichier(annuaire: Annuaire, id: string): Rang {
  if (id === ID_PRINCIPAL) return 'fondateur';
  return annuaire.comptes.find(c => c.id === id)?.acces.role ?? 'ami';
}

/** Séquestre d'un compte pour un titulaire (« attendu » s'il n'y en a pas). */
export function sequestreDe(entree: EntreeCompte, titulaire: string): SequestreCompte {
  if (titulaire === ID_PRINCIPAL) return entree.sequestre;
  return entree.sequestres?.[titulaire] ?? { etat: 'attendu' };
}

function poserSequestre(entree: EntreeCompte, titulaire: string, sequestre: SequestreCompte | undefined): void {
  if (titulaire === ID_PRINCIPAL) {
    entree.sequestre = sequestre ?? { etat: 'attendu' };
    return;
  }
  const table = { ...(entree.sequestres ?? {}) };
  if (!sequestre || sequestre.etat === 'attendu') delete table[titulaire];
  else table[titulaire] = sequestre;
  if (Object.keys(table).length > 0) entree.sequestres = table;
  else delete entree.sequestres;
}

/** Copie profonde de ce que les rangs modifient. */
function cloner(source: Annuaire): Annuaire {
  return {
    ...source,
    admin: { ...source.admin },
    comptes: source.comptes.map(c => ({
      ...c,
      acces: { ...c.acces },
      sequestre: { ...c.sequestre },
      ...(c.sequestres ? { sequestres: { ...c.sequestres } } : {}),
      ...(c.titulaire ? { titulaire: { ...c.titulaire } } : {}),
    })),
    ...(source.fondateurs ? { fondateurs: { partage: { ...source.fondateurs.partage }, registre: { ...source.fondateurs.registre } } } : {}),
  };
}

function entreeDe(annuaire: Annuaire, id: string): EntreeCompte {
  const e = annuaire.comptes.find(c => c.id === id);
  if (!e) throw new ErreurAnnuaire('Compte introuvable.');
  return e;
}

/** Clé publique de séquestre d'un titulaire, telle que l'annuaire la donne. */
export function publiqueTitulaire(annuaire: Annuaire, titulaire: string): string | undefined {
  return titulaire === ID_PRINCIPAL ? annuaire.admin.cleSequestre : annuaire.comptes.find(c => c.id === titulaire)?.titulaire?.cle;
}

/** Clé privée de séquestre du titulaire (à effacer après usage). */
export function clePriveeTitulaire(annuaire: Annuaire, titulaire: string, cles: ClesAdmin): Uint8Array {
  if (titulaire === ID_PRINCIPAL) return internes.clePrivee(annuaire, cles);
  const paire = annuaire.comptes.find(c => c.id === titulaire)?.titulaire;
  if (!paire?.privee || !paire.cle) {
    throw new ErreurAnnuaire('Pas encore de clé de séquestre pour ce compte : elle est créée à sa prochaine connexion.');
  }
  let privee: Uint8Array;
  try {
    privee = descellerAvecContexte(cles.sequestre, paire.privee, usagePriveeTitulaire(titulaire));
  } catch {
    throw new ErreurAnnuaire('Clé de séquestre illisible avec la clé de ce compte.');
  }
  if (bytesToHex(publiqueDepuisPrivee(privee)) !== paire.cle) {
    privee.fill(0);
    throw new ErreurAnnuaire('Clé publique de séquestre incohérente : annuaire modifié hors de l’app.');
  }
  return privee;
}

// --- Bloc privé d'un titulaire (autre que le compte historique) -------------------------

const priveVide = (): PriveTitulaire => ({ noms: {}, creeLe: {}, codes: {} });

function lirePriveTitulaire(annuaire: Annuaire, titulaire: string, cles: ClesAdmin): PriveTitulaire {
  const scelle = annuaire.comptes.find(c => c.id === titulaire)?.titulaire?.prive;
  if (!scelle) return priveVide();
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(descellerTexte(cles.annuaire, scelle, usagePriveTitulaire(titulaire))) as Record<string, unknown>;
  } catch {
    throw new ErreurAnnuaire('Bloc privé du titulaire illisible avec cette clé.');
  }
  const dict = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  const prive = priveVide();
  for (const [id, nom] of Object.entries(dict(o.noms))) if (internes.MOTIF_ID.test(id) && typeof nom === 'string' && nom.trim() && nom !== NOM_INCONNU) prive.noms[id] = nom.slice(0, 30);
  for (const [id, d] of Object.entries(dict(o.creeLe))) if (internes.MOTIF_ID.test(id) && typeof d === 'string') prive.creeLe[id] = d.slice(0, 40);
  for (const [id, c] of Object.entries(dict(o.codes))) {
    const code = dict(c);
    if (internes.MOTIF_ID.test(id) && typeof code.code === 'string' && typeof code.creeLe === 'string') prive.codes[id] = { code: code.code, creeLe: code.creeLe };
  }
  return prive;
}

function ecrirePriveTitulaire(annuaire: Annuaire, titulaire: string, prive: PriveTitulaire, cles: ClesAdmin, alea: SourceAleatoire): void {
  const e = entreeDe(annuaire, titulaire);
  e.titulaire = { ...(e.titulaire ?? {}), prive: scellerTexte(cles.annuaire, JSON.stringify(prive), usagePriveTitulaire(titulaire), alea) };
}

/** Codes d'accès et prénoms connus d'un titulaire. */
function carnetTitulaire(annuaire: Annuaire, titulaire: string, cles: ClesAdmin): PriveTitulaire {
  if (titulaire === ID_PRINCIPAL) {
    const prive = internes.lirePrive(annuaire, cles);
    return { noms: prive.noms, creeLe: prive.creeLe, codes: prive.codes };
  }
  return lirePriveTitulaire(annuaire, titulaire, cles);
}

// --- Registre des Fondateurs ------------------------------------------------------------

function cleCommune(annuaire: Annuaire, titulaire: string, privee: Uint8Array): Uint8Array | undefined {
  const depot = annuaire.fondateurs?.partage[titulaire];
  if (!depot) return undefined;
  try {
    const cle = ouvrirDepot(privee, depot, usagePartage(titulaire));
    return cle.length === 32 ? cle : undefined;
  } catch {
    return undefined;
  }
}

export function lireRegistre(annuaire: Annuaire, commune: Uint8Array): Registre {
  const registre: Registre = {};
  for (const [id, scelle] of Object.entries(annuaire.fondateurs?.registre ?? {})) {
    try {
      const o = JSON.parse(descellerTexte(commune, scelle, usageRegistre(id))) as Record<string, unknown>;
      if (o.rang !== 'administrateur' && o.rang !== 'fondateur') continue;
      const entree: EntreeRegistre = { rang: o.rang };
      if (typeof o.cle === 'string' && /^[0-9a-f]{64}$/.test(o.cle)) entree.cle = o.cle;
      registre[id] = entree;
    } catch {
      // Scellé illisible (fichier retouché) : ignoré, comme s'il n'existait pas.
    }
  }
  if (registre[ID_PRINCIPAL]) registre[ID_PRINCIPAL].rang = 'fondateur';
  return registre;
}

function poserRegistre(annuaire: Annuaire, commune: Uint8Array, id: string, entree: EntreeRegistre | undefined, alea: SourceAleatoire): void {
  const bloc = annuaire.fondateurs ?? { partage: {}, registre: {} };
  annuaire.fondateurs = bloc;
  if (entree) bloc.registre[id] = scellerTexte(commune, JSON.stringify(entree), usageRegistre(id), alea);
  else delete bloc.registre[id];
}

/** Rang qui fait foi pour un compte : celui du registre, sinon Gestionnaire/Ami du fichier. */
function rangConfirme(annuaire: Annuaire, registre: Registre, id: string): Rang {
  if (id === ID_PRINCIPAL) return 'fondateur';
  if (registre[id]) return registre[id].rang;
  const role = annuaire.comptes.find(c => c.id === id)?.acces.role;
  return role === 'gestionnaire' ? 'gestionnaire' : 'ami';
}

// --- Étapes d'un Fondateur ----------------------------------------------------------------

export interface ResultatEtapes {
  annuaire: Annuaire;
  modifie: boolean;
  /** Titulaires dont la paire n'a pas encore pu être créée ou confirmée, ou pour qui un re-scellement attend. */
  enAttente: string[];
  /** Titulaires dont la paire n'a pas encore pu être créée ou confirmée. */
  pairesEnAttente: string[];
  registre?: Registre;
}

/**
 * Ce qu'un Fondateur déverrouillé fait à chaque ouverture de l'annuaire :
 *  1. crée au besoin la clé commune et le registre (compte historique) ;
 *  2. confirme — ou crée — la paire des titulaires qu'il peut ouvrir ;
 *  3. retire tout dépôt qui ne respecte plus la règle des rangs (titulaire
 *     rétrogradé, compte devenu Fondateur, clé changée) ;
 *  4. re-scelle pour chaque titulaire confirmé la clé des comptes de rang
 *     strictement inférieur qu'il peut lui-même ouvrir (dépôt ECIES, avec le
 *     prénom : le titulaire le convertit en enveloppe à SA prochaine ouverture).
 */
export function etapesFondateur(
  source: Annuaire,
  titulaire: string,
  cles: ClesAdmin,
  alea: SourceAleatoire = aleatoireParDefaut,
  maintenantIso = new Date().toISOString(),
): ResultatEtapes {
  const inchange: ResultatEtapes = { annuaire: source, modifie: false, enAttente: [], pairesEnAttente: [] };
  if (source.heritage || source.restreint) return inchange;
  const a = cloner(source);
  let modifie = false;
  let privee: Uint8Array;
  try {
    privee = clePriveeTitulaire(a, titulaire, cles);
  } catch {
    return inchange;
  }
  const ouvertes = new Map<string, Uint8Array>();
  let commune = cleCommune(a, titulaire, privee);
  try {
    let registre: Registre;
    if (!commune) {
      if (titulaire !== ID_PRINCIPAL || a.fondateurs || !a.admin.cleSequestre) {
        return inchange;
      }
      // Première fois : le compte historique crée la clé commune et s'inscrit au registre.
      commune = alea(32);
      a.fondateurs = { partage: { [ID_PRINCIPAL]: scellerPourAdmin(a.admin.cleSequestre, commune, usagePartage(ID_PRINCIPAL), alea) }, registre: {} };
      registre = {};
      modifie = true;
    } else {
      registre = lireRegistre(a, commune);
    }
    if (titulaire === ID_PRINCIPAL && registre[ID_PRINCIPAL]?.cle !== a.admin.cleSequestre) {
      registre[ID_PRINCIPAL] = { rang: 'fondateur', cle: a.admin.cleSequestre };
      poserRegistre(a, commune, ID_PRINCIPAL, registre[ID_PRINCIPAL], alea);
      modifie = true;
    }
    if (titulaire !== ID_PRINCIPAL && registre[titulaire]?.rang !== 'fondateur') {
      return inchange;
    }

    const carnet = carnetTitulaire(a, titulaire, cles);
    const ouvrir = (e: EntreeCompte): Uint8Array | undefined => {
      const deja = ouvertes.get(e.id);
      if (deja) return deja;
      const s = sequestreDe(e, titulaire);
      const code = carnet.codes[e.id]?.code;
      if (s.etat !== 'actif' || !s.enveloppe || !code) return undefined;
      try {
        const cle = descellerAvecContexte(cleEnveloppeAcces(privee, e.id, code), s.enveloppe, usageEnveloppeTitulaire(titulaire, e.id));
        ouvertes.set(e.id, cle);
        return cle;
      } catch {
        return undefined;
      }
    };
    const enAttente: string[] = [];
    const pairesEnAttente: string[] = [];

    // 2. Paires des titulaires : le registre fait foi pour le rang ; la clé est confirmée en ouvrant le compte.
    for (const [id, rec] of Object.entries({ ...registre })) {
      if (id === ID_PRINCIPAL) continue;
      const e = a.comptes.find(c => c.id === id);
      if (!e) {
        delete registre[id];
        poserRegistre(a, commune, id, undefined, alea);
        modifie = true;
        continue;
      }
      if (e.acces.role !== rec.rang) {
        e.acces.role = rec.rang;
        modifie = true;
      }
      if (rec.cle && e.titulaire?.cle === rec.cle) continue;
      const cle = ouvrir(e);
      if (!cle) {
        enAttente.push(id);
        pairesEnAttente.push(id);
        continue;
      }
      const clesE = clesDepuisCle(cle, id);
      try {
        let publique: string | undefined;
        if (e.titulaire?.privee && e.titulaire.cle) {
          try {
            const p = descellerAvecContexte(clesE.sequestre, e.titulaire.privee, usagePriveeTitulaire(id));
            if (bytesToHex(publiqueDepuisPrivee(p)) === e.titulaire.cle) publique = e.titulaire.cle;
            p.fill(0);
          } catch {
            publique = undefined;
          }
        }
        if (!publique) {
          // La paire est créée ici, scellée par la clé du compte promu (que ce Fondateur vient d'ouvrir).
          const paire = genererPaireSequestre(alea);
          publique = bytesToHex(paire.publique);
          e.titulaire = { ...(e.titulaire?.prive ? { prive: e.titulaire.prive } : {}), cle: publique, privee: scellerAvecContexte(clesE.sequestre, paire.privee, usagePriveeTitulaire(id), alea) };
          paire.privee.fill(0);
        }
        if (rec.cle && rec.cle !== publique) {
          // Nouvelle clé : les dépôts faits pour l'ancienne ne s'ouvrent plus.
          for (const c of a.comptes) poserSequestre(c, id, undefined);
        }
        registre[id] = { rang: rec.rang, cle: publique };
        poserRegistre(a, commune, id, registre[id], alea);
        modifie = true;
      } finally {
        effacerCles(clesE);
      }
    }
    // Rang « administrateur » ou « fondateur » du fichier sans inscription au registre : retouché, ou retiré ailleurs.
    for (const e of a.comptes) {
      if ((e.acces.role === 'administrateur' || e.acces.role === 'fondateur') && !registre[e.id]) {
        delete e.acces.role;
        modifie = true;
      }
    }
    // Les Fondateurs confirmés reçoivent la clé commune.
    for (const [id, rec] of Object.entries(registre)) {
      if (rec.rang === 'fondateur' && rec.cle && !a.fondateurs!.partage[id]) {
        a.fondateurs!.partage[id] = scellerPourAdmin(rec.cle, commune, usagePartage(id), alea);
        modifie = true;
      }
    }
    for (const id of Object.keys(a.fondateurs!.partage)) {
      if (registre[id]?.rang !== 'fondateur') {
        delete a.fondateurs!.partage[id];
        modifie = true;
      }
    }

    // 3. Nettoyage : un dépôt n'existe que pour un titulaire confirmé, de rang strictement supérieur.
    for (const e of a.comptes) {
      const rangE = rangConfirme(a, registre, e.id);
      for (const h of Object.keys(e.sequestres ?? {})) {
        const r = registre[h];
        if (!r?.cle || h === e.id || NIVEAU_RANG[rangE] >= NIVEAU_RANG[r.rang] || !a.comptes.some(c => c.id === h)) {
          poserSequestre(e, h, undefined);
          modifie = true;
        }
      }
      if (rangE === 'fondateur' && e.sequestre.etat !== 'revoque') {
        // Un Fondateur n'est scellé pour personne, pas même pour le compte historique.
        e.sequestre = { etat: 'revoque' };
        modifie = true;
      }
      if (e.titulaire && !registre[e.id]) {
        // Rétrogradé : sa paire disparaît (ses dépôts aussi, ci-dessus).
        delete e.titulaire;
        modifie = true;
      }
    }

    // 4. Re-scellement pour chaque titulaire confirmé.
    for (const [h, r] of Object.entries(registre)) {
      if (!r.cle) continue;
      for (const e of a.comptes) {
        if (e.id === h || NIVEAU_RANG[rangConfirme(a, registre, e.id)] >= NIVEAU_RANG[r.rang]) continue;
        if (sequestreDe(e, h).etat !== 'attendu') continue;
        const cle = ouvrir(e);
        if (!cle) {
          if (!enAttente.includes(h)) enAttente.push(h);
          continue;
        }
        const nom = carnet.noms[e.id];
        const contenu = utf8ToBytes(JSON.stringify({ k: bytesToHex(cle), ...(nom ? { nom } : {}), ...(carnet.creeLe[e.id] ? { creeLe: carnet.creeLe[e.id] } : {}) }));
        poserSequestre(e, h, { etat: 'depose', depot: scellerPourAdmin(r.cle, contenu, usageDepotTitulaire(h, e.id), alea) });
        contenu.fill(0);
        modifie = true;
      }
    }
    void maintenantIso;
    return { annuaire: modifie ? a : source, modifie, enAttente, pairesEnAttente, registre };
  } finally {
    privee.fill(0);
    commune?.fill(0);
    for (const cle of ouvertes.values()) cle.fill(0);
  }
}

/** Registre lisible par ce Fondateur (rien pour un autre rang). */
export function registreDe(annuaire: Annuaire, titulaire: string, cles: ClesAdmin): Registre | undefined {
  let privee: Uint8Array;
  try {
    privee = clePriveeTitulaire(annuaire, titulaire, cles);
  } catch {
    return undefined;
  }
  try {
    const commune = cleCommune(annuaire, titulaire, privee);
    if (!commune) return undefined;
    try {
      return lireRegistre(annuaire, commune);
    } finally {
      commune.fill(0);
    }
  } finally {
    privee.fill(0);
  }
}

function etatTitulaire(annuaire: Annuaire, registre: Registre | undefined, id: string): Profil['titulaire'] {
  const e = annuaire.comptes.find(c => c.id === id);
  if (!e || (e.acces.role !== 'administrateur' && e.acces.role !== 'fondateur')) return undefined;
  const rec = registre?.[id];
  return rec?.cle && e.titulaire?.cle === rec.cle ? 'actif' : 'en-attente';
}

// --- Ouverture de l'annuaire par un titulaire --------------------------------------------

/**
 * Compte historique (Fondateur) : l'ouverture d'avant (migration, séquestres,
 * gestionnaires), puis les étapes des Fondateurs. Rend TOUS les comptes
 * (les autres Fondateurs y figurent, mais la règle des rangs interdit d'agir sur eux).
 */
export function ouvrirAnnuaireAdmin(source: Annuaire, cles: ClesAdmin, alea: SourceAleatoire = aleatoireParDefaut, maintenantIso = new Date().toISOString()): VueAdmin {
  const v1 = ouvrirAnnuaireAdminBase(source, cles, alea, maintenantIso);
  const etapes = etapesFondateur(v1.annuaire, ID_PRINCIPAL, cles, alea, maintenantIso);
  const v2 = etapes.modifie ? ouvrirAnnuaireAdminBase(etapes.annuaire, cles, alea, maintenantIso) : v1;
  const registre = etapes.registre ?? registreDe(v2.annuaire, ID_PRINCIPAL, cles);
  return {
    ...v2,
    modifie: v1.modifie || etapes.modifie || v2.modifie,
    evenementsGestion: v2 === v1 ? v1.evenementsGestion : [...v1.evenementsGestion, ...v2.evenementsGestion],
    profils: v2.profils.map(p => {
      const etat = p.admin ? undefined : etatTitulaire(v2.annuaire, registre, p.id);
      return etat ? { ...p, titulaire: etat } : p;
    }),
  };
}

/**
 * Administrateur ou Fondateur (autre que le compte historique) déverrouillé :
 * crée sa paire si elle manque (confirmée ensuite par un Fondateur), convertit
 * les dépôts reçus en enveloppes protégées par SES codes d'accès, et — s'il
 * est Fondateur, sur un appareil qui a l'annuaire complet — fait les étapes
 * des Fondateurs. Rend son compte et les comptes de rang strictement inférieur.
 */
export function ouvrirAnnuaireTitulaire(
  source: Annuaire,
  titulaire: string,
  nom: string,
  cles: ClesAdmin,
  alea: SourceAleatoire = aleatoireParDefaut,
  maintenantIso = new Date().toISOString(),
): VueAdmin & { enAttente: string[] } {
  if (source.heritage) {
    throw new ErreurAnnuaire('Annuaire à migrer : le Fondateur doit d’abord ouvrir son compte.');
  }
  const rang = rangFichier(source, titulaire);
  if (titulaire === ID_PRINCIPAL || (rang !== 'administrateur' && rang !== 'fondateur')) {
    throw new ErreurAnnuaire('Ce compte n’est ni Administrateur ni Fondateur.');
  }
  let a = cloner(source);
  let modifie = false;
  const soi = entreeDe(a, titulaire);

  // Sa paire : relue, ou créée (en attente de confirmation par un Fondateur).
  let privee: Uint8Array | undefined;
  if (soi.titulaire?.privee && soi.titulaire.cle) {
    try {
      privee = clePriveeTitulaire(a, titulaire, cles);
    } catch {
      privee = undefined;
    }
  }
  let prive: PriveTitulaire;
  try {
    prive = lirePriveTitulaire(a, titulaire, cles);
  } catch {
    prive = priveVide();
    modifie = true;
  }
  if (!privee) {
    const paire = genererPaireSequestre(alea);
    soi.titulaire = { cle: bytesToHex(paire.publique), privee: scellerAvecContexte(cles.sequestre, paire.privee, usagePriveeTitulaire(titulaire), alea) };
    privee = paire.privee;
    // Les dépôts faits pour une ancienne paire ne s'ouvrent plus : un Fondateur re-scellera.
    for (const c of a.comptes) poserSequestre(c, titulaire, undefined);
    prive.codes = {};
    modifie = true;
  }

  try {
    // Dépôts reçus → enveloppes protégées par SES codes d'accès.
    for (const e of a.comptes) {
      const s = e.sequestres?.[titulaire];
      if (s?.etat !== 'depose' || !s.depot) continue;
      let cle: Uint8Array | undefined;
      try {
        const depot = lireContenuDepot(ouvrirDepot(privee, s.depot, usageDepotTitulaire(titulaire, e.id)));
        cle = depot.cle;
        const code = prive.codes[e.id]?.code ?? genererCodeAcces(alea);
        poserSequestre(e, titulaire, { etat: 'actif', enveloppe: scellerAvecContexte(cleEnveloppeAcces(privee, e.id, code), cle, usageEnveloppeTitulaire(titulaire, e.id), alea) });
        prive.codes[e.id] = { code, creeLe: prive.codes[e.id]?.creeLe ?? maintenantIso };
        if (depot.nom) prive.noms[e.id] = depot.nom;
        if (depot.creeLe) prive.creeLe[e.id] = depot.creeLe;
      } catch {
        poserSequestre(e, titulaire, undefined);
      } finally {
        cle?.fill(0);
      }
      modifie = true;
    }
    // Rien de son bloc ne survit à un compte disparu ou qui n'est plus inférieur.
    const presents = new Set(a.comptes.filter(c => c.id !== titulaire).map(c => c.id));
    for (const table of [prive.noms, prive.creeLe, prive.codes] as Array<Record<string, unknown>>) {
      for (const id of Object.keys(table)) {
        if (!presents.has(id)) {
          delete table[id];
          modifie = true;
        }
      }
    }
    for (const id of Object.keys(prive.codes)) {
      if (sequestreDe(entreeDe(a, id), titulaire).etat !== 'actif') {
        delete prive.codes[id];
        modifie = true;
      }
    }
    if (modifie) ecrirePriveTitulaire(a, titulaire, prive, cles, alea);
  } finally {
    privee.fill(0);
  }

  let enAttente: string[] = [];
  let registre: Registre | undefined;
  if (rang === 'fondateur' && !a.restreint) {
    const etapes = etapesFondateur(a, titulaire, cles, alea, maintenantIso);
    a = etapes.annuaire;
    modifie ||= etapes.modifie;
    enAttente = etapes.enAttente;
    registre = etapes.registre;
  }

  const moi = entreeDe(a, titulaire);
  const profils: Profil[] = [
    { id: titulaire, nom, admin: false, creeLe: '', ...moi.acces },
    ...a.comptes
      .filter(e => e.id !== titulaire && NIVEAU_RANG[e.acces.role ?? 'ami'] < NIVEAU_RANG[rang])
      .map(e => {
        const profil: Profil = {
          id: e.id,
          nom: prive.noms[e.id] ?? NOM_INCONNU,
          ...(prive.noms[e.id] === undefined ? { nomInconnu: true } : {}),
          admin: false,
          creeLe: prive.creeLe[e.id] ?? '',
          ...e.acces,
          anterieur: true,
          sequestre: sequestreDe(e, titulaire).etat,
        };
        const etat = etatTitulaire(a, registre, e.id);
        if (etat) profil.titulaire = etat;
        return profil;
      }),
  ];
  return { annuaire: modifie ? a : source, profils, modifie, evenementsGestion: [], enAttente };
}

/** Ouvre l'annuaire pour n'importe quel titulaire (compte historique compris). */
export function ouvrirAnnuairePour(source: Annuaire, titulaire: string, nom: string, cles: ClesAdmin, alea?: SourceAleatoire, maintenantIso?: string): VueAdmin {
  return titulaire === ID_PRINCIPAL ? ouvrirAnnuaireAdmin(source, cles, alea, maintenantIso) : ouvrirAnnuaireTitulaire(source, titulaire, nom, cles, alea, maintenantIso);
}

// --- Séquestre, vu d'un titulaire ----------------------------------------------------------

/** Vérifie que `titulaire` est strictement au-dessus du compte `id` (rangs de l'annuaire). */
function exigerSuperieur(annuaire: Annuaire, titulaire: string, id: string): void {
  if (id === ID_PRINCIPAL || id === titulaire) {
    throw new ErreurAnnuaire('Action impossible sur ce compte.');
  }
  if (NIVEAU_RANG[rangFichier(annuaire, id)] >= NIVEAU_RANG[rangFichier(annuaire, titulaire)]) {
    throw new ErreurAnnuaire(rangFichier(annuaire, id) === 'fondateur' ? 'Action impossible sur un Fondateur.' : 'Action impossible sur un compte de rang égal ou supérieur.');
  }
}

export function codeAccesTitulaire(annuaire: Annuaire, titulaire: string, cles: ClesAdmin, id: string): { code: string; creeLe: string } | undefined {
  exigerSuperieur(annuaire, titulaire, id);
  if (titulaire === ID_PRINCIPAL) return codeAcces(annuaire, id, cles);
  return lirePriveTitulaire(annuaire, titulaire, cles).codes[id];
}

/**
 * Relit la clé maîtresse d'un compte avec le code d'accès PROPRE à ce
 * titulaire. Lève si le compte n'est pas strictement inférieur, si le
 * séquestre de ce titulaire est absent ou révoqué, ou si le code est faux.
 */
export function ouvrirSequestreTitulaire(annuaire: Annuaire, titulaire: string, cles: ClesAdmin, id: string, code: string): Uint8Array {
  exigerSuperieur(annuaire, titulaire, id);
  if (titulaire === ID_PRINCIPAL) return ouvrirSequestre(annuaire, id, code, cles);
  const s = sequestreDe(entreeDe(annuaire, id), titulaire);
  if (s.etat !== 'actif' || !s.enveloppe) {
    throw new ErreurAnnuaire(
      s.etat === 'revoque' ? 'Votre accès à ce compte est révoqué.' : 'Pas encore de séquestre pour vous : il est re-scellé à la prochaine connexion d’un Fondateur.',
    );
  }
  const privee = clePriveeTitulaire(annuaire, titulaire, cles);
  try {
    return descellerAvecContexte(cleEnveloppeAcces(privee, id, code), s.enveloppe, usageEnveloppeTitulaire(titulaire, id));
  } catch {
    throw new ErreurAnnuaire('Code d’accès incorrect.');
  } finally {
    privee.fill(0);
  }
}

export function regenererCodeTitulaire(
  annuaire: Annuaire,
  titulaire: string,
  cles: ClesAdmin,
  id: string,
  alea: SourceAleatoire = aleatoireParDefaut,
  maintenantIso = new Date().toISOString(),
): { annuaire: Annuaire; code: string } {
  exigerSuperieur(annuaire, titulaire, id);
  if (titulaire === ID_PRINCIPAL) return regenererCodeAcces(annuaire, id, cles, alea, maintenantIso);
  const prive = lirePriveTitulaire(annuaire, titulaire, cles);
  const ancien = prive.codes[id];
  if (!ancien) throw new ErreurAnnuaire('Aucun code d’accès pour ce compte.');
  const cle = ouvrirSequestreTitulaire(annuaire, titulaire, cles, id, ancien.code);
  const privee = clePriveeTitulaire(annuaire, titulaire, cles);
  try {
    const a = cloner(annuaire);
    const code = genererCodeAcces(alea);
    poserSequestre(entreeDe(a, id), titulaire, { etat: 'actif', enveloppe: scellerAvecContexte(cleEnveloppeAcces(privee, id, code), cle, usageEnveloppeTitulaire(titulaire, id), alea) });
    prive.codes[id] = { code, creeLe: maintenantIso };
    ecrirePriveTitulaire(a, titulaire, prive, cles, alea);
    return { annuaire: a, code };
  } finally {
    cle.fill(0);
    privee.fill(0);
  }
}

export function revoquerSequestreTitulaire(annuaire: Annuaire, titulaire: string, cles: ClesAdmin, id: string, alea: SourceAleatoire = aleatoireParDefaut): Annuaire {
  exigerSuperieur(annuaire, titulaire, id);
  if (titulaire === ID_PRINCIPAL) return revoquerSequestre(annuaire, id, cles, alea);
  const a = cloner(annuaire);
  const prive = lirePriveTitulaire(a, titulaire, cles);
  delete prive.codes[id];
  poserSequestre(entreeDe(a, id), titulaire, { etat: 'revoque' });
  ecrirePriveTitulaire(a, titulaire, prive, cles, alea);
  return a;
}

export function retablirSequestreTitulaire(annuaire: Annuaire, titulaire: string, id: string): Annuaire {
  exigerSuperieur(annuaire, titulaire, id);
  if (titulaire === ID_PRINCIPAL) return retablirSequestre(annuaire, id);
  const a = cloner(annuaire);
  const e = entreeDe(a, id);
  if (sequestreDe(e, titulaire).etat === 'revoque') poserSequestre(e, titulaire, undefined);
  return a;
}

// --- Changer le rang --------------------------------------------------------------------

export interface ResultatRang {
  annuaire: Annuaire;
  /** Promotion faite, mais la paire du promu n'a pas encore pu être créée : à sa prochaine connexion. */
  enAttente: boolean;
}

/**
 * Change le rang de `cible`. Gestionnaire/Ami entre eux : tout titulaire de
 * rang supérieur. Administrateur ou Fondateur (promotion ou rétrogradation) :
 * un Fondateur seulement — le registre est mis à jour, la paire du promu
 * créée et les comptes inférieurs re-scellés pour lui (s'il est ouvrable),
 * ou, à la rétrogradation, tous ses dépôts et sa paire supprimés.
 *
 * Rétrograder n'efface pas ce que l'ancien titulaire a déjà pu lire : voir
 * « Rétrogradation » dans `docs/hub/sequestre.md` (régénérer les identifiants
 * des comptes concernés).
 */
export function changerRang(
  source: Annuaire,
  acteur: string,
  cles: ClesAdmin,
  cible: string,
  rang: Rang,
  alea: SourceAleatoire = aleatoireParDefaut,
  maintenantIso = new Date().toISOString(),
): ResultatRang {
  if (source.heritage) throw new ErreurAnnuaire('Annuaire à migrer : le Fondateur doit d’abord ouvrir son compte.');
  exigerSuperieur(source, acteur, cible);
  const rangActeur = rangFichier(source, acteur);
  const avant = rangFichier(source, cible);
  const titulaires = (r: Rang) => r === 'administrateur' || r === 'fondateur';
  if (rangActeur !== 'fondateur' && (titulaires(rang) || titulaires(avant))) {
    throw new ErreurAnnuaire('Seul un Fondateur nomme ou rétrograde un Administrateur ou un Fondateur.');
  }
  if (NIVEAU_RANG[rang] >= NIVEAU_RANG[rangActeur] && rang !== 'fondateur') {
    throw new ErreurAnnuaire('Rang non attribuable.');
  }
  const a = cloner(source);
  const e = entreeDe(a, cible);
  if (!titulaires(rang) && !titulaires(avant)) {
    if (rang === 'ami') delete e.acces.role;
    else e.acces.role = rang as AccesPublic['role'];
    return { annuaire: a, enAttente: false };
  }
  // Promotion ou rétrogradation d'un titulaire : le registre des Fondateurs.
  const privee = clePriveeTitulaire(a, acteur, cles);
  const commune = cleCommune(a, acteur, privee);
  privee.fill(0);
  if (!commune) {
    throw new ErreurAnnuaire('Registre des Fondateurs illisible sur cet appareil : ouvrez d’abord votre compte sur l’appareil qui a l’annuaire complet.');
  }
  try {
    const registre = lireRegistre(a, commune);
    if (titulaires(rang)) {
      const precedent = registre[cible];
      poserRegistre(a, commune, cible, { rang: rang as RangTitulaire, ...(precedent?.cle ? { cle: precedent.cle } : {}) }, alea);
      e.acces.role = rang as AccesPublic['role'];
    } else {
      poserRegistre(a, commune, cible, undefined, alea);
      delete a.fondateurs?.partage[cible];
      delete e.titulaire;
      for (const c of a.comptes) poserSequestre(c, cible, undefined);
      if (rang === 'ami') delete e.acces.role;
      else e.acces.role = rang as AccesPublic['role'];
    }
  } finally {
    commune.fill(0);
  }
  const etapes = etapesFondateur(a, acteur, cles, alea, maintenantIso);
  return { annuaire: etapes.annuaire, enAttente: titulaires(rang) && etapes.pairesEnAttente.includes(cible) };
}

// --- Gestion des comptes par un titulaire autre que le compte historique ------------------

/**
 * Compte créé par un Administrateur ou un Fondateur (autre que le compte
 * historique) : comme pour un gestionnaire, le prénom part scellé pour le
 * compte historique ; la clé du nouveau compte est déposée pour lui ET pour
 * le créateur (les autres titulaires la reçoivent d'un Fondateur).
 */
export function ajouterCompteParTitulaire(
  source: Annuaire,
  nouveau: NouveauCompteGere,
  depots: { principal: string; titulaire: string },
  maintenantIso: string,
  alea: SourceAleatoire = aleatoireParDefaut,
): Annuaire {
  const rang = rangFichier(source, nouveau.gestionnaireId);
  if (rang !== 'administrateur' && rang !== 'fondateur') throw new ErreurAnnuaire('Ce compte n’est ni Administrateur ni Fondateur.');
  const a = ajouterCompteGere(source, nouveau, maintenantIso, alea);
  return {
    ...a,
    comptes: a.comptes.map(c =>
      c.id === nouveau.id ? { ...c, sequestre: { etat: 'depose', depot: depots.principal }, sequestres: { [nouveau.gestionnaireId]: { etat: 'depose', depot: depots.titulaire } } } : c,
    ),
  };
}

/** Identifiants régénérés par un titulaire : ses dépôts et celui du compte historique ; tout autre séquestre est périmé. */
export function regenererSequestres(source: Annuaire, titulaire: string, id: string, depots: { principal?: string; titulaire?: string }): Annuaire {
  exigerSuperieur(source, titulaire, id);
  const a = cloner(source);
  const e = entreeDe(a, id);
  e.sequestre = depots.principal ? { etat: 'depose', depot: depots.principal } : { etat: 'attendu' };
  delete e.sequestres;
  delete e.titulaire;
  if (titulaire !== ID_PRINCIPAL && depots.titulaire) poserSequestre(e, titulaire, { etat: 'depose', depot: depots.titulaire });
  return a;
}

/**
 * Règles d'accès modifiées par un titulaire : seulement les comptes de rang
 * strictement inférieur, seulement `acces` (ni rang, ni prénom, ni séquestre).
 */
export function appliquerAccesParTitulaire(source: Annuaire, titulaire: string, modifies: readonly Profil[]): Annuaire {
  const parId = new Map(modifies.map(p => [p.id, p]));
  for (const id of parId.keys()) exigerSuperieur(source, titulaire, id);
  return {
    ...source,
    comptes: source.comptes.map(c => {
      const p = parId.get(c.id);
      if (!p) return c;
      const acces = internes.accesDe({ ...p, role: c.acces.role });
      return { ...c, acces };
    }),
  };
}

/** Suppression d'un compte de rang strictement inférieur par un titulaire. */
export function supprimerCompteParTitulaire(source: Annuaire, titulaire: string, id: string): Annuaire {
  exigerSuperieur(source, titulaire, id);
  return { ...source, comptes: source.comptes.filter(c => c.id !== id) };
}

/** Utilitaire des tests et de l'inspection : ce qu'un titulaire peut ouvrir (identifiants). */
export function comptesScellesPour(annuaire: Annuaire, titulaire: string): string[] {
  return annuaire.comptes.filter(c => (titulaire === ID_PRINCIPAL ? c.sequestre.etat : c.sequestres?.[titulaire]?.etat) === 'actif' || (titulaire === ID_PRINCIPAL ? c.sequestre.etat : c.sequestres?.[titulaire]?.etat) === 'depose').map(c => c.id);
}

/** Lecture d'un dépôt ou d'une enveloppe non nécessaire ailleurs : réexport pour les tests. */
export const pourTests = { usagePriveeTitulaire, usageEnveloppeTitulaire, utf8DepuisOctets };
