/**
 * Menu « Équipe » de Tâches (entrée de la barre de navigation) :
 *
 *  - Fondateur : les membres (avatar, nom, rang du hub, état de l'accès,
 *    dernière activité, projets et droit sur chacun, charge : tâches
 *    ouvertes, en retard, temps de la semaine) ; inviter un profil du hub,
 *    ouvrir / fermer l'accès (la même vérité que l'Administration : les apps
 *    du profil), « peut créer ses propres projets », droits en masse
 *    (matrice membres × projets, appliqués d'un geste), retirer d'un projet
 *    ou de tous (rotation de clé) avec réassignation de ses tâches, fiche du
 *    membre (ses tâches, son activité récente, ses débriefings) ; filtres et
 *    recherche ; profils supprimés du hub signalés et nettoyables en un clic.
 *  - Membre : l'équipe des projets partagés avec lui, en lecture seule.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { rangDe } from '../../hub/admin/roles';
import { teinteTransparente } from '../../hub/themes';
import type { Profil } from '../../profils/profils';
import { aleatoireParDefaut } from '../../securite/aleatoire';
import { jourLisible } from '../dates';
import {
  activiteRecente,
  appliquerMatrice,
  debriefingsDe,
  equipeVueMembre,
  filtrerEquipe,
  FILTRES_EQUIPE,
  invitables,
  LIBELLES_ACCES,
  lignesEquipe,
  matriceDroits,
  reassignerTaches,
  retirerDesProjets,
  tachesDuMembre,
  type ChangementDroit,
  type ChargeMembre,
  type EtatAcces,
  type FiltresEquipe,
  type LigneEquipe,
  type ProfilEquipe,
} from '../equipe';
import {
  changerPerso,
  droitDe,
  listeMembres,
  membreDe,
  type DroitOuAucun,
  type Membre,
} from '../membres';
import {
  estTerminee,
  LIBELLES_DROIT,
  projetsDe,
  statutDe,
  type Auteur,
} from '../modele';
import { dureeLisible } from '../temps';
import type { Actions } from './actions';
import {
  attenueDe,
  Avatar,
  Bouton,
  Champ,
  Dialogue,
  EtatVide,
  Libelle,
  Options,
  Puce,
  texteDe,
  titreDe,
} from './atomes';
import { ChoixDroit } from './Membres';
import { couleurAuteur } from './Vues';

const DROITS: readonly DroitOuAucun[] = [
  'aucun',
  'lecture',
  'ecriture',
  'admin',
];
const COURTS: Record<DroitOuAucun, string> = {
  aucun: '—',
  lecture: 'Lecture',
  ecriture: 'Écriture',
  admin: 'Admin',
};
const RANGS: Record<string, string> = {
  ami: 'Ami',
  gestionnaire: 'Gestionnaire',
  administrateur: 'Administrateur',
};

function couleurDroit(a: Actions, d: DroitOuAucun): string {
  return d === 'admin'
    ? a.theme.teintes.admin
    : d === 'ecriture'
    ? a.theme.ok
    : d === 'lecture'
    ? a.theme.alerte
    : a.theme.attenue;
}
function couleurAcces(a: Actions, e: EtatAcces): string {
  return e === 'ouvert'
    ? a.theme.ok
    : e === 'supprime'
    ? a.theme.critique
    : e === 'inconnu'
    ? a.theme.attenue
    : a.theme.alerte;
}

/** « il y a 5 min », « hier », « le 3 oct. ». */
export function ilYa(iso: string | undefined, maintenant: number): string {
  if (!iso) return 'aucune activité';
  const ms = maintenant - Date.parse(iso);
  if (!Number.isFinite(ms)) return 'aucune activité';
  const min = Math.round(ms / 60_000);
  if (min < 2) return 'à l’instant';
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const j = Math.round(h / 24);
  if (j < 2) return 'hier';
  if (j < 30) return `il y a ${j} j`;
  return `le ${new Date(iso).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })}`;
}

const texteCharge = (c: ChargeMembre) =>
  `${c.ouvertes} ouverte${c.ouvertes > 1 ? 's' : ''} · ${
    c.enRetard
  } en retard · ${
    c.minutesSemaine ? dureeLisible(c.minutesSemaine) : '0 min'
  } cette semaine`;

/** Profils de l'annuaire du hub, vus par l'équipe. */
export const profilsEquipe = (comptes: readonly Profil[]): ProfilEquipe[] =>
  comptes.map(p => ({
    id: p.id,
    nom: p.nom,
    admin: p.admin,
    ...(p.actif === false ? { actif: false } : {}),
    ...(p.apps ? { apps: p.apps } : {}),
    role: rangDe(p),
    ...(p.derniereConnexion ? { derniereConnexion: p.derniereConnexion } : {}),
  }));

type Retrait = {
  compte: string;
  portee: 'projet' | 'tous' | 'taches';
  projetId?: string;
};

type Fermeture = (f: (() => void) | undefined) => void;

export function VueEquipe({
  a,
  comptes,
  onOuvrirTache,
  onErreur,
  onAvis,
  fermeture,
}: {
  a: Actions;
  comptes: readonly Profil[];
  onOuvrirTache(id: string): void;
  onErreur(e: unknown): void;
  onAvis(t: string): void;
  /** Échap : la racine ferme la fenêtre du dessus du menu Équipe (pas l'app). */
  fermeture?: Fermeture;
}) {
  useEffect(() => () => fermeture?.(undefined), [fermeture]);
  if (a.etat.role !== 'fondateur' || a.etat.perso)
    return <EquipeMembre a={a} />;
  return (
    <EquipeFondateur
      a={a}
      comptes={comptes}
      onOuvrirTache={onOuvrirTache}
      onErreur={onErreur}
      onAvis={onAvis}
      fermeture={fermeture}
    />
  );
}

// ------------------------------------------------------------------ Fondateur

