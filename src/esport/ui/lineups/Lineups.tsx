/**
 * Module « Lineups » (« Lineups et placements » pour The Finals) : les lineups de la team.
 *
 *  - Grille : cartes compactes (image d'abord, personnage et capacité en pastilles), filtres rapides (map,
 *    personnage, capacité, side ou mode, zone, tag, statut, favoris, recherche) appliqués sur place.
 *  - Vue par map : chaque lineup est un pin là où il tombe (les pins proches se regroupent) ; un pin touché montre la
 *    position de départ et la trajectoire, et ouvre la fiche à côté.
 *  - Fiche (FicheLineup), formulaire (FormulaireLineup), corbeille de 30 jours.
 *
 * Droits (vérifiés par le serveur) : lineups.voir, lineups.proposer, lineups.gerer. Contenu tactique : rien ne part
 * vers une IA ni sur Discord.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { BoutonHub, Champ, Segments } from '../../../hub/admin/ui/commun';
import { teinteTransparente, type ThemeHub } from '../../../hub/themes';
import { Icone } from '../../../ui/icones';
import { SelecteurRepliable } from '../../../ui/selecteurs/SelecteurRepliable';
import { dateCourte } from '../../libelles';
import { trLu, trLuModele, trnLu, type CleLu } from '../../i18n/lineups';
import { apiLineups, type ApiLineups, type FiltresLineups, type Lineup, type LineupCorbeille, type ListeLineups, type StatutLineup } from '../../lineups/api';
import { prendreLineupDemande } from '../../lineups/intention';
import { agentDe, capaciteDe, carteDe, couleurPersonnage, facettes, filtrerLineups, filtresActifs, grouperPins, imagesDe, initiales, rayonRegroupement, sidesDuModele, trierLineups, videoDe, type OptionFacette } from '../../lineups/logique';
import { sourcesIcone, type Assets } from '../../strats/assets';
import { modeleDuJeu } from '../../strats/modeles';
import { useTempsReel } from '../../tempsReel/hooks';
import { Retours, useAgir } from '../commun';
import { BoutonPliable, Carte, ESP, EnTetePage, EtatVide, SqueletteCartes, attenue, rayonCarte, texte } from '../design';
import type { PropsModule } from '../modules';
import { useCible } from '../notifications/Cible';
import { MentionRiot, demanderStrat, useAssetsTeam } from '../strats/commun';
import { CarteTactique, type PinCarte } from './CarteTactique';
import { amenerEnHaut, useDefilementEcran } from './defilement';
import { BoutonFavori, FicheLineup, Legende } from './FicheLineup';
import { GrilleEgale, PastillesFiltre, type OptionPastille } from './Filtres';
import { FormulaireLineup } from './FormulaireLineup';
import { Difficulte, EtiquetteImage, EtiquetteSide, PuceCapacite, PucePersonnage, nomSide } from './Puces';

type Vue = 'grille' | 'carte';
const LIMITES_DEFAUT: ListeLineups['limites'] = { images: 4, tailleImage: 12 * 1024 * 1024, tailleVideo: 200 * 1024 * 1024 };

/** Au-delà de ce nombre de choix, un filtre devient un sélecteur repliable (avec recherche). */
const PASTILLES_MAX = 8;
/** Largeur (fenêtre) à partir de laquelle la vue par map montre la carte et la fiche côte à côte. */
const LARGEUR_COTE_A_COTE = 760;

/** Filtre d'une liste : pastilles quand elle est courte, sélecteur repliable (recherche) quand elle est longue. */
function FiltreListe({
  theme,
  libelle,
  valeur,
  options,
  tout,
  dense,
  visuel,
  onChoisir,
  testID,
}: {
  theme: ThemeHub;
  libelle: string;
  valeur: string;
  options: readonly OptionFacette[];
  tout: string;
  dense: boolean;
  /** Visuel d'une pastille (portrait, icône de capacité). */
  visuel?(o: OptionFacette): React.ReactNode;
  onChoisir(v: string): void;
  testID: string;
}) {
  if (options.length <= PASTILLES_MAX) {
    return <PastillesFiltre theme={theme} libelle={libelle} valeur={valeur} tout={tout} dense={dense} options={options.map((o): OptionPastille => ({ id: o.id, nom: o.nom, n: o.n, visuel: visuel?.(o) }))} onChoisir={onChoisir} testID={testID} />;
  }
  return (
    <SelecteurRepliable
      theme={theme}
      libelle={libelle}
      valeur={valeur}
      vide={tout}
      options={[{ id: '', nom: tout }, ...options.map(o => ({ id: o.id, nom: o.nom, detail: String(o.n) }))]}
      onChoisir={onChoisir}
      testID={testID}
      style={{ flexGrow: 1, flexBasis: 240, maxWidth: 420 }}
    />
  );
}

