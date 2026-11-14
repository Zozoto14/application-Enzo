/**
 * État de l'atelier de strats (éditeur plein écran) : document et historique, étape, outil, joueur, sélection
 * MULTIPLE, presse-papiers, vue, lecture animée, présentation, réglages d'affichage (par utilisateur),
 * enregistrement AUTOMATIQUE (différé, verrou optimiste du serveur, conflit signalé), temps réel (une autre
 * personne a enregistré), raccourcis clavier.
 *
 * Sans DOM ni canevas : la mise en page (Atelier.tsx) et le canevas Konva (Editeur.web.tsx) s'y branchent ;
 * les tests le pilotent avec un faux canevas et une fausse API.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ErreurEsport } from '../../../client';
import type { Strat } from '../../../strats/api';
import { trouverAgent, type AgentAsset, type CacheImages, type CapaciteAsset, type CarteAsset } from '../../../strats/assets';
import {
  ETAPES_MAX,
  TAILLE_MAX_DOCUMENT,
  VUE_INITIALE,
  annuler,
  executer,
  historique,
  lireDocument,
  prochainOrdre,
  retablir,
  tailleDocument,
  zoomer,
  type Action,
  type DocumentStrat,
  type Etape,
  type FormeZone,
  type Historique,
  type ObjetStrat,
  type UsageTrace,
  type Vue,
} from '../../../strats/document';
import { aligner, repartir, type Alignement } from '../../../strats/geometrie';
import { COULEURS_EQUIPES, definitionPour, type DefinitionModele, type GenreMarqueur } from '../../../strats/modeles';
import { PLATEAU, idThemeCarte, reglagesCarte, type Attenuation, type IdThemeCarte } from '../../../strats/plateau';
import { agentsActifs } from '../../../jeux/profil';
import { tr } from '../../../i18n';
import { trAt } from '../../../i18n/atelier';
import { trSt } from '../../../i18n/strats2';
import { useTempsReel } from '../../../tempsReel/hooks';
import { message } from '../../commun';
import type { ExportCanevas, MenuCanevas, Outil, PropsCanevas } from '../canevas/types';
import type { PropsEditeur } from '../types';

export const DELAI_AUTO_MS = 2500;
/** La miniature (image du canevas) n'accompagne un enregistrement automatique qu'une fois par minute. */
export const DELAI_MINIATURE_MS = 60_000;
export const COULEUR_ENNEMI = PLATEAU.ennemi;
export type Camp = 'allie' | 'ennemi';
export type OngletTiroir = 'selection' | 'etape' | 'joueurs' | 'utilitaires' | 'calques';
export type EtatSauvegarde = 'lecture' | 'enregistre' | 'modifie' | 'enregistrement' | 'erreur' | 'conflit';
export interface Ancre {
  x: number;
  y: number;
  l: number;
  h: number;
}

/** Réglages d'affichage de l'atelier, gardés par utilisateur (navigateur). */
export interface Preferences {
  themeCarte: IdThemeCarte;
  attenuation: Attenuation;
  noms: boolean;
  legende: boolean;
  fantome: boolean;
  /** Une nouvelle étape reprend les pions de la précédente. */
  reprise: boolean;
  dockReplie: boolean;
  /** Tiroir : épinglé ouvert, ou « auto » (il s'ouvre quand on choisit un objet). */
  tiroir: 'auto' | 'ouvert';
}
export const PREFERENCES_DEFAUT: Preferences = { themeCarte: 'tactique', attenuation: 0, noms: true, legende: false, fantome: false, reprise: true, dockReplie: false, tiroir: 'auto' };
const CLE_PREFS = 'esport.strats.atelier.v1';

type Stockage = { getItem(c: string): string | null; setItem(c: string, v: string): void };
const stockage = (): Stockage | undefined => {
  try {
    return (globalThis as { localStorage?: Stockage }).localStorage;
  } catch {
    return undefined;
  }
};
export function lirePreferences(): Preferences {
  try {
    const brut = JSON.parse(stockage()?.getItem(CLE_PREFS) ?? '{}') as Partial<Preferences>;
    return {
      themeCarte: idThemeCarte(brut.themeCarte),
      attenuation: brut.attenuation === 1 || brut.attenuation === 2 ? brut.attenuation : 0,
      noms: brut.noms !== false,
      legende: brut.legende === true,
      fantome: brut.fantome === true,
      reprise: brut.reprise !== false,
      dockReplie: brut.dockReplie === true,
      tiroir: brut.tiroir === 'ouvert' ? 'ouvert' : 'auto',
    };
  } catch {
    return PREFERENCES_DEFAUT;
  }
}
function ecrirePreferences(p: Preferences): void {
  try {
    stockage()?.setItem(CLE_PREFS, JSON.stringify(p));
  } catch {
    // Stockage plein ou interdit : les réglages valent pour cette séance.
  }
}

/** Ce que seule la plateforme sait faire (navigateur) : télécharger un fichier, imprimer une page. */
export interface Plateforme {
  telecharger(url: string, nom: string): Promise<void>;
  imprimer(html: string): Promise<void>;
  /** Attendre que le canevas ait redessiné (deux images). */
  attendreRendu(): Promise<void>;
}

/** Personnage générique quand le profil du jeu n'en a aucun : un pion à la couleur du joueur. */
export const PION_GENERIQUE: AgentAsset = { cle: 'pion', nom: 'Pion', role: null, icone: null, capacites: [] };
/** Ennemi dont on ignore l'agent : pion rouge « ? ». */
export const AGENT_INCONNU: AgentAsset = { cle: 'inconnu', nom: '?', role: null, icone: null, capacites: [] };

/** Nom de fichier ASCII (certains navigateurs ignorent un nom accentué). */
export const nomFichier = (titre: string) => titre.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'strat';

