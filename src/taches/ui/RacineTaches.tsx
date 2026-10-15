/**
 * App « Tâches » (V1) : Espaces > Projets > Listes > Tâches, vues Liste,
 * Kanban, Calendrier et « Ma journée », détail en panneau latéral (PC, iPad)
 * ou plein écran (iPhone), ajout rapide en une ligne, filtres et vues
 * enregistrées, rappels, partage projet par projet avec UN ami.
 *
 * Raccourcis (hors champ de saisie) : N nouvelle tâche, / recherche, 1-4 les
 * vues, Échap ferme la fenêtre, puis le détail, puis l'app.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { RetourHub } from '../../hub/Hub';
import { teinteTransparente } from '../../hub/themes';
import type { PropsRacineApp } from '../../hub/types';
import { useMobile } from '../../ui/mobile';
import { droitsProjet, roleTaches } from '../acces';
import { annulerSuppression, effacerElement, elementsCorbeille, purgerCorbeille, restaurerElement, supprimerElement, viderCorbeille, type Genre, type ResultatSuppression } from '../corbeille';
import { lireAjoutRapide } from '../ajoutRapide';
import { analyserDeplacement, annulerDeplacement, deplacerTaches, type Destination, type OptionsDeplacement, type ResultatDeplacement } from '../deplacer';
import { jourLisible, sansAccents } from '../dates';
import { ajouterDemo, retirerDemo } from '../demo';
import { filtrer, filtresActifs, trier } from '../filtres';
import {
  creerEspace,
  creerProjet,
  creerTache,
  enregistrerVue,
  ErreurTaches,
  espacesVivants,
  FILTRES_DEFAUT,
  LIBELLES_PRIORITE,
  listesDe,
  modifierListe,
  modifierTache,
  PRIORITES,
  projetsDe,
  statutsDe,
  supprimerVue,
  tachesVivantes,
  vivant,
  assignesDe,
  LIBELLES_DROIT,
  type Contexte,
  type DonneesTaches,
  type Filtres,
  type Groupe,
  type Tache,
  type Tri,
  type TypeVue,
} from '../modele';
import { CLES_TACHES } from '../partage';
import { rouvrirTache, terminerTache } from '../recurrence';
import type { Actions, CibleIA } from './actions';
import { useAidesV3 } from './aides';
import { ajouterDependance, optionsDependance, personnesPour } from './DetailV3';
import { VueGantt } from './Gantt';
import { DialogueAides, DialogueIA } from './IA';
import { DialogueMembres, PersonnesProjet } from './Membres';
import { DialogueObjectif, VueObjectifs } from './Objectifs';
import { VueTableau } from './TableauBord';
import { VuePilote } from './PiloteSemaine';
import { listeMembres, membresDuProjet, projetPartage } from '../membres';
import type { Profil } from '../../profils/profils';
import { attenueDe, Bouton, Champ, couleurPriorite, Dialogue, EtatVide, Options, Puce, T, texteDe, titreDe } from './atomes';
import { AvisAnnulable, DialogueCorbeille, DialogueMenu, DialogueSuppression, type ElementMenu } from './Suppression';
import type { ElementCorbeille } from '../corbeille';
import { demanderHistorique } from '../integrations/office';
import { noterRelanceFaite } from '../integrations/prospects';
import { chargerDonnees, enregistrerDonnees } from '../../hub/admin/donnees';
import { prefsDe } from '../notifications';
import { appareilTaches, notificationSystemeDisponible, reinitialiserLiens, testerNotification, verifierRappels } from '../resume';
import { arreterMinuteur, chronoDe, demarrerMinuteur, dureeLisible, minuteurActif } from '../temps';
import { DialogueLiens, DialogueNotifications } from './ReglagesV2';
import { DialogueReleve, DialogueTemps, PastilleMinuteur } from './SuiviTemps';
import { DialogueJournal } from './Journal';
import { LIBELLES_OUVERTURE, type Ouverture } from './ouverture';
import { DetailTache } from './Detail';
import { DialogueChoix, DialogueEcheance, DialogueEspace, DialogueFiltres, DialogueNom, DialogueProjet, DialogueRappels, DialogueRappelsRecus, DialogueRecurrence, DialogueReglages } from './Dialogues';
import { BarreSelection, DialogueDeplacer, elementsMenuTache } from './Deplacer';
import { VueEquipe } from './Equipe';
import { useEtatTaches } from './etat';
import { ContexteZones, RegistreZones, useZoneDepot } from './glisser';
import { VueCalendrier, VueJournee, VueKanban, VueListe } from './Vues';

type Selection = { g: 'journee' } | { g: 'tout' } | { g: 'objectifs' } | { g: 'equipe' } | { g: 'semaine' } | { g: 'projet'; id: string; liste?: string } | { g: 'vue'; id: string };

type Fenetre =
  | { g: 'statut' | 'priorite' | 'assigne' | 'echeance' | 'recurrence' | 'rappels' | 'liste'; t: Tache }
  | { g: 'filtres' }
  | { g: 'reglages' }
  | { g: 'projet'; id: string }
  | { g: 'espace' }
  | { g: 'nouveau-projet'; espaceId: string }
  | { g: 'rappels-recus' }
  | { g: 'navigation' }
  | { g: 'menu'; genre: 'espace' | 'projet' | 'liste'; id: string }
  | { g: 'menu-vue' }
  | { g: 'supprimer'; genre: Genre; id: string }
  | { g: 'corbeille' }
  | { g: 'notifications' }
  | { g: 'liens' }
  | { g: 'releve' }
  | { g: 'journal'; projetId?: string; tacheId?: string; onglet?: 'journal' | 'debrief' }
  | { g: 'espace-modifier'; id: string }
  | { g: 'liste-renommer'; id: string }
  | { g: 'temps'; t: Tache }
  | { g: 'membres' }
  | { g: 'aides' }
  | { g: 'ia'; cible: CibleIA }
  | { g: 'objectif'; id?: string }
  | { g: 'dependance'; t: Tache }
  | { g: 'menu-ia' }
  | { g: 'deplacer'; ids: readonly string[]; dest?: Destination; mode?: 'auto' | 'parents' }
  | { g: 'menu-tache'; t: Tache };

/** « Annuler » pendant 10 s : une suppression ou un déplacement. */
interface Annulable {
  texte: string;
  defaire(x: DonneesTaches, ctx: Contexte): DonneesTaches;
  fait: string;
}

/** Durée pendant laquelle « Annuler » reste proposé après une suppression. */
export const DELAI_ANNULER_MS = 10_000;

const VUES: ReadonlyArray<[TypeVue, string, string]> = [
  ['liste', 'Liste', '☰'],
  ['kanban', 'Kanban', '▥'],
  ['calendrier', 'Calendrier', '▦'],
  ['journee', 'Ma journée', '☀︎'],
  ['gantt', 'Chronologie', '▤'],
  ['tableau', 'Tableau de bord', '◔'],
];
const COURTS: Record<TypeVue, string> = { liste: '☰ Liste', kanban: '▥ Kanban', calendrier: '▦ Agenda', journee: '☀︎ Jour', gantt: '▤ Gantt', tableau: '◔ Stats' };

interface Affichage {
  ouverture?: Ouverture;
  selection?: Selection;
  vue?: TypeVue;
  tri?: Tri;
  groupe?: Groupe;
  calendrier?: 'mois' | 'semaine';
  dernierProjet?: string;
}