/** Carte compacte d'un lineup dans la grille : l'image d'abord. */
export function CarteLineup({ theme, lineup, assets, dense = false, onOuvrir, onFavori }: { theme: ThemeHub; lineup: Lineup; assets: Assets | undefined; /** Deux colonnes sur téléphone : puces et texte plus petits. */ dense?: boolean; onOuvrir(): void; onFavori(): void }) {
  const agent = agentDe(assets, lineup.personnage);
  const capacite = capaciteDe(agent, lineup.capacite);
  const image = imagesDe(lineup).find(m => m.lien);
  const couleur = couleurPersonnage(agent, lineup.personnage?.nom);
  const rayon = Math.min(rayonCarte(theme), 14);
  const [echec, setEchec] = useState(false);
  return (
    <View testID={`esport-lineup-carte-${lineup.id}`} style={{ height: '100%', borderRadius: rayon, borderWidth: 1, borderColor: theme.ligne, backgroundColor: theme.surface, overflow: 'hidden' }}>
      <Pressable testID={`esport-lineup-${lineup.id}`} accessibilityRole="button" accessibilityLabel={trLu('fiche.ouvrir', { titre: lineup.titre })} onPress={onOuvrir} style={(e: { pressed: boolean; hovered?: boolean }) => ({ flex: 1, opacity: e.pressed ? 0.85 : 1 })}>
        <View style={{ width: '100%', aspectRatio: 16 / 9, backgroundColor: '#0B0F14', alignItems: 'center', justifyContent: 'center' }}>
          {image?.lien && !echec ? (
            <Image testID={`esport-lineup-image-${lineup.id}`} source={{ uri: image.lien.url }} onError={() => setEchec(true)} accessibilityIgnoresInvertColors resizeMode="cover" style={{ width: '100%', height: '100%' }} />
          ) : lineup.depart || lineup.arrivee ? (
            <View style={{ height: '100%', aspectRatio: 1 }}>
              <CarteTactique carte={carteDe(assets, lineup.carte.cle)} nom={lineup.carte.nom} trajets={[{ id: lineup.id, depart: lineup.depart, arrivee: lineup.arrivee, couleur }]} compacte style={{ borderRadius: 0, borderWidth: 0 }} testID={`esport-lineup-apercu-${lineup.id}`} />
            </View>
          ) : (
            <Text style={{ color: 'rgba(232, 238, 246, 0.28)', fontSize: 30, fontWeight: '800', letterSpacing: 1 }}>{initiales(lineup.carte.nom)}</Text>
          )}
          <View style={{ position: 'absolute', left: 8, top: 8, flexDirection: 'row', gap: 6 }}>
            {lineup.personnage ? <PucePersonnage agent={agent} nom={lineup.personnage.nom} taille={dense ? 26 : 30} /> : null}
            {lineup.capacite ? <PuceCapacite capacite={capacite} nom={lineup.capacite.nom} taille={dense ? 26 : 30} /> : null}
          </View>
          <View style={{ position: 'absolute', left: 8, bottom: 8, flexDirection: 'row', gap: 6 }}>
            {lineup.statut === 'propose' ? <EtiquetteImage texte={trLu('statut.propose')} couleur="#E8B654" /> : null}
            {videoDe(lineup) || lineup.videoUrl ? <EtiquetteImage texte={trLu('video.aucune')} /> : null}
          </View>
        </View>
        <View style={{ padding: dense ? ESP.xs : ESP.s, gap: dense ? 4 : 6, flex: 1 }}>
          <Text numberOfLines={2} style={{ ...texte(theme, dense ? 14 : 15), fontWeight: '700' }}>
            {lineup.titre}
          </Text>
          <Text numberOfLines={1} style={attenue(theme, 12)}>
            {(dense ? [lineup.carte.nom, lineup.zone?.nom] : [lineup.carte.nom, lineup.zone?.nom, lineup.capacite?.nom]).filter(Boolean).join(' · ')}
          </Text>
          <View style={{ flex: 1 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.xs, flexWrap: 'wrap' }}>
            <EtiquetteSide theme={theme} side={lineup.side} />
            <Difficulte theme={theme} n={lineup.difficulte} />
            {dense ? null : <Text style={attenue(theme, 12)}>{trLu(`posture.${lineup.posture}` as CleLu)}</Text>}
          </View>
        </View>
      </Pressable>
      <View style={{ position: 'absolute', right: 8, top: 8 }}>
        <BoutonFavori theme={theme} actif={lineup.favori} onPress={onFavori} testID={`esport-lineup-favori-${lineup.id}`} surImage />
      </View>
    </View>
  );
}