const TOUCHES_OUTILS: Record<string, Outil> = { v: 'selection', h: 'main', a: 'agent', c: 'capacite', f: 'fleche', l: 'ligne', r: 'forme', t: 'texte', m: 'marqueur', o: 'vision', e: 'gomme' };

export interface OptionsAtelier extends PropsEditeur {
  images: CacheImages;
  plateforme?: Plateforme;
  /** Délai de l'enregistrement automatique (ms) ; 0 : désactivé. */
  delaiAuto?: number;
  /** Documents rendus côte à côte (comparaison) : fournis par l'écran web. */
  mouvementReduit?: boolean;
}

export function useAtelier(props: OptionsAtelier) {
  const { api, teamId, stratId, assets, client, onRetour, onOuvrir, onSupprimee, images, plateforme } = props;
  const delaiAuto = props.delaiAuto ?? DELAI_AUTO_MS;
  const [strat, setStrat] = useState<Strat | undefined>();
  const [h, setH] = useState<Historique | undefined>();
  const [revision, setRevision] = useState(0);
  const [enregistre, setEnregistre] = useState<DocumentStrat | undefined>();
  const [etape, setEtape] = useState(0);
  const [outil, setOutilBrut] = useState<Outil>('selection');
  const [joueur, setJoueur] = useState<number | null>(0);
  const [couleurLibre, setCouleurLibre] = useState<string | undefined>();
  const [agentCle, setAgentCle] = useState<string | undefined>();
  const [capaciteCle, setCapaciteCle] = useState<string | undefined>();
  const [formeZone, setFormeZone] = useState<FormeZone | 'aucune' | 'auto'>('auto');
  const [formeDessin, setFormeDessin] = useState<'rect' | 'ellipse'>('rect');
  const [texte, setTexte] = useState('');
  const [usage, setUsage] = useState<UsageTrace>('deplacement');
  const [trajetJoueur, setTrajetJoueur] = useState(true);
  const [marqueur, setMarqueur] = useState<{ genre: GenreMarqueur; equipe: number | null; etiquette: string } | undefined>();
  const [vision, setVision] = useState({ ouverture: 90, portee: 30 });
  const [niveau, setNiveau] = useState<number | null>(null);
  const [aimant, setAimant] = useState(0);
  const [rotation, setRotation] = useState<0 | 180>(0);
  const [selection, setSelectionBrute] = useState<string[]>([]);
  const [pressePapier, setPressePapier] = useState<ObjetStrat[]>([]);
  const [vue, setVue] = useState<Vue>(VUE_INITIALE);
  const [conflit, setConflit] = useState<number | undefined>();
  const [temps, setTemps] = useState<number | undefined>();
  const [enLecture, setEnLecture] = useState(false);
  const [enchaine, setEnchaine] = useState(false);
  const [presentation, setPresentation] = useState(false);
  const [surligne, setSurligne] = useState<number | null>(null);
  const [laser, setLaser] = useState(false);
  const [laserTenu, setLaserTenu] = useState(false);
  const [comparer, setComparer] = useState(false);
  const [aide, setAide] = useState(false);
  const [callout, setCallout] = useState<string | undefined>();
  const [info, setInfo] = useState<string | undefined>();
  const [camp, setCamp] = useState<Camp>('allie');
  const [equipe, setEquipe] = useState(1);
  const [roleFiltre, setRoleFiltre] = useState<string | null>(null);
  const [categorie, setCategorie] = useState<string | null>(null);
  const [distant, setDistant] = useState<{ revision: number; pseudo: string | null } | undefined>();
  const [popover, setPopover] = useState<{ cle: string; ancre?: Ancre } | undefined>();
  const [menu, setMenu] = useState<MenuCanevas | undefined>();
  const [onglet, setOnglet] = useState<OngletTiroir>('etape');
  const [tiroirAuto, setTiroirAuto] = useState(false);
  const [prefs, setPrefsBrutes] = useState<Preferences>(lirePreferences);
  const [panTemporaire, setPanTemporaire] = useState(false);
  const [enCours, setEnCours] = useState<string | undefined>();
  const [erreur, setErreur] = useState<string | undefined>();
  const [avis, setAvis] = useState<string | undefined>();
  const [echecAuto, setEchecAuto] = useState(false);
  const [confirmation, setConfirmation] = useState<'supprimer' | 'quitter' | 'vider' | undefined>();
  const [modeEdition, setModeEdition] = useState(false);
  const [glisseEtape, setGlisseEtape] = useState<{ de: number; vers: number } | undefined>();
  const [partage, setPartage] = useState<string | undefined>();
  const canevas = useRef<ExportCanevas | undefined>(undefined);
  const occupe = useRef(false);
  const vivant = useRef(true);
  const derniereMiniature = useRef(0);
  const revisionRef = useRef(0);
  revisionRef.current = revision;
  useEffect(
    () => () => {
      vivant.current = false;
    },
    [],
  );

  const setPrefs = useCallback((champs: Partial<Preferences>) => {
    setPrefsBrutes(p => {
      const n = { ...p, ...champs };
      ecrirePreferences(n);
      return n;
    });
  }, []);

  const doc = h?.present;
  const def: DefinitionModele = definitionPour(doc?.modele ?? 'generique', doc?.mode);
  const peutModifier = Boolean(strat?.moi.modifier);
  const modifie = Boolean(doc && enregistre && doc !== enregistre);
  const agentsProfil = useMemo(() => agentsActifs(assets), [assets]);
  const agents = agentsProfil.length ? agentsProfil : [PION_GENERIQUE];
  const iEtape = doc ? Math.min(etape, doc.etapes.length - 1) : 0;
  const etapeCourante: Etape | undefined = doc?.etapes[iEtape];
  const agentJoueur = joueur !== null && doc?.joueurs[joueur]?.agent ? trouverAgent(assets, doc.joueurs[joueur].agent as string) : undefined;
  const agent: AgentAsset = (agentCle === AGENT_INCONNU.cle ? AGENT_INCONNU : agentCle ? (agents.find(a => a.cle === agentCle) ?? trouverAgent(assets, agentCle)) : undefined) ?? agentJoueur ?? agents[0];
  const capacite: CapaciteAsset | undefined = agent.capacites.find(c => c.cle === capaciteCle) ?? agent.capacites[0];
  const couleurEnnemi = def.equipesAdverses > 1 ? COULEURS_EQUIPES[(equipe - 1) % COULEURS_EQUIPES.length] : COULEUR_ENNEMI;
  const couleur = camp === 'ennemi' ? couleurEnnemi : (couleurLibre ?? (joueur !== null ? (doc?.joueurs[joueur]?.couleur ?? '#ffffff') : '#ffffff'));
  const carteAsset: CarteAsset | undefined = assets?.cartes.find(c => c.cle === doc?.carte.cle);
  const marqueurCourant = marqueur ?? { genre: def.marqueurs[0], equipe: null, etiquette: '' };
  const niveaux = useMemo(() => {
    if (carteAsset?.niveaux?.length) return carteAsset.niveaux.map((n, i) => ({ valeur: i, nom: n.nom }));
    return def.etages ? [0, 1, 2, 3].map(i => ({ valeur: i, nom: trSt('niveau.n', { n: i }) })) : [];
  }, [carteAsset, def.etages]);
  const libelleAgent = doc?.modele === 'thefinals' ? trSt('modele.classe') : doc?.modele === 'valorant' ? trSt('modele.agent') : trSt('modele.personnage');
  const choisis = useMemo(() => (etapeCourante?.objets ?? []).filter(o => selection.includes(o.id)), [etapeCourante, selection]);

  // ---------------------------------------------------------------- Actions sur le document
  const faire = useCallback((a: Action) => setH(x => (x ? executer(x, a) : x)), []);
  const defaire = useCallback(() => setH(x => (x ? annuler(x) : x)), []);
  const refaire = useCallback(() => setH(x => (x ? retablir(x) : x)), []);

  const setSelection = useCallback((ids: string[]) => {
    setSelectionBrute(avant => (avant.length === ids.length && avant.every((x, i) => x === ids[i]) ? avant : ids));
    if (ids.length) setOnglet('selection');
    setTiroirAuto(ids.length > 0);
  }, []);
  const setOutil = useCallback((o: Outil) => {
    setOutilBrut(o);
    setMenu(undefined);
  }, []);

  /** Exécute une action et sélectionne les objets qu'elle a créés (copie, duplication). */
  const faireEtChoisir = useCallback(
    (a: Action, cible: number) => {
      setH(x => {
        if (!x) return x;
        const apres = executer(x, a);
        if (apres !== x) {
          const avant = new Set((x.present.etapes[cible]?.objets ?? []).map(o => o.id));
          const nouveaux = (apres.present.etapes[cible]?.objets ?? []).filter(o => !avant.has(o.id)).map(o => o.id);
          if (nouveaux.length) setSelectionBrute(nouveaux);
        }
        return apres;
      });
    },
    [],
  );

  const supprimerSelection = useCallback(() => {
    if (!selection.length) return;
    faire({ type: 'supprimerLot', etape: iEtape, ids: selection });
    setSelection([]);
  }, [faire, iEtape, selection, setSelection]);
  const dupliquerSelection = useCallback(() => {
    if (choisis.length) faireEtChoisir({ type: 'coller', etape: iEtape, objets: choisis, decalage: 20 }, iEtape);
  }, [choisis, faireEtChoisir, iEtape]);
  const copier = useCallback(() => {
    if (choisis.length) setPressePapier(choisis);
  }, [choisis]);
  const coller = useCallback(() => {
    if (pressePapier.length) faireEtChoisir({ type: 'coller', etape: iEtape, objets: pressePapier, decalage: 20 }, iEtape);
  }, [faireEtChoisir, iEtape, pressePapier]);
  const verrouillerSelection = useCallback((verrou: boolean) => faire({ type: 'verrouiller', etape: iEtape, ids: selection, verrou }), [faire, iEtape, selection]);
  const ordonnerSelection = useCallback((vers: 'avant' | 'arriere') => faire({ type: 'ordonner', etape: iEtape, ids: selection, vers }), [faire, iEtape, selection]);
  const copierVersSuivante = useCallback(() => {
    if (!doc || !selection.length) return;
    if (iEtape >= doc.etapes.length - 1) {
      if (doc.etapes.length >= ETAPES_MAX) return;
      // Pas d'étape suivante : on la crée (vide), puis on y copie la sélection.
      setH(x => (x ? executer(executer(x, { type: 'ajouterEtape', apres: iEtape }), { type: 'copierVers', de: iEtape, vers: iEtape + 1, ids: selection }) : x));
    } else faire({ type: 'copierVers', de: iEtape, vers: iEtape + 1, ids: selection });
    setAvis(trAt('menu.copie_suivante_faite', { n: selection.length }));
  }, [doc, faire, iEtape, selection]);
  const affecterJoueur = useCallback(
    (j: number | null) => {
      if (!doc) return;
      const concernes = choisis.filter(o => 'joueur' in o).map(o => o.id);
      if (concernes.length) faire({ type: 'modifierLot', etape: iEtape, ids: concernes, champs: j === null ? { joueur: null } : { joueur: j, couleur: doc.joueurs[j]?.couleur ?? '#ffffff' } });
    },
    [choisis, doc, faire, iEtape],
  );
  const affecterNiveau = useCallback((n: number | null) => faire({ type: 'modifierLot', etape: iEtape, ids: selection, champs: { niveau: n } }), [faire, iEtape, selection]);
  const alignerSelection = useCallback((mode: Alignement) => faire({ type: 'decaler', etape: iEtape, deplacements: aligner(choisis, mode) }), [choisis, faire, iEtape]);
  const repartirSelection = useCallback((axe: 'horizontal' | 'vertical') => faire({ type: 'decaler', etape: iEtape, deplacements: repartir(choisis, axe) }), [choisis, faire, iEtape]);
  const toutSelectionner = useCallback(() => {
    if (doc && etapeCourante) setSelection(etapeCourante.objets.filter(o => !o.verrou).map(o => o.id));
  }, [doc, etapeCourante, setSelection]);

  // ---------------------------------------------------------------- Étapes et lecture animée
  const changerEtape = useCallback((i: number) => {
    setEtape(i);
    setEnchaine(false);
    setSelectionBrute([]);
    setMenu(undefined);
    setTemps(t => (t === undefined ? undefined : 0));
  }, []);
  const ajouterEtape = useCallback(() => {
    if (!doc || doc.etapes.length >= ETAPES_MAX) return;
    faire({ type: 'ajouterEtape', apres: iEtape, reprise: prefs.reprise });
    changerEtape(iEtape + 1);
  }, [changerEtape, doc, faire, iEtape, prefs.reprise]);
  const dupliquerEtape = useCallback(() => {
    if (!doc || doc.etapes.length >= ETAPES_MAX) return;
    faire({ type: 'dupliquerEtape', etape: iEtape });
    changerEtape(iEtape + 1);
  }, [changerEtape, doc, faire, iEtape]);
  const supprimerEtape = useCallback(() => {
    if (!doc || doc.etapes.length <= 1) return;
    faire({ type: 'supprimerEtape', etape: iEtape });
    changerEtape(Math.max(0, iEtape - 1));
  }, [changerEtape, doc, faire, iEtape]);
  const deplacerEtape = useCallback(
    (de: number, vers: number) => {
      if (!doc || de === vers || !doc.etapes[de] || !doc.etapes[vers]) return;
      faire({ type: 'deplacerEtape', de, vers });
      changerEtape(vers);
    },
    [changerEtape, doc, faire],
  );

  useEffect(() => {
    if (!enLecture || !doc) return undefined;
    const raf = (globalThis as { requestAnimationFrame?: (f: (t: number) => void) => number }).requestAnimationFrame;
    const annulerRaf = (globalThis as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame;
    if (!raf || !annulerRaf) return undefined;
    let precedent = Date.now();
    let id = 0;
    const pas = () => {
      const maintenant = Date.now();
      const dt = (maintenant - precedent) / 1000;
      precedent = maintenant;
      setTemps(t => {
        const actuel = (t ?? 0) + dt;
        const duree = doc.etapes[iEtape]?.duree ?? 5;
        if (actuel < duree) return actuel;
        if (iEtape < doc.etapes.length - 1) {
          // Étape suivante, enchaînée : les pions glissent depuis leur dernière position.
          setEtape(iEtape + 1);
          setEnchaine(true);
          return 0;
        }
        setEnLecture(false);
        return duree;
      });
      id = raf(pas);
    };
    id = raf(pas);
    return () => annulerRaf(id);
  }, [enLecture, doc, iEtape]);
  const lire = useCallback(() => {
    setSelectionBrute([]);
    setMenu(undefined);
    setTemps(t => (t === undefined || (doc && t >= (doc.etapes[iEtape]?.duree ?? 5)) ? 0 : t));
    setEnLecture(true);
  }, [doc, iEtape]);
  const pause = useCallback(() => setEnLecture(false), []);
  const arreter = useCallback(() => {
    setEnLecture(false);
    setEnchaine(false);
    setTemps(undefined);
  }, []);
  const allerTemps = useCallback((t: number) => {
    setEnLecture(false);
    setSelectionBrute([]);
    setTemps(t);
  }, []);

  // ---------------------------------------------------------------- Chargement, enregistrement
  const charger = useCallback(async () => {
    const s = await api.detail(teamId, stratId);
    const d = lireDocument(s.donnees, s.modele);
    if (!vivant.current) return;
    setStrat(s);
    setH(historique(d));
    setEnregistre(d);
    setRevision(s.revision);
    setEtape(e => Math.min(e, d.etapes.length - 1));
    setConflit(undefined);
    setDistant(undefined);
    setEchecAuto(false);
    setErreur(undefined);
  }, [api, teamId, stratId]);
  const recharger = useCallback(() => {
    setEnCours('chargement');
    void charger()
      .catch(e => vivant.current && setErreur(message(e)))
      .finally(() => vivant.current && setEnCours(undefined));
  }, [charger]);
  useEffect(() => {
    recharger();
  }, [recharger]);

  // Temps réel : quelqu'un d'autre enregistre cette strat. Sans changement local, la nouvelle version s'affiche
  // d'elle-même ; sinon bandeau « Recharger » (le verrou optimiste protège déjà l'enregistrement).
  const sansChangement = useRef(true);
  sansChangement.current = !modifie && enCours !== 'enregistrement';
  useTempsReel(
    client,
    [`team:${teamId}:strat_editor`],
    messages => {
      if (!messages.some(m => m.cle === `strat:${stratId}` && m.action !== 'supprime')) return;
      void api
        .detail(teamId, stratId)
        .then(s => {
          if (!vivant.current || s.revision <= revisionRef.current) return;
          if (sansChangement.current) {
            const d = lireDocument(s.donnees, s.modele);
            setStrat(s);
            setH(x => (x ? { passe: [...x.passe, x.present].slice(-100), present: d, futur: [] } : historique(d)));
            setEnregistre(d);
            setRevision(s.revision);
          } else setDistant({ revision: s.revision, pseudo: s.majPar.pseudo });
        })
        .catch(() => undefined);
    },
    { actif: Boolean(client) },
  );

  /** Une seule écriture à la fois : les enregistrements se suivent (jamais deux révisions concurrentes de soi-même). */
  const file = useRef<Promise<unknown>>(Promise.resolve());
  const etat = useRef({ doc, strat, revision, carteAsset });
  etat.current = { doc, strat, revision, carteAsset };
  const enregistrer = useCallback(
    (options: { auto?: boolean; forcer?: number } = {}): Promise<boolean> => {
      const tache = file.current.then(async (): Promise<boolean> => {
        const { doc: d, strat: s, revision: r, carteAsset: carte } = etat.current;
        if (!d || !s || !s.moi.modifier) return false;
        if (options.auto && d === enregistreRef.current) return true;
        if (vivant.current) {
          setEnCours('enregistrement');
          if (!options.auto) {
            setErreur(undefined);
            setAvis(undefined);
          }
        }
        try {
          if (tailleDocument(d) > TAILLE_MAX_DOCUMENT) throw new Error(trSt('editeur.trop_gros'));
          let miniature: string | undefined;
          const maintenant = Date.now();
          if (!options.auto || maintenant - derniereMiniature.current > DELAI_MINIATURE_MS) {
            try {
              miniature = canevas.current?.miniature();
              derniereMiniature.current = maintenant;
            } catch {
              miniature = undefined; // Canevas « contaminé » ou pas prêt : on enregistre sans miniature.
            }
          }
          // Instantané de l'échelle de la map (page de partage, export) : celle du profil au moment d'enregistrer.
          const donnees = carte?.echelle !== undefined && carte.echelle !== d.carte.echelle ? { ...d, carte: { ...d.carte, echelle: carte.echelle ?? null } } : d;
          const corps = { revision: options.forcer ?? r, donnees, miniature, ...(options.auto ? { auto: true } : {}) };
          const n = await api.enregistrer(teamId, s.id, corps);
          etat.current = { ...etat.current, revision: n.revision, strat: n };
          enregistreRef.current = d;
          if (vivant.current) {
            setStrat(n);
            setRevision(n.revision);
            setEnregistre(d);
            setConflit(undefined);
            setDistant(undefined);
            setEchecAuto(false);
            if (!options.auto) setAvis(n.avertissement ? tr('strats.editeur.strat_enregistree_miniature_no') : tr('strats.editeur.strat_enregistree_version', { revision: n.revision }));
          }
          return true;
        } catch (e) {
          if (vivant.current) {
            if (e instanceof ErreurEsport && e.code === 'conflit') setConflit(Number((e.details as { revision?: number } | undefined)?.revision ?? 0) || 0);
            setErreur(message(e));
            setEchecAuto(true);
          }
          return false;
        } finally {
          if (vivant.current) setEnCours(undefined);
        }
      });
      file.current = tache.catch(() => undefined);
      return tache;
    },
    [api, teamId],
  );
  const enregistreRef = useRef(enregistre);
  enregistreRef.current = enregistre;

  // Enregistrement automatique : différé après le dernier changement, jamais pendant un geste ni après un échec
  // (conflit, hors ligne) tant que l'on n'a pas réglé le problème (bandeau, « Enregistrer »).
  useEffect(() => {
    if (!delaiAuto || !peutModifier || !modifie || conflit !== undefined || echecAuto) return undefined;
    let minuteur: ReturnType<typeof setTimeout>;
    const tenter = () => {
      if (occupe.current) minuteur = setTimeout(tenter, 600);
      else void enregistrer({ auto: true });
    };
    minuteur = setTimeout(tenter, delaiAuto);
    return () => clearTimeout(minuteur);
  }, [delaiAuto, peutModifier, modifie, conflit, echecAuto, doc, enregistrer]);

  const sauvegarde: EtatSauvegarde = !peutModifier ? 'lecture' : conflit !== undefined ? 'conflit' : enCours === 'enregistrement' ? 'enregistrement' : !modifie ? 'enregistre' : echecAuto ? 'erreur' : 'modifie';

  /** Retour à la liste : ce qui reste à enregistrer part d'abord ; en cas d'échec, on demande avant de quitter. */
  const quitter = useCallback(async () => {
    if (etat.current.doc !== enregistreRef.current && etat.current.strat?.moi.modifier) {
      const ok = await enregistrer({ auto: true });
      if (!ok && vivant.current) {
        setConfirmation('quitter');
        return;
      }
    }
    onRetour();
  }, [enregistrer, onRetour]);

  const agir = useCallback(async (libelle: string, action: () => Promise<string | void>) => {
    setEnCours(libelle);
    setErreur(undefined);
    setAvis(undefined);
    try {
      const fait = await action();
      if (vivant.current && fait) setAvis(fait);
    } catch (e) {
      if (vivant.current) setErreur(message(e));
    } finally {
      if (vivant.current) setEnCours(undefined);
    }
  }, []);

  /** Renommer la strat (titre dans la barre du haut) : passe par la même file que les enregistrements. */
  const renommer = useCallback(
    (titre: string) => {
      const propre = titre.trim().slice(0, 80);
      const s = etat.current.strat;
      if (!s || !propre || propre === s.titre) return;
      const tache = file.current.then(async () => {
        try {
          const n = await api.modifier(teamId, s.id, { titre: propre });
          etat.current = { ...etat.current, revision: n.revision, strat: n };
          if (vivant.current) {
            setStrat(n);
            setRevision(n.revision);
          }
        } catch (e) {
          if (vivant.current) setErreur(message(e));
        }
      });
      file.current = tache.catch(() => undefined);
    },
    [api, teamId],
  );

  // ---------------------------------------------------------------- Exports
  const imagesEtapes = useCallback(async (): Promise<string[]> => {
    if (!doc || !canevas.current) throw new Error(tr('strats.editeur.le_canevas_n_est'));
    const avant = iEtape;
    const sortie: string[] = [];
    setSelectionBrute([]);
    setTemps(undefined);
    setEnLecture(false);
    try {
      for (let i = 0; i < doc.etapes.length; i++) {
        setEtape(i);
        await plateforme?.attendreRendu();
        sortie.push((canevas.current as ExportCanevas).png(1.2));
      }
    } catch {
      throw new Error(tr('strats.editeur.export_impossible_une_image'));
    } finally {
      setEtape(avant);
    }
    return sortie;
  }, [doc, iEtape, plateforme]);
  const exporterPng = useCallback(
    () =>
      agir('export', async () => {
        if (!canevas.current || !strat || !doc || !plateforme) throw new Error(tr('strats.editeur.le_canevas_n_est'));
        let url: string;
        try {
          url = canevas.current.png(2);
        } catch {
          throw new Error(tr('strats.editeur.export_impossible_une_image'));
        }
        await plateforme.telecharger(url, `${nomFichier(strat.titre)}-etape-${iEtape + 1}.png`);
        return tr('strats.editeur.image_png_exportee');
      }),
    [agir, doc, iEtape, plateforme, strat],
  );
  const exporterToutesPng = useCallback(
    () =>
      agir('export', async () => {
        if (!strat || !plateforme) return;
        const liste = await imagesEtapes();
        for (let i = 0; i < liste.length; i++) await plateforme.telecharger(liste[i], `${nomFichier(strat.titre)}-etape-${i + 1}.png`);
        return trSt('export.png_toutes', { n: liste.length });
      }),
    [agir, imagesEtapes, plateforme, strat],
  );
  const exporterPdf = useCallback(
    (html: (images: string[]) => string) =>
      agir('export', async () => {
        if (!doc || !strat || !plateforme) return;
        const liste = await imagesEtapes();
        await plateforme.imprimer(html(liste));
        return trSt('export.pdf_pret');
      }),
    [agir, doc, imagesEtapes, plateforme, strat],
  );
  const dupliquerStrat = useCallback(
    () =>
      agir('duplication', async () => {
        if (!strat) return;
        await enregistrer({ auto: true });
        const copie = await api.dupliquer(teamId, strat.id);
        onOuvrir(copie.id);
      }),
    [agir, api, enregistrer, onOuvrir, strat, teamId],
  );
  const supprimerStrat = useCallback(
    () =>
      agir('suppression', async () => {
        if (!strat) return;
        await api.supprimer(teamId, strat.id);
        onSupprimee({ id: strat.id, titre: strat.titre });
      }),
    [agir, api, onSupprimee, strat, teamId],
  );
  const ajouterAuPlaybook = useCallback(
    () =>
      agir('playbook', async () => {
        if (!strat) return;
        await api.creerEntree(teamId, { stratId: strat.id, tags: strat.tags });
        return trAt('plus.playbook_fait');
      }),
    [agir, api, strat, teamId],
  );
  const creerPartage = useCallback(
    () =>
      agir('partage', async () => {
        if (!strat) return;
        const lien = await api.creerPartage(teamId, strat.id, {});
        if (vivant.current) setPartage(lien.url);
      }),
    [agir, api, strat, teamId],
  );

  // ---------------------------------------------------------------- Dock : agents, capacités, joueurs
  const choisirAgent = useCallback(
    (a: AgentAsset) => {
      setAgentCle(a.cle);
      setCapaciteCle(undefined);
      if (camp === 'allie' && joueur !== null && !couleurLibre && a.cle !== PION_GENERIQUE.cle) faire({ type: 'joueur', index: joueur, champs: { agent: a.cle } });
      setOutil('agent');
    },
    [camp, couleurLibre, faire, joueur, setOutil],
  );
  const choisirCapacite = useCallback(
    (c: CapaciteAsset) => {
      setCapaciteCle(c.cle);
      setOutil('capacite');
    },
    [setOutil],
  );
  const choisirJoueur = useCallback((i: number) => {
    setJoueur(i);
    setCouleurLibre(undefined);
    setCamp('allie');
    setAgentCle(undefined);
    setCapaciteCle(undefined);
  }, []);
  /** Joueur et couleur d'un objet déposé depuis le dock, selon le camp. */
  const depot = { joueur: couleurLibre || camp === 'ennemi' ? null : joueur, couleur };

  // ---------------------------------------------------------------- Zoom
  const taille = useRef({ largeur: 0, hauteur: 0 });
  const zoom = useCallback((facteur: number) => setVue(v => zoomer(v, facteur, { x: taille.current.largeur / 2 - 40, y: taille.current.hauteur / 2 - 40 })), []);
  const ajuster = useCallback(() => setVue(VUE_INITIALE), []);

  // ---------------------------------------------------------------- Échap : ferme d'abord ce qui est ouvert
  const echap = useCallback((): boolean => {
    if (confirmation) setConfirmation(undefined);
    else if (menu) setMenu(undefined);
    else if (popover) setPopover(undefined);
    else if (aide) setAide(false);
    else if (partage) setPartage(undefined);
    else if (presentation) {
      setPresentation(false);
      setSurligne(null);
      setLaser(false);
      arreter();
    } else if (comparer) setComparer(false);
    else if (temps !== undefined) arreter();
    else if (selection.length) setSelection([]);
    else if (tiroirAuto) setTiroirAuto(false);
    else if (outil !== 'selection') setOutilBrut('selection');
    else return false;
    return true;
  }, [aide, arreter, comparer, confirmation, menu, outil, partage, popover, presentation, selection.length, setSelection, temps, tiroirAuto]);

  // ---------------------------------------------------------------- Clavier
  const espace = useRef<{ depuis: number; vue: Vue } | undefined>(undefined);
  const vueRef = useRef(vue);
  vueRef.current = vue;
  useEffect(() => {
    const fenetre = globalThis as unknown as { addEventListener?(t: string, f: (e: never) => void, capture?: boolean): void; removeEventListener?(t: string, f: (e: never) => void, capture?: boolean): void };
    if (!fenetre.addEventListener || !fenetre.removeEventListener) return undefined;
    type Touche = { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; repeat?: boolean; target: unknown; preventDefault(): void; stopPropagation?(): void };
    const dansChamp = (ev: Touche) => {
      const cible = ev.target as { tagName?: string; isContentEditable?: boolean } | null;
      return Boolean(cible && (cible.tagName === 'INPUT' || cible.tagName === 'TEXTAREA' || cible.tagName === 'SELECT' || cible.isContentEditable));
    };
    function touche(ev: Touche) {
      const k = ev.key.toLowerCase();
      if (k === 'escape') {
        // Échap ne sort JAMAIS de l'atelier (l'app derrière ne le voit pas) : dans un champ, il rend la main au
        // plateau ; sinon il ferme d'abord ce qui est ouvert.
        ev.preventDefault();
        ev.stopPropagation?.();
        if (dansChamp(ev)) (ev.target as { blur?(): void }).blur?.();
        else echap();
        return;
      }
      if (dansChamp(ev)) return;
      const ctrl = ev.ctrlKey || ev.metaKey;
      if (presentation) {
        // Présentation : flèches et Espace changent d'étape ou lancent la lecture, L tient le laser.
        if (k === 'arrowright' || k === 'pagedown') changerEtape(Math.min((doc?.etapes.length ?? 1) - 1, iEtape + 1));
        else if (k === 'arrowleft' || k === 'pageup') changerEtape(Math.max(0, iEtape - 1));
        else if (k === ' ') {
          ev.preventDefault();
          if (enLecture) pause();
          else lire();
        } else if (k === 'l') setLaserTenu(true);
        else if (/^[1-9]$/.test(k) && Number(k) <= (doc?.joueurs.length ?? 0)) setSurligne(s => (s === Number(k) - 1 ? null : Number(k) - 1));
        else if (k === '0') setSurligne(null);
        return;
      }
      if (ctrl && k === 'z') {
        ev.preventDefault();
        if (ev.shiftKey) refaire();
        else defaire();
      } else if (ctrl && k === 'y') {
        ev.preventDefault();
        refaire();
      } else if (ctrl && k === 's') {
        ev.preventDefault();
        if (peutModifier) void enregistrer();
      } else if (ctrl && k === 'd') {
        ev.preventDefault();
        if (selection.length) dupliquerSelection();
        else dupliquerEtape();
      } else if (ctrl && k === 'a') {
        ev.preventDefault();
        toutSelectionner();
      } else if (ctrl && k === 'c' && selection.length) {
        ev.preventDefault();
        copier();
      } else if (ctrl && k === 'v' && pressePapier.length) {
        ev.preventDefault();
        coller();
      } else if (ctrl || ev.altKey) {
        return;
      } else if (k === ' ') {
        ev.preventDefault();
        // Espace tenu : déplacer la vue ; un appui bref (sans glisser) : lecture / pause.
        if (!ev.repeat && !espace.current) {
          espace.current = { depuis: Date.now(), vue: vueRef.current };
          setPanTemporaire(true);
        }
      } else if ((k === 'delete' || k === 'backspace') && selection.length) {
        supprimerSelection();
      } else if (k.startsWith('arrow') && selection.length) {
        ev.preventDefault();
        const pas = ev.shiftKey ? 20 : 4;
        faire({ type: 'deplacerLot', etape: iEtape, ids: selection, dx: k === 'arrowleft' ? -pas : k === 'arrowright' ? pas : 0, dy: k === 'arrowup' ? -pas : k === 'arrowdown' ? pas : 0 });
      } else if ((k === ',' || k === '.' || k === ';' || k === ':') && choisis.length === 1 && (choisis[0].type === 'capacite' || choisis[0].type === 'vision' || choisis[0].type === 'agent')) {
        // Orientation fine de la sélection : 5° (Maj : 1°).
        ev.preventDefault();
        const o = choisis[0];
        const pas = (k === ',' || k === ';' ? -1 : 1) * (ev.shiftKey ? 1 : 5);
        const tourner = (x: number) => Math.round((((x + pas) % 360) + 360) % 360);
        if (o.type === 'capacite' && o.zone && 'angle' in o.zone) faire({ type: 'modifier', etape: iEtape, id: o.id, champs: { zone: { ...o.zone, angle: tourner(o.zone.angle) } } });
        else if (o.type === 'vision') faire({ type: 'modifier', etape: iEtape, id: o.id, champs: { angle: tourner(o.angle) } });
        else if (o.type === 'agent') faire({ type: 'modifier', etape: iEtape, id: o.id, champs: { angle: tourner(o.angle ?? -90) } });
      } else if (k === '?') setAide(x => !x);
      else if (k === 'g') setAimant(x => (x ? 0 : 10));
      else if (peutModifier && TOUCHES_OUTILS[k]) setOutil(TOUCHES_OUTILS[k]);
      else if (/^[1-9]$/.test(k) && Number(k) <= (doc?.joueurs.length ?? 0)) {
        setJoueur(Number(k) - 1);
        setCouleurLibre(undefined);
        setCamp('allie');
        setAgentCle(undefined);
      } else if (k === '[') changerEtape(Math.max(0, iEtape - 1));
      else if (k === ']') changerEtape(Math.min((doc?.etapes.length ?? 1) - 1, iEtape + 1));
      else if (k === '+' || k === '=') zoom(1.25);
      else if (k === '-') zoom(1 / 1.25);
      else if (k === '0') ajuster();
    }
    function relache(ev: Touche) {
      const k = ev.key.toLowerCase();
      if (k === 'l') setLaserTenu(false);
      if (k !== ' ' || !espace.current) return;
      const e0 = espace.current;
      espace.current = undefined;
      setPanTemporaire(false);
      if (dansChamp(ev)) return;
      const bouge = e0.vue !== vueRef.current;
      if (!bouge && Date.now() - e0.depuis < 400) {
        if (enLecture) pause();
        else lire();
      }
    }
    // En capture : l'atelier passe avant les écouteurs de l'app qu'il recouvre.
    fenetre.addEventListener('keydown', touche as (e: never) => void, true);
    fenetre.addEventListener('keyup', relache as (e: never) => void, true);
    return () => {
      fenetre.removeEventListener?.('keydown', touche as (e: never) => void, true);
      fenetre.removeEventListener?.('keyup', relache as (e: never) => void, true);
    };
  }, [ajuster, changerEtape, choisis, coller, copier, defaire, doc, dupliquerEtape, dupliquerSelection, echap, enLecture, enregistrer, faire, iEtape, lire, pause, peutModifier, pressePapier.length, presentation, refaire, selection, setOutil, supprimerSelection, toutSelectionner, zoom]);

  // Onglet masqué (autre onglet, téléphone verrouillé) : ce qui reste à enregistrer part tout de suite.
  useEffect(() => {
    const d = (globalThis as { document?: { addEventListener?(t: string, f: () => void): void; removeEventListener?(t: string, f: () => void): void; visibilityState?: string } }).document;
    if (!d?.addEventListener || !delaiAuto) return undefined;
    const visible = () => {
      if (d.visibilityState === 'hidden') void enregistrer({ auto: true });
    };
    d.addEventListener('visibilitychange', visible);
    return () => d.removeEventListener?.('visibilitychange', visible);
  }, [delaiAuto, enregistrer]);

  // ---------------------------------------------------------------- Propriétés du canevas
  const surPret = useCallback((e: ExportCanevas) => {
    canevas.current = e;
  }, []);
  const surOccupe = useCallback((o: boolean) => {
    occupe.current = o;
  }, []);
  const surMenu = useCallback((m: MenuCanevas) => {
    setPopover(undefined);
    setMenu(m);
  }, []);
  const lecteur = !peutModifier || temps !== undefined;
  const propsCanevas: Omit<PropsCanevas, 'largeur' | 'hauteur' | 'marges' | 'taille'> | undefined = doc
    ? {
        doc,
        carte: carteAsset,
        fond: doc.carte.image ?? carteAsset?.minimap ?? null,
        etape: iEtape,
        outil: lecteur ? 'main' : outil,
        couleur,
        joueur: depot.joueur,
        agent,
        capacite,
        agents: assets?.agents,
        formeZone,
        formeDessin,
        texte,
        tirets: usage === 'rotation',
        epaisseur: 5,
        usage,
        trajetJoueur,
        marqueur: marqueurCourant,
        vision,
        niveau: niveaux.length ? niveau : null,
        aimant,
        rotation,
        temps,
        enchaine,
        ordreSuivant: prochainOrdre(etapeCourante),
        selection,
        onSelection: setSelection,
        onMenu: peutModifier ? surMenu : undefined,
        onCallout: setCallout,
        onInfo: setInfo,
        onOccupe: surOccupe,
        vue,
        onVue: setVue,
        onAction: peutModifier ? faire : () => undefined,
        images,
        onPret: surPret,
        ...reglagesCarte(doc?.modele, prefs.themeCarte, prefs.attenuation),
        noms: prefs.noms,
        fantome: prefs.fantome,
        surligne,
        panTemporaire,
        lectureSeule: !peutModifier,
        mouvementReduit: props.mouvementReduit,
      }
    : undefined;

  return {
    // Données
    strat,
    doc,
    def,
    assets,
    agents,
    agent,
    capacite,
    carteAsset,
    niveaux,
    libelleAgent,
    peutModifier,
    modifie,
    revision,
    iEtape,
    etapeCourante,
    choisis,
    historique: h,
    // État
    outil,
    setOutil,
    joueur,
    couleur,
    couleurLibre,
    setCouleurLibre: (c: string | undefined) => {
      setCouleurLibre(c);
      if (c) setCamp('allie');
    },
    camp,
    setCamp,
    equipe,
    setEquipe,
    roleFiltre,
    setRoleFiltre,
    categorie,
    setCategorie,
    formeZone,
    setFormeZone,
    formeDessin,
    setFormeDessin,
    texte,
    setTexte,
    usage,
    setUsage,
    trajetJoueur,
    setTrajetJoueur,
    marqueur: marqueurCourant,
    setMarqueur,
    vision,
    setVision,
    niveau,
    setNiveau,
    aimant,
    setAimant,
    rotation,
    setRotation,
    selection,
    setSelection,
    pressePapier,
    vue,
    setVue,
    zoom,
    ajuster,
    taille,
    temps,
    enLecture,
    presentation,
    setPresentation,
    surligne,
    setSurligne,
    laser: laser || laserTenu,
    laserLibre: laserTenu,
    setLaser,
    comparer,
    setComparer,
    aide,
    setAide,
    callout,
    info,
    popover,
    setPopover,
    menu,
    setMenu,
    onglet,
    setOnglet,
    tiroirAuto,
    setTiroirAuto,
    prefs,
    setPrefs,
    enCours,
    erreur,
    setErreur,
    avis,
    setAvis,
    conflit,
    distant,
    sauvegarde,
    confirmation,
    setConfirmation,
    modeEdition,
    setModeEdition,
    glisseEtape,
    setGlisseEtape,
    partage,
    setPartage,
    depot,
    // Actions
    faire,
    defaire,
    refaire,
    supprimerSelection,
    dupliquerSelection,
    copier,
    coller,
    verrouillerSelection,
    ordonnerSelection,
    copierVersSuivante,
    affecterJoueur,
    affecterNiveau,
    alignerSelection,
    repartirSelection,
    toutSelectionner,
    changerEtape,
    ajouterEtape,
    dupliquerEtape,
    supprimerEtape,
    deplacerEtape,
    lire,
    pause,
    arreter,
    allerTemps,
    recharger,
    enregistrer,
    quitter,
    quitterSansEnregistrer: onRetour,
    renommer,
    exporterPng,
    exporterToutesPng,
    exporterPdf,
    dupliquerStrat,
    supprimerStrat,
    creerPartage,
    ajouterAuPlaybook,
    choisirAgent,
    choisirCapacite,
    choisirJoueur,
    echap,
    canevas,
    propsCanevas,
  };
}

export type EtatAtelier = ReturnType<typeof useAtelier>;