function EquipeFondateur({
  a,
  comptes,
  onOuvrirTache,
  onErreur,
  onAvis,
  fermeture,
}: {
  a: Actions;
  comptes: readonly Profil[];
  onOuvrirTache(id: string): void;
  onErreur(e: unknown): void;
  onAvis(t: string): void;
  fermeture?: Fermeture;
}) {
  const theme = a.theme;
  const d = a.etat.donnees;
  const { width } = useWindowDimensions();
  const profils = useMemo(() => profilsEquipe(comptes), [comptes]);
  const lignes = useMemo(
    () => lignesEquipe(d, profils, a.etat.aujourdhui),
    [d, profils, a.etat.aujourdhui],
  );
  const [filtres, setFiltres] = useState<FiltresEquipe>(FILTRES_EQUIPE);
  const [onglet, setOnglet] = useState<'membres' | 'droits'>('membres');
  const [fiche, setFiche] = useState<string | undefined>();
  const [retrait, setRetrait] = useState<Retrait | undefined>();
  const [choixProjet, setChoixProjet] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [choixMatrice, setChoixMatrice] = useState(false);
  // Échap ferme la fenêtre du dessus (retrait, fiche, choix), jamais l'app.
  useEffect(() => {
    fermeture?.(
      retrait
        ? () => setRetrait(undefined)
        : fiche
          ? () => setFiche(undefined)
          : choixProjet
            ? () => setChoixProjet(false)
            : choixMatrice
              ? () => setChoixMatrice(false)
              : undefined,
    );
  }, [fermeture, retrait, fiche, choixProjet, choixMatrice]);
  const visibles = filtrerEquipe(lignes, filtres);
  const supprimes = lignes.filter(l => l.acces === 'supprime');
  const aInviter = invitables(d, profils);
  const projets = projetsDe(d).filter(p => !p.auto);
  const agir = (f: () => Promise<void> | void, avis: string) => {
    setEnCours(true);
    Promise.resolve()
      .then(f)
      .then(() => onAvis(avis))
      .catch(onErreur)
      .finally(() => setEnCours(false));
  };
  const deuxColonnes = !a.mobile && width >= 1180;
  const puceFiltre = (
    texte: string,
    actif: boolean,
    onPress: () => void,
    testID: string,
  ) => (
    <Puce
      theme={theme}
      grand={a.mobile}
      texte={texte}
      actif={actif}
      couleur={actif ? theme.accent : theme.attenue}
      onPress={onPress}
      testID={testID}
    />
  );
  return (
    <View style={{ gap: 14 }} testID="vue-equipe">
      <Text style={attenueDe(theme)} testID="equipe-resume">
        {lignes.length} membre{lignes.length > 1 ? 's' : ''} ·{' '}
        {lignes.filter(l => l.acces === 'ouvert').length} accès ouvert
        {lignes.filter(l => l.acces === 'ouvert').length > 1 ? 's' : ''} ·{' '}
        {
          projets.filter(p =>
            lignes.some(l => l.projets.some(x => x.id === p.id)),
          ).length
        }{' '}
        projet(s) partagé(s). L’accès à Tâches est le même que dans
        Administration › Utilisateurs.
      </Text>
      {supprimes.length ? (
        <View
          testID="equipe-supprimes"
          style={[
            styles.bandeau,
            {
              borderColor: theme.critique,
              backgroundColor: teinteTransparente(theme.critique, 0.1),
              borderRadius: Math.min(theme.rayonMoyen, 12),
            },
          ]}
        >
          <Text style={[texteDe(theme), { flex: 1, minWidth: 200 }]}>
            ⚠{' '}
            {supprimes.length > 1
              ? `${supprimes.length} profils supprimés du hub sont encore membres`
              : 'Un profil supprimé du hub est encore membre'}{' '}
            : {supprimes.map(l => l.membre.nom).join(', ')}.
          </Text>
          <Bouton
            theme={theme}
            variante="danger"
            titre="Nettoyer"
            desactive={enCours}
            onPress={() =>
              agir(async () => {
                for (const l of supprimes)
                  await a.etat.retirer(l.membre.compte);
              }, `${supprimes.length > 1 ? 'Profils supprimés retirés' : 'Profil supprimé retiré'} de Tâches (clés des projets changées).`)
            }
            testID="equipe-nettoyer"
          />
        </View>
      ) : null}
      <View style={[styles.rangee, { justifyContent: 'space-between' }]}>
        <View
          style={[
            styles.segment,
            {
              borderColor: theme.ligne,
              borderRadius: Math.min(theme.rayonMoyen, 12),
            },
          ]}
          accessibilityRole="tablist"
        >
          {(['membres', 'droits'] as const).map(o => (
            <Pressable
              key={o}
              accessibilityRole="tab"
              accessibilityState={{ selected: onglet === o }}
              onPress={() => setOnglet(o)}
              testID={`equipe-onglet-${o}`}
              style={[
                styles.segmentBouton,
                {
                  backgroundColor: onglet === o ? theme.accent : 'transparent',
                  borderRadius: Math.min(theme.rayonMoyen, 9),
                },
              ]}
            >
              <Text
                style={{
                  color: onglet === o ? theme.surAccent : theme.texte,
                  fontSize: 15,
                  fontWeight: '600',
                }}
              >
                {o === 'membres' ? '👥 Membres' : '▦ Droits par projet'}
              </Text>
            </Pressable>
          ))}
        </View>
        <Champ
          theme={theme}
          mobile={a.mobile}
          value={filtres.recherche}
          onChangeText={v => setFiltres(f => ({ ...f, recherche: v }))}
          placeholder="Rechercher un membre ou un projet"
          accessibilityLabel="Rechercher un membre"
          testID="equipe-recherche"
          style={a.mobile ? { width: '100%' } : { width: 280 }}
        />
      </View>
      <View style={styles.rangee} accessibilityLabel="Filtres de l’équipe">
        {puceFiltre(
          'Tous',
          filtres.acces === 'tous',
          () => setFiltres(f => ({ ...f, acces: 'tous' })),
          'equipe-filtre-tous',
        )}
        {puceFiltre(
          'Accès ouvert',
          filtres.acces === 'ouvert',
          () =>
            setFiltres(f => ({
              ...f,
              acces: f.acces === 'ouvert' ? 'tous' : 'ouvert',
            })),
          'equipe-filtre-ouvert',
        )}
        {puceFiltre(
          'Accès fermé',
          filtres.acces === 'ferme',
          () =>
            setFiltres(f => ({
              ...f,
              acces: f.acces === 'ferme' ? 'tous' : 'ferme',
            })),
          'equipe-filtre-ferme',
        )}
        {supprimes.length
          ? puceFiltre(
              'Supprimés du hub',
              filtres.acces === 'supprime',
              () =>
                setFiltres(f => ({
                  ...f,
                  acces: f.acces === 'supprime' ? 'tous' : 'supprime',
                })),
              'equipe-filtre-supprime',
            )
          : null}
        {puceFiltre(
          'En retard',
          Boolean(filtres.retard),
          () => setFiltres(f => ({ ...f, retard: !f.retard })),
          'equipe-filtre-retard',
        )}
        {(['ami', 'gestionnaire', 'administrateur'] as const).map(r =>
          puceFiltre(
            RANGS[r],
            filtres.rang === r,
            () =>
              setFiltres(f => ({ ...f, rang: f.rang === r ? undefined : r })),
            `equipe-filtre-${r}`,
          ),
        )}
        {puceFiltre(
          filtres.projet
            ? `Projet : ${d.projets[filtres.projet]?.nom ?? '?'} ✕`
            : 'Projet ▾',
          Boolean(filtres.projet),
          () =>
            filtres.projet
              ? setFiltres(f => ({ ...f, projet: undefined }))
              : setChoixProjet(true),
          'equipe-filtre-projet',
        )}
      </View>

      {onglet === 'membres' ? (
        <View style={{ gap: 12 }}>
          {!lignes.length ? (
            <EtatVide
              theme={theme}
              testID="equipe-vide"
              titre="Personne dans l’équipe"
              texte="Invitez des profils du hub (amis, gestionnaires, administrateurs) : chacun ne voit que les projets que vous partagez avec lui."
            />
          ) : !visibles.length ? (
            <Text style={attenueDe(theme)} testID="equipe-aucun">
              Aucun membre ne correspond.
            </Text>
          ) : (
            <View
              style={[
                styles.grille,
                deuxColonnes && { flexDirection: 'row', flexWrap: 'wrap' },
              ]}
            >
              {visibles.map(l => (
                <View
                  key={l.membre.compte}
                  style={deuxColonnes ? { width: '49.4%' } : undefined}
                >
                  <CarteMembre
                    a={a}
                    l={l}
                    enCours={enCours}
                    onFiche={() => setFiche(l.membre.compte)}
                    onRetrait={r => setRetrait(r)}
                    agir={agir}
                    onErreur={onErreur}
                  />
                </View>
              ))}
            </View>
          )}
          <Libelle
            theme={theme}
          >{`INVITER À TÂCHES · ${aInviter.length}`}</Libelle>
          {!aInviter.length ? (
            <Text style={attenueDe(theme)}>
              {comptes.length
                ? 'Tous les profils du hub sont déjà membres.'
                : 'Aucun profil : créez des comptes dans l’Administration.'}
            </Text>
          ) : (
            aInviter.map(p => (
              <View
                key={p.id}
                style={[styles.ligne, { borderColor: theme.ligne }]}
                testID={`equipe-invitable-${p.id}`}
              >
                <Avatar
                  theme={theme}
                  nom={p.nom}
                  couleur={couleurAuteur(a, p.id)}
                />
                <Text style={[texteDe(theme), { flex: 1 }]}>
                  {p.nom}{' '}
                  <Text style={attenueDe(theme)}>
                    · {RANGS[p.role ?? 'ami'] ?? 'Ami'}
                  </Text>
                </Text>
                <Bouton
                  theme={theme}
                  compact
                  titre="Inviter à Tâches"
                  desactive={enCours}
                  onPress={() =>
                    agir(
                      () =>
                        a.etat.inviter(
                          p.id,
                          p.nom,
                          (p.role === 'gestionnaire' ||
                          p.role === 'administrateur'
                            ? p.role
                            : 'ami') as 'ami',
                        ),
                      `${p.nom} a maintenant accès à Tâches : choisissez ses projets.`,
                    )
                  }
                  testID={`equipe-inviter-${p.id}`}
                />
              </View>
            ))
          )}
        </View>
      ) : (
        <MatriceDroits
          a={a}
          lignes={visibles}
          onErreur={onErreur}
          onAvis={onAvis}
          ouvert={choixMatrice}
          onOuvert={setChoixMatrice}
        />
      )}

      {choixProjet ? (
        <Dialogue
          theme={theme}
          mobile={a.mobile}
          visible
          titre="Filtrer par projet"
          onFermer={() => setChoixProjet(false)}
          testID="equipe-choix-projet"
        >
          <Options
            theme={theme}
            options={projets.map(p => ({
              valeur: p.id,
              texte: p.nom,
              couleur: p.couleur,
            }))}
            valeur={filtres.projet}
            onChoisir={v => {
              setFiltres(f => ({ ...f, projet: v }));
              setChoixProjet(false);
            }}
            testID="equipe-choix-projet"
          />
        </Dialogue>
      ) : null}
      {fiche && membreDe(d, fiche) ? (
        <FicheMembre
          a={a}
          compte={fiche}
          ligne={lignes.find(l => l.membre.compte === fiche)}
          onFermer={() => setFiche(undefined)}
          onOuvrirTache={id => {
            setFiche(undefined);
            onOuvrirTache(id);
          }}
          onRetrait={r => setRetrait(r)}
          agir={agir}
          enCours={enCours}
          onErreur={onErreur}
        />
      ) : null}
      {retrait && membreDe(d, retrait.compte) ? (
        <DialogueRetrait
          a={a}
          r={retrait}
          onFermer={() => setRetrait(undefined)}
          onErreur={onErreur}
          onAvis={onAvis}
        />
      ) : null}
    </View>
  );
}