/** Ligne d'un lineup dans une liste (groupe de pins, lineups liés). */
export function LigneLineup({ theme, lineup, assets, actif, onPress, testID }: { theme: ThemeHub; lineup: Lineup; assets: Assets | undefined; actif?: boolean; onPress(): void; testID: string }) {
  const agent = agentDe(assets, lineup.personnage);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={trLu('fiche.ouvrir', { titre: lineup.titre })}
      accessibilityState={{ selected: Boolean(actif) }}
      onPress={onPress}
      style={(e: { pressed: boolean; hovered?: boolean }) => ({ flexDirection: 'row', alignItems: 'center', gap: ESP.xs, minHeight: 48, paddingHorizontal: ESP.xs, borderRadius: 10, borderWidth: 1, borderColor: actif || e.hovered ? theme.accent : theme.ligne, backgroundColor: actif ? teinteTransparente(theme.accent, 0.1) : theme.surface })}>
      {lineup.personnage ? <PucePersonnage agent={agent} nom={lineup.personnage.nom} taille={30} /> : null}
      {lineup.capacite ? <PuceCapacite capacite={capaciteDe(agent, lineup.capacite)} nom={lineup.capacite.nom} taille={30} /> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ ...texte(theme, 14), fontWeight: '700' }}>
          {lineup.titre}
        </Text>
        <Text numberOfLines={1} style={attenue(theme, 12)}>
          {[lineup.zone?.nom, lineup.capacite?.nom, lineup.side ? nomSide(lineup.side) : null].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <Icone nom="chevron-droite" taille={16} couleur={theme.attenue} />
    </Pressable>
  );
}

