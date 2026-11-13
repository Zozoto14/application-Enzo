/**
 * Profils de jeu côté app : fonctions pures (libellés, profil vide, assets des modules) et cache du
 * profil du jeu de chaque team (lu une fois par session : `GET /teams/:id/jeu`).
 *
 * Les modules qui listent des maps et des personnages (Strats, Playbook, Ressources, Scouting) lisent le
 * profil du jeu de la team plutôt qu'une liste codée en dur :
 *  - Valorant (`base: 'valorant'`) : les maps et agents du profil, avec les images Riot de l'éditeur de
 *    strats (minimaps, icônes, capacités ; valorant-api.com) quand elles existent ;
 *  - autre jeu : maps et personnages du profil, sans fond de carte ni capacités (l'éditeur de strats
 *    devient générique : pions à initiales, flèches, zones, textes). Les images d'un profil ne sont PAS
 *    mises dans le document d'une strat (le serveur n'y accepte que le CDN Riot).
 */

import type { ClientEsport } from '../client';
import { SLOTS, cleRole, type AgentAsset, type Assets, type CapaciteAsset, type CarteAsset } from '../strats/assets';
import { modeleDuJeu } from '../strats/modeles';
import { apiJeux, type CapaciteJeu, type CapaciteOfficielle, type DonneesJeu, type FormatJeu, type ProfilJeu } from './api';
import { capacitesPrereplies } from './modeles';

/** « 5v5 », « 3v3v3v3 » ; au-delà de 4 équipes « 20 × 3 ». */
export function libelleFormat(f: Pick<FormatJeu, 'equipes' | 'joueursParEquipe'>): string {
  if (f.equipes > 4) return `${f.equipes} × ${f.joueursParEquipe}`;
  return Array.from({ length: Math.max(1, f.equipes) }, () => f.joueursParEquipe).join('v');
}

