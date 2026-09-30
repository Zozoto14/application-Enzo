/**
 * L'annuaire des comptes voyage entre les appareils de l'administrateur.
 *
 * Le fichier `profils` est découpé en petites entrées fusionnées « dernier
 * gagnant » (fusionLww.ts) : `sel`, `admin`, `admin-connexion`, `politique`,
 * `prive` (bloc scellé pour l'administrateur), `gestion` (actions de
 * gestionnaires en attente), et par compte `compte:<id>` (empreinte, prénom
 * scellé, accès), `sequestre:<id>`, `suivi:<id>`, `creation:<id>`. Une
 * suppression de compte voyage comme une pierre tombale datée de
 * `compte:<id>`.
 *
 * Rien ici n'est en clair : empreintes salées, blocs scellés, règles d'accès
 * et politique des apps. Ce document ne se dépose QUE dans l'espace de
 * l'administrateur (`p/principal/`), lisible avec le seul jeton maître.
 *
 * Un ami, lui, ne reçoit que sa PROJECTION (`projectionAmi`) : son entrée,
 * le sel, la politique des apps et la clé publique de séquestre.
 */

import {
  fusionnerBlocsPrives,
  lireAnnuaire,
  type Annuaire,
  type ClesAdmin,
  type EntreeCompte,
} from './annuaire';
import { fusionner, noterLocal, type DocumentLww, type EtatLww, type ResultatLww, type Valeurs } from '../sync/relais/fusionLww';
import type { SourceAleatoire } from '../securite/aleatoire';


/** L'annuaire, découpé en entrées. Un annuaire à migrer (formats 1 et 2) ne se découpe pas. */
export function entitesAnnuaire(annuaire: Annuaire): Valeurs {
  if (annuaire.heritage) {
    throw new Error('Annuaire à migrer : l’administrateur doit d’abord ouvrir son compte.');
  }
  const e: Valeurs = {};
  if (annuaire.sel) e.sel = annuaire.sel;
  const { derniereConnexion, ...admin } = annuaire.admin;
  if (Object.keys(admin).length > 0) e.admin = admin;
  if (derniereConnexion) e['admin-connexion'] = derniereConnexion;
  if (annuaire.politique) e.politique = annuaire.politique;
  if (annuaire.prive) e.prive = annuaire.prive;
  if (annuaire.journalGestion?.length) e.gestion = annuaire.journalGestion;
  for (const c of annuaire.comptes) {
    e[`compte:${c.id}`] = { empreinte: c.empreinte, nom: c.nom, acces: c.acces };
    e[`sequestre:${c.id}`] = c.sequestre;
    if (c.suivi) e[`suivi:${c.id}`] = c.suivi;
    if (c.creation) e[`creation:${c.id}`] = c.creation;
  }
  return e;
}

/**
 * Recompose l'annuaire. L'ordre des comptes suit `ordre` (celui d'ici), les
 * nouveaux venus à la suite. Tout repasse par `lireAnnuaire` : ce qui vient
 * du relais est validé comme un fichier local.
 */
export function annuaireDepuisEntites(e: Valeurs, ordre: readonly string[] = []): Annuaire {
  const ids = Object.keys(e)
    .filter(cle => cle.startsWith('compte:'))
    .map(cle => cle.slice('compte:'.length));
  ids.sort((a, b) => {
    const ia = ordre.indexOf(a);
    const ib = ordre.indexOf(b);
    return ia === -1 && ib === -1 ? (a < b ? -1 : 1) : ia === -1 ? 1 : ib === -1 ? -1 : ia - ib;
  });
  const comptes = ids.map(id => {
    const base = e[`compte:${id}`] as Partial<EntreeCompte>;
    return {
      id,
      empreinte: base?.empreinte,
      nom: base?.nom,
      acces: base?.acces,
      sequestre: e[`sequestre:${id}`] ?? { etat: 'attendu' },
      ...(e[`suivi:${id}`] ? { suivi: e[`suivi:${id}`] } : {}),
      ...(e[`creation:${id}`] ? { creation: e[`creation:${id}`] } : {}),
    };
  });
  const brut = {
    v: 3,
    sel: e.sel ?? '',
    admin: { ...((e.admin as object) ?? {}), ...(e['admin-connexion'] ? { derniereConnexion: e['admin-connexion'] } : {}) },
    ...(e.politique ? { politique: e.politique } : {}),
    comptes,
    ...(e.gestion ? { journalGestion: e.gestion } : {}),
    ...(e.prive ? { prive: e.prive } : {}),
  };
  return lireAnnuaire(JSON.stringify(brut));
}

export interface FusionAnnuaire extends ResultatLww {
  annuaire: Annuaire;
  /** Comptes retirés ici par une suppression faite ailleurs (leurs fichiers sont à effacer). */
  comptesRetires: string[];
}

/**
 * Fusionne l'annuaire d'ici avec celui du relais. `cles` (administrateur
 * déverrouillé) permet de réunir deux blocs privés divergents plutôt que
 * d'en perdre un.
 */