function BadgeAcces({ a, l }: { a: Actions; l: LigneEquipe }) {
  return (
    <Puce
      theme={a.theme}
      texte={LIBELLES_ACCES[l.acces]}
      couleur={couleurAcces(a, l.acces)}
      testID={`equipe-acces-${l.membre.compte}`}
    />
  );
}

function CarteMembre({
  a,
  l,
  enCours,
  onFiche,
  onRetrait,
  agir,
  onErreur,
}: {
  a: Actions;
  l: LigneEquipe;
  enCours: boolean;
  onFiche(): void;
  onRetrait(r: Retrait): void;
  agir(f: () => Promise<void> | void, avis: string): void;
  onErreur(e: unknown): void;
}) {
  const theme = a.theme;
  const m = l.membre;
  return (
    <View
      testID={`equipe-membre-${m.compte}`}
      style={[
        styles.carte,
        {
          borderColor: l.acces === 'supprime' ? theme.critique : theme.ligne,
          backgroundColor: theme.surface,
          borderRadius: Math.min(theme.rayonGrand, 14),
        },
      ]}
    >
      <View style={styles.ligneTete}>
        <Avatar
          theme={theme}
          nom={m.nom}
          couleur={couleurAuteur(a, m.code)}
          taille={40}
        />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Fiche de ${m.nom}`}
            onPress={onFiche}
            testID={`equipe-fiche-${m.compte}`}
            style={{ minHeight: 28, justifyContent: 'center' }}
          >
            <Text
              style={[titreDe(theme, 17), { color: theme.texte }]}
              numberOfLines={1}
            >
              {m.nom}
            </Text>
          </Pressable>
          <Text style={attenueDe(theme)} numberOfLines={2}>
            {RANGS[m.rang ?? 'ami']}
            {m.historique ? ' · depuis la V1' : ''} ·{' '}
            {ilYa(l.derniere, a.etat.maintenant())}
          </Text>
        </View>
        <BadgeAcces a={a} l={l} />
      </View>
      <View style={styles.rangee} accessibilityLabel={`Projets de ${m.nom}`}>
        {l.projets.length ? (
          l.projets.map(p => (
            <Puce
              key={p.id}
              theme={theme}
              texte={`${p.icone ? `${p.icone} ` : ''}${p.nom} · ${
                COURTS[p.droit]
              }`}
              couleur={couleurDroit(a, p.droit)}
            />
          ))
        ) : (
          <Text style={attenueDe(theme)}>Aucun projet partagé.</Text>
        )}
      </View>
      <Text
        style={[
          texteDe(theme),
          l.charge.enRetard ? { color: theme.critique } : null,
        ]}
        testID={`equipe-charge-${m.compte}`}
      >
        {texteCharge(l.charge)}
      </Text>
      <View style={styles.rangee}>
        <Bouton
          theme={theme}
          compact={!a.mobile}
          titre="Fiche…"
          onPress={onFiche}
          testID={`equipe-ouvrir-fiche-${m.compte}`}
        />
        {l.acces === 'ferme' ? (
          <Bouton
            theme={theme}
            compact={!a.mobile}
            titre="Ouvrir l’accès"
            desactive={enCours}
            onPress={() =>
              agir(
                () => a.etat.inviter(m.compte, m.nom, m.rang),
                `Accès à Tâches ouvert pour ${m.nom}.`,
              )
            }
            testID={`equipe-ouvrir-${m.compte}`}
          />
        ) : null}
        {!m.historique ? (
          <Bouton
            theme={theme}
            compact={!a.mobile}
            variante="discret"
            titre={`${m.perso ? '☑' : '☐'} Ses propres projets`}
            libelle={`Peut créer ses propres projets : ${
              m.perso ? 'oui' : 'non'
            }`}
            onPress={() => {
              try {
                a.etat.maj((x, ctx) =>
                  changerPerso(x, m.compte, !m.perso, ctx),
                );
              } catch (e) {
                onErreur(e);
              }
            }}
            testID={`equipe-perso-${m.compte}`}
          />
        ) : null}
        <Bouton
          theme={theme}
          compact={!a.mobile}
          variante="danger"
          titre={l.acces === 'supprime' ? 'Nettoyer' : 'Retirer…'}
          onPress={() =>
            onRetrait({
              compte: m.compte,
              portee:
                l.projets.length && l.acces !== 'supprime' ? 'tous' : 'taches',
            })
          }
          testID={`equipe-retirer-${m.compte}`}
        />
      </View>
    </View>
  );
}

// ------------------------------------------------------------------ Matrice

function MatriceDroits({
  a,
  lignes,
  onErreur,
  onAvis,
  ouvert,
  onOuvert,
}: {
  a: Actions;
  lignes: readonly LigneEquipe[];
  onErreur(e: unknown): void;
  onAvis(t: string): void;
  /** Le choix d'un droit est ouvert (Échap le ferme par la racine). */
  ouvert: boolean;
  onOuvert(o: boolean): void;
}) {
  const theme = a.theme;
  const d = a.etat.donnees;
  const m = matriceDroits(d);
  const membres = m.membres.filter(x =>
    lignes.some(l => l.membre.compte === x.compte),
  );
  const [brouillon, setBrouillon] = useState<Record<string, DroitOuAucun>>({});
  const [choixBrut, setChoixBrut] = useState<
    | { titre: string; cellules: Array<{ compte: string; projetId: string }> }
    | undefined
  >();
  const choix = ouvert ? choixBrut : undefined;
  const setChoix = (c: typeof choixBrut) => {
    setChoixBrut(c);
    onOuvert(Boolean(c));
  };
  const cle = (compte: string, projetId: string) => `${compte}|${projetId}`;
  const valeur = (compte: string, projetId: string): DroitOuAucun =>
    brouillon[cle(compte, projetId)] ?? m.droits[compte]?.[projetId] ?? 'aucun';
  const changements: ChangementDroit[] = Object.entries(brouillon)
    .map(([k, droit]) => {
      const [compte, projetId] = k.split('|');
      return { compte, projetId, droit };
    })
    .filter(c => (m.droits[c.compte]?.[c.projetId] ?? 'aucun') !== c.droit);
  const retraits = changements.filter(c => c.droit === 'aucun').length;
  if (!membres.length || !m.projets.length) {
    return (
      <Text style={attenueDe(theme)}>
        {!m.projets.length
          ? 'Aucun projet à partager.'
          : 'Aucun membre ne correspond.'}
      </Text>
    );
  }
  const largeurNom = a.mobile ? 120 : 180;
  const appliquer = () => {
    try {
      let nb = 0;
      a.etat.maj((x, ctx) => {
        const r = appliquerMatrice(x, changements, {
          ...ctx,
          aleaOctets: aleatoireParDefaut,
        });
        nb = r.nb;
        return r.donnees;
      });
      setBrouillon({});
      onAvis(
        `Droits mis à jour (${nb} changement${nb > 1 ? 's' : ''}).${
          retraits
            ? ' Les accès retirés changent la clé du projet : rien de nouveau ne leur parvient.'
            : ''
        }`,
      );
    } catch (e) {
      onErreur(e);
    }
  };
  return (
    <View style={{ gap: 10 }} testID="equipe-matrice">
      <Text style={attenueDe(theme)}>
        Touchez une case pour changer le droit, un nom pour toute sa ligne, un
        projet pour toute sa colonne ; rien ne change avant « Appliquer ».
        Lecture : voir. Écriture : tâches, commentaires, temps, journal. Admin :
        en plus listes, statuts et paramètres du projet.
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator
        testID="equipe-matrice-defilement"
      >
        <View
          accessibilityRole="grid"
          accessibilityLabel="Droits des membres par projet"
        >
          <View
            style={[styles.matriceLigne, { borderColor: theme.ligne }]}
            accessibilityRole="row"
          >
            <View style={{ width: largeurNom }} />
            {m.projets.map(p => (
              <Pressable
                key={p.id}
                accessibilityRole="button"
                accessibilityLabel={`Tous les membres sur « ${p.nom} »`}
                onPress={() =>
                  setChoix({
                    titre: `Tous les membres sur « ${p.nom} »`,
                    cellules: membres.map(x => ({
                      compte: x.compte,
                      projetId: p.id,
                    })),
                  })
                }
                testID={`matrice-colonne-${p.id}`}
                style={styles.matriceTete}
              >
                <View style={[styles.point, { backgroundColor: p.couleur }]} />
                <Text
                  style={[texteDe(theme), { fontWeight: '700' }]}
                  numberOfLines={2}
                >
                  {p.nom}
                </Text>
              </Pressable>
            ))}
          </View>
          {membres.map(x => (
            <View
              key={x.compte}
              style={[styles.matriceLigne, { borderColor: theme.ligne }]}
              accessibilityRole="row"
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Tous les projets de ${x.nom}`}
                onPress={() =>
                  setChoix({
                    titre: `Tous les projets de ${x.nom}`,
                    cellules: m.projets.map(p => ({
                      compte: x.compte,
                      projetId: p.id,
                    })),
                  })
                }
                testID={`matrice-ligne-${x.compte}`}
                style={[styles.matriceNom, { width: largeurNom }]}
              >
                <Avatar
                  theme={theme}
                  nom={x.nom}
                  couleur={couleurAuteur(a, x.code)}
                  taille={28}
                />
                <Text
                  style={[texteDe(theme), { flex: 1, fontWeight: '600' }]}
                  numberOfLines={1}
                >
                  {x.nom}
                </Text>
              </Pressable>
              {m.projets.map(p => {
                const v = valeur(x.compte, p.id);
                const change = v !== (m.droits[x.compte]?.[p.id] ?? 'aucun');
                const c = couleurDroit(a, v);
                return (
                  <Pressable
                    key={p.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${x.nom} sur « ${p.nom} » : ${
                      LIBELLES_DROIT[v]
                    }${change ? ' (à appliquer)' : ''}`}
                    onPress={() =>
                      setChoix({
                        titre: `${x.nom} sur « ${p.nom} »`,
                        cellules: [{ compte: x.compte, projetId: p.id }],
                      })
                    }
                    testID={`matrice-${x.compte}-${p.id}`}
                    style={[
                      styles.cellule,
                      {
                        borderColor: change ? theme.accent : 'transparent',
                        backgroundColor:
                          v === 'aucun'
                            ? 'transparent'
                            : teinteTransparente(c, 0.16),
                        borderRadius: Math.min(theme.rayonMoyen, 8),
                      },
                    ]}
                  >
                    <Text
                      style={{
                        color:
                          v === 'aucun'
                            ? theme.attenue
                            : theme.sombre
                            ? c
                            : theme.texte,
                        fontSize: 15,
                        fontWeight: change ? '800' : '600',
                      }}
                    >
                      {COURTS[v]}
                      {change ? ' •' : ''}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
      {changements.length ? (
        <View
          style={[
            styles.bandeau,
            {
              borderColor: theme.accent,
              backgroundColor: teinteTransparente(theme.accent, 0.1),
              borderRadius: Math.min(theme.rayonMoyen, 12),
            },
          ]}
          testID="matrice-en-attente"
        >
          <Text style={[texteDe(theme), { flex: 1, minWidth: 180 }]}>
            {changements.length} changement{changements.length > 1 ? 's' : ''}{' '}
            en attente
            {retraits
              ? ` dont ${retraits} retrait${
                  retraits > 1 ? 's' : ''
                } (la clé du projet changera)`
              : ''}
            .
          </Text>
          <Bouton
            theme={theme}
            titre="Annuler"
            onPress={() => setBrouillon({})}
            testID="matrice-annuler"
          />
          <Bouton
            theme={theme}
            variante="plein"
            titre={`Appliquer (${changements.length})`}
            onPress={appliquer}
            testID="matrice-appliquer"
          />
        </View>
      ) : null}
      {choix ? (
        <Dialogue
          theme={theme}
          mobile={a.mobile}
          visible
          titre={choix.titre}
          onFermer={() => setChoix(undefined)}
          testID="matrice-choix"
        >
          <Options
            theme={theme}
            options={DROITS.map(x => ({
              valeur: x,
              texte: LIBELLES_DROIT[x],
              couleur: couleurDroit(a, x),
            }))}
            valeur={
              choix.cellules.length === 1
                ? valeur(choix.cellules[0].compte, choix.cellules[0].projetId)
                : undefined
            }
            onChoisir={v => {
              setBrouillon(b => ({
                ...b,
                ...Object.fromEntries(
                  choix.cellules.map(c => [cle(c.compte, c.projetId), v]),
                ),
              }));
              setChoix(undefined);
            }}
            testID="matrice-choix"
          />
        </Dialogue>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------ Fiche d'un membre

function FicheMembre({
  a,
  compte,
  ligne,
  onFermer,
  onOuvrirTache,
  onRetrait,
  agir,
  enCours,
  onErreur,
}: {
  a: Actions;
  compte: string;
  ligne?: LigneEquipe;
  onFermer(): void;
  onOuvrirTache(id: string): void;
  onRetrait(r: Retrait): void;
  agir(f: () => Promise<void> | void, avis: string): void;
  enCours: boolean;
  onErreur(e: unknown): void;
}) {
  const theme = a.theme;
  const d = a.etat.donnees;
  const m = membreDe(d, compte)!;
  const taches = tachesDuMembre(d, m.code);
  const ouvertes = taches.filter(t => !estTerminee(d, t));
  const activite = activiteRecente(d, m.code, 15);
  const debriefs = debriefingsDe(d, m.code, jourIlYa(a.etat.aujourdhui, 14));
  const projets = projetsDe(d).filter(p => !p.auto);
  return (
    <Dialogue
      theme={theme}
      mobile={a.mobile}
      visible
      large
      titre={m.nom}
      description={`${RANGS[m.rang ?? 'ami']}${
        ligne
          ? ` · ${LIBELLES_ACCES[ligne.acces]} · ${ilYa(
              ligne.derniere,
              a.etat.maintenant(),
            )}`
          : ''
      }${
        m.depuis
          ? ` · membre depuis le ${new Date(m.depuis).toLocaleDateString(
              'fr-FR',
            )}`
          : ''
      }`}
      onFermer={onFermer}
      testID="equipe-fiche"
    >
      <View style={{ gap: 14 }}>
        <View style={styles.rangee}>
          <Avatar
            theme={theme}
            nom={m.nom}
            couleur={couleurAuteur(a, m.code)}
            taille={44}
          />
          {ligne ? (
            <Text style={[texteDe(theme), { flex: 1, minWidth: 180 }]}>
              {texteCharge(ligne.charge)}
            </Text>
          ) : null}
        </View>
        <View style={styles.rangee}>
          {ligne?.acces === 'ferme' ? (
            <Bouton
              theme={theme}
              compact={!a.mobile}
              titre="Ouvrir l’accès"
              desactive={enCours}
              onPress={() =>
                agir(
                  () => a.etat.inviter(m.compte, m.nom, m.rang),
                  `Accès à Tâches ouvert pour ${m.nom}.`,
                )
              }
              testID="fiche-ouvrir"
            />
          ) : null}
          <Bouton
            theme={theme}
            compact={!a.mobile}
            titre="Retirer de tous les projets…"
            onPress={() => onRetrait({ compte, portee: 'tous' })}
            testID="fiche-retirer-tous"
          />
          <Bouton
            theme={theme}
            compact={!a.mobile}
            variante="danger"
            titre="Fermer l’accès à Tâches…"
            onPress={() => onRetrait({ compte, portee: 'taches' })}
            testID="fiche-fermer"
          />
        </View>

        <Libelle theme={theme}>PROJETS ET DROITS</Libelle>
        {projets.length ? (
          projets.map(p => (
            <View
              key={p.id}
              style={[
                styles.ligne,
                { borderColor: theme.ligne, flexWrap: 'wrap' },
              ]}
              testID={`fiche-projet-${p.id}`}
            >
              <View style={[styles.point, { backgroundColor: p.couleur }]} />
              <Text
                style={[texteDe(theme), { flex: 1, minWidth: 120 }]}
                numberOfLines={1}
              >
                {p.icone ? `${p.icone} ` : ''}
                {p.nom}
              </Text>
              <ChoixDroit a={a} projet={p} membre={m} onErreur={onErreur} />
              {droitDe(d, p.id, m.compte) !== 'aucun' ? (
                <Bouton
                  theme={theme}
                  compact
                  variante="discret"
                  titre="Retirer…"
                  libelle={`Retirer ${m.nom} de « ${p.nom} »`}
                  onPress={() =>
                    onRetrait({ compte, portee: 'projet', projetId: p.id })
                  }
                  testID={`fiche-retirer-${p.id}`}
                />
              ) : null}
            </View>
          ))
        ) : (
          <Text style={attenueDe(theme)}>Aucun projet.</Text>
        )}

        <Libelle theme={theme}>{`SES TÂCHES · ${ouvertes.length} OUVERTE${
          ouvertes.length > 1 ? 'S' : ''
        }`}</Libelle>
        {taches.length ? (
          taches.slice(0, 25).map(t => {
            const st = statutDe(d, t);
            return (
              <Pressable
                key={t.id}
                accessibilityRole="button"
                onPress={() => onOuvrirTache(t.id)}
                testID={`fiche-tache-${t.id}`}
                style={[styles.ligne, { borderColor: theme.ligne }]}
              >
                <Text
                  style={[
                    texteDe(theme),
                    {
                      flex: 1,
                      textDecorationLine: st.ferme ? 'line-through' : 'none',
                      color: st.ferme ? theme.attenue : theme.texte,
                    },
                  ]}
                  numberOfLines={1}
                >
                  {t.titre}
                </Text>
                <Text style={attenueDe(theme)} numberOfLines={1}>
                  {d.projets[t.projetId]?.nom}
                </Text>
                {t.echeance ? (
                  <Text
                    style={[
                      attenueDe(theme),
                      !st.ferme && t.echeance.jour < a.etat.aujourdhui
                        ? { color: theme.critique }
                        : null,
                    ]}
                  >
                    {jourLisible(t.echeance.jour, a.etat.aujourdhui)}
                  </Text>
                ) : null}
                <Puce theme={theme} texte={st.nom} couleur={st.couleur} />
              </Pressable>
            );
          })
        ) : (
          <Text style={attenueDe(theme)}>
            Aucune tâche ne lui est assignée.
          </Text>
        )}

        <Libelle theme={theme}>ACTIVITÉ RÉCENTE</Libelle>
        {activite.length ? (
          activite.map((x, i) => (
            <Pressable
              key={`${x.date}-${i}`}
              accessibilityRole={x.tacheId ? 'button' : undefined}
              disabled={!x.tacheId}
              onPress={() => x.tacheId && onOuvrirTache(x.tacheId)}
              style={styles.activite}
            >
              <Text style={[attenueDe(theme), { width: 110 }]}>
                {ilYa(x.date, a.etat.maintenant())}
              </Text>
              <Text style={[texteDe(theme), { flex: 1 }]}>{x.texte}</Text>
            </Pressable>
          ))
        ) : (
          <Text style={attenueDe(theme)}>Rien pour l’instant.</Text>
        )}

        <Libelle theme={theme}>DÉBRIEFINGS · 14 DERNIERS JOURS</Libelle>
        {debriefs.length ? (
          debriefs.map(g => (
            <View
              key={`${g.jour}-${g.projetId}`}
              style={{ gap: 2 }}
              testID={`fiche-debrief-${g.jour}`}
            >
              <Text style={[texteDe(theme), { fontWeight: '700' }]}>
                {jourLisible(g.jour, a.etat.aujourdhui).replace(/^./, c =>
                  c.toUpperCase(),
                )}{' '}
                · {d.projets[g.projetId]?.nom}
              </Text>
              {g.entrees.map(e => (
                <Text key={e.id} style={texteDe(theme)}>
                  • {e.texte}
                  {e.minutes ? (
                    <Text style={attenueDe(theme)}>
                      {' '}
                      ({dureeLisible(e.minutes)})
                    </Text>
                  ) : null}
                </Text>
              ))}
            </View>
          ))
        ) : (
          <Text style={attenueDe(theme)}>Aucune entrée de journal.</Text>
        )}
      </View>
    </Dialogue>
  );
}

const jourIlYa = (jour: string, n: number) => {
  const t = new Date(`${jour}T12:00:00Z`).getTime() - n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
};

// ------------------------------------------------------------------ Retrait (et réassignation)

function DialogueRetrait({
  a,
  r,
  onFermer,
  onErreur,
  onAvis,
}: {
  a: Actions;
  r: Retrait;
  onFermer(): void;
  onErreur(e: unknown): void;
  onAvis(t: string): void;
}) {
  const theme = a.theme;
  const d = a.etat.donnees;
  const m = membreDe(d, r.compte) as Membre;
  const projets =
    r.portee === 'projet' && r.projetId
      ? [r.projetId]
      : projetsDe(d)
          .filter(p => !p.auto && droitDe(d, p.id, r.compte) !== 'aucun')
          .map(p => p.id);
  const ouvertes = tachesDuMembre(d, m.code).filter(
    t =>
      !estTerminee(d, t) &&
      (r.portee === 'taches' || projets.includes(t.projetId)),
  );
  const autres: Array<{ code: Auteur; nom: string }> = [
    { code: 'fondateur', nom: `${a.etat.noms.fondateur ?? 'Moi'} (moi)` },
    ...listeMembres(d)
      .filter(x => x.compte !== r.compte)
      .map(x => ({ code: x.code, nom: x.nom })),
  ];
  const [vers, setVers] = useState<string>(
    ouvertes.length ? 'fondateur' : 'garder',
  );
  const [enCours, setEnCours] = useState(false);
  const titre =
    r.portee === 'projet'
      ? `Retirer ${m.nom} de « ${d.projets[r.projetId!]?.nom ?? ''} »`
      : r.portee === 'tous'
      ? `Retirer ${m.nom} de tous les projets`
      : `Fermer l’accès de ${m.nom} à Tâches`;
  const explication =
    r.portee === 'taches'
      ? `${
          m.nom
        } ne verra plus Tâches (sa tuile disparaît, l’accès est aussi fermé dans l’Administration) ; son dépôt est effacé au prochain tour et la clé de ${
          projets.length
        } projet${
          projets.length > 1 ? 's' : ''
        } change. Ses commentaires et son temps passés restent.`
      : `${m.nom} ne verra plus ${
          r.portee === 'projet'
            ? 'ce projet'
            : `ses ${projets.length} projet${projets.length > 1 ? 's' : ''}`
        } (réécrit au prochain tour) ; la clé ${
          projets.length > 1 ? 'de chaque projet' : 'du projet'
        } change. ${
          r.portee === 'tous' ? 'Il garde l’accès à Tâches, sans projet.' : ''
        }`;
  const confirmer = () => {
    setEnCours(true);
    Promise.resolve()
      .then(async () => {
        let nb = 0;
        a.etat.maj((x, ctx) => {
          let y = x;
          if (vers !== 'garder' && ouvertes.length) {
            const re = reassignerTaches(
              y,
              m.code,
              vers === 'personne' ? undefined : vers,
              ctx,
              r.portee === 'taches' ? {} : { projets },
              a.etat.noms,
            );
            nb = re.nb;
            y = re.donnees;
          }
          if (r.portee !== 'taches')
            y = retirerDesProjets(y, r.compte, projets, {
              ...ctx,
              aleaOctets: aleatoireParDefaut,
            });
          return y;
        });
        if (r.portee === 'taches') await a.etat.retirer(r.compte);
        onAvis(
          `${
            r.portee === 'taches'
              ? `${m.nom} n’a plus accès à Tâches`
              : `${m.nom} est retiré${
                  r.portee === 'tous' ? ' de tous les projets' : ' du projet'
                }`
          }${
            nb
              ? ` ; ${nb} tâche${nb > 1 ? 's' : ''} réassignée${
                  nb > 1 ? 's' : ''
                }`
              : ''
          }.`,
        );
        onFermer();
      })
      .catch(onErreur)
      .finally(() => setEnCours(false));
  };
  return (
    <Dialogue
      theme={theme}
      mobile={a.mobile}
      visible
      titre={titre}
      description={explication}
      onFermer={onFermer}
      testID="equipe-retrait"
      pied={
        <>
          <Bouton
            theme={theme}
            titre="Annuler"
            onPress={onFermer}
            testID="retrait-annuler"
          />
          <Bouton
            theme={theme}
            variante="danger"
            titre={r.portee === 'taches' ? 'Fermer l’accès' : 'Retirer'}
            desactive={enCours}
            onPress={confirmer}
            testID="retrait-confirmer"
          />
        </>
      }
    >
      {ouvertes.length ? (
        <View style={{ gap: 8 }} testID="retrait-reassigner">
          <Libelle theme={theme}>{`SES ${ouvertes.length} TÂCHE${
            ouvertes.length > 1 ? 'S' : ''
          } OUVERTE${ouvertes.length > 1 ? 'S' : ''}${
            r.portee === 'taches' ? '' : ' DANS CES PROJETS'
          }`}</Libelle>
          <Options
            theme={theme}
            options={[
              ...autres.map(p => ({
                valeur: p.code,
                texte: `Réassigner à ${p.nom}`,
              })),
              { valeur: 'personne', texte: 'Ne les assigner à personne' },
              { valeur: 'garder', texte: `Les laisser à ${m.nom}` },
            ]}
            valeur={vers}
            onChoisir={setVers}
            testID="retrait-vers"
          />
          <Text style={attenueDe(theme)}>
            Une tâche d’un projet que la personne choisie ne voit pas reste sans
            elle.
          </Text>
        </View>
      ) : (
        <Text style={attenueDe(theme)}>
          Aucune tâche ouverte ne lui est assignée
          {r.portee === 'taches' ? '' : ' dans ces projets'}.
        </Text>
      )}
    </Dialogue>
  );
}

// ------------------------------------------------------------------ Membre (lecture seule)

function EquipeMembre({ a }: { a: Actions }) {
  const theme = a.theme;
  const d = a.etat.donnees;
  if (a.etat.perso) {
    return (
      <EtatVide
        theme={theme}
        testID="equipe-perso"
        titre="Mes projets personnels"
        texte="Ils restent à toi seul : personne d’autre ne les voit. L’équipe des projets partagés est dans « Partagés avec moi »."
      />
    );
  }
  const personnes = equipeVueMembre(d, a.etat.noms, a.etat.aujourdhui);
  if (!personnes.length) {
    return (
      <EtatVide
        theme={theme}
        testID="equipe-membre-vide"
        titre="Aucun projet partagé avec toi"
        texte="L’équipe apparaîtra ici quand un projet sera partagé avec toi."
      />
    );
  }
  return (
    <View style={{ gap: 12 }} testID="vue-equipe-membre">
      <Text style={attenueDe(theme)}>
        Les personnes des projets partagés avec toi, et leur droit. Seul{' '}
        {a.etat.parFondateur} gère l’équipe (lecture seule).
      </Text>
      {personnes.map(p => (
        <View
          key={p.code}
          testID={`equipe-personne-${p.code}`}
          style={[
            styles.carte,
            {
              borderColor: theme.ligne,
              backgroundColor: theme.surface,
              borderRadius: Math.min(theme.rayonGrand, 14),
            },
          ]}
        >
          <View style={styles.ligneTete}>
            <Avatar
              theme={theme}
              nom={p.nom}
              couleur={couleurAuteur(a, p.code)}
              taille={40}
            />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                style={[titreDe(theme, 17), { color: theme.texte }]}
                numberOfLines={1}
              >
                {p.nom}
                {p.code === a.etat.moi ? ' (moi)' : ''}
              </Text>
              <Text style={attenueDe(theme)}>
                {p.code === 'fondateur'
                  ? 'Fondateur · propriétaire des projets'
                  : texteCharge(p.charge)}
              </Text>
            </View>
          </View>
          <View style={styles.rangee}>
            {p.projets.map(x => (
              <Puce
                key={x.id}
                theme={theme}
                texte={`${x.nom} · ${
                  x.droit === 'proprietaire' ? 'Propriétaire' : COURTS[x.droit]
                }`}
                couleur={
                  x.droit === 'proprietaire'
                    ? theme.accent
                    : couleurDroit(a, x.droit)
                }
              />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  rangee: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  ligne: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 4,
  },
  ligneTete: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  carte: { borderWidth: 1, padding: 14, gap: 10 },
  grille: { gap: 12, justifyContent: 'space-between' },
  bandeau: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
    borderWidth: 1,
    padding: 12,
  },
  segment: { flexDirection: 'row', borderWidth: 1, padding: 3, gap: 3 },
  segmentBouton: {
    minHeight: 40,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  point: { width: 10, height: 10, borderRadius: 5 },
  matriceLigne: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 52,
    gap: 4,
  },
  matriceTete: {
    width: 112,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 4,
  },
  matriceNom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 48,
    paddingRight: 8,
  },
  cellule: {
    width: 112,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  activite: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    minHeight: 32,
    paddingVertical: 2,
  },
});
