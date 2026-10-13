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
import { lireAjoutRapide } from '../ajoutRapide';
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
  modifierTache,
  PRIORITES,
  projetsDe,
  statutsDe,
  supprimerVue,
  tachesVivantes,
  vivant,
  type Auteur,
  type Filtres,
  type Groupe,
  type Tache,
  type Tri,
  type TypeVue,
} from '../modele';
import { CLES_TACHES } from '../partage';
import { rouvrirTache, terminerTache } from '../recurrence';
import type { Actions } from './actions';
import { attenueDe, Bouton, Champ, couleurPriorite, Dialogue, EtatVide, Puce, T, texteDe, titreDe } from './atomes';
import { DetailTache } from './Detail';
import { DialogueChoix, DialogueEcheance, DialogueFiltres, DialogueNom, DialogueProjet, DialogueRappels, DialogueRappelsRecus, DialogueRecurrence, DialogueReglages } from './Dialogues';
import { useEtatTaches } from './etat';
import { ContexteZones, RegistreZones } from './glisser';
import { VueCalendrier, VueJournee, VueKanban, VueListe } from './Vues';

type Selection = { g: 'journee' } | { g: 'tout' } | { g: 'projet'; id: string; liste?: string } | { g: 'vue'; id: string };

type Fenetre =
  | { g: 'statut' | 'priorite' | 'assigne' | 'echeance' | 'recurrence' | 'rappels' | 'liste'; t: Tache }
  | { g: 'filtres' }
  | { g: 'reglages' }
  | { g: 'projet'; id: string }
  | { g: 'espace' }
  | { g: 'nouveau-projet'; espaceId: string }
  | { g: 'rappels-recus' }
  | { g: 'navigation' };

const VUES: ReadonlyArray<[TypeVue, string, string]> = [
  ['liste', 'Liste', '☰'],
  ['kanban', 'Kanban', '▥'],
  ['calendrier', 'Calendrier', '▦'],
  ['journee', 'Ma journée', '☀︎'],
];

interface Affichage {
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

function AppTaches({ contexte, theme, onRetour }: PropsRacineApp) {
  const mobile = useMobile();
  const { width } = useWindowDimensions();
  const etat = useEtatTaches(contexte);
  const d = etat.donnees;
  const role = etat.role;
  const base = contexte.baseProfil!;
  const registre = useMemo(() => new RegistreZones(), []);
  const affichageInitial = useMemo(() => lireAffichage(base.lire(CLES_TACHES.affichage)), [base]);

  const [selection, setSelection] = useState<Selection>(affichageInitial.selection ?? { g: 'journee' });
  const [vue, setVue] = useState<TypeVue>(affichageInitial.vue ?? 'liste');
  const [filtres, setFiltres] = useState<Filtres>(FILTRES_DEFAUT);
  const [tri, setTri] = useState<Tri>(affichageInitial.tri ?? 'manuel');
  const [groupe, setGroupe] = useState<Groupe>(affichageInitial.groupe ?? 'statut');
  const [modeCal, setModeCal] = useState<'mois' | 'semaine'>(affichageInitial.calendrier ?? 'mois');
  const [jourCal, setJourCal] = useState(etat.aujourdhui);
  const [ouverte, setOuverte] = useState<string | undefined>();
  const [fenetre, setFenetre] = useState<Fenetre | undefined>();
  const [avis, setAvis] = useState<{ texte: string; genre: 'ok' | 'erreur' } | undefined>();
  const [rapide, setRapide] = useState('');
  const [dernierProjet, setDernierProjet] = useState(affichageInitial.dernierProjet);
  const champRapide = useRef<Cible | null>(null);
  const champRecherche = useRef<Cible | null>(null);

  // Préférences d'affichage de l'appareil.
  useEffect(() => {
    const valeur: Affichage = { selection, vue, tri, groupe, calendrier: modeCal, dernierProjet };
    const texte = JSON.stringify(valeur);
    if (texte !== base.lire(CLES_TACHES.affichage)) base.ecrire(CLES_TACHES.affichage, texte);
  }, [base, selection, vue, tri, groupe, modeCal, dernierProjet]);

  // Avis éphémère.
  useEffect(() => {
    if (!avis) return undefined;
    const t = setTimeout(() => setAvis(undefined), avis.genre === 'erreur' ? 6000 : 3500);
    return () => clearTimeout(t);
  }, [avis]);

  // Sélection devenue invalide (projet supprimé, plus partagé) : retour à Ma journée.
  const projetSel = selection.g === 'projet' ? d.projets[selection.id] : undefined;
  const vueSel = selection.g === 'vue' ? d.vues[selection.id] : undefined;
  useEffect(() => {
    if ((selection.g === 'projet' && !vivant(projetSel)) || (selection.g === 'vue' && !vivant(vueSel))) setSelection({ g: 'journee' });
  }, [selection, projetSel, vueSel]);

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
  const toutes = useMemo(() => tachesVivantes(d, projetId).filter(t => !listeId || t.listeId === listeId), [d, projetId, listeId]);
  const visibles = useMemo(() => {
    const f = filtrer(d, toutes, filtres, etat.aujourdhui);
    const sansSous = vueEffective === 'liste' || vueEffective === 'kanban' ? f.filter(t => !t.parentId || (filtres.recherche.trim() !== '' && !f.some(p => p.id === t.parentId))) : f;
    return trier(d, sansSous, tri);
  }, [d, toutes, filtres, etat.aujourdhui, vueEffective, tri]);

  const droits = useCallback((pid: string) => droitsProjet(role, d, pid), [role, d]);
  const projetsModifiables = projetsDe(d).filter(p => droits(p.id).modifier);

  // --- Actions
  const noms = etat.noms;
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
        etat.maj((x, ctx) => {
          if (ferme) return rouvrirTache(x, id, ctx, noms);
          const r = terminerTache(x, id, ctx, etat.aujourdhui, noms);
          suivante = r.suivante;
          return r.donnees;
        });
        if (!ferme) setAvis({ texte: suivante ? `« ${t.titre} » terminée — prochaine occurrence créée.` : `« ${t.titre} » terminée.`, genre: 'ok' });
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
  };