export function Lineups({ theme, client, detail, large, onAller }: PropsModule) {
  const teamId = detail.team.id;
  const api = useMemo(() => apiLineups(client), [client]);
  const assets = useAssetsTeam(client, detail.team);
  const modele = assets?.modele ?? modeleDuJeu(null, detail.team.jeu);
  const [liste, setListe] = useState<ListeLineups | undefined>();
  const [vue, setVue] = useState<Vue>('grille');
  const [filtres, setFiltres] = useState<FiltresLineups>({});
  const [recherche, setRecherche] = useState('');
  const [ouvert, setOuvert] = useState<string | undefined>(() => prendreLineupDemande());
  const [formulaire, setFormulaire] = useState<{ lineup?: Lineup } | undefined>();
  const [corbeille, setCorbeille] = useState(false);
  const [pin, setPin] = useState<string | undefined>();
  const [groupe, setGroupe] = useState<string | undefined>();
  const [largeurCarte, setLargeurCarte] = useState(0);
  // Filtres : sous les yeux à la souris (pastilles serrées), repliés au doigt (la grille d'abord).
  const [filtresOuverts, setFiltresOuverts] = useState(large);
  const { width: largeurFenetre } = useWindowDimensions();
  const coteACote = large || largeurFenetre >= LARGEUR_COTE_A_COTE;
  const { erreur, avis, agir, setAvis } = useAgir();

  const recharger = useCallback(async () => setListe(await api.liste(teamId)), [api, teamId]);
  useEffect(() => {
    void agir('', recharger);
  }, [agir, recharger]);
  // Temps réel : un autre propose, valide, corrige ou supprime un lineup (formulaire fermé seulement).
  useTempsReel(client, [`team:${teamId}:lineups`], () => void recharger().catch(() => undefined), { actif: !formulaire });
  // Lien direct d'une notification (lineup proposé, validé) : sa fiche s'ouvre.
  useCible('lineups', c => {
    if (c.g === 'lineup' && typeof c.lineup === 'string') {
      setFormulaire(undefined);
      setCorbeille(false);
      setOuvert(c.lineup);
    }
  });

  const tous = useMemo(() => liste?.lineups ?? [], [liste]);
  const droits = liste?.droits ?? { proposer: false, gerer: false, lier: false };
  const f = useMemo<FiltresLineups>(() => ({ ...filtres, q: recherche.trim() || undefined }), [filtres, recherche]);
  const visibles = useMemo(() => trierLineups(filtrerLineups(tous, f)), [tous, f]);
  const fac = useMemo(() => facettes(tous, filtres), [tous, filtres]);
  const majFiltre = (p: Partial<FiltresLineups>) => {
    setFiltres(x => {
      const n = { ...x, ...p };
      // Changer de map ou de personnage remet à zéro ce qui en dépend.
      if ('carte' in p) n.zone = undefined;
      if ('personnage' in p) n.capacite = undefined;
      return n;
    });
    setPin(undefined);
    setGroupe(undefined);
  };
  const remplacer = (l: Lineup) => setListe(x => (x ? { ...x, lineups: x.lineups.map(y => (y.id === l.id ? l : y)) } : x));
  const basculerFavori = (l: Lineup) => {
    const favori = !l.favori;
    remplacer({ ...l, favori });
    void agir('favori', async () => {
      try {
        await api.favori(teamId, l.id, favori);
      } catch (e) {
        remplacer(l);
        throw e;
      }
    });
  };
  const apresSuppression = (l: Lineup) => {
    setOuvert(undefined);
    setPin(undefined);
    setListe(x => (x ? { ...x, lineups: x.lineups.filter(y => y.id !== l.id), total: Math.max(0, x.total - 1) } : x));
    setAvis(trLu('fiche.supprimee', { titre: l.titre }));
  };
  const ouvrirStrat = (id: string) => {
    demanderStrat(id);
    onAller('module:strat_editor');
  };
  const voitStrats = detail.modules.some(m => m.cle === 'strat_editor' && m.active) && detail.moi.permissions.includes('strats.view');
  const titrePage = trLuModele('titre', modele);
  const lineupOuvert = ouvert ? tous.find(l => l.id === ouvert) : undefined;
  // Une fiche ou le formulaire s'ouvre en haut de la page ; le retour à la liste retrouve l'endroit quitté.
  useDefilementEcran('esport-lineups', formulaire ? 'formulaire' : lineupOuvert ? `fiche:${lineupOuvert.id}` : corbeille ? 'corbeille' : 'liste');
  const choisirPin = (id: string | undefined) => {
    setPin(id);
    setGroupe(undefined);
    // Petit écran : la fiche est sous la carte ; la carte monte en haut de l'écran pour la laisser apparaître.
    if (id && !coteACote) setTimeout(() => amenerEnHaut('esport-lineups-carte', true), 60);
  };

  // ---------------------------------------------------------------- Formulaire
  if (formulaire) {
    return (
      <View testID="esport-lineups" style={{ gap: ESP.l }}>
        <FormulaireLineup
          theme={theme}
          client={client}
          api={api}
          teamId={teamId}
          assets={assets}
          modele={modele}
          lineup={formulaire.lineup}
          droits={droits}
          limites={liste?.limites ?? LIMITES_DEFAUT}
          large={large}
          carteInitiale={filtres.carte}
          onAnnuler={() => setFormulaire(undefined)}
          onFini={(l, texteAvis) => {
            setFormulaire(undefined);
            setOuvert(l.id);
            void agir('', async () => {
              await recharger();
              return texteAvis;
            });
          }}
        />
      </View>
    );
  }

  // ---------------------------------------------------------------- Fiche complète
  if (ouvert && lineupOuvert) {
    return (
      <View testID="esport-lineups" style={{ gap: ESP.l }}>
        <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-lineups" />
        <FicheLineup
          theme={theme}
          client={client}
          api={api}
          teamId={teamId}
          lineup={lineupOuvert}
          assets={assets}
          large={large}
          onRetour={() => setOuvert(undefined)}
          onModifier={() => setFormulaire({ lineup: lineupOuvert })}
          onChange={remplacer}
          onSupprime={apresSuppression}
          onOuvrirStrat={voitStrats ? ouvrirStrat : undefined}
        />
        <MentionRiot theme={theme} jeu={assets?.jeu} />
      </View>
    );
  }

  // ---------------------------------------------------------------- Corbeille
  if (corbeille) {
    return (
      <View testID="esport-lineups-corbeille" style={{ gap: ESP.l }}>
        <EnTetePage theme={theme} large={large} titre={trLu('corbeille.titre')} sous={trLu('corbeille.aide')} action={<BoutonHub theme={theme} titre={trLu('corbeille.retour')} onPress={() => setCorbeille(false)} testID="esport-lineups-corbeille-retour" />} />
        <CorbeilleLineups
          theme={theme}
          api={api}
          teamId={teamId}
          onRestaure={titre => {
            void recharger().catch(() => undefined);
            setAvis(trLu('corbeille.restaure', { titre }));
          }}
        />
        <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-lineups" />
      </View>
    );
  }

  // ---------------------------------------------------------------- Liste (grille ou vue par map)
  const vide = Boolean(liste && tous.length === 0);
  /** Téléphone : deux colonnes de cartes serrées. */
  const petit = !large && largeurFenetre < 520;
  const actifs = filtresActifs(filtres);
  const sides = sidesDuModele(modele);
  const nouveau = droits.proposer ? <BoutonHub theme={theme} titre={trLu(droits.gerer ? 'nouveau' : 'proposer')} variante="plein" icone="plus" onPress={() => setFormulaire({})} testID="esport-lineups-nouveau" /> : undefined;
  const effacer = () => (setFiltres({}), setRecherche(''), setPin(undefined), setGroupe(undefined));
  const agentFiltre = filtres.personnage ? assets?.agents.find(a => a.cle === filtres.personnage) : undefined;
  const capaciteParCle = (cle: string) => (agentFiltre ? agentFiltre.capacites : (assets?.agents ?? []).flatMap(a => a.capacites)).find(c => c.cle === cle);
  const choixVue = <Segments<Vue> theme={theme} libelle={trLu('vue.libelle')} valeur={vue} options={[['grille', trLu('vue.grille')], ['carte', trLu('vue.carte')]]} onChoisir={v => (setVue(v), setPin(undefined), setGroupe(undefined))} testID="esport-lineups-vue" />;
  const boutonFiltres = <BoutonPliable theme={theme} titre={trLu('filtres')} resume={actifs ? trnLu('filtres.n', actifs) : trLu('filtres.aucun')} ouvert={filtresOuverts} onBasculer={() => setFiltresOuverts(o => !o)} testID="esport-lineups-filtres-ouvrir" />;
  const barre = (
    <View style={{ gap: ESP.s }}>
      {large ? (
        <View style={{ flexDirection: 'row', gap: ESP.s, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Champ theme={theme} libelle={trLu('recherche')} valeur={recherche} onChanger={setRecherche} placeholder={trLu('recherche.aide')} maxLength={60} style={{ flexGrow: 1, flexBasis: 220, maxWidth: 420 }} testID="esport-lineups-recherche" />
          {boutonFiltres}
          <View style={{ flexGrow: 1 }} />
          {choixVue}
        </View>
      ) : (
        <>
          <Champ theme={theme} libelle={trLu('recherche')} valeur={recherche} onChanger={setRecherche} placeholder={trLu('recherche.aide')} maxLength={60} testID="esport-lineups-recherche" />
          <View style={{ flexDirection: 'row', gap: ESP.xs, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
            {choixVue}
            {boutonFiltres}
          </View>
        </>
      )}
      {filtresOuverts ? (
        <View testID="esport-lineups-filtres" style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: ESP.l, rowGap: large ? ESP.xs : ESP.s, paddingVertical: large ? ESP.xs : ESP.s, paddingHorizontal: ESP.s, borderRadius: Math.min(rayonCarte(theme), 12), borderWidth: 1, borderColor: theme.ligne, backgroundColor: theme.surface }}>
          {/* Vue par map : la map se choisit au-dessus de la carte. */}
          {vue === 'grille' ? <FiltreListe theme={theme} dense={large} libelle={trLu('filtre.carte')} valeur={filtres.carte ?? ''} options={fac.cartes} tout={trLu('toutes')} onChoisir={v => majFiltre({ carte: v || undefined })} testID="esport-lineups-filtre-carte" /> : null}
          {fac.personnages.length > 0 ? (
            <FiltreListe
              theme={theme}
              dense={large}
              libelle={trLuModele('filtre.personnage', modele)}
              valeur={filtres.personnage ?? ''}
              options={fac.personnages}
              tout={trLu('tous')}
              visuel={o => <PucePersonnage agent={assets?.agents.find(a => a.cle === o.id)} nom={o.nom} taille={large ? 22 : 28} />}
              onChoisir={v => majFiltre({ personnage: v || undefined })}
              testID="esport-lineups-filtre-personnage"
            />
          ) : null}
          {fac.capacites.length > 0 ? (
            <FiltreListe
              theme={theme}
              dense={large}
              libelle={trLuModele('filtre.capacite', modele)}
              valeur={filtres.capacite ?? ''}
              options={fac.capacites}
              tout={trLu('toutes')}
              visuel={o => <PuceCapacite capacite={capaciteParCle(o.id)} nom={o.nom} taille={large ? 22 : 28} />}
              onChoisir={v => majFiltre({ capacite: v || undefined })}
              testID="esport-lineups-filtre-capacite"
            />
          ) : null}
          {filtres.carte && fac.zones.length > 0 ? <FiltreListe theme={theme} dense={large} libelle={trLu('filtre.zone')} valeur={filtres.zone ?? ''} options={fac.zones} tout={trLu('toutes')} onChoisir={v => majFiltre({ zone: v || undefined })} testID="esport-lineups-filtre-zone" /> : null}
          {sides.length > 0 ? (
            <PastillesFiltre theme={theme} dense={large} libelle={trLu(modele === 'thefinals' ? 'filtre.mode' : 'filtre.side')} valeur={filtres.side ?? ''} tout={trLu('tous')} options={sides.map(x => ({ id: x, nom: nomSide(x) }))} onChoisir={v => majFiltre({ side: v || undefined })} testID="esport-lineups-filtre-side" />
          ) : null}
          {fac.tags.length > 0 ? <FiltreListe theme={theme} dense={large} libelle={trLu('filtre.tag')} valeur={filtres.tag ?? ''} options={fac.tags} tout={trLu('tous')} onChoisir={v => majFiltre({ tag: v || undefined })} testID="esport-lineups-filtre-tag" /> : null}
          <PastillesFiltre
            theme={theme}
            dense={large}
            libelle={trLu('filtre.statut')}
            valeur={filtres.statut ?? ''}
            tout={trLu('tous')}
            options={[
              { id: 'valide', nom: trLu('statut.valides') },
              { id: 'propose', nom: trLu('statut.proposes') },
            ]}
            onChoisir={v => majFiltre({ statut: (v || undefined) as StatutLineup | undefined })}
            testID="esport-lineups-filtre-statut"
          />
          <Pressable
            testID="esport-lineups-filtre-favoris"
            accessibilityRole="switch"
            accessibilityState={{ checked: Boolean(filtres.favoris) }}
            accessibilityLabel={trLu('filtre.favoris')}
            onPress={() => majFiltre({ favoris: !filtres.favoris })}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: large ? 32 : 44, paddingHorizontal: large ? 10 : 12, borderRadius: 999, borderWidth: 1, borderColor: filtres.favoris ? '#F4C542' : theme.ligne, backgroundColor: filtres.favoris ? teinteTransparente('#F4C542', 0.16) : 'transparent' }}>
            <Icone nom="etoile" taille={large ? 14 : 16} couleur={filtres.favoris ? '#F4C542' : theme.attenue} />
            <Text style={{ ...texte(theme, large ? 13 : 14), fontWeight: filtres.favoris ? '700' : '500' }}>{trLu('filtre.favoris')}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
  const compteEtEffacer = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.s, flexWrap: 'wrap', minHeight: 32 }}>
      <Text style={attenue(theme, 12)} testID="esport-lineups-compte">
        {trLu('compte', { n: visibles.length, total: tous.length })}
      </Text>
      {actifs || recherche ? (
        <Pressable testID="esport-lineups-filtres-effacer" accessibilityRole="button" onPress={effacer} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: large ? 32 : 44 }}>
          <Icone nom="croix" taille={14} couleur={theme.accent} />
          <Text style={{ ...texte(theme, 13), fontWeight: '600', color: theme.accent }}>{trLu('filtres.effacer')}</Text>
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <View testID="esport-lineups" style={{ gap: ESP.l }}>
      <EnTetePage theme={theme} large={large} titre={titrePage} sous={large || vide ? trLuModele('sous', modele) : undefined} action={nouveau} actions={[droits.proposer && { titre: trLu('corbeille.ouvrir'), onPress: () => setCorbeille(true), testID: 'esport-lineups-corbeille-ouvrir' }]} />
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-lineups" />
      {!liste ? <SqueletteCartes theme={theme} n={large ? 3 : 1} large={large} /> : null}
      {vide ? (
        <Carte theme={theme}>
          <EtatVide theme={theme} glyphe="viseur" titre={trLu('vide.titre')} texte={`${trLuModele('vide.texte', modele)}${droits.proposer ? '' : ` ${trLu('vide.lecture')}`}`} action={droits.proposer ? { titre: trLu(droits.gerer ? 'nouveau' : 'proposer'), onPress: () => setFormulaire({}), testID: 'esport-lineups-vide-nouveau' } : undefined} testID="esport-lineups-vide" />
        </Carte>
      ) : null}
      {liste && !vide ? (
        <View style={{ gap: ESP.xs }}>
          {barre}
          {compteEtEffacer}
        </View>
      ) : null}
      {liste && !vide && vue === 'grille' ? (
        visibles.length === 0 ? (
          <Carte theme={theme}>
            <EtatVide theme={theme} glyphe="loupe" titre={trLu('vide.filtres.titre')} texte={trLu('vide.filtres.texte')} action={{ titre: trLu('filtres.effacer'), onPress: effacer }} testID="esport-lineups-vide-filtres" />
          </Carte>
        ) : (
          <GrilleEgale min={petit ? 150 : 236} gap={petit ? ESP.xs : ESP.m} testID="esport-lineups-grille">
            {visibles.map(l => (
              <CarteLineup key={l.id} theme={theme} lineup={l} assets={assets} dense={petit} onOuvrir={() => setOuvert(l.id)} onFavori={() => basculerFavori(l)} />
            ))}
          </GrilleEgale>
        )
      ) : null}
      {liste && !vide && vue === 'carte' ? (
        <VueCarte
          theme={theme}
          client={client}
          api={api}
          teamId={teamId}
          assets={assets}
          large={large}
          coteACote={coteACote}
          lineups={visibles}
          carteChoisie={filtres.carte}
          cartes={fac.cartes}
          onCarte={v => majFiltre({ carte: v })}
          pin={pin}
          onPin={choisirPin}
          groupe={groupe}
          onGroupe={g => (setGroupe(g), setPin(undefined))}
          largeur={largeurCarte}
          onLargeur={setLargeurCarte}
          onOuvrir={id => setOuvert(id)}
          onModifier={l => setFormulaire({ lineup: l })}
          onChange={remplacer}
          onSupprime={apresSuppression}
          onOuvrirStrat={voitStrats ? ouvrirStrat : undefined}
        />
      ) : null}
      <MentionRiot theme={theme} jeu={assets?.jeu} />
    </View>
  );
}