function lireAffichage(brut: string | null | undefined): Affichage {
  try {
    const o = brut ? (JSON.parse(brut) as Affichage) : {};
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface Cible {
  focus(): void;
  blur?(): void;
}

// ------------------------------------------------------------------ Racine

export function Taches(props: PropsRacineApp) {
  if (!roleTaches(props.contexte) || !props.contexte.baseProfil) {
    return (
      <View style={[styles.racine, { backgroundColor: props.theme.fond }]} testID="app-taches">
        <View style={{ padding: 16 }}>
          <RetourHub theme={props.theme} onRetour={props.onRetour} titre="Tâches" />
        </View>
        <View style={{ padding: 24 }}>
          <EtatVide theme={props.theme} titre="Tâches n’est pas ouverte pour ce compte" texte="Le Fondateur choisit l’ami avec qui il partage ses projets." testID="taches-refuse" />
        </View>
      </View>
    );
  }
  return <AppTaches {...props} />;
}

function AppTaches({ contexte, theme, onRetour, onOuvrirApp, onParametres }: PropsRacineApp) {
  const mobile = useMobile();
  const { width } = useWindowDimensions();
  const etat = useEtatTaches(contexte);
  const d = etat.donnees;
  const role = etat.role;
  const base = contexte.baseProfil!;
  const registre = useMemo(() => new RegistreZones(), []);
  const affichageInitial = useMemo(() => lireAffichage(base.lire(CLES_TACHES.affichage)), [base]);

  // Ouverture : le calendrier de la semaine (ou la vue choisie dans les réglages ; « la dernière » seulement si demandé).
  const [ouverture, setOuverture] = useState<Ouverture>(affichageInitial.ouverture ?? 'calendrier-semaine');
  const depart: Affichage =
    ouverture === 'derniere'
      ? affichageInitial
      : ouverture === 'journee'
        ? { selection: { g: 'journee' }, vue: affichageInitial.vue }
        : ouverture === 'liste'
          ? { selection: { g: 'tout' }, vue: 'liste' }
          : { selection: { g: 'tout' }, vue: 'calendrier', calendrier: 'semaine' };
  const [selection, setSelection] = useState<Selection>(depart.selection ?? { g: 'journee' });
  const [vue, setVue] = useState<TypeVue>(depart.vue ?? 'liste');
  const [filtres, setFiltres] = useState<Filtres>(FILTRES_DEFAUT);
  const [tri, setTri] = useState<Tri>(affichageInitial.tri ?? 'manuel');
  const [groupe, setGroupe] = useState<Groupe>(affichageInitial.groupe ?? 'statut');
  const [modeCal, setModeCal] = useState<'mois' | 'semaine'>(depart.calendrier ?? affichageInitial.calendrier ?? 'mois');
  const [jourCal, setJourCal] = useState(etat.aujourdhui);
  const [ouverte, setOuverte] = useState<string | undefined>();
  const [fenetre, setFenetre] = useState<Fenetre | undefined>();
  const [avis, setAvis] = useState<{ texte: string; genre: 'ok' | 'erreur' } | undefined>();
  const [annulable, setAnnulable] = useState<Annulable | undefined>();
  // Multi-sélection (vue Liste) : tâches cochées, et la dernière touchée (Maj + clic : la plage).
  const [choisies, setChoisies] = useState<readonly string[]>([]);
  const ancre = useRef<string | undefined>(undefined);
  // Fenêtre ouverte DANS une vue (menu Équipe) : Échap la ferme, elle.
  const fermerLocale = useRef<(() => void) | undefined>(undefined);
  const [rapide, setRapide] = useState('');
  const [rapideActif, setRapideActif] = useState(false);
  const [dernierProjet, setDernierProjet] = useState(affichageInitial.dernierProjet);
  const champRapide = useRef<Cible | null>(null);
  const champRecherche = useRef<Cible | null>(null);

  // Préférences d'affichage de l'appareil.
  useEffect(() => {
    const valeur: Affichage = { ouverture, selection, vue, tri, groupe, calendrier: modeCal, dernierProjet };
    const texte = JSON.stringify(valeur);
    if (texte !== base.lire(CLES_TACHES.affichage)) base.ecrire(CLES_TACHES.affichage, texte);
  }, [base, ouverture, selection, vue, tri, groupe, modeCal, dernierProjet]);

  // Avis éphémère.
  useEffect(() => {
    if (!avis) return undefined;
    const t = setTimeout(() => setAvis(undefined), avis.genre === 'erreur' ? 6000 : 3500);
    return () => clearTimeout(t);
  }, [avis]);

  // « Annuler » : 10 s.
  useEffect(() => {
    if (!annulable) return undefined;
    const t = setTimeout(() => setAnnulable(undefined), DELAI_ANNULER_MS);
    return () => clearTimeout(t);
  }, [annulable]);

  // Corbeille : ce qui y est depuis plus de 30 jours s'efface (Fondateur ; rien n'est écrit s'il n'y a rien).
  useEffect(() => {
    if (role !== 'fondateur') return;
    try {
      etat.maj((x, ctx) => purgerCorbeille(x, ctx));
    } catch {
      // Sans conséquence : réessayé à la prochaine ouverture.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  // Liens avec les autres apps : une passe à l'ouverture (Fondateur), puis celle du hub (5 min).
  useEffect(() => {
    if (role !== 'fondateur') return;
    reinitialiserLiens();
    verifierRappels(contexte, Date.now());
    // À l'ouverture seulement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  // Sélection devenue invalide (projet supprimé, plus partagé) : retour à Ma journée.
  const projetSel = selection.g === 'projet' ? d.projets[selection.id] : undefined;
  const vueSel = selection.g === 'vue' ? d.vues[selection.id] : undefined;
  useEffect(() => {
    if ((selection.g === 'projet' && !vivant(projetSel)) || (selection.g === 'vue' && !vivant(vueSel))) setSelection({ g: 'journee' });
  }, [selection, projetSel, vueSel]);

  useEffect(() => {
    setChoisies([]);
    ancre.current = undefined;
  }, [selection, vue]);

  const signaler = useCallback((e: unknown) => setAvis({ texte: message(e), genre: 'erreur' }), []);
  const essayer = useCallback(
    (f: () => void) => {
      try {
        f();
      } catch (e) {
        signaler(e);
      }
    },
    [signaler],
  );

  // --- Périmètre affiché
  const projetId = selection.g === 'projet' ? selection.id : vueSel?.projetId;
  const listeId = selection.g === 'projet' ? selection.liste : undefined;
  const vueEffective: TypeVue = selection.g === 'journee' ? 'journee' : vue === 'journee' ? 'liste' : vue;
  const objectifs = selection.g === 'objectifs' && role === 'fondateur';
  const equipe = selection.g === 'equipe';
  const pilote = selection.g === 'semaine';
  const toutes = useMemo(() => tachesVivantes(d, projetId).filter(t => !listeId || t.listeId === listeId), [d, projetId, listeId]);
  const visibles = useMemo(() => {
    const f = filtrer(d, toutes, filtres, etat.aujourdhui);
    const sansSous = vueEffective === 'liste' || vueEffective === 'kanban' ? f.filter(t => !t.parentId || (filtres.recherche.trim() !== '' && !f.some(p => p.id === t.parentId))) : f;
    return trier(d, sansSous, tri);
  }, [d, toutes, filtres, etat.aujourdhui, vueEffective, tri]);

  const droits = useCallback((pid: string) => droitsProjet(role, d, pid, etat.moi), [role, d, etat.moi]);
  const ouvrirIA = useCallback((cible: CibleIA) => setFenetre({ g: 'ia', cible }), []);
  const avisOk = useCallback((texte: string) => setAvis({ texte, genre: 'ok' }), []);
  const aides = useAidesV3(base, etat, ouvrirIA, avisOk);
  const projetsModifiables = projetsDe(d).filter(p => droits(p.id).modifier);

  // --- Actions
  const noms = etat.noms;
  const cote = { role, moi: etat.moi } as const;
  const actions: Actions = {
    theme,
    mobile,
    etat,
    ouvrir: id => setOuverte(id),
    basculer: id =>
      essayer(() => {
        const t = d.taches[id];
        if (!t) return;
        const ferme = statutsDe(d, t.projetId).find(s => s.id === t.statut)?.ferme;
        let suivante: string | undefined;
        let temps = 0;
        etat.maj((x, ctx) => {
          if (ferme) return rouvrirTache(x, id, ctx, noms);
          // Terminée : son minuteur s'arrête (le temps est noté).
          const arret = (x.taches[id] && chronoDe(x.taches[id], ctx.auteur)) ? arreterMinuteur(x, id, ctx) : { donnees: x, minutes: 0 };
          temps = arret.minutes;
          const r = terminerTache(arret.donnees, id, ctx, etat.aujourdhui, noms);
          suivante = r.suivante;
          return r.donnees;
        });
        // Relance de Prospects cochée : le contact est noté dans Prospects.
        let prospect = '';
        if (!ferme && t.source?.app === 'prospects' && role === 'fondateur' && contexte.admin) {
          try {
            const admin = chargerDonnees(contexte.admin.stockage);
            const carnet = noterRelanceFaite(admin.prospects, t, etat.aujourdhui, etat.maintenant());
            if (carnet !== admin.prospects && enregistrerDonnees(contexte.admin.stockage, { ...admin, prospects: carnet })) prospect = ' Contact noté dans Prospects.';
          } catch {
            prospect = ' (Prospects n’a pas pu être mis à jour.)';
          }
        }
        if (!ferme) setAvis({ texte: `${suivante ? `« ${t.titre} » terminée — prochaine occurrence créée.` : `« ${t.titre} » terminée.`}${temps ? ` ${dureeLisible(temps)} notées.` : ''}${prospect}`, genre: 'ok' });
      }),
    changer: (id, c) => essayer(() => etat.maj((x, ctx) => modifierTache(x, id, c, ctx, noms))),
    droits,
    menuStatut: t => setFenetre({ g: 'statut', t }),
    menuPriorite: t => setFenetre({ g: 'priorite', t }),
    menuEcheance: t => setFenetre({ g: 'echeance', t }),
    menuAssigne: t => setFenetre({ g: 'assigne', t }),
    versColonne: (t, colonne) =>
      essayer(() => {
        const statuts = statutsDe(d, t.projetId);
        const cible = projetId ? statuts.find(s => s.id === colonne) : colonne === '~ferme' ? statuts.find(s => s.ferme) : statuts.find(s => !s.ferme && sansAccents(s.nom) === colonne);
        if (!cible) throw new ErreurTaches('Ce statut n’existe pas dans le projet de cette tâche.');
        if (cible.id === t.statut) return;
        if (cible.ferme && !statuts.find(s => s.id === t.statut)?.ferme) actions.basculer(t.id);
        else etat.maj((x, ctx) => modifierTache(x, t.id, { statut: cible.id }, ctx, noms));
      }),
    basculerJournee: t => essayer(() => etat.maj((x, ctx) => modifierTache(x, t.id, { pourAujourdhui: t.pourAujourdhui === etat.aujourdhui ? undefined : etat.aujourdhui }, ctx, noms))),
    aides,
    minuteur: t =>
      essayer(() => {
        const enCours = chronoDe(t, etat.moi);
        if (enCours) {
          let minutes = 0;
          etat.maj((x, ctx) => {
            const r = arreterMinuteur(x, t.id, ctx);
            minutes = r.minutes;
            return r.donnees;
          });
          setAvis({ texte: minutes ? `Minuteur arrêté : ${dureeLisible(minutes)} notées sur « ${t.titre} ».` : 'Minuteur arrêté (moins de 30 s : rien n’est noté).', genre: 'ok' });
          return;
        }
        let arrete: { tache: Tache; minutes: number } | undefined;
        etat.maj((x, ctx) => {
          const r = demarrerMinuteur(x, t.id, ctx);
          arrete = r.arrete;
          return r.donnees;
        });
        setAvis({ texte: arrete ? `Minuteur sur « ${t.titre} » (celui de « ${arrete.tache.titre} » est arrêté${arrete.minutes ? ` : ${dureeLisible(arrete.minutes)} notées` : ''}).` : `Minuteur démarré sur « ${t.titre} ».`, genre: 'ok' });
      }),
    demanderSuppression: (genre, id) => {
      if (genre === 'tache' ? !d.taches[id] || !droits(d.taches[id].projetId).modifier : role !== 'fondateur') return;
      setFenetre({ g: 'supprimer', genre, id });
    },
    supprimer: (genre, id, deplacerVers) =>
      essayer(() => {
        let r: ResultatSuppression | undefined;
        etat.maj((x, ctx) => {
          r = supprimerElement(x, genre, id, ctx, deplacerVers ? { deplacerVers } : {});
          return r.donnees;
        });
        if (!r) return;
        if (genre === 'tache' && ouverte === id) setOuverte(undefined);
        setAvis(undefined);
        const res = r;
        setAnnulable({ texte: res.texte, defaire: (x, ctx) => annulerSuppression(x, res, ctx), fait: 'Suppression annulée.' });
      }),
    demanderDeplacement: (ids, dest, mode) => setFenetre({ g: 'deplacer', ids, ...(dest ? { dest } : {}), ...(mode ? { mode } : {}) }),
    deposer: (ids, zone) =>
      essayer(() => {
        const projet = zone.startsWith('projet:') ? zone.slice(7) : undefined;
        const listeDepot = zone.startsWith('liste:') ? zone.slice(6) : projet ? listesDe(d, projet)[0]?.id : undefined;
        if (!listeDepot) return;
        // Sur son propre projet : rien (on ne change pas de liste sans le vouloir).
        if (projet && ids.every(id => d.taches[id]?.projetId === projet)) return;
        const dest: Destination = { listeId: listeDepot };
        const an = analyserDeplacement(d, ids, dest, cote, noms);
        if (an.refus) throw new ErreurTaches(an.refus);
        if (an.rien) return;
        // Un choix à faire ou un avertissement à lire : la fenêtre, déjà sur la bonne destination.
        if (an.statuts.length || an.etiquettes.length || an.visibles.length || an.disparus.length) setFenetre({ g: 'deplacer', ids, dest });
        else deplacer(ids, dest, {});
      }),
    menuTache: t => setFenetre({ g: 'menu-tache', t }),
    ...(vueEffective === 'liste' && !equipe && !pilote && !objectifs
      ? {
          selection: {
            ids: choisies,
            basculer: (id, mode, ordre) => {
              const a0 = ancre.current;
              setChoisies(c => {
                if (mode === 'plage' && a0 && ordre?.includes(a0) && ordre.includes(id)) {
                  const [i, j] = [ordre.indexOf(a0), ordre.indexOf(id)].sort((x, y) => x - y);
                  return [...new Set([...c, ...ordre.slice(i, j + 1)])];
                }
                return c.includes(id) ? c.filter(x => x !== id) : [...c, id];
              });
              ancre.current = id;
            },
            tout: ids => setChoisies(c => (ids.every(id => c.includes(id)) ? c.filter(id => !ids.includes(id)) : [...new Set([...c, ...ids])])),
            vider: () => setChoisies([]),
          },
        }
      : {}),
  };
  function deplacer(ids: readonly string[], dest: Destination, o: OptionsDeplacement) {
    essayer(() => {
      let r: ResultatDeplacement | undefined;
      etat.maj((x, ctx) => {
        r = deplacerTaches(x, ids, dest, ctx, cote, o, noms);
        return r.donnees;
      });
      const res = r;
      if (!res) return;
      if (!res.nb) {
        setAvis({ texte: res.texte, genre: 'ok' });
        return;
      }
      setChoisies(c => c.filter(id => !ids.includes(id)));
      setAvis(undefined);
      setAnnulable({ texte: res.texte, defaire: (x, ctx) => annulerDeplacement(x, res.retours, ctx), fait: 'Déplacement annulé.' });
    });
  }
  const annuler = () =>
    essayer(() => {
      const r = annulable;
      if (!r) return;
      setAnnulable(undefined);
      etat.maj((x, ctx) => r.defaire(x, ctx));
      setAvis({ texte: r.fait, genre: 'ok' });
    });
  const nbCorbeille = elementsCorbeille(d, etat.maintenant(), role).length;

  // Menus « ⋯ » (barre latérale, appui long, en-tête de la vue).
  const elementsMenu = (genre: 'espace' | 'projet' | 'liste', id: string): ElementMenu[] => {
    if (role !== 'fondateur') {
      // Membre admin d'un projet : ses paramètres (listes, statuts), et le journal.
      return genre === 'projet' && droits(id).gerer
        ? [
            { texte: '⚙︎ Paramètres du projet (listes, statuts…)', testID: 'menu-reglages-projet', action: () => setFenetre({ g: 'projet', id }) },
            { texte: '📓 Journal et débriefing', testID: 'menu-journal-projet', action: () => setFenetre({ g: 'journal', projetId: id }) },
          ]
        : [];
    }
    if (genre === 'espace') {
      const e = d.espaces[id];
      return [
        { texte: '＋ Nouveau projet', testID: 'menu-nouveau-projet', action: () => setFenetre({ g: 'nouveau-projet', espaceId: id }) },
        { texte: '✎ Modifier l’espace (nom, couleur)', testID: 'menu-modifier-espace', action: () => setFenetre({ g: 'espace-modifier', id }) },
        { texte: `Supprimer l’espace « ${e?.nom ?? ''} »…`, danger: true, testID: 'menu-supprimer-espace', action: () => actions.demanderSuppression('espace', id) },
      ];
    }
    if (genre === 'projet') {
      const p = d.projets[id];
      return [
        { texte: '⚙︎ Paramètres du projet (nom, icône, statuts, dates, partage…)', testID: 'menu-reglages-projet', action: () => setFenetre({ g: 'projet', id }) },
        { texte: '📓 Journal et débriefing', testID: 'menu-journal-projet', action: () => setFenetre({ g: 'journal', projetId: id }) },
        ...(aides?.secrets.ia.actif ? [{ texte: '✨ Résumer le projet (IA)', testID: 'menu-ia-resumer', action: () => setFenetre({ g: 'ia', cible: { genre: 'resumer', projetId: id } }) }] : []),
        { texte: `Supprimer le projet « ${p?.nom ?? ''} »…`, danger: true, testID: 'menu-supprimer-projet', action: () => actions.demanderSuppression('projet', id) },
      ];
    }
    const l = d.listes[id];
    return [
      { texte: '✎ Renommer la liste', testID: 'menu-renommer-liste', action: () => setFenetre({ g: 'liste-renommer', id }) },
      { texte: `Supprimer la liste « ${l?.nom ?? ''} »…`, danger: true, testID: 'menu-supprimer-liste', action: () => actions.demanderSuppression('liste', id) },
    ];
  };

  // --- Ajout rapide
  const listeCible = (): string | undefined => {
    if (selection.g === 'projet' && droits(selection.id).modifier) return selection.liste ?? listesDe(d, selection.id)[0]?.id;
    const pid = projetId && droits(projetId).modifier ? projetId : dernierProjet && vivant(d.projets[dernierProjet]) && droits(dernierProjet).modifier ? dernierProjet : projetsModifiables[0]?.id;
    return pid ? listesDe(d, pid)[0]?.id : undefined;
  };
  const seulMembre = role === 'fondateur' ? (m => (m.length === 1 ? m[0].code : undefined))(listeMembres(d)) : etat.moi;
  const lu = rapide.trim() ? lireAjoutRapide(rapide, { aujourdhui: etat.aujourdhui, auteur: etat.moi, noms, avecAmi: etat.moi === 'ami' || Boolean(d.reglages.ami), ...(seulMembre ? { amiParDefaut: seulMembre } : {}) }) : undefined;
  const ajouter = () =>
    essayer(() => {
      if (!lu) return;
      const liste = listeCible();
      if (!liste) {
        if (role === 'fondateur') setFenetre(espacesVivants(d).length ? { g: 'nouveau-projet', espaceId: espacesVivants(d)[0].id } : { g: 'espace' });
        throw new ErreurTaches(role === 'ami' ? 'Aucun projet partagé en écriture.' : 'Créez d’abord un projet.');
      }
      if (!lu.titre) throw new ErreurTaches('Donnez un titre à la tâche.');
      let cree: Tache | undefined;
      etat.maj((x, ctx) => {
        const r = creerTache(
          x,
          {
            titre: lu.titre,
            listeId: liste,
            ...(lu.echeance ? { echeance: lu.echeance } : {}),
            etiquettes: lu.etiquettes,
            ...(lu.priorite ? { priorite: lu.priorite } : {}),
            ...(lu.assignes?.length ? { assignes: lu.assignes } : {}),
            ...(lu.recurrence ? { recurrence: lu.recurrence } : {}),
            ...(lu.echeance && prefsDe(x, role).delaiDefaut >= 0 ? { rappels: [prefsDe(x, role).delaiDefaut] } : {}),
            ...(selection.g === 'journee' && !lu.echeance ? { pourAujourdhui: etat.aujourdhui } : {}),
          },
          ctx,
        );
        cree = r.tache;
        return r.donnees;
      });
      setRapide('');
      if (cree) {
        setDernierProjet(cree.projetId);
        setAvis({ texte: `Ajoutée à « ${d.projets[cree.projetId]?.nom} » : ${cree.titre}`, genre: 'ok' });
      }
    });

  // --- Clavier : N, /, 1-4, Échap (en capture : avant le hub et les feuilles)
  const etatClavier = useRef({ fenetre, ouverte, selection, choisies: 0, suppr: (_: string | undefined) => undefined as void });
  etatClavier.current = {
    fenetre,
    ouverte,
    selection,
    choisies: choisies.length,
    // Suppr : l'élément de la barre latérale qui a le focus, sinon la tâche ouverte, sinon la liste / le projet affiché.
    suppr: (focus: string | undefined) => {
      const m = focus?.match(/^nav-(espace|projet|liste)-([a-z0-9-]+)$/);
      if (m && !/^(nouveau|reglages|menu)/.test(m[2])) actions.demanderSuppression(m[1] as Genre, m[2]);
      else if (ouverte) actions.demanderSuppression('tache', ouverte);
      else if (selection.g === 'projet') actions.demanderSuppression(selection.liste ? 'liste' : 'projet', selection.liste ?? selection.id);
    },
  };
  useEffect(() => {
    const doc = (globalThis as { document?: { addEventListener(t: string, f: (e: never) => void, c: boolean): void; removeEventListener(t: string, f: (e: never) => void, c: boolean): void; activeElement?: unknown } }).document;
    if (!doc) return undefined;
    const surTouche = (e: { key: string; target?: { tagName?: string; isContentEditable?: boolean; blur?(): void }; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; defaultPrevented?: boolean; preventDefault(): void; stopPropagation(): void }) => {
      if (e.defaultPrevented) return;
      const tag = e.target?.tagName?.toLowerCase();
      const champ = tag === 'input' || tag === 'textarea' || Boolean(e.target?.isContentEditable);
      const arreter = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (e.key === 'Escape') {
        if (fermerLocale.current) {
          // Une fenêtre du menu Équipe (fiche, retrait, choix) : elle se ferme, pas l'app.
          arreter();
          fermerLocale.current();
        } else if (etatClavier.current.fenetre) {
          arreter();
          setFenetre(undefined);
        } else if (etatClavier.current.ouverte) {
          arreter();
          e.target?.blur?.();
          setOuverte(undefined);
        } else if (etatClavier.current.choisies) {
          arreter();
          setChoisies([]);
        } else if (champ) {
          arreter();
          e.target?.blur?.();
        }
        return;
      }
      if (champ || e.ctrlKey || e.metaKey || e.altKey || etatClavier.current.fenetre) return;
      if (e.key === 'Delete') {
        arreter();
        const actif = (doc.activeElement as { closest?(s: string): { getAttribute(n: string): string | null } | null } | undefined)?.closest?.('[data-testid]');
        etatClavier.current.suppr(actif?.getAttribute('data-testid') ?? undefined);
        return;
      }
      if (e.key === 'n' || e.key === 'N') {
        arreter();
        champRapide.current?.focus();
      } else if (e.key === '/') {
        arreter();
        champRecherche.current?.focus();
      } else if (['1', '2', '3', '4', '5', '6'].includes(e.key)) {
        arreter();
        const v = VUES[Number(e.key) - 1][0];
        if (v === 'journee') setSelection({ g: 'journee' });
        else {
          setVue(v);
          setSelection(s => (s.g === 'journee' || s.g === 'objectifs' || s.g === 'equipe' || s.g === 'semaine' ? { g: 'tout' } : s));
        }
      }
    };
    doc.addEventListener('keydown', surTouche as never, true);
    return () => doc.removeEventListener('keydown', surTouche as never, true);
  }, []);

  const choisirVue = (v: TypeVue) => {
    if (v === 'journee') setSelection({ g: 'journee' });
    else {
      setVue(v);
      if (selection.g === 'journee' || selection.g === 'objectifs' || selection.g === 'equipe' || selection.g === 'semaine') setSelection({ g: 'tout' });
    }
  };
  const choisirSelection = (s: Selection) => {
    // En quittant une vue enregistrée, ses filtres ne suivent pas.
    if (selection.g === 'vue' && s.g !== 'vue') {
      setFiltres(FILTRES_DEFAUT);
    }
    setSelection(s);
    if (s.g === 'vue') {
      const v = d.vues[s.id];
      if (v) {
        setFiltres(v.filtres);
        setTri(v.tri);
        setGroupe(v.groupe);
        if (v.vue !== 'journee') setVue(v.vue);
      }
    } else if (s.g === 'projet') {
      setDernierProjet(s.id);
    }
    if (fenetre?.g === 'navigation') setFenetre(undefined);
  };

  // --- Titre de la sélection
  const titreSelection =
    selection.g === 'journee' ? 'Ma journée' : selection.g === 'objectifs' ? 'Objectifs' : selection.g === 'equipe' ? 'Équipe' : selection.g === 'semaine' ? 'Ta semaine' : selection.g === 'tout' ? 'Toutes les tâches' : selection.g === 'vue' ? (vueSel?.nom ?? 'Vue') : `${projetSel?.nom ?? 'Projet'}${listeId ? ` › ${d.listes[listeId]?.nom ?? ''}` : ''}`;
  const nbFiltres = filtresActifs(filtres) - (filtres.recherche.trim() ? 1 : 0);
  const aucunProjet = projetsDe(d).length === 0;

  // --- Contenu principal
  const contenu = pilote ? (
    <VuePilote a={actions} contexte={contexte} onOuvrirApp={onOuvrirApp} />
  ) : equipe ? (
    <VueEquipe a={actions} fermeture={f => (fermerLocale.current = f)} comptes={contexte.profils?.tous ?? []} onOuvrirTache={id => setOuverte(id)} onErreur={signaler} onAvis={avisOk} />
  ) : aucunProjet ? (
    role === 'fondateur' ? (
      <EtatVide
        theme={theme}
        testID="taches-bienvenue"
        titre="Bienvenue dans Tâches"
        texte="Rangez vos tâches en Espaces › Projets › Listes. Ajoutez-les en une ligne (« Appeler Paul demain #prospects !haute »), suivez-les en liste, en Kanban, au calendrier ou dans Ma journée, et partagez un projet avec un ami.">
        <Bouton theme={theme} variante="plein" titre="Créer un espace" onPress={() => setFenetre({ g: 'espace' })} testID="taches-creer-espace" />
        <Bouton
          theme={theme}
          titre="Découvrir avec un exemple"
          onPress={() =>
            essayer(() => {
              let pid = '';
              etat.maj((x, ctx) => {
                const r = ajouterDemo(x, ctx, etat.aujourdhui);
                pid = r.projetId;
                return r.donnees;
              });
              setSelection({ g: 'projet', id: pid });
            })
          }
          testID="taches-demo"
        />
      </EtatVide>
    ) : (
      <EtatVide theme={theme} testID="taches-rien-partage" titre="Aucun projet partagé avec toi" texte={`Quand ${etat.parFondateur === 'le Fondateur' ? 'le Fondateur' : noms.fondateur} partagera un projet avec toi, il apparaîtra ici (la synchronisation peut prendre une ou deux minutes).${etat.persoPermis ? ' En attendant, tu peux créer tes propres projets : ils restent à toi seul.' : ''}`}>
        {etat.persoPermis ? <Bouton theme={theme} variante="plein" titre="🔒 Créer mes propres projets" onPress={() => etat.changerSource('perso')} testID="taches-perso" /> : null}
      </EtatVide>
    )
  ) : objectifs ? (
    <VueObjectifs a={actions} onModifier={id => setFenetre({ g: 'objectif', id })} onNouveau={() => setFenetre({ g: 'objectif' })} />
  ) : vueEffective === 'journee' ? (
    <VueJournee a={actions} taches={filtrer(d, toutes, filtres, etat.aujourdhui)} qui={etat.moi} />
  ) : vueEffective === 'tableau' ? (
    <VueTableau a={actions} projetId={projetId} />
  ) : vueEffective === 'gantt' ? (
    <VueGantt a={actions} taches={filtrer(d, toutes, filtres, etat.aujourdhui)} onAvis={avisOk} onErreur={signaler} />
  ) : visibles.length === 0 && vueEffective !== 'calendrier' && vueEffective !== 'kanban' ? (
    <EtatVide
      theme={theme}
      testID="taches-vide"
      titre={filtresActifs(filtres) ? 'Aucune tâche ne correspond' : 'Aucune tâche ici'}
      texte={filtresActifs(filtres) ? 'Changez la recherche ou les filtres.' : 'Écrivez-en une dans la barre d’ajout rapide (touche N) : « Préparer la réunion vendredi 14h #equipe !haute ».'}>
      {filtresActifs(filtres) ? <Bouton theme={theme} titre="Effacer les filtres" onPress={() => setFiltres(FILTRES_DEFAUT)} testID="taches-effacer-filtres" /> : null}
    </EtatVide>
  ) : vueEffective === 'kanban' ? (
    <VueKanban a={actions} taches={visibles} projetId={projetId} />
  ) : vueEffective === 'calendrier' ? (
    <VueCalendrier a={actions} taches={filtrer(d, toutes, filtres, etat.aujourdhui)} mode={modeCal} onMode={setModeCal} jour={jourCal} onJour={setJourCal} />
  ) : (
    <View style={{ gap: 12 }}>
      <BarreSelection a={actions} onDeplacer={() => actions.demanderDeplacement?.(choisies)} />
      <VueListe a={actions} taches={visibles} groupe={groupe} projetId={projetId} />
    </View>
  );

  // --- Barre latérale (aussi en feuille sur téléphone / iPad portrait)
  const navigation = (
    <Navigation
      a={actions}
      selection={selection}
      onChoisir={choisirSelection}
      onNouvelEspace={() => setFenetre({ g: 'espace' })}
      onNouveauProjet={espaceId => setFenetre({ g: 'nouveau-projet', espaceId })}
      onMenu={(genre, id) => setFenetre({ g: 'menu', genre, id })}
      onCorbeille={() => setFenetre({ g: 'corbeille' })}
      nbCorbeille={nbCorbeille}
      onSupprimerVue={id => essayer(() => etat.maj((x, ctx) => supprimerVue(x, id, ctx)))}
    />
  );

  const barreRapide = (projetsModifiables.length > 0 || role === 'fondateur') && !aucunProjet && !equipe && !pilote ? (
    <View style={{ gap: 6 }}>
      <View style={[styles.rapide, { borderColor: rapide || rapideActif ? theme.accent : theme.ligne, backgroundColor: theme.surface, borderRadius: Math.min(theme.rayonMoyen, 12) }]}>
        <Text style={{ color: theme.accent, fontSize: 20, fontWeight: '700' }}>＋</Text>
        <TextInput
          ref={champRapide as never}
          testID="ajout-rapide"
          value={rapide}
          onChangeText={setRapide}
          onSubmitEditing={ajouter}
          onFocus={() => setRapideActif(true)}
          onBlur={() => setRapideActif(false)}
          blurOnSubmit={false}
          placeholder={mobile ? 'Nouvelle tâche…' : 'Ajouter une tâche (N) — ex. « Appeler Paul demain #prospects !haute @ami »'}
          placeholderTextColor={theme.attenue}
          accessibilityLabel="Ajout rapide d’une tâche"
          style={[texteDe(theme, mobile ? 17 : T.corps), styles.champRapide]}
        />
        {rapide.trim() ? <Bouton theme={theme} compact={!mobile} variante="plein" titre="Ajouter" onPress={ajouter} testID="ajout-rapide-valider" /> : null}
      </View>
      {lu && lu.reconnus.length ? (
        <View style={styles.rangee} testID="ajout-rapide-apercu">
          <Text style={attenueDe(theme)}>Compris :</Text>
          {lu.echeance ? <Puce theme={theme} texte={`📅 ${jourLisible(lu.echeance.jour, etat.aujourdhui)}${lu.echeance.heure ? ` ${lu.echeance.heure}` : ''}`} couleur={theme.accent} /> : null}
          {lu.priorite ? <Puce theme={theme} texte={`⚑ ${LIBELLES_PRIORITE[lu.priorite]}`} couleur={couleurPriorite(lu.priorite, theme)} /> : null}
          {(lu.assignes ?? []).map(x => (
            <Puce key={x} theme={theme} texte={`@ ${noms[x] ?? 'Membre'}`} couleur={theme.teintes.admin} />
          ))}
          {lu.etiquettes.map(e => (
            <Puce key={e} theme={theme} texte={`#${e}`} couleur={theme.teintes.anime} />
          ))}
          {lu.recurrence ? <Puce theme={theme} texte="↻ récurrente" couleur={theme.ok} /> : null}
        </View>
      ) : null}
    </View>
  ) : null;

  const recherche = (
    <Champ
      ref={champRecherche as never}
      theme={theme}
      mobile={mobile}
      value={filtres.recherche}
      onChangeText={v => setFiltres(f => ({ ...f, recherche: v }))}
      placeholder={mobile ? 'Rechercher' : 'Rechercher (/)'}
      testID="taches-recherche"
      accessibilityLabel="Rechercher une tâche"
      style={mobile ? undefined : { width: width >= 1280 ? 240 : 180 }}
    />
  );

  const ongletsBrut = (
    <View style={[styles.onglets, { borderColor: theme.ligne, borderRadius: Math.min(theme.rayonMoyen, 12) }]} accessibilityRole="tablist">
      {VUES.map(([v, libelle, icone], i) => {
        const actif = vueEffective === v && !objectifs && !equipe && !pilote;
        return (
          <Pressable
            key={v}
            testID={`onglet-${v}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: actif }}
            accessibilityLabel={`${libelle} (touche ${i + 1})`}
            onPress={() => choisirVue(v)}
            style={[styles.onglet, mobile && { paddingHorizontal: 10, minHeight: 44 }, { backgroundColor: actif ? theme.accent : 'transparent', borderRadius: Math.min(theme.rayonMoyen, 9) }]}>
            <Text numberOfLines={1} style={{ color: actif ? theme.surAccent : theme.texte, fontSize: 15, fontWeight: '600' }}>
              {mobile || width < 1360 ? COURTS[v] : `${icone}  ${libelle}`}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
  // Six vues : sur téléphone, les onglets défilent à l'horizontale.
  const ongletsVues = mobile ? (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} testID="onglets-defilement" contentContainerStyle={{ paddingRight: 8 }}>
      {ongletsBrut}
    </ScrollView>
  ) : (
    ongletsBrut
  );

  const outils = (
    <View style={styles.rangee}>
      {selection.g === 'projet' && projetSel && droits(projetSel.id).gerer ? <Bouton theme={theme} compact={!mobile} titre="⚙︎ Projet" onPress={() => setFenetre({ g: 'projet', id: projetSel.id })} testID="taches-projet-reglages" /> : null}
      {selection.g === 'projet' && projetSel && droits(projetSel.id).gerer ? <Bouton theme={theme} compact={!mobile} titre="⋯" libelle="Plus d’actions : supprimer le projet, la liste, l’espace" onPress={() => setFenetre({ g: 'menu-vue' })} testID="taches-menu" /> : null}
      <Bouton theme={theme} compact={!mobile} titre={nbFiltres ? `Filtres · ${nbFiltres}` : 'Filtres'} onPress={() => setFenetre({ g: 'filtres' })} testID="taches-filtres" />
      <Bouton theme={theme} compact={!mobile} titre={etat.rappels.length ? `🔔 ${etat.rappels.length}` : '🔔'} libelle={`Rappels : ${etat.rappels.length} non lu(s)`} onPress={() => setFenetre({ g: 'rappels-recus' })} testID="taches-rappels" />
      <Bouton theme={theme} compact={!mobile} titre="⏱" libelle="Relevé du temps (semaine, export CSV)" onPress={() => setFenetre({ g: 'releve' })} testID="taches-releve" />
      <Bouton theme={theme} compact={!mobile} titre="📓" libelle="Journal du jour et débriefing" onPress={() => setFenetre({ g: 'journal', ...(projetId ? { projetId } : {}) })} testID="taches-journal" />
      {aides?.secrets.ia.actif ? <Bouton theme={theme} compact={!mobile} titre="✨" libelle="Aide de l’IA (planning de la semaine, résumé du projet)" onPress={() => setFenetre({ g: 'menu-ia' })} testID="taches-ia" /> : null}
      <Bouton theme={theme} compact={!mobile} titre={role === 'fondateur' ? '👥 Partage' : '👥 Partagés'} libelle={role === 'fondateur' ? 'Réglages de Tâches : membres, partage, IA, exemple' : 'Projets partagés avec moi'} onPress={() => setFenetre({ g: 'reglages' })} testID="taches-reglages" />
    </View>
  );

  const chrono = minuteurActif(d, role);
  const pastilleMinuteur = chrono ? <PastilleMinuteur a={actions} t={chrono.tache} debut={chrono.debut} onOuvrir={() => setOuverte(chrono.tache.id)} /> : null;
  const ouvrirSession = (session: string) => {
    demanderHistorique(base, session, Date.now());
    onOuvrirApp?.('claude-office');
  };

  const detail = ouverte ? (
    <DetailTache
      a={actions}
      id={ouverte}
      onFermer={() => setOuverte(undefined)}
      onRecurrence={t => setFenetre({ g: 'recurrence', t })}
      onRappels={t => setFenetre({ g: 'rappels', t })}
      onListe={t => setFenetre({ g: 'liste', t })}
      onErreur={signaler}
      onAvis={texte => setAvis({ texte, genre: 'ok' })}
      onSaisirTemps={t => setFenetre({ g: 'temps', t })}
      onJournal={t => setFenetre({ g: 'journal', projetId: t.projetId, tacheId: t.id })}
      onDependance={t => setFenetre({ g: 'dependance', t })}
      onOuvrirSession={onOuvrirApp ? ouvrirSession : undefined}
      onOuvrirApp={onOuvrirApp}
    />
  ) : null;

  const annulableVue = annulable ? <AvisAnnulable a={actions} texte={annulable.texte} onAnnuler={annuler} bas={mobile ? 96 : 24} /> : null;
  const avisVue = annulableVue ?? (avis ? (
    <View pointerEvents="none" style={[styles.avis, mobile && { bottom: 96 }]}>
      <Text testID="taches-avis" accessibilityLiveRegion="polite" style={[texteDe(theme), styles.avisTexte, { backgroundColor: avis.genre === 'erreur' ? theme.critique : theme.texte, color: theme.fond, borderRadius: Math.min(theme.rayonMoyen, 10) }]}>
        {avis.texte}
      </Text>
    </View>
  ) : null);

  const fenetres = (
    <Fenetres
      a={actions}
      fenetre={fenetre}
      onFermer={() => setFenetre(undefined)}
      navigation={navigation}
      filtres={filtres}
      tri={tri}
      groupe={groupe}
      projetId={projetId}
      amis={(contexte.profils?.tous ?? []).filter(p => !p.admin && p.actif !== false).map(p => ({ id: p.id, nom: p.nom }))}
      onFiltres={(f, t, g) => {
        setFiltres(f);
        setTri(t);
        setGroupe(g);
      }}
      onEnregistrerVue={nom =>
        essayer(() => {
          let id = '';
          etat.maj((x, ctx) => {
            const r = enregistrerVue(x, { nom, vue: vueEffective, ...(projetId ? { projetId } : {}), filtres, tri, groupe }, ctx);
            id = r.vue.id;
            return r.donnees;
          });
          setSelection({ g: 'vue', id });
          setAvis({ texte: `Vue « ${nom.trim()} » enregistrée.`, genre: 'ok' });
        })
      }
      onSelection={choisirSelection}
      onOuvrir={id => {
        setFenetre(undefined);
        setOuverte(id);
      }}
      onErreur={signaler}
      onAvis={texte => setAvis({ texte, genre: 'ok' })}
      menu={elementsMenu}
      menuVue={() => {
        const p = projetSel;
        if (!p) return [];
        const l = listeId ? d.listes[listeId] : undefined;
        const e = d.espaces[p.espaceId];
        return [
          ...elementsMenu('projet', p.id),
          ...(l ? elementsMenu('liste', l.id) : []),
          ...(e && role === 'fondateur' ? [{ texte: `Supprimer l’espace « ${e.nom} »…`, danger: true, testID: 'menu-supprimer-espace', action: () => actions.demanderSuppression('espace', e.id) }] : []),
        ];
      }}
      onCorbeilleRestaurer={el =>
        essayer(() => {
          etat.maj((x, ctx) => restaurerElement(x, el.genre, el.id, ctx));
          setAvis({ texte: `« ${el.nom} » restauré${el.genre === 'liste' || el.genre === 'tache' ? 'e' : ''}.`, genre: 'ok' });
        })
      }
      onCorbeilleEffacer={el =>
        essayer(() => {
          etat.maj((x, ctx) => effacerElement(x, el.genre, el.id, ctx));
          setAvis({ texte: `« ${el.nom} » supprimé${el.genre === 'liste' || el.genre === 'tache' ? 'e' : ''} définitivement.`, genre: 'ok' });
        })
      }
      contexte={contexte}
      onAller={setFenetre}
      comptes={contexte.profils?.tous ?? []}
      {...(onParametres ? { onParametres: () => onParametres('taches') } : {})}
      onOuvertureChangee={o => {
        setOuverture(o);
        setAvis({ texte: `À l’ouverture : ${LIBELLES_OUVERTURE[o].replace(' (par défaut)', '').toLowerCase()}.`, genre: 'ok' });
      }}
      onCorbeilleVider={() =>
        essayer(() => {
          etat.maj((x, ctx) => viderCorbeille(x, ctx));
          setAvis({ texte: 'Corbeille vidée.', genre: 'ok' });
        })
      }
      onDeplacer={deplacer}
    />
  );

  // ================================================================== Téléphone
  if (mobile && detail) {
    // Téléphone : le détail est une page plein écran (le reste n'est pas monté dessous).
    return (
      <ContexteZones.Provider value={registre}>
        <View style={[styles.racine, { backgroundColor: theme.surface }]} testID="app-taches">
          {detail}
          {avisVue}
          {fenetres}
        </View>
      </ContexteZones.Provider>
    );
  }
  if (mobile) {
    return (
      <ContexteZones.Provider value={registre}>
        <View style={[styles.racine, { backgroundColor: theme.fond }]} testID="app-taches">
          <View style={styles.enteteMobile}>
            <RetourHub theme={theme} onRetour={onRetour} titre="Tâches" />
          </View>
          <View style={[styles.rangee, styles.barreMobile]}>
            <Bouton theme={theme} titre="☰" libelle="Espaces et projets" onPress={() => setFenetre({ g: 'navigation' })} testID="taches-navigation" />
            <Text numberOfLines={1} style={[titreDe(theme, 19), { flex: 1 }]} testID="taches-titre">
              {titreSelection}
            </Text>
            <Bouton theme={theme} titre={etat.rappels.length ? `🔔 ${etat.rappels.length}` : '🔔'} libelle={`Rappels : ${etat.rappels.length} non lu(s)`} onPress={() => setFenetre({ g: 'rappels-recus' })} testID="taches-rappels" />
            <Bouton theme={theme} titre="📓" libelle="Journal du jour et débriefing" onPress={() => setFenetre({ g: 'journal', ...(projetId ? { projetId } : {}) })} testID="taches-journal" />
            {aides?.secrets.ia.actif ? <Bouton theme={theme} titre="✨" libelle="Aide de l’IA" onPress={() => setFenetre({ g: 'menu-ia' })} testID="taches-ia" /> : null}
            <Bouton theme={theme} titre="👥" libelle={role === 'fondateur' ? 'Réglages de Tâches : ami, partage, exemple' : 'Projets partagés avec moi'} onPress={() => setFenetre({ g: 'reglages' })} testID="taches-reglages" />
          </View>
          <View style={{ paddingHorizontal: 16, gap: 10 }}>
            {pastilleMinuteur}
            {ongletsVues}
            <View style={[styles.rangee, { flexWrap: 'nowrap' }, (equipe || pilote) && { display: 'none' }]}>
              <View style={{ flex: 1 }}>{recherche}</View>
              <Bouton theme={theme} titre={nbFiltres ? `Filtres · ${nbFiltres}` : 'Filtres'} onPress={() => setFenetre({ g: 'filtres' })} testID="taches-filtres" />
              {selection.g === 'projet' && projetSel && droits(projetSel.id).gerer ? <Bouton theme={theme} titre="⋯" libelle="Réglages et suppression du projet" onPress={() => setFenetre({ g: 'menu-vue' })} testID="taches-menu" /> : null}
            </View>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 140, gap: 12 }} keyboardShouldPersistTaps="handled">
            {contenu}
          </ScrollView>
          {barreRapide ? <View style={[styles.piedMobile, { backgroundColor: theme.fond, borderColor: theme.ligne }]}>{barreRapide}</View> : null}
          {avisVue}
          {fenetres}
        </View>
      </ContexteZones.Provider>
    );
  }

  // ================================================================== PC, iPad
  const laterale = width >= 960;
  const detailCote = width >= 1280;
  return (
    <ContexteZones.Provider value={registre}>
      <View style={[styles.racine, { backgroundColor: theme.fond }]} testID="app-taches">
        <View style={[styles.enteteBureau, { borderColor: theme.ligne }]}>
          <RetourHub theme={theme} onRetour={onRetour} titre="Tâches" />
        </View>
        <View style={styles.corps}>
          {laterale ? <View style={[styles.laterale, { borderColor: theme.ligne, width: width >= 1280 ? 264 : 232 }]}>{navigation}</View> : null}
          <View style={styles.principal}>
            <View style={[styles.barre, { borderColor: theme.ligne }]}>
              {!laterale ? <Bouton theme={theme} compact titre="☰" libelle="Espaces et projets" onPress={() => setFenetre({ g: 'navigation' })} testID="taches-navigation" /> : null}
              <View style={{ flex: 1, minWidth: 160, gap: 2 }}>
                <Text numberOfLines={1} style={titreDe(theme, 22)} testID="taches-titre">
                  {titreSelection}
                </Text>
                {projetSel && role === 'fondateur' && projetPartage(d, projetSel) ? (
                  <View style={styles.rangee}>
                    <PersonnesProjet a={actions} projetId={projetSel.id} taille={22} />
                    <Text style={attenueDe(theme)} numberOfLines={1}>
                      Partagé avec {membresDuProjet(d, projetSel.id).map(m => `${m.nom} (${LIBELLES_DROIT[m.droit].toLowerCase()})`).join(', ')}
                    </Text>
                  </View>
                ) : projetSel && role === 'ami' ? (
                  <View style={styles.rangee}>
                    <PersonnesProjet a={actions} projetId={projetSel.id} taille={22} />
                    <Text style={attenueDe(theme)}>Partagé par {etat.parFondateur} · {droits(projetSel.id).gerer ? 'admin du projet' : projetSel.partage === 'ecriture' ? 'vous pouvez modifier' : 'lecture seule'}</Text>
                  </View>
                ) : null}
              </View>
              {ongletsVues}
              {equipe || pilote ? null : recherche}
              {pastilleMinuteur}
              {outils}
            </View>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.contenu} keyboardShouldPersistTaps="handled">
              {barreRapide}
              {contenu}
            </ScrollView>
          </View>
          {detail && detailCote ? <View style={[styles.panneau, { borderColor: theme.ligne }]}>{detail}</View> : null}
        </View>
        {detail && !detailCote ? (
          <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            <Pressable accessibilityRole="button" accessibilityLabel="Fermer le détail" onPress={() => setOuverte(undefined)} style={[StyleSheet.absoluteFill, { backgroundColor: teinteTransparente('#000000', theme.sombre ? 0.5 : 0.25) }]} />
            <View style={[styles.panneauFlottant, { borderColor: theme.ligne, width: Math.min(440, width - 64) }]}>{detail}</View>
          </View>
        ) : null}
        {avisVue}
        {fenetres}
      </View>
    </ContexteZones.Provider>
  );
}

// ------------------------------------------------------------------ Navigation (barre latérale)

function LigneNav({ a, texte, actif, onPress, onLongPress, testID, couleur, gauche, droite, niveau = 0, compte }: { a: Actions; texte: string; actif: boolean; onPress(): void; onLongPress?(): void; testID: string; couleur?: string; gauche?: string; droite?: React.ReactNode; niveau?: number; compte?: number }) {
  const theme = a.theme;
  return (
    <View style={[styles.ligneNav, { paddingLeft: 6 + niveau * 16, backgroundColor: actif ? teinteTransparente(theme.accent, 0.16) : 'transparent', borderRadius: Math.min(theme.rayonMoyen, 10) }]}>
      <Pressable testID={testID} accessibilityRole="button" accessibilityState={{ selected: actif }} accessibilityHint={onLongPress ? 'Appui long ou touche Suppr : actions' : undefined} onPress={onPress} onLongPress={onLongPress} delayLongPress={550} style={styles.ligneNavBouton}>
        {couleur ? <View style={[styles.point, { backgroundColor: couleur }]} /> : gauche ? <Text style={{ color: actif ? theme.accent : theme.attenue, fontSize: 16, width: 18, textAlign: 'center' }}>{gauche}</Text> : null}
        <Text numberOfLines={1} style={[texteDe(theme), { flex: 1, fontWeight: actif ? '700' : '500', color: actif ? theme.texte : theme.texte }]}>
          {texte}
        </Text>
        {compte ? <Text style={attenueDe(theme)}>{compte}</Text> : null}
      </Pressable>
      {droite}
    </View>
  );
}

/** Ligne de la barre latérale qui reçoit une tâche glissée (souris ou doigt) : « projet:… » ou « liste:… ». */
function ZoneNav({ a, id, children }: { a: Actions; id: string; children: React.ReactNode }) {
  const zone = useZoneDepot(id);
  return (
    <View
      ref={zone.ref as never}
      testID={`zone-${id.replace(':', '-')}`}
      style={zone.survolee ? ({ backgroundColor: teinteTransparente(a.theme.accent, 0.24), borderRadius: Math.min(a.theme.rayonMoyen, 10), outlineColor: a.theme.accent, outlineWidth: 2, outlineStyle: 'solid' } as object) : undefined}>
      {children}
    </View>
  );
}

function Navigation({
  a,
  selection,
  onChoisir,
  onNouvelEspace,
  onNouveauProjet,
  onMenu,
  onCorbeille,
  nbCorbeille,
  onSupprimerVue,
}: {
  a: Actions;
  selection: Selection;
  onChoisir(s: Selection): void;
  onNouvelEspace(): void;
  onNouveauProjet(espaceId: string): void;
  onMenu(genre: 'espace' | 'projet' | 'liste', id: string): void;
  onCorbeille(): void;
  nbCorbeille: number;
  onSupprimerVue(id: string): void;
}) {
  const theme = a.theme;
  const d = a.etat.donnees;
  const fondateur = a.etat.role === 'fondateur';
  const vues = Object.values(d.vues).filter(vivant);
  const j = tachesVivantes(d).filter(t => !statutsDe(d, t.projetId).find(s => s.id === t.statut)?.ferme && t.echeance && t.echeance.jour <= a.etat.aujourdhui).length;
  const petitBouton = (titre: string, libelle: string, onPress: () => void, testID: string) => (
    <Pressable accessibilityRole="button" accessibilityLabel={libelle} onPress={onPress} testID={testID} style={styles.petitBouton}>
      <Text style={{ color: theme.attenue, fontSize: 17, fontWeight: '700' }}>{titre}</Text>
    </Pressable>
  );
  return (
    <ScrollView contentContainerStyle={{ padding: 10, gap: 2 }} testID="taches-navigation-liste">
      {a.etat.persoPermis || a.etat.perso ? (
        <View style={{ gap: 2, marginBottom: 8 }}>
          <LigneNav a={a} texte="Partagés avec moi" gauche="👥" actif={!a.etat.perso} onPress={() => a.etat.changerSource('partage')} testID="nav-source-partage" />
          <LigneNav a={a} texte="Mes projets (rien que pour moi)" gauche="🔒" actif={a.etat.perso} onPress={() => a.etat.changerSource('perso')} testID="nav-source-perso" />
        </View>
      ) : null}
      <LigneNav a={a} texte="Ma journée" gauche="☀︎" actif={selection.g === 'journee'} onPress={() => onChoisir({ g: 'journee' })} testID="nav-journee" compte={j} />
      <LigneNav a={a} texte="Toutes les tâches" gauche="▤" actif={selection.g === 'tout'} onPress={() => onChoisir({ g: 'tout' })} testID="nav-tout" />
      {fondateur ? <LigneNav a={a} texte="Objectifs" gauche="◎" actif={selection.g === 'objectifs'} onPress={() => onChoisir({ g: 'objectifs' })} testID="nav-objectifs" compte={Object.values(d.objectifs ?? {}).filter(vivant).length || undefined} /> : null}
      <LigneNav a={a} texte="Ta semaine" gauche="🗓" actif={selection.g === 'semaine'} onPress={() => onChoisir({ g: 'semaine' })} testID="nav-semaine" />
      {!a.etat.perso ? <LigneNav a={a} texte="Équipe" gauche="👥" actif={selection.g === 'equipe'} onPress={() => onChoisir({ g: 'equipe' })} testID="nav-equipe" compte={a.etat.role === 'fondateur' ? listeMembres(d).length || undefined : undefined} /> : null}
      {vues.length ? <Text style={[attenueDe(theme), styles.intertitre]}>VUES ENREGISTRÉES</Text> : null}
      {vues.map(v => (
        <LigneNav key={v.id} a={a} texte={v.nom} gauche="★" actif={selection.g === 'vue' && selection.id === v.id} onPress={() => onChoisir({ g: 'vue', id: v.id })} testID={`nav-vue-${v.id}`} droite={fondateur ? petitBouton('✕', `Supprimer la vue ${v.nom}`, () => onSupprimerVue(v.id), `nav-vue-supprimer-${v.id}`) : undefined} />
      ))}
      <View style={[styles.rangee, { marginTop: 10, justifyContent: 'space-between', flexWrap: 'nowrap' }]}>
        <Text style={[attenueDe(theme), styles.intertitre, { marginTop: 0 }]}>{fondateur ? 'ESPACES' : `PARTAGÉS PAR ${a.etat.parFondateur.toUpperCase()}`}</Text>
        {fondateur ? petitBouton('＋', 'Nouvel espace', onNouvelEspace, 'nav-nouvel-espace') : null}
      </View>
      {espacesVivants(d).map(e => {
        const projets = projetsDe(d, e.id);
        if (!fondateur && projets.length === 0) return null;
        return (
          <View key={e.id} style={{ gap: 2 }}>
            <View style={styles.espace}>
              <Pressable
                testID={`nav-espace-${e.id}`}
                accessibilityRole="button"
                accessibilityLabel={`Espace ${e.nom}`}
                accessibilityHint={fondateur ? 'Appui long ou touche Suppr : actions de l’espace' : undefined}
                disabled={!fondateur}
                onPress={fondateur ? () => onMenu('espace', e.id) : undefined}
                onLongPress={fondateur ? () => onMenu('espace', e.id) : undefined}
                delayLongPress={550}
                style={styles.espaceBouton}>
                <View style={[styles.carreEspace, { backgroundColor: e.couleur, borderRadius: 5 }]}>
                  <Text style={{ color: theme.surAccent, fontSize: 15, fontWeight: '800' }}>{e.nom[0]?.toUpperCase()}</Text>
                </View>
                <Text numberOfLines={1} style={[texteDe(theme), { flex: 1, fontWeight: '700' }]}>
                  {e.nom}
                </Text>
              </Pressable>
              {fondateur ? petitBouton('⋯', `Actions de l’espace ${e.nom} (supprimer…)`, () => onMenu('espace', e.id), `nav-espace-menu-${e.id}`) : null}
              {fondateur ? petitBouton('＋', `Nouveau projet dans ${e.nom}`, () => onNouveauProjet(e.id), `nav-nouveau-projet-${e.id}`) : null}
            </View>
            {projets.map(p => {
              const actif = selection.g === 'projet' && selection.id === p.id;
              return (
                <View key={p.id} style={{ gap: 2 }}>
                  <ZoneNav a={a} id={`projet:${p.id}`}>
                    <LigneNav
                    a={a}
                    niveau={1}
                    texte={`${p.icone ? `${p.icone} ` : ''}${p.nom}${fondateur && projetPartage(d, p) ? '  👥' : ''}${!fondateur && p.partage === 'lecture' ? '  👁' : ''}`}
                    couleur={p.couleur}
                    actif={actif && !selection.liste}
                    onPress={() => onChoisir({ g: 'projet', id: p.id })}
                    onLongPress={fondateur || a.droits(p.id).gerer ? () => onMenu('projet', p.id) : undefined}
                    testID={`nav-projet-${p.id}`}
                    compte={tachesVivantes(d, p.id).filter(t => !t.parentId && !statutsDe(d, p.id).find(s => s.id === t.statut)?.ferme).length}
                    droite={fondateur || a.droits(p.id).gerer ? petitBouton('⋯', `Actions du projet ${p.nom} (réglages${fondateur ? ', supprimer…' : ''})`, () => onMenu('projet', p.id), `nav-projet-menu-${p.id}`) : undefined}
                    />
                  </ZoneNav>
                  {actif && listesDe(d, p.id).length > 1
                    ? listesDe(d, p.id).map(l => (
                        <ZoneNav key={l.id} a={a} id={`liste:${l.id}`}>
                          <LigneNav
                          a={a}
                          niveau={2}
                          gauche="·"
                          texte={l.nom}
                          actif={selection.g === 'projet' && selection.liste === l.id}
                          onPress={() => onChoisir({ g: 'projet', id: p.id, liste: l.id })}
                          onLongPress={fondateur ? () => onMenu('liste', l.id) : undefined}
                          testID={`nav-liste-${l.id}`}
                          droite={fondateur ? petitBouton('⋯', `Actions de la liste ${l.nom} (supprimer…)`, () => onMenu('liste', l.id), `nav-liste-menu-${l.id}`) : undefined}
                          />
                        </ZoneNav>
                      ))
                    : null}
                </View>
              );
            })}
          </View>
        );
      })}
      {fondateur && espacesVivants(d).length === 0 ? <Text style={[attenueDe(theme), { padding: 8 }]}>Aucun espace : créez-en un avec ＋.</Text> : null}
      {fondateur || nbCorbeille > 0 ? (
        <View style={{ marginTop: 12 }}>
          <LigneNav a={a} texte="Corbeille" gauche="🗑" actif={false} onPress={onCorbeille} testID="nav-corbeille" compte={nbCorbeille} />
        </View>
      ) : null}
    </ScrollView>
  );
}

// ------------------------------------------------------------------ Fenêtres

function Fenetres({
  a,
  fenetre,
  onFermer,
  navigation,
  filtres,
  tri,
  groupe,
  projetId,
  amis,
  onFiltres,
  onEnregistrerVue,
  onSelection,
  onOuvrir,
  onErreur,
  onAvis,
  menu,
  menuVue,
  onCorbeilleRestaurer,
  onCorbeilleEffacer,
  onCorbeilleVider,
  contexte,
  onAller,
  onOuvertureChangee,
  comptes,
  onParametres,
  onDeplacer,
}: {
  a: Actions;
  fenetre?: Fenetre;
  onFermer(): void;
  navigation: React.ReactNode;
  filtres: Filtres;
  tri: Tri;
  groupe: Groupe;
  projetId?: string;
  amis: ReadonlyArray<{ id: string; nom: string }>;
  onFiltres(f: Filtres, t: Tri, g: Groupe): void;
  onEnregistrerVue(nom: string): void;
  onSelection(s: Selection): void;
  onOuvrir(id: string): void;
  onErreur(e: unknown): void;
  onAvis(t: string): void;
  menu(genre: 'espace' | 'projet' | 'liste', id: string): ElementMenu[];
  menuVue(): ElementMenu[];
  onCorbeilleRestaurer(e: ElementCorbeille): void;
  onCorbeilleEffacer(e: ElementCorbeille): void;
  onCorbeilleVider(): void;
  contexte: PropsRacineApp['contexte'];
  onAller(f: Fenetre): void;
  onOuvertureChangee(o: Ouverture): void;
  comptes: readonly Profil[];
  onParametres?(): void;
  onDeplacer(ids: readonly string[], dest: Destination, o: OptionsDeplacement): void;
}) {
  if (!fenetre) return null;
  const d = a.etat.donnees;
  const theme = a.theme;
  const essayer = (f: () => void) => {
    try {
      f();
    } catch (e) {
      onErreur(e);
    }
  };
  switch (fenetre.g) {
    case 'navigation':
      return (
        <DialogueNavigation a={a} onFermer={onFermer}>
          {navigation}
        </DialogueNavigation>
      );
    case 'statut': {
      const t = d.taches[fenetre.t.id] ?? fenetre.t;
      return (
        <DialogueChoix
          a={a}
          titre="Statut"
          testID="choix-statut"
          valeur={t.statut}
          options={statutsDe(d, t.projetId).map(s => ({ valeur: s.id, texte: s.nom, couleur: s.couleur, detail: s.ferme ? 'Terminé' : undefined }))}
          onChoisir={v => {
            const ferme = statutsDe(d, t.projetId).find(s => s.id === v)?.ferme;
            const etaitFerme = statutsDe(d, t.projetId).find(s => s.id === t.statut)?.ferme;
            if (ferme && !etaitFerme) a.basculer(t.id);
            else a.changer(t.id, { statut: v });
          }}
          onFermer={onFermer}
        />
      );
    }
    case 'priorite':
      return (
        <DialogueChoix
          a={a}
          titre="Priorité"
          testID="choix-priorite"
          valeur={fenetre.t.priorite}
          options={PRIORITES.map(p => ({ valeur: p, texte: LIBELLES_PRIORITE[p], couleur: couleurPriorite(p, theme) }))}
          onChoisir={v => a.changer(fenetre.t.id, { priorite: v })}
          onFermer={onFermer}
        />
      );
    case 'assigne': {
      // Plusieurs personnes : chaque choix ajoute ou retire (les personnes du projet).
      const t = d.taches[fenetre.t.id] ?? fenetre.t;
      const choisis = assignesDe(t);
      const options = [{ valeur: '~personne', texte: 'Personne' }, ...personnesPour(a, t.projetId).map(p => ({ valeur: p.code, texte: `${p.nom}${p.code === a.etat.moi ? ' (moi)' : ''}` }))];
      return (
        <Dialogue theme={theme} mobile={a.mobile} visible titre="Pour qui ?" description="Une ou plusieurs personnes du projet." onFermer={onFermer} testID="choix-assigne">
          <Options
            theme={theme}
            multiple
            valeur={choisis.length ? choisis : ['~personne']}
            options={options}
            onChoisir={v => a.changer(t.id, { assignes: v === '~personne' ? [] : choisis.includes(v) ? choisis.filter(x => x !== v) : [...choisis, v] })}
            testID="choix-assigne"
          />
        </Dialogue>
      );
    }
    case 'liste':
      return (
        <DialogueChoix
          a={a}
          titre="Déplacer vers la liste"
          testID="choix-liste"
          valeur={fenetre.t.listeId}
          options={listesDe(d, fenetre.t.projetId).map(l => ({ valeur: l.id, texte: l.nom }))}
          onChoisir={v => a.changer(fenetre.t.id, { listeId: v })}
          onFermer={onFermer}
        />
      );
    case 'echeance':
      return <DialogueEcheance a={a} t={d.taches[fenetre.t.id] ?? fenetre.t} onFermer={onFermer} />;
    case 'recurrence':
      return <DialogueRecurrence a={a} t={d.taches[fenetre.t.id] ?? fenetre.t} onFermer={onFermer} />;
    case 'rappels':
      return <DialogueRappels a={a} t={d.taches[fenetre.t.id] ?? fenetre.t} onFermer={onFermer} />;
    case 'filtres':
      return <DialogueFiltres a={a} filtres={filtres} tri={tri} groupe={groupe} projetId={projetId} onChanger={onFiltres} onEnregistrerVue={onEnregistrerVue} onFermer={onFermer} />;
    case 'reglages':
      return (
        <DialogueReglages
          a={a}
          amis={amis}
          ouverture={lireAffichage(contexte.baseProfil?.lire(CLES_TACHES.affichage)).ouverture ?? 'calendrier-semaine'}
          onOuverture={o => {
            const b = contexte.baseProfil;
            if (b) b.ecrire(CLES_TACHES.affichage, JSON.stringify({ ...lireAffichage(b.lire(CLES_TACHES.affichage)), ouverture: o }));
            onOuvertureChangee(o);
          }}
          onNotifications={() => onAller({ g: 'notifications' })}
          onMembres={() => onAller({ g: 'membres' })}
          onAides={() => onAller({ g: 'aides' })}
          {...(onParametres ? { onParametres } : {})}
          onLiens={() => onAller({ g: 'liens' })}
          onReleve={() => onAller({ g: 'releve' })}
          onFermer={onFermer}
          onErreur={onErreur}
          onDemo={() =>
            essayer(() => {
              let pid = '';
              a.etat.maj((x, ctx) => {
                const r = ajouterDemo(x, ctx, a.etat.aujourdhui);
                pid = r.projetId;
                return r.donnees;
              });
              onSelection({ g: 'projet', id: pid });
              onAvis('Exemple ajouté : espace « Exemple ».');
              onFermer();
            })
          }
          onRetirerDemo={() =>
            essayer(() => {
              a.etat.maj((x, ctx) => retirerDemo(x, ctx));
              onAvis('Exemple retiré.');
              onFermer();
            })
          }
        />
      );
    case 'projet':
      return (
        <DialogueProjet
          a={a}
          projetId={fenetre.id}
          onFermer={onFermer}
          onErreur={onErreur}
          onSupprimer={() => {
            onFermer();
            a.demanderSuppression('projet', fenetre.id);
          }}
          onMembres={() => onAller({ g: 'membres' })}
        />
      );
    case 'menu': {
      const e = fenetre.genre === 'espace' ? d.espaces[fenetre.id] : fenetre.genre === 'projet' ? d.projets[fenetre.id] : d.listes[fenetre.id];
      return <DialogueMenu a={a} titre={`${fenetre.genre === 'espace' ? 'Espace' : fenetre.genre === 'projet' ? 'Projet' : 'Liste'} « ${e?.nom ?? ''} »`} elements={menu(fenetre.genre, fenetre.id)} onFermer={onFermer} testID="dialogue-menu" />;
    }
    case 'menu-vue':
      return <DialogueMenu a={a} titre="Actions" elements={menuVue()} onFermer={onFermer} testID="dialogue-menu" />;
    case 'supprimer':
      return <DialogueSuppression a={a} genre={fenetre.genre} id={fenetre.id} onFermer={onFermer} onConfirmer={vers => a.supprimer(fenetre.genre, fenetre.id, vers)} />;
    case 'notifications':
      return (
        <DialogueNotifications
          a={a}
          appareil={appareilTaches(contexte.baseProfil)}
          systemeDisponible={notificationSystemeDisponible()}
          onTester={() => {
            const r = testerNotification(contexte, Date.now());
            a.etat.relire();
            onAvis(
              `${r.systeme ? 'Notification du système envoyée' : 'Pas de notification du système ici (application du PC, ou navigateur autorisé) : la pastille 🔔 la montre'}.${r.calme ? ' Heures calmes en cours : les vraies notifications attendront.' : ''}${r.autreAppareil ? ' Un autre appareil est choisi pour les notifications du système.' : ''}`,
            );
          }}
          onFermer={onFermer}
        />
      );
    case 'liens':
      return (
        <DialogueLiens
          a={a}
          onFermer={onFermer}
          onSynchroniser={() => {
            reinitialiserLiens();
            verifierRappels(contexte, Date.now());
            a.etat.relire();
            onAvis('Liens mis à jour.');
          }}
        />
      );
    case 'releve':
      return (
        <DialogueReleve
          a={a}
          onFermer={onFermer}
          onOuvrir={onOuvrir}
          onExporter={(nom, csv) => {
            const enregistrer = contexte.enregistrerFichier;
            if (!enregistrer) {
              onErreur(new Error('Export indisponible sur cet appareil.'));
              return;
            }
            void enregistrer(nom, csv, 'text/csv').then(ok => ok && onAvis(`Relevé exporté : ${nom}.`), onErreur);
          }}
        />
      );
    case 'journal':
      return (
        <DialogueJournal
          a={a}
          {...(fenetre.projetId ? { projetId: fenetre.projetId } : {})}
          {...(fenetre.tacheId ? { tacheId: fenetre.tacheId } : {})}
          {...(fenetre.onglet ? { ongletInitial: fenetre.onglet } : {})}
          onFermer={onFermer}
          onOuvrir={onOuvrir}
          onErreur={onErreur}
          onAvis={onAvis}
          onExporter={
            contexte.enregistrerFichier
              ? (nom, contenu) => void contexte.enregistrerFichier!(nom, contenu, nom.endsWith('.md') ? 'text/markdown' : 'text/plain').then(ok => ok && onAvis(`Débriefing exporté : ${nom}.`), onErreur)
              : undefined
          }
        />
      );
    case 'espace-modifier':
      return <DialogueEspace a={a} id={fenetre.id} onFermer={onFermer} onErreur={onErreur} />;
    case 'liste-renommer': {
      const l = d.listes[fenetre.id];
      return (
        <DialogueNom
          a={a}
          titre="Renommer la liste"
          placeholder="Nom de la liste"
          initial={l?.nom}
          bouton="Renommer"
          testID="renommer-liste"
          onFermer={onFermer}
          onValider={nom => essayer(() => a.etat.maj((x, ctx) => modifierListe(x, fenetre.id, { nom }, ctx)))}
        />
      );
    }
    case 'temps':
      return <DialogueTemps a={a} t={d.taches[fenetre.t.id] ?? fenetre.t} onFermer={onFermer} onErreur={onErreur} />;
    case 'corbeille':
      return <DialogueCorbeille a={a} onFermer={onFermer} onRestaurer={onCorbeilleRestaurer} onEffacer={onCorbeilleEffacer} onVider={onCorbeilleVider} />;
    case 'espace':
      return (
        <DialogueNom
          a={a}
          titre="Nouvel espace"
          description="Un espace regroupe des projets (ex. Perso, Travail, Association). Un premier projet y est créé."
          placeholder="Nom de l’espace"
          testID="nouvel-espace"
          onFermer={onFermer}
          onValider={nom =>
            essayer(() => {
              let pid = '';
              a.etat.maj((x, ctx) => {
                const e = creerEspace(x, nom, ctx);
                const p = creerProjet(e.donnees, e.espace.id, 'Premier projet', ctx);
                pid = p.projet.id;
                return p.donnees;
              });
              onSelection({ g: 'projet', id: pid });
              onAvis('Espace créé, avec un premier projet à renommer (⚙︎ Projet).');
            })
          }
        />
      );
    case 'nouveau-projet':
      return (
        <DialogueNom
          a={a}
          titre="Nouveau projet"
          description={`Dans l’espace « ${d.espaces[fenetre.espaceId]?.nom ?? ''} ». Statuts par défaut : À faire, En cours, En revue, Fait (modifiables).`}
          placeholder="Nom du projet"
          testID="nouveau-projet"
          onFermer={onFermer}
          onValider={nom =>
            essayer(() => {
              let pid = '';
              a.etat.maj((x, ctx) => {
                const p = creerProjet(x, fenetre.espaceId, nom, ctx);
                pid = p.projet.id;
                return p.donnees;
              });
              onSelection({ g: 'projet', id: pid });
            })
          }
        />
      );
    case 'membres':
      return <DialogueMembres a={a} comptes={comptes} onFermer={onFermer} onErreur={onErreur} onAvis={onAvis} />;
    case 'aides':
      return a.aides ? <DialogueAides a={a} onFermer={onFermer} onAvis={onAvis} onErreur={onErreur} /> : null;
    case 'ia':
      return a.aides ? <DialogueIA a={a} cible={fenetre.cible} onFermer={onFermer} onAvis={onAvis} onErreur={onErreur} /> : null;
    case 'menu-ia':
      return (
        <DialogueMenu
          a={a}
          titre="✨ Aide de l’IA"
          elements={[
            { texte: '🗓 Proposer un planning de la semaine', testID: 'menu-ia-planning', action: () => onAller({ g: 'ia', cible: { genre: 'planning' } }) },
            ...(projetId ? [{ texte: '📝 Résumer ce projet', testID: 'menu-ia-resumer', action: () => onAller({ g: 'ia', cible: { genre: 'resumer', projetId } }) }] : []),
            { texte: '⚙︎ Réglages de l’IA et de GitHub', testID: 'menu-ia-reglages', action: () => onAller({ g: 'aides' }) },
          ]}
          onFermer={onFermer}
          testID="dialogue-menu-ia"
        />
      );
    case 'objectif':
      return <DialogueObjectif a={a} {...(fenetre.id ? { id: fenetre.id } : {})} onFermer={onFermer} onErreur={onErreur} onAvis={onAvis} />;
    case 'dependance': {
      const t = d.taches[fenetre.t.id] ?? fenetre.t;
      return (
        <DialogueChoix
          a={a}
          titre={`« ${t.titre} » dépend de…`}
          testID="choix-dependance"
          options={optionsDependance(a, t)}
          onChoisir={v =>
            essayer(() => {
              const viole = ajouterDependance(a, t, v);
              onAvis(viole ? 'Dépendance ajoutée — elle n’est pas respectée : « Décaler » dans le détail.' : 'Dépendance ajoutée.');
            })
          }
          onFermer={onFermer}
        />
      );
    }
    case 'deplacer':
      return (
        <DialogueDeplacer
          a={a}
          ids={fenetre.ids}
          {...(fenetre.dest ? { initiale: fenetre.dest } : {})}
          {...(fenetre.mode ? { mode: fenetre.mode } : {})}
          onFermer={onFermer}
          onDeplacer={(dest, o) => {
            onFermer();
            onDeplacer(fenetre.ids, dest, o);
          }}
        />
      );
    case 'menu-tache': {
      const t = d.taches[fenetre.t.id] ?? fenetre.t;
      const sel = a.selection;
      return (
        <DialogueMenu
          a={a}
          titre={`Tâche « ${t.titre} »`}
          elements={elementsMenuTache(a, t, {
            onDeplacer: () => onAller({ g: 'deplacer', ids: [t.id] }),
            onParent: () => onAller({ g: 'deplacer', ids: [t.id], mode: 'parents' }),
            onPrincipale: () => onDeplacer([t.id], { listeId: t.listeId, parentId: null }, {}),
            ...(sel ? { onSelectionner: () => !sel.ids.includes(t.id) && sel.basculer(t.id, 'ajout') } : {}),
            onSupprimer: () => a.demanderSuppression('tache', t.id),
          })}
          onFermer={onFermer}
          testID="dialogue-menu-tache"
        />
      );
    }
    case 'rappels-recus':
      return (
        <DialogueRappelsRecus
          a={a}
          rappels={a.etat.rappels}
          onOuvrir={onOuvrir}
          onSemaine={() => {
            onSelection({ g: 'semaine' });
            onFermer();
          }}
          onToutLu={() => {
            a.etat.rappelsLus();
            onFermer();
          }}
          onFermer={onFermer}
        />
      );
  }
}

function DialogueNavigation({ a, onFermer, children }: { a: Actions; onFermer(): void; children: React.ReactNode }) {
  // Sur téléphone et iPad portrait : la barre latérale en feuille.
  return (
    <Dialogue theme={a.theme} mobile visible titre="Espaces et projets" onFermer={onFermer} testID="dialogue-navigation">
      <View style={{ marginHorizontal: -16 }}>{children}</View>
    </Dialogue>
  );
}

const styles = StyleSheet.create({
  racine: { flex: 1, minHeight: 0 },
  enteteBureau: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  enteteMobile: { paddingHorizontal: 16, paddingTop: 8 },
  barreMobile: { paddingHorizontal: 12, paddingVertical: 6, flexWrap: 'nowrap' },
  corps: { flex: 1, flexDirection: 'row', minHeight: 0 },
  laterale: { borderRightWidth: StyleSheet.hairlineWidth },
  principal: { flex: 1, minWidth: 0 },
  barre: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 12, flexWrap: 'wrap', borderBottomWidth: StyleSheet.hairlineWidth },
  contenu: { padding: 20, gap: 16, paddingBottom: 60 },
  panneau: { width: 420, borderLeftWidth: StyleSheet.hairlineWidth },
  panneauFlottant: { position: 'absolute', right: 0, top: 0, bottom: 0, borderLeftWidth: 1, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 24, shadowOffset: { width: -4, height: 0 } },
  onglets: { flexDirection: 'row', borderWidth: 1, padding: 3, gap: 3 },
  onglet: { minHeight: 38, paddingHorizontal: 12, justifyContent: 'center', alignItems: 'center' },
  rangee: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  rapide: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, paddingLeft: 14, paddingRight: 6, minHeight: 50 },
  champRapide: { flex: 1, minHeight: 46, paddingVertical: 8, outlineStyle: 'none' } as object,
  piedMobile: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 12, paddingBottom: 16, borderTopWidth: StyleSheet.hairlineWidth },
  avis: { position: 'absolute', left: 0, right: 0, bottom: 24, alignItems: 'center', paddingHorizontal: 16 },
  avisTexte: { paddingHorizontal: 16, paddingVertical: 10, overflow: 'hidden', maxWidth: 560 },
  ligneNav: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  ligneNavBouton: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingRight: 8 },
  point: { width: 10, height: 10, borderRadius: 5, marginLeft: 4 },
  intertitre: { fontWeight: '700', letterSpacing: 0.6, marginTop: 12, marginBottom: 4, paddingLeft: 6 },
  espace: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 44, paddingLeft: 6, marginTop: 6 },
  espaceBouton: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  carreEspace: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  petitBouton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
