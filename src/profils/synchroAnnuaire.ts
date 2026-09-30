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
  internes,
  lireAnnuaire,
  type AccesPublic,
  type Annuaire,
  type ClesAdmin,
  type EntreeCompte,
  type PaireTitulaire,
  type SequestreCompte,
} from './annuaire';
import { NIVEAU_RANG } from '../hub/admin/roles';
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
  if (annuaire.juridique) e.juridique = annuaire.juridique;
  if (annuaire.journalGestion?.length) e.gestion = annuaire.journalGestion;
  for (const c of annuaire.comptes) {
    e[`compte:${c.id}`] = { empreinte: c.empreinte, nom: c.nom, acces: c.acces };
    e[`sequestre:${c.id}`] = c.sequestre;
    if (c.sequestres) e[`sequestres:${c.id}`] = c.sequestres;
    if (c.titulaire) e[`titulaire:${c.id}`] = c.titulaire;
    if (c.suivi) e[`suivi:${c.id}`] = c.suivi;
    if (c.creation) e[`creation:${c.id}`] = c.creation;
  }
  // Registre des Fondateurs : une entrée par titulaire (deux Fondateurs qui promeuvent chacun quelqu'un ne s'écrasent pas).
  for (const [id, v] of Object.entries(annuaire.fondateurs?.partage ?? {})) e[`partage:${id}`] = v;
  for (const [id, v] of Object.entries(annuaire.fondateurs?.registre ?? {})) e[`registre:${id}`] = v;
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
      ...(e[`sequestres:${id}`] ? { sequestres: e[`sequestres:${id}`] } : {}),
      ...(e[`titulaire:${id}`] ? { titulaire: e[`titulaire:${id}`] } : {}),
      ...(e[`suivi:${id}`] ? { suivi: e[`suivi:${id}`] } : {}),
      ...(e[`creation:${id}`] ? { creation: e[`creation:${id}`] } : {}),
    };
  });
  const table = (prefixe: string) => Object.fromEntries(Object.entries(e).filter(([cle]) => cle.startsWith(prefixe)).map(([cle, v]) => [cle.slice(prefixe.length), v]));
  const partage = table('partage:');
  const registre = table('registre:');
  const brut = {
    v: 3,
    sel: e.sel ?? '',
    admin: { ...((e.admin as object) ?? {}), ...(e['admin-connexion'] ? { derniereConnexion: e['admin-connexion'] } : {}) },
    ...(e.politique ? { politique: e.politique } : {}),
    comptes,
    ...(e.gestion ? { journalGestion: e.gestion } : {}),
    ...(e.prive ? { prive: e.prive } : {}),
    ...(e.juridique ? { juridique: e.juridique } : {}),
    ...(Object.keys(partage).length + Object.keys(registre).length > 0 ? { fondateurs: { partage, registre } } : {}),
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
    ...(annuaire.juridique ? { juridique: annuaire.juridique } : {}),
    comptes: [entree],
    restreint: true,
  };
}

// --- Côté titulaire (Administrateur, Fondateur autre que le compte historique) ---------

const estTitulaireRole = (role: AccesPublic['role']): role is 'administrateur' | 'fondateur' => role === 'administrateur' || role === 'fondateur';

/**
 * Ce qu'un Administrateur (ou un Fondateur autre que le compte historique)
 * reçoit dans son espace pour administrer depuis le site : son entrée (avec
 * sa paire et son bloc privé, scellés par SA clé), et les comptes de rang
 * STRICTEMENT inférieur réduits à ce qu'il lui faut — empreinte, prénom
 * scellé, accès, et SON séquestre sur eux. Rien d'un compte de rang égal ou
 * supérieur (ni Fondateurs ni autres Administrateurs), ni le registre des
 * Fondateurs, ni leurs séquestres, ni le bloc privé du compte historique,
 * ni son empreinte ou son prénom. Un simple ami reçoit `projectionAmi`.
 */