  // --- Ajout rapide
  const listeCible = (): string | undefined => {
    if (selection.g === 'projet' && droits(selection.id).modifier) return selection.liste ?? listesDe(d, selection.id)[0]?.id;
    const pid = projetId && droits(projetId).modifier ? projetId : dernierProjet && vivant(d.projets[dernierProjet]) && droits(dernierProjet).modifier ? dernierProjet : projetsModifiables[0]?.id;
    return pid ? listesDe(d, pid)[0]?.id : undefined;
  };
  const lu = rapide.trim() ? lireAjoutRapide(rapide, { aujourdhui: etat.aujourdhui, auteur: role, noms, avecAmi: role === 'ami' || Boolean(d.reglages.ami) }) : undefined;
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
            ...(lu.assigne ? { assigne: lu.assigne } : {}),
            ...(lu.recurrence ? { recurrence: lu.recurrence } : {}),
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
  const etatClavier = useRef({ fenetre, ouverte });
  etatClavier.current = { fenetre, ouverte };
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
        if (etatClavier.current.fenetre) {
          arreter();
          setFenetre(undefined);
        } else if (etatClavier.current.ouverte) {
          arreter();
          e.target?.blur?.();
          setOuverte(undefined);
        } else if (champ) {
          arreter();
          e.target?.blur?.();
        }
        return;
      }
      if (champ || e.ctrlKey || e.metaKey || e.altKey || etatClavier.current.fenetre) return;
      if (e.key === 'n' || e.key === 'N') {
        arreter();
        champRapide.current?.focus();
      } else if (e.key === '/') {
        arreter();
        champRecherche.current?.focus();
      } else if (['1', '2', '3', '4'].includes(e.key)) {
        arreter();
        const v = VUES[Number(e.key) - 1][0];
        if (v === 'journee') setSelection({ g: 'journee' });
        else {
          setVue(v);
          setSelection(s => (s.g === 'journee' ? { g: 'tout' } : s));
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
      if (selection.g === 'journee') setSelection({ g: 'tout' });
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
    selection.g === 'journee' ? 'Ma journée' : selection.g === 'tout' ? 'Toutes les tâches' : selection.g === 'vue' ? (vueSel?.nom ?? 'Vue') : `${projetSel?.nom ?? 'Projet'}${listeId ? ` › ${d.listes[listeId]?.nom ?? ''}` : ''}`;
  const nbFiltres = filtresActifs(filtres) - (filtres.recherche.trim() ? 1 : 0);
  const aucunProjet = projetsDe(d).length === 0;

  // --- Contenu principal
  const contenu = aucunProjet ? (
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
      <EtatVide theme={theme} testID="taches-rien-partage" titre="Rien n’est partagé avec vous pour l’instant" texte={`Quand ${noms.fondateur} partagera un projet avec vous, il apparaîtra ici (la synchronisation peut prendre une ou deux minutes).`} />
    )
  ) : vueEffective === 'journee' ? (
    <VueJournee a={actions} taches={filtrer(d, toutes, filtres, etat.aujourdhui)} qui={role} />
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
    <VueListe a={actions} taches={visibles} groupe={groupe} projetId={projetId} />
  );

  // --- Barre latérale (aussi en feuille sur téléphone / iPad portrait)
  const navigation = (
    <Navigation
      a={actions}
      selection={selection}
      onChoisir={choisirSelection}
      onNouvelEspace={() => setFenetre({ g: 'espace' })}
      onNouveauProjet={espaceId => setFenetre({ g: 'nouveau-projet', espaceId })}
      onProjet={id => setFenetre({ g: 'projet', id })}
      onSupprimerVue={id => essayer(() => etat.maj((x, ctx) => supprimerVue(x, id, ctx)))}
    />
  );

  const barreRapide = (projetsModifiables.length > 0 || role === 'fondateur') && !aucunProjet ? (
    <View style={{ gap: 6 }}>
      <View style={[styles.rapide, { borderColor: rapide ? theme.accent : theme.ligne, backgroundColor: theme.surface, borderRadius: Math.min(theme.rayonMoyen, 12) }]}>
        <Text style={{ color: theme.accent, fontSize: 20, fontWeight: '700' }}>＋</Text>
        <TextInput
          ref={champRapide as never}
          testID="ajout-rapide"
          value={rapide}
          onChangeText={setRapide}
          onSubmitEditing={ajouter}
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
          {lu.assigne ? <Puce theme={theme} texte={`@ ${noms[lu.assigne]}`} couleur={theme.teintes.admin} /> : null}
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

  const ongletsVues = (
    <View style={[styles.onglets, { borderColor: theme.ligne, borderRadius: Math.min(theme.rayonMoyen, 12) }]} accessibilityRole="tablist">
      {VUES.map(([v, libelle, icone], i) => {
        const actif = vueEffective === v;
        return (
          <Pressable
            key={v}
            testID={`onglet-${v}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: actif }}
            accessibilityLabel={`${libelle} (touche ${i + 1})`}
            onPress={() => choisirVue(v)}
            style={[styles.onglet, mobile && { flex: 1, paddingHorizontal: 4, minHeight: 44 }, { backgroundColor: actif ? theme.accent : 'transparent', borderRadius: Math.min(theme.rayonMoyen, 9) }]}>
            <Text numberOfLines={1} style={{ color: actif ? theme.surAccent : theme.texte, fontSize: 15, fontWeight: '600' }}>
              {mobile ? (v === 'journee' ? '☀︎ Jour' : v === 'calendrier' ? '▦ Agenda' : `${icone} ${libelle}`) : `${icone}  ${libelle}`}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  const outils = (
    <View style={styles.rangee}>
      {selection.g === 'projet' && role === 'fondateur' && projetSel ? <Bouton theme={theme} compact={!mobile} titre="⚙︎ Projet" onPress={() => setFenetre({ g: 'projet', id: projetSel.id })} testID="taches-projet-reglages" /> : null}
      <Bouton theme={theme} compact={!mobile} titre={nbFiltres ? `Filtres · ${nbFiltres}` : 'Filtres'} onPress={() => setFenetre({ g: 'filtres' })} testID="taches-filtres" />
      <Bouton theme={theme} compact={!mobile} titre={etat.rappels.length ? `🔔 ${etat.rappels.length}` : '🔔'} libelle={`Rappels : ${etat.rappels.length} non lu(s)`} onPress={() => setFenetre({ g: 'rappels-recus' })} testID="taches-rappels" />
      <Bouton theme={theme} compact={!mobile} titre={role === 'fondateur' ? '👥 Partage' : '👥 Partagés'} libelle={role === 'fondateur' ? 'Réglages de Tâches : ami, partage, exemple' : 'Projets partagés avec moi'} onPress={() => setFenetre({ g: 'reglages' })} testID="taches-reglages" />
    </View>
  );

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
    />
  ) : null;

  const avisVue = avis ? (
    <View pointerEvents="none" style={[styles.avis, mobile && { bottom: 96 }]}>
      <Text testID="taches-avis" accessibilityLiveRegion="polite" style={[texteDe(theme), styles.avisTexte, { backgroundColor: avis.genre === 'erreur' ? theme.critique : theme.texte, color: theme.fond, borderRadius: Math.min(theme.rayonMoyen, 10) }]}>
        {avis.texte}
      </Text>
    </View>
  ) : null;

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
            <Bouton theme={theme} titre="👥" libelle={role === 'fondateur' ? 'Réglages de Tâches : ami, partage, exemple' : 'Projets partagés avec moi'} onPress={() => setFenetre({ g: 'reglages' })} testID="taches-reglages" />
          </View>
          <View style={{ paddingHorizontal: 16, gap: 10 }}>
            {ongletsVues}
            <View style={[styles.rangee, { flexWrap: 'nowrap' }]}>
              <View style={{ flex: 1 }}>{recherche}</View>
              <Bouton theme={theme} titre={nbFiltres ? `Filtres · ${nbFiltres}` : 'Filtres'} onPress={() => setFenetre({ g: 'filtres' })} testID="taches-filtres" />
              {selection.g === 'projet' && role === 'fondateur' && projetSel ? <Bouton theme={theme} titre="⚙︎" libelle="Réglages du projet" onPress={() => setFenetre({ g: 'projet', id: projetSel.id })} testID="taches-projet-reglages" /> : null}
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
                {projetSel && role === 'fondateur' && projetSel.partage !== 'aucun' && d.reglages.amiNom ? (
                  <Text style={attenueDe(theme)}>Partagé avec {d.reglages.amiNom} · {projetSel.partage === 'ecriture' ? 'écriture' : 'lecture seule'}</Text>
                ) : projetSel && role === 'ami' ? (
                  <Text style={attenueDe(theme)}>Partagé par {noms.fondateur} · {projetSel.partage === 'ecriture' ? 'vous pouvez modifier' : 'lecture seule'}</Text>
                ) : null}
              </View>
              {ongletsVues}
              {recherche}
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

function LigneNav({ a, texte, actif, onPress, testID, couleur, gauche, droite, niveau = 0, compte }: { a: Actions; texte: string; actif: boolean; onPress(): void; testID: string; couleur?: string; gauche?: string; droite?: React.ReactNode; niveau?: number; compte?: number }) {
  const theme = a.theme;
  return (
    <View style={[styles.ligneNav, { paddingLeft: 6 + niveau * 16, backgroundColor: actif ? teinteTransparente(theme.accent, 0.16) : 'transparent', borderRadius: Math.min(theme.rayonMoyen, 10) }]}>
      <Pressable testID={testID} accessibilityRole="button" accessibilityState={{ selected: actif }} onPress={onPress} style={styles.ligneNavBouton}>
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

function Navigation({
  a,
  selection,
  onChoisir,
  onNouvelEspace,
  onNouveauProjet,
  onProjet,
  onSupprimerVue,
}: {
  a: Actions;
  selection: Selection;
  onChoisir(s: Selection): void;
  onNouvelEspace(): void;
  onNouveauProjet(espaceId: string): void;
  onProjet(id: string): void;
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
      <LigneNav a={a} texte="Ma journée" gauche="☀︎" actif={selection.g === 'journee'} onPress={() => onChoisir({ g: 'journee' })} testID="nav-journee" compte={j} />
      <LigneNav a={a} texte="Toutes les tâches" gauche="▤" actif={selection.g === 'tout'} onPress={() => onChoisir({ g: 'tout' })} testID="nav-tout" />
      {vues.length ? <Text style={[attenueDe(theme), styles.intertitre]}>VUES ENREGISTRÉES</Text> : null}
      {vues.map(v => (
        <LigneNav key={v.id} a={a} texte={v.nom} gauche="★" actif={selection.g === 'vue' && selection.id === v.id} onPress={() => onChoisir({ g: 'vue', id: v.id })} testID={`nav-vue-${v.id}`} droite={fondateur ? petitBouton('✕', `Supprimer la vue ${v.nom}`, () => onSupprimerVue(v.id), `nav-vue-supprimer-${v.id}`) : undefined} />
      ))}
      <View style={[styles.rangee, { marginTop: 10, justifyContent: 'space-between', flexWrap: 'nowrap' }]}>
        <Text style={[attenueDe(theme), styles.intertitre, { marginTop: 0 }]}>{fondateur ? 'ESPACES' : `PARTAGÉS PAR ${a.etat.noms.fondateur.toUpperCase()}`}</Text>
        {fondateur ? petitBouton('＋', 'Nouvel espace', onNouvelEspace, 'nav-nouvel-espace') : null}
      </View>
      {espacesVivants(d).map(e => {
        const projets = projetsDe(d, e.id);
        if (!fondateur && projets.length === 0) return null;
        return (
          <View key={e.id} style={{ gap: 2 }}>
            <View style={styles.espace}>
              <View style={[styles.carreEspace, { backgroundColor: e.couleur, borderRadius: 5 }]}>
                <Text style={{ color: theme.surAccent, fontSize: 15, fontWeight: '800' }}>{e.nom[0]?.toUpperCase()}</Text>
              </View>
              <Text numberOfLines={1} style={[texteDe(theme), { flex: 1, fontWeight: '700' }]} testID={`nav-espace-${e.id}`}>
                {e.nom}
              </Text>
              {fondateur ? petitBouton('＋', `Nouveau projet dans ${e.nom}`, () => onNouveauProjet(e.id), `nav-nouveau-projet-${e.id}`) : null}
            </View>
            {projets.map(p => {
              const actif = selection.g === 'projet' && selection.id === p.id;
              return (
                <View key={p.id} style={{ gap: 2 }}>
                  <LigneNav
                    a={a}
                    niveau={1}
                    texte={`${p.nom}${p.partage !== 'aucun' && fondateur ? '  👥' : ''}${!fondateur && p.partage === 'lecture' ? '  👁' : ''}`}
                    couleur={p.couleur}
                    actif={actif && !selection.liste}
                    onPress={() => onChoisir({ g: 'projet', id: p.id })}
                    testID={`nav-projet-${p.id}`}
                    compte={tachesVivantes(d, p.id).filter(t => !t.parentId && !statutsDe(d, p.id).find(s => s.id === t.statut)?.ferme).length}
                    droite={fondateur ? petitBouton('⋯', `Réglages du projet ${p.nom}`, () => onProjet(p.id), `nav-projet-reglages-${p.id}`) : undefined}
                  />
                  {actif && listesDe(d, p.id).length > 1
                    ? listesDe(d, p.id).map(l => (
                        <LigneNav key={l.id} a={a} niveau={2} gauche="·" texte={l.nom} actif={selection.g === 'projet' && selection.liste === l.id} onPress={() => onChoisir({ g: 'projet', id: p.id, liste: l.id })} testID={`nav-liste-${l.id}`} />
                      ))
                    : null}
                </View>
              );
            })}
          </View>
        );
      })}
      {fondateur && espacesVivants(d).length === 0 ? <Text style={[attenueDe(theme), { padding: 8 }]}>Aucun espace : créez-en un avec ＋.</Text> : null}
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
      const options: Array<{ valeur: Auteur | 'personne'; texte: string }> = [{ valeur: 'personne', texte: 'Personne' }, { valeur: 'fondateur', texte: `${a.etat.noms.fondateur}${a.etat.role === 'fondateur' ? ' (moi)' : ''}` }];
      if (a.etat.role === 'ami' || d.reglages.ami) options.push({ valeur: 'ami', texte: `${a.etat.noms.ami}${a.etat.role === 'ami' ? ' (moi)' : ''}` });
      return (
        <DialogueChoix a={a} titre="Pour qui ?" testID="choix-assigne" valeur={fenetre.t.assigne ?? 'personne'} options={options} onChoisir={v => a.changer(fenetre.t.id, { assigne: v === 'personne' ? undefined : v })} onFermer={onFermer} />
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
          onSupprime={() => {
            onAvis('Projet supprimé.');
            onSelection({ g: 'journee' });
            onFermer();
          }}
        />
      );
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
    case 'rappels-recus':
      return (
        <DialogueRappelsRecus
          a={a}
          rappels={a.etat.rappels}
          onOuvrir={onOuvrir}
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
  champRapide: { flex: 1, minHeight: 46, paddingVertical: 8 },
  piedMobile: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 12, paddingBottom: 16, borderTopWidth: StyleSheet.hairlineWidth },
  avis: { position: 'absolute', left: 0, right: 0, bottom: 24, alignItems: 'center', paddingHorizontal: 16 },
  avisTexte: { paddingHorizontal: 16, paddingVertical: 10, overflow: 'hidden', maxWidth: 560 },
  ligneNav: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  ligneNavBouton: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingRight: 8 },
  point: { width: 10, height: 10, borderRadius: 5, marginLeft: 4 },
  intertitre: { fontWeight: '700', letterSpacing: 0.6, marginTop: 12, marginBottom: 4, paddingLeft: 6 },
  espace: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40, paddingLeft: 6, marginTop: 6 },
  carreEspace: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  petitBouton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