export function fusionnerAnnuaire(
  local: Annuaire,
  etat: EtatLww,
  distant: DocumentLww | undefined,
  maintenant: string,
  cles?: ClesAdmin,
  alea?: SourceAleatoire,
): FusionAnnuaire {
  const locales = entitesAnnuaire(local);
  const note = noterLocal(etat, locales, maintenant);
  // Deux appareils n'ont jamais deux sels : le premier annuaire publié fait foi, et on
  // l'adopte tel quel (sans rien effacer d'ici : aucun fichier n'est retiré dans ce cas).
  if (distant?.entites.sel && locales.sel && distant.entites.sel !== locales.sel) {
    const resultat = fusionner({}, { ...note, connus: {}, dates: {}, supprimes: {} }, distant);
    const annuaire = annuaireDepuisEntites(resultat.entites, local.comptes.map(c => c.id));
    return { ...resultat, changeIci: true, aPublier: false, annuaire, comptesRetires: [] };
  }
  let resultat = fusionner(locales, note, distant);
  // Blocs privés divergents : on réunit (voir fusionnerBlocsPrives).
  const privesDiffèrent = cles && typeof locales.prive === 'string' && typeof distant?.entites.prive === 'string' && locales.prive !== distant.entites.prive;
  if (privesDiffèrent && typeof resultat.entites.prive === 'string') {
    const gagnant = resultat.entites.prive;
    const perdant = gagnant === locales.prive ? (distant!.entites.prive as string) : (locales.prive as string);
    const ids = new Set(Object.keys(resultat.entites).filter(c => c.startsWith('compte:')).map(c => c.slice('compte:'.length)));
    const reuni = fusionnerBlocsPrives(gagnant, perdant, ids, cles!, alea);
    if (reuni !== gagnant) {
      const entites = { ...resultat.entites, prive: reuni };
      const etatReuni = { ...resultat.etat, dates: { ...resultat.etat.dates, prive: maintenant } };
      const retirees = resultat.retirees;
      resultat = { ...fusionner(entites, etatReuni, distant), retirees, changeIci: true };
    }
  }
  const annuaire = annuaireDepuisEntites(resultat.entites, local.comptes.map(c => c.id));
  const comptesRetires = resultat.retirees.filter(c => c.startsWith('compte:')).map(c => c.slice('compte:'.length));
  return { ...resultat, annuaire, comptesRetires };
}

// --- Côté ami --------------------------------------------------------------------

/**
 * Ce qu'un ami reçoit dans son espace : son entrée seule, le sel (pour
 * retrouver son compte par son prénom), la politique des apps et la clé
 * PUBLIQUE de séquestre (pour son dépôt et son suivi de connexion). Ni
 * l'empreinte ni le prénom de l'administrateur, ni les autres comptes, ni
 * le bloc privé.
 */
export function projectionAmi(annuaire: Annuaire, id: string): Annuaire | undefined {
  const entree = annuaire.comptes.find(c => c.id === id);
  if (!entree || annuaire.heritage || !annuaire.sel) return undefined;
  return {
    v: annuaire.v,
    sel: annuaire.sel,
    admin: annuaire.admin.cleSequestre ? { cleSequestre: annuaire.admin.cleSequestre } : {},
    ...(annuaire.politique ? { politique: annuaire.politique } : {}),
    comptes: [entree],
    restreint: true,
  };
}

/** Ce que l'ami renvoie de lui-même : ce que `noterConnexionAmi` change sur son appareil. */
export interface RetourAmi {
  suivi?: string;
  sequestre?: EntreeCompte['sequestre'];
  invitationAcceptee?: boolean;
}

export function retourAmi(annuaire: Annuaire, id: string): RetourAmi | undefined {
  const entree = annuaire.comptes.find(c => c.id === id);
  if (!entree) return undefined;
  return {
    ...(entree.suivi ? { suivi: entree.suivi } : {}),
    ...(entree.sequestre.etat === 'depose' ? { sequestre: entree.sequestre } : {}),
    invitationAcceptee: !entree.acces.invitationExpireLe,
  };
}

/**
 * Côté administrateur : applique ce qu'un ami a renvoyé depuis un autre
 * appareil (suivi scellé pour l'administrateur, dépôt de séquestre,
 * invitation acceptée). Rien d'autre n'est accepté de l'ami : ni ses accès,
 * ni son prénom, ni la politique.
 */
export function appliquerRetourAmi(annuaire: Annuaire, id: string, retour: RetourAmi): Annuaire {
  const valide = lireAnnuaire(
    JSON.stringify({ v: 3, sel: annuaire.sel, admin: {}, comptes: [{ id, empreinte: '0'.repeat(64), nom: '00', acces: {}, sequestre: retour.sequestre ?? {}, ...(retour.suivi ? { suivi: retour.suivi } : {}) }] }),
  ).comptes[0];
  return {
    ...annuaire,
    comptes: annuaire.comptes.map(c => {
      if (c.id !== id || !valide) return c;
      const suivant: EntreeCompte = { ...c, acces: { ...c.acces } };
      if (valide.suivi) suivant.suivi = valide.suivi;
      if (c.sequestre.etat === 'attendu' && valide.sequestre.etat === 'depose') suivant.sequestre = valide.sequestre;
      if (retour.invitationAcceptee === true) delete suivant.acces.invitationExpireLe;
      return suivant;
    }),
  };
}

/**
 * Côté ami : la projection reçue remplace l'annuaire restreint d'ici, en
 * gardant ce que l'ami a fait sur cet appareil et que l'administrateur n'a
 * pas encore repris (dépôt de séquestre, suivi, invitation acceptée).
 */
export function recevoirProjection(local: Annuaire | undefined, recue: Annuaire, id: string): Annuaire {
  const projection = { ...recue, restreint: true as const, comptes: recue.comptes.filter(c => c.id === id) };
  const ici = local?.comptes.find(c => c.id === id);
  if (!ici) return projection;
  return {
    ...projection,
    comptes: projection.comptes.map(c => {
      const suivant: EntreeCompte = { ...c, acces: { ...c.acces } };
      if (ici.suivi && !c.suivi) suivant.suivi = ici.suivi;
      if (c.sequestre.etat === 'attendu' && ici.sequestre.etat === 'depose') suivant.sequestre = ici.sequestre;
      if (!ici.acces.invitationExpireLe) delete suivant.acces.invitationExpireLe;
      return suivant;
    }),
  };
}