export function projectionTitulaire(annuaire: Annuaire, id: string): Annuaire | undefined {
  const soi = annuaire.comptes.find(c => c.id === id);
  if (!soi || annuaire.heritage || !annuaire.sel) return undefined;
  const rang = soi.acces.role;
  if (!estTitulaireRole(rang)) return projectionAmi(annuaire, id);
  const moi: EntreeCompte = { ...soi };
  delete moi.sequestres;
  delete moi.creation;
  const inferieurs: EntreeCompte[] = annuaire.comptes
    .filter(c => c.id !== id && NIVEAU_RANG[c.acces.role ?? 'ami'] < NIVEAU_RANG[rang])
    .map(c => ({
      id: c.id,
      empreinte: c.empreinte,
      nom: c.nom,
      acces: c.acces,
      sequestre: { etat: 'attendu' },
      ...(c.sequestres?.[id] ? { sequestres: { [id]: c.sequestres[id] } } : {}),
    }));
  return {
    v: annuaire.v,
    sel: annuaire.sel,
    admin: annuaire.admin.cleSequestre ? { cleSequestre: annuaire.admin.cleSequestre } : {},
    ...(annuaire.politique ? { politique: annuaire.politique } : {}),
    ...(annuaire.juridique ? { juridique: annuaire.juridique } : {}),
    comptes: [moi, ...inferieurs],
    restreint: true,
    proprietaire: id,
  };
}

/** Ce que l'ami renvoie de lui-même : ce que `noterConnexionAmi` change sur son appareil. */
export interface RetourAmi {
  suivi?: string;
  sequestre?: EntreeCompte['sequestre'];
  invitationAcceptee?: boolean;
  /** Titulaire : sa paire et son bloc privé (lui seul peut les écrire). */
  titulaire?: PaireTitulaire;
  /** Titulaire : SES séquestres sur les comptes inférieurs (dépôts convertis, code régénéré, révocation). */
  sequestres?: Record<string, SequestreCompte>;
  /** Titulaire : règles d'accès modifiées depuis le site, en attente. */
  modifications?: Record<string, AccesPublic>;
  /** Titulaire : ses actions, scellées pour le compte historique (journal). */
  journal?: string[];
}

export function retourAmi(annuaire: Annuaire, id: string): RetourAmi | undefined {
  const entree = annuaire.comptes.find(c => c.id === id);
  if (!entree) return undefined;
  const retour: RetourAmi = {
    ...(entree.suivi ? { suivi: entree.suivi } : {}),
    ...(entree.sequestre.etat === 'depose' ? { sequestre: entree.sequestre } : {}),
    invitationAcceptee: !entree.acces.invitationExpireLe,
  };
  if (estTitulaireRole(entree.acces.role)) {
    if (entree.titulaire) retour.titulaire = entree.titulaire;
    const sequestres = Object.fromEntries(annuaire.comptes.filter(c => c.id !== id && c.sequestres?.[id]).map(c => [c.id, c.sequestres![id]]));
    if (Object.keys(sequestres).length > 0) retour.sequestres = sequestres;
    if (annuaire.modifications && Object.keys(annuaire.modifications).length > 0) retour.modifications = annuaire.modifications;
    if (annuaire.journalGestion?.length) retour.journal = annuaire.journalGestion;
  }
  return retour;
}

/**
 * Côté administrateur : applique ce qu'un ami a renvoyé depuis un autre
 * appareil (suivi scellé pour l'administrateur, dépôt de séquestre,
 * invitation acceptée). Rien d'autre n'est accepté de l'ami : ni ses accès,
 * ni son prénom, ni la politique.
 */