/** Vue par map : les lineups en pins à leur point d'arrivée ; un pin touché montre sa trajectoire et ouvre sa fiche. */
function VueCarte({
  theme,
  client,
  api,
  teamId,
  assets,
  large,
  coteACote,
  lineups,
  carteChoisie,
  cartes,
  onCarte,
  pin,
  onPin,
  groupe,
  onGroupe,
  largeur,
  onLargeur,
  onOuvrir,
  onModifier,
  onChange,
  onSupprime,
  onOuvrirStrat,
}: {
  theme: ThemeHub;
  client: PropsModule['client'];
  api: ApiLineups;
  teamId: string;
  assets: Assets | undefined;
  large: boolean;
  /** Carte et fiche côte à côte (PC, iPad) ; sinon l'une sous l'autre. */
  coteACote: boolean;
  lineups: readonly Lineup[];
  carteChoisie: string | undefined;
  cartes: readonly OptionFacette[];
  onCarte(cle: string): void;
  pin: string | undefined;
  onPin(id: string | undefined): void;
  groupe: string | undefined;
  onGroupe(cle: string | undefined): void;
  largeur: number;
  onLargeur(px: number): void;
  onOuvrir(id: string): void;
  onModifier(l: Lineup): void;
  onChange(l: Lineup): void;
  onSupprime(l: Lineup): void;
  onOuvrirStrat?(id: string): void;
}) {
  // Sans map choisie : celle qui a le plus de lineups.
  const cle = carteChoisie ?? [...cartes].sort((a, b) => b.n - a.n)[0]?.id;
  const surCarte = useMemo(() => lineups.filter(l => l.carte.cle === cle), [lineups, cle]);
  const groupes = useMemo(() => grouperPins(surCarte, rayonRegroupement(largeur)), [surCarte, largeur]);
  const sansPoint = surCarte.filter(l => !l.arrivee).length;
  const choisi = pin ? surCarte.find(l => l.id === pin) : undefined;
  const groupeChoisi = groupe ? groupes.find(g => g.cle === groupe) : undefined;
  const carte = carteDe(assets, cle);
  const nomCarte = carte?.nom ?? cartes.find(c => c.id === cle)?.nom ?? '';

  const pins: PinCarte[] = groupes.map(g => {
    const l = g.lineups[0];
    const agent = agentDe(assets, l.personnage);
    const seul = g.lineups.length === 1;
    const contient = Boolean(choisi && g.lineups.some(x => x.id === choisi.id));
    return {
      id: seul ? l.id : g.cle,
      x: g.x,
      y: g.y,
      couleur: couleurPersonnage(agent, l.personnage?.nom),
      icone: seul ? sourcesIcone(capaciteDe(agent, l.capacite)) : null,
      initiales: initiales(l.capacite?.nom ?? l.personnage?.nom ?? l.titre),
      libelle: seul ? trLu('carte.pin', { titre: l.titre, detail: [l.personnage?.nom, l.capacite?.nom].filter(Boolean).join(', ') || l.carte.nom }) : trLu('carte.groupe', { n: g.lineups.length }),
      n: g.lineups.length,
      actif: contient || g.cle === groupe,
      estompe: Boolean(choisi) && !contient,
    };
  });
  const couleurChoisi = choisi ? couleurPersonnage(agentDe(assets, choisi.personnage), choisi.personnage?.nom) : theme.accent;
  const toucherPin = (id: string) => {
    const g = groupes.find(x => (x.lineups.length === 1 ? x.lineups[0].id : x.cle) === id);
    if (!g) return;
    if (g.lineups.length === 1) onPin(g.lineups[0].id === pin ? undefined : g.lineups[0].id);
    else onGroupe(g.cle === groupe ? undefined : g.cle);
  };

  const panneau = choisi ? (
    <FicheLineup theme={theme} client={client} api={api} teamId={teamId} lineup={choisi} assets={assets} large={large} compacte onOuvrir={() => onOuvrir(choisi.id)} onModifier={() => onModifier(choisi)} onChange={onChange} onSupprime={onSupprime} onOuvrirStrat={onOuvrirStrat} />
  ) : groupeChoisi ? (
    <View testID="esport-lineups-groupe" style={{ gap: ESP.xs }}>
      <Text accessibilityRole="header" style={{ ...texte(theme, 15), fontWeight: '700' }}>
        {trLu('carte.groupe.titre', { n: groupeChoisi.lineups.length })}
      </Text>
      {groupeChoisi.lineups.map(l => (
        <LigneLineup key={l.id} theme={theme} lineup={l} assets={assets} onPress={() => onPin(l.id)} testID={`esport-lineups-groupe-${l.id}`} />
      ))}
    </View>
  ) : (
    <View testID="esport-lineups-carte-aide" style={{ gap: ESP.s }}>
      <Text style={{ ...texte(theme, 15), fontWeight: '700' }}>{surCarte.length - sansPoint > 0 ? trLu('carte.touchez') : trLu('carte.vide')}</Text>
      <Text style={attenue(theme, 13)}>{trLu('carte.choisir.texte')}</Text>
      {surCarte
        .filter(l => l.arrivee)
        .slice(0, 8)
        .map(l => (
          <LigneLineup key={l.id} theme={theme} lineup={l} assets={assets} onPress={() => onPin(l.id)} testID={`esport-lineups-liste-${l.id}`} />
        ))}
    </View>
  );

  return (
    <View testID="esport-lineups-vue-carte" style={{ gap: ESP.s }}>
      {cartes.length > 1 ? (
        <View accessibilityRole="radiogroup" accessibilityLabel={trLu('filtre.carte')} style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {cartes.map(c => {
            const actif = c.id === cle;
            return (
              <Pressable
                key={c.id}
                testID={`esport-lineups-carte-${c.id}`}
                accessibilityRole="radio"
                accessibilityState={{ checked: actif }}
                accessibilityLabel={`${trLu('filtre.carte')} : ${c.nom}`}
                onPress={() => onCarte(c.id)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: large ? 36 : 44, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: actif ? theme.accent : theme.ligne, backgroundColor: actif ? teinteTransparente(theme.accent, 0.18) : theme.surface }}>
                <Text style={{ ...texte(theme, 14), fontWeight: actif ? '700' : '500' }}>{c.nom}</Text>
                <Text style={attenue(theme, 12)}>{c.n}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <View style={coteACote ? { flexDirection: 'row', gap: large ? ESP.l : ESP.s, alignItems: 'flex-start' } : { gap: ESP.m }}>
        <View style={coteACote ? { flex: large ? 1.35 : 1.2, minWidth: 0, gap: ESP.xs, maxWidth: 780 } : { minWidth: 0, gap: ESP.xs, maxWidth: 780, width: '100%' }}>
          <CarteTactique
            carte={carte}
            nom={nomCarte}
            pins={pins}
            trajets={choisi ? [{ id: choisi.id, depart: choisi.depart, arrivee: choisi.arrivee, couleur: couleurChoisi }] : []}
            onPin={toucherPin}
            onLargeur={onLargeur}
            testID="esport-lineups-carte"
          />
          <View style={{ flexDirection: 'row', gap: ESP.m, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
            <Legende theme={theme} couleur={couleurChoisi} />
            {sansPoint > 0 ? <Text style={attenue(theme, 12)}>{trnLu('carte.sans_point', sansPoint)}</Text> : null}
          </View>
        </View>
        <View style={{ flex: coteACote ? 1 : undefined, minWidth: 0, padding: large ? ESP.m : ESP.s, borderRadius: Math.min(rayonCarte(theme), 14), borderWidth: 1, borderColor: theme.ligne, backgroundColor: theme.surface }}>{panneau}</View>
      </View>
    </View>
  );
}

/** Corbeille : lineups supprimés depuis moins de 30 jours, restaurables. */
function CorbeilleLineups({ theme, api, teamId, onRestaure }: { theme: ThemeHub; api: ApiLineups; teamId: string; onRestaure(titre: string): void }) {
  const [lignes, setLignes] = useState<LineupCorbeille[] | undefined>();
  const { enCours, erreur, agir } = useAgir();
  const charger = useCallback(async () => setLignes(await api.corbeille(teamId)), [api, teamId]);
  useEffect(() => {
    void agir('', charger);
  }, [agir, charger]);
  return (
    <View style={{ gap: ESP.s }}>
      <Retours theme={theme} erreur={erreur} prefixe="esport-lineups-corbeille" />
      {lignes?.length === 0 ? (
        <Carte theme={theme}>
          <EtatVide theme={theme} glyphe="corbeille" titre={trLu('corbeille.vide')} testID="esport-lineups-corbeille-vide" />
        </Carte>
      ) : null}
      {lignes?.map(l => (
        <View key={l.id} testID={`esport-lineups-corbeille-${l.id}`} style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.s, flexWrap: 'wrap', padding: ESP.s, borderRadius: 12, borderWidth: 1, borderColor: theme.ligne, backgroundColor: theme.surface }}>
          <View style={{ flex: 1, minWidth: 180, gap: 2 }}>
            <Text style={{ ...texte(theme, 15), fontWeight: '700' }}>{l.titre}</Text>
            <Text style={attenue(theme, 12)}>{`${l.carte.nom} · ${trLu('corbeille.par', { qui: l.supprimePar?.pseudo ?? trLu('fiche.inconnu'), date: dateCourte(l.supprimeLe) })}`}</Text>
          </View>
          <BoutonHub
            theme={theme}
            titre={trLu('corbeille.restaurer')}
            desactive={Boolean(enCours)}
            onPress={() =>
              void agir('restauration', async () => {
                await api.restaurer(teamId, l.id);
                await charger();
                onRestaure(l.titre);
              })
            }
            testID={`esport-lineups-restaurer-${l.id}`}
          />
        </View>
      ))}
    </View>
  );
}