/** Clé stable d'un nom (même règle que le serveur, esport/noyau/jeux/schema.mjs). */
export function cleDe(nom: string): string {
  return String(nom ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

export const donneesVides = (): DonneesJeu => ({ formats: [], score: null, modes: [], cartes: [], classes: [], personnages: [], roster: null, rolesJoueurs: [], champs: [], libelles: {}, sources: [] });

/** Le profil (ou la clé de jeu) est-il Valorant (fonctions Riot) ? */
export const estValorant = (p: { base?: string | null; cle?: string } | string | null | undefined): boolean =>
  typeof p === 'string' ? p === 'valorant' : Boolean(p && (p.base === 'valorant' || (p.base === undefined && p.cle === 'valorant')));

/** Hôte d'une adresse d'image (affiché à la place de l'image tant qu'on ne demande pas l'aperçu). */
export function hote(url: string | null | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/**
 * Assets des modules (même forme que l'éditeur de strats) depuis le profil du jeu. `riot` : assets Riot
 * (Valorant), pour les minimaps, icônes et capacités des maps et agents du profil.
 */
export function assetsDepuisProfil(profil: ProfilJeu, riot?: Assets, maintenant = Date.now()): Assets {
  const valorant = estValorant(profil);
  const modele = modeleDuJeu(profil.modeleStrat, profil.base === 'valorant' ? 'valorant' : profil.cle);
  const d = profil.donnees;
  const classes = new Map(d.classes.map(c => [c.cle, c.nom]));
  const cartes: CarteAsset[] = d.cartes.map(c => {
    const r = valorant ? riot?.cartes.find(x => x.cle === c.cle) : undefined;
    // Image DÉPOSÉE dans le profil (lien signé) d'abord, sinon la minimap Riot (Valorant).
    const deposee = c.fichier ? profil.images?.[c.fichier] : undefined;
    return {
      cle: c.cle,
      nom: c.nom,
      minimap: deposee?.url ?? r?.minimap ?? null,
      vignette: deposee?.url ?? r?.vignette ?? c.image ?? null,
      actif: c.actif,
      echelle: c.echelle?.pxParMetre ?? null,
      ...(deposee ? { largeurImage: deposee.largeur, hauteurImage: deposee.hauteur } : {}),
      zones: c.zones ?? [],
      reperes: c.reperes ?? [],
      niveaux: c.niveaux ?? [],
    };
  });
  const lien = (f: string | undefined): string | null => (f ? (profil.images?.[f]?.url ?? null) : null);
  const agents: AgentAsset[] = d.personnages.map(p => {
    const r = valorant ? riot?.agents.find(x => x.cle === p.cle) : undefined;
    // Caractéristiques des capacités : celles du profil, sinon les données pré-remplies du modèle (« à vérifier »).
    const donnees = p.capacites?.length ? p.capacites : capacitesPrereplies(modele, p);
    // Capacités officielles IMPORTÉES (icônes dans le stockage du serveur) : prioritaires sur les icônes lues en direct.
    const officielles = capacitesOfficielles(p.officielles ?? [], r?.capacites ?? [], lien);
    // Valorant : le rôle traduit par valorant-api.com d'abord (langue de l'app), sinon la classe du profil.
    return {
      cle: p.cle,
      nom: p.nom,
      role: r?.role ?? (p.classe ? classes.get(p.classe) : null) ?? null,
      roleCle: p.classe ?? r?.roleCle ?? cleRole(r?.role) ?? null,
      icone: lien(p.fichier) ?? r?.icone ?? null,
      iconeDoc: p.source?.url ?? r?.iconeDoc ?? r?.icone ?? null,
      capacites: fusionnerCapacites(officielles, donnees),
      actif: p.actif,
    };
  });
  return { jeu: valorant ? 'valorant' : profil.cle, modele, source: riot && valorant ? riot.source : 'profil', cartes, agents, majLe: maintenant };
}

/**
 * Capacités officielles d'un agent : celles importées dans le profil (icône = lien signé, adresse CDN pour le
 * document), complétées par celles lues en direct sur valorant-api.com (nom traduit dans la langue de l'app).
 */
export function capacitesOfficielles(importees: CapaciteOfficielle[], riot: CapaciteAsset[], lien: (f: string | undefined) => string | null): CapaciteAsset[] {
  if (importees.length === 0) return riot;
  const ordre = ['C', 'Q', 'E', 'X'];
  return importees
    .map(o => {
      const r = riot.find(c => c.touche.toUpperCase() === o.touche.toUpperCase());
      const icone = lien(o.fichier) ?? r?.icone ?? o.url ?? null;
      return { cle: o.slot ?? r?.cle ?? SLOTS[o.touche.toUpperCase()] ?? cleDe(o.nom), nom: r?.icone ? r.nom : o.nom, icone, iconeDoc: o.url ?? r?.iconeDoc ?? r?.icone ?? null, touche: o.touche, ...(o.description ? { description: o.description } : {}) };
    })
    .sort((a, b) => ordre.indexOf(a.touche.toUpperCase()) - ordre.indexOf(b.touche.toUpperCase()));
}

/**
 * Capacités d'un personnage : celles de Riot (icônes, noms traduits, emplacement stable) rapprochées des
 * caractéristiques du profil par la touche (C, Q, E, X) ; sans Riot, celles du profil (clé : l'emplacement
 * Riot quand la touche en donne un, pour rester lisible par les strats déjà dessinées).
 */
export function fusionnerCapacites(riot: CapaciteAsset[], donnees: CapaciteJeu[]): CapaciteAsset[] {
  if (riot.length) {
    const utilisees = new Set<CapaciteJeu>();
    const sortie = riot.map(c => {
      const x = donnees.find(y => y.touche && y.touche.toUpperCase() === c.touche.toUpperCase() && !utilisees.has(y));
      if (x) utilisees.add(x);
      // Repli générique sans réseau (« Capacité E », sans icône) : le nom du profil est plus parlant.
      return x ? { ...c, nom: c.icone ? c.nom : x.nom, donnees: x } : c;
    });
    // Capacités du profil sans équivalent Riot (gadgets, ajouts du Fondateur).
    for (const x of donnees) if (!utilisees.has(x)) sortie.push({ cle: x.cle, nom: x.nom, icone: null, touche: x.touche, donnees: x });
    return sortie;
  }
  return donnees.map(x => ({ cle: SLOTS[x.touche.toUpperCase()] ?? x.cle, nom: x.nom, icone: null, touche: x.touche, donnees: x }));
}

/** Maps du pool (actives), plus celle déjà choisie (une strat sur une map sortie du pool reste éditable). */
export const cartesDuPool = (a: Assets | undefined, garder?: string): CarteAsset[] => (a?.cartes ?? []).filter(c => c.actif !== false || c.cle === garder);
export const agentsActifs = (a: Assets | undefined): AgentAsset[] => (a?.agents ?? []).filter(x => x.actif !== false);

// ------------------------------------------------------------------ Profil du jeu de chaque team (cache)

const profilsTeams = new Map<string, Promise<ProfilJeu | null>>();

/** Réponse plausible d'un profil (le serveur ancien, ou un faux client de test, peut rendre autre chose). */
function lisible(p: unknown): p is ProfilJeu {
  const d = (p as ProfilJeu | undefined)?.donnees;
  return Boolean(p && typeof p === 'object' && typeof (p as ProfilJeu).cle === 'string' && d && Array.isArray(d.cartes) && Array.isArray(d.personnages));
}

/** Profil du jeu d'une team (une requête par team et par session) ; null si le serveur ne le donne pas. */
export function profilDeTeam(client: ClientEsport, teamId: string): Promise<ProfilJeu | null> {
  const cle = `${client.config?.adresse ?? ''}|${teamId}`;
  let p = profilsTeams.get(cle);
  if (!p) {
    p = Promise.resolve()
      .then(() => apiJeux(client).pourTeam(teamId))
      .then(r => {
        // Portraits en cours d'import automatique par le serveur : le profil sera relu à la prochaine ouverture (d'ici là,
        // les portraits du CDN officiel s'affichent).
        if (lisible(r) && (r as { importAgents?: string }).importAgents === 'en-cours') setTimeout(() => profilsTeams.get(cle) === p && profilsTeams.delete(cle), 30_000);
        return lisible(r) ? r : null;
      })
      .catch(() => {
        // Échec (réseau, serveur ancien) : pas gardé, la prochaine ouverture redemande.
        profilsTeams.delete(cle);
        return null;
      });
    profilsTeams.set(cle, p);
  }
  return p;
}

/** À appeler après une modification d'un profil ou du jeu d'une team. */
export function oublierProfilsTeams(): void {
  profilsTeams.clear();
}