export function appliquerRetourAmi(annuaire: Annuaire, id: string, retour: RetourAmi): Annuaire {
  const valide = lireAnnuaire(
    JSON.stringify({
      v: 3,
      sel: annuaire.sel,
      admin: {},
      comptes: [{ id, empreinte: '0'.repeat(64), nom: '00', acces: {}, sequestre: retour.sequestre ?? {}, ...(retour.suivi ? { suivi: retour.suivi } : {}), ...(retour.titulaire ? { titulaire: retour.titulaire } : {}) }],
    }),
  ).comptes[0];
  const soi = annuaire.comptes.find(c => c.id === id);
  // Ce qu'un titulaire renvoie n'est accepté que s'il l'est encore (rang relu ICI, pas dans le retour).
  const rang = soi?.acces.role;
  const titulaire = estTitulaireRole(rang) ? rang : undefined;
  const inferieur = (c: EntreeCompte) => titulaire !== undefined && c.id !== id && NIVEAU_RANG[c.acces.role ?? 'ami'] < NIVEAU_RANG[titulaire];
  let journal = annuaire.journalGestion;
  if (titulaire && Array.isArray(retour.journal)) {
    const connus = new Set(journal ?? []);
    const recus = lireAnnuaire(JSON.stringify({ v: 3, sel: '', admin: {}, comptes: [], journalGestion: retour.journal })).journalGestion ?? [];
    const nouveaux = recus.filter(e => !connus.has(e));
    if (nouveaux.length > 0) journal = [...(journal ?? []), ...nouveaux].slice(-500);
  }
  return {
    ...annuaire,
    ...(journal ? { journalGestion: journal } : {}),
    comptes: annuaire.comptes.map(c => {
      if (c.id === id && valide) {
        const suivant: EntreeCompte = { ...c, acces: { ...c.acces } };
        if (valide.suivi) suivant.suivi = valide.suivi;
        if (c.sequestre.etat === 'attendu' && valide.sequestre.etat === 'depose') suivant.sequestre = valide.sequestre;
        if (retour.invitationAcceptee === true) delete suivant.acces.invitationExpireLe;
        if (titulaire && valide.titulaire?.cle && valide.titulaire.privee) suivant.titulaire = valide.titulaire;
        return suivant;
      }
      if (!inferieur(c)) return c;
      let suivant = c;
      // Son séquestre sur ce compte : seulement un état qu'il peut avoir produit lui-même.
      const brut = retour.sequestres?.[c.id];
      if (brut !== undefined) {
        const s = internes.lireSequestre(brut);
        const actuel = c.sequestres?.[id];
        const permis = s.etat === 'revoque' || (s.etat === 'actif' && (actuel?.etat === 'depose' || actuel?.etat === 'actif'));
        if (permis && JSON.stringify(actuel) !== JSON.stringify(s)) {
          suivant = { ...suivant, sequestres: { ...(suivant.sequestres ?? {}), [id]: s } };
        }
      }
      // Ses modifications d'accès (jamais le rang, qui ne change pas par ce chemin).
      const acces = retour.modifications?.[c.id];
      if (acces && typeof acces === 'object') {
        const propre = internes.lireAcces({ ...acces, role: c.acces.role });
        if (JSON.stringify(propre) !== JSON.stringify(c.acces)) suivant = { ...suivant, acces: propre };
      }
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
  const soiRecu = recue.comptes.find(c => c.id === id);
  const titulaire = estTitulaireRole(soiRecu?.acces.role);
  // Un ami ne garde que son entrée ; un titulaire, aussi les comptes inférieurs de sa projection.
  const projection: Annuaire = { ...recue, restreint: true as const, proprietaire: id, comptes: recue.comptes.filter(c => c.id === id || titulaire) };
  delete projection.modifications;
  delete projection.journalGestion;
  if (!local) return projection;
  const ici = local.comptes.find(c => c.id === id);
  // Modifications d'accès faites ici et pas encore reprises par un Fondateur : gardées (et appliquées).
  const modifications: Record<string, AccesPublic> = {};
  for (const [cid, acces] of Object.entries(local.modifications ?? {})) {
    const recu = projection.comptes.find(c => c.id === cid);
    if (titulaire && recu && JSON.stringify(recu.acces) !== JSON.stringify(acces)) modifications[cid] = acces;
  }
  const suivant: Annuaire = {
    ...projection,
    ...(titulaire && local.journalGestion?.length ? { journalGestion: local.journalGestion } : {}),
    ...(Object.keys(modifications).length > 0 ? { modifications } : {}),
    comptes: projection.comptes.map(c => {
      if (c.id === id) {
        if (!ici) return c;
        const suivant: EntreeCompte = { ...c, acces: { ...c.acces } };
        if (ici.suivi && !c.suivi) suivant.suivi = ici.suivi;
        if (c.sequestre.etat === 'attendu' && ici.sequestre.etat === 'depose') suivant.sequestre = ici.sequestre;
        if (!ici.acces.invitationExpireLe) delete suivant.acces.invitationExpireLe;
        // Sa paire et son bloc privé : ceux d'ici font foi (ses codes d'accès y sont).
        if (titulaire && ici.titulaire?.privee) suivant.titulaire = ici.titulaire;
        else if (!titulaire) delete suivant.titulaire;
        return suivant;
      }
      const avant = local.comptes.find(e => e.id === c.id);
      const suivant: EntreeCompte = { ...c, acces: modifications[c.id] ? { ...modifications[c.id], ...(c.acces.role ? { role: c.acces.role } : {}) } : c.acces };
      // Son séquestre : ce qu'il a fait ici (dépôt converti, code régénéré, révocation) l'emporte tant
      // que la projection ne l'a pas repris ; un séquestre retiré là-bas (rétrogradation) disparaît.
      const recu = c.sequestres?.[id];
      const localS = avant?.sequestres?.[id];
      if (recu && localS && JSON.stringify(recu) !== JSON.stringify(localS) && (recu.etat === 'depose' || recu.etat === 'actif') && (localS.etat === 'actif' || localS.etat === 'revoque')) {
        suivant.sequestres = { [id]: localS };
      }
      return suivant;
    }),
  };
  return suivant;
}
