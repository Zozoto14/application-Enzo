/**
 * Trombinoscope (page Membres, premier sous-onglet) : grille de cartes — photo, pseudo, team(s) et jeu, postes,
 * elo, réseaux — avec recherche et filtres (team, jeu, poste du profil de jeu), puis la FICHE détaillée au clic
 * (FicheTrombi.tsx). Ce que chacun voit est décidé par le serveur (GET /trombi) : le CM et le staff tout leur
 * périmètre, un joueur les membres de ses teams (champs « membres » seulement), chacun sa propre fiche.
 *
 * Badges (migration 0032) : puces sous le pseudo (ordre du catalogue, 3 au plus et « +N »), filtre par badge ;
 * menu « ⋯ » : « Gérer les badges » (catalogue, GestionBadges.tsx) et « Badge à plusieurs » (sélection de cartes).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { BoutonHub, Case, Champ } from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import type { ClientEsport } from '../../client';
import { apiTrombi, filtrerCartes, postesAffiches, type CarteTrombi, type FiltresTrombi, type Trombinoscope as Donnees } from '../../trombi/api';
import { trTb, trnTb, type CleTb } from '../../i18n/trombi';
import { Choix, Retours, useAgir } from '../commun';
import { Badge, Carte, ESP, EnTetePage, EtatVide, Grille, LARGEUR_CONTENU, Pliable, SqueletteCartes, Volet, attenue, couleurTeam, texte, useDensite, type EtatPresse } from '../design';
import { FicheTrombi } from './FicheTrombi';
import { GestionBadges } from './GestionBadges';
import { PastilleReseau, PhotoJoueur, PucesBadges } from './commun';
import { useTempsReel } from '../../tempsReel/hooks';

const FILTRES_VIDES: FiltresTrombi = { recherche: '', team: 'toutes', jeu: 'tous', poste: 'tous', badge: 'tous' };

export function Trombinoscope({ theme, client, large, onExporter }: { theme: ThemeHub; client: ClientEsport; large: boolean; onExporter?(nom: string, contenu: string, type?: string): Promise<boolean> }) {
  const api = useMemo(() => apiTrombi(client), [client]);
  const [donnees, setDonnees] = useState<Donnees | undefined>();
  const [filtres, setFiltres] = useState<FiltresTrombi>(FILTRES_VIDES);
  const { marge } = useDensite();
  const [ouvert, setOuvert] = useState<{ compte: string; edition: boolean } | undefined>();
  const [gestion, setGestion] = useState(false);
  const [selection, setSelection] = useState<Set<string> | undefined>();
  const [badgeLot, setBadgeLot] = useState<string | undefined>();
  const { erreur, avis, agir, enCours } = useAgir();

  const recharger = useCallback(async () => setDonnees(await api.liste()), [api]);
  useEffect(() => {
    void agir('', recharger);
  }, [agir, recharger]);
  // Temps réel : fiche, photo ou badge changé par un autre.
  useTempsReel(client, 'trombi', () => void recharger().catch(() => undefined));

  const visibles = useMemo(() => (donnees ? filtrerCartes(donnees.fiches, filtres) : []), [donnees, filtres]);
  const postes = useMemo(() => {
    const jeux = (donnees?.jeux ?? []).filter(j => filtres.jeu === 'tous' || j.cle === filtres.jeu);
    const vus = new Map<string, string>();
    for (const j of jeux) for (const r of j.rolesJoueurs) if (!vus.has(r.cle)) vus.set(r.cle, r.nom);
    return [...vus].map(([id, nom]) => ({ id, nom }));
  }, [donnees, filtres.jeu]);
  const actifs = Number(filtres.team !== 'toutes') + Number(filtres.jeu !== 'tous') + Number(filtres.poste !== 'tous') + Number((filtres.badge ?? 'tous') !== 'tous');
  const droitsBadges = donnees?.droits.badges;
  // Badges attribuables en lot : manuels, et réservés au Fondateur seulement pour lui.
  const badgesLot = (donnees?.badges ?? []).filter(b => !b.auto && (!b.reserve || droitsBadges?.fondateur));
  const lot = (retirer: boolean) =>
    void agir('lot', async () => {
      const r = await api.badgeEnLot(badgeLot!, [...(selection ?? [])], { retirer });
      await recharger();
      return trnTb('selection.fait', r.modifies);
    });
  const moi = donnees?.fiches.find(f => f.moi);
  const portee = donnees ? trTb(`portee.${donnees.droits.voir}` as CleTb) : trTb('chargement');

  return (
    <ScrollView
      contentContainerStyle={{ paddingHorizontal: large ? marge : ESP.m, paddingTop: large ? ESP.l : ESP.m, paddingBottom: ESP.xxxl, gap: large ? ESP.l : ESP.m, maxWidth: LARGEUR_CONTENU + 2 * marge, width: '100%', alignSelf: 'center' }}
      keyboardShouldPersistTaps="handled"
      testID="esport-trombi">
      <EnTetePage
        theme={theme}
        large={large}
        titre={trTb('titre')}
        sous={donnees ? `${trnTb('fiches', donnees.fiches.length)} · ${portee}` : portee}
        action={
          moi || droitsBadges?.gerer ? (
            <>
              {droitsBadges?.gerer ? <BoutonHub theme={theme} titre={trTb('badges.gerer')} onPress={() => setGestion(true)} testID="esport-trombi-badges-gerer-bouton" /> : null}
              {moi ? <BoutonHub theme={theme} titre={trTb('ma_fiche')} variante="plein" onPress={() => setOuvert({ compte: moi.compte, edition: true })} testID="esport-trombi-ma-fiche" /> : null}
            </>
          ) : undefined
        }
        actions={[
          droitsBadges?.gerer && { titre: trTb('badges.gerer'), onPress: () => setGestion(true), testID: 'esport-trombi-badges-gerer' },
          droitsBadges?.attribuer && !selection && { titre: trTb('selection.commencer'), onPress: () => setSelection(new Set()), testID: 'esport-trombi-selection' },
        ]}
        testID="esport-trombi-entete"
      />
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-trombi" />
      {selection ? (
        <Carte theme={theme} testID="esport-trombi-selection-barre">
          <View style={{ gap: ESP.s }}>
            <Text style={{ ...texte(theme, 15), fontWeight: '700' }}>{trnTb('selection.titre', selection.size)}</Text>
            <Text style={attenue(theme)}>{trTb('selection.aide')}</Text>
            <Choix theme={theme} libelle={trTb('selection.badge')} valeur={badgeLot} options={badgesLot.map(b => ({ id: b.id, nom: `${b.icone ? `${b.icone} ` : ''}${b.nom}`, couleur: b.couleur }))} onChoisir={setBadgeLot} testID="esport-trombi-selection-badge" />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ESP.xs }}>
              <BoutonHub theme={theme} titre={trTb('selection.attribuer')} variante="plein" desactive={!badgeLot || !selection.size || Boolean(enCours)} onPress={() => lot(false)} testID="esport-trombi-selection-attribuer" />
              <BoutonHub theme={theme} titre={trTb('selection.retirer')} desactive={!badgeLot || !selection.size || Boolean(enCours)} onPress={() => lot(true)} testID="esport-trombi-selection-retirer" />
              <BoutonHub
                theme={theme}
                titre={trTb('selection.terminer')}
                onPress={() => {
                  setSelection(undefined);
                  setBadgeLot(undefined);
                }}
                testID="esport-trombi-selection-terminer"
              />
            </View>
          </View>
        </Carte>
      ) : null}
      {donnees ? (
        <View style={{ gap: ESP.s }}>
          <Champ theme={theme} libelle={trTb('recherche')} placeholder={trTb('recherche_aide')} valeur={filtres.recherche} onChanger={recherche => setFiltres(f => ({ ...f, recherche }))} maxLength={60} testID="esport-trombi-recherche" />
          <Pliable theme={theme} titre={trTb('filtres')} resume={actifs ? trnTb('filtres_actifs', actifs) : undefined} testID="esport-trombi-filtres">
            {donnees.teams.length > 1 ? (
              <Choix
                theme={theme}
                libelle={trTb('filtre.team')}
                valeur={filtres.team}
                options={[{ id: 'toutes', nom: trTb('filtre.toutes') }, ...donnees.teams.map(t => ({ id: t.id, nom: t.nom, couleur: couleurTeam(t.slug) }))]}
                onChoisir={team => setFiltres(f => ({ ...f, team }))}
                testID="esport-trombi-filtre-team"
              />
            ) : null}
            {donnees.jeux.length > 1 ? (
              <Choix
                theme={theme}
                libelle={trTb('filtre.jeu')}
                valeur={filtres.jeu}
                options={[{ id: 'tous', nom: trTb('filtre.tous') }, ...donnees.jeux.map(j => ({ id: j.cle, nom: j.nom }))]}
                onChoisir={jeu => setFiltres(f => ({ ...f, jeu, poste: 'tous' }))}
                testID="esport-trombi-filtre-jeu"
              />
            ) : null}
            {donnees.badges.length ? (
              <Choix
                theme={theme}
                libelle={trTb('filtre.badge')}
                valeur={filtres.badge ?? 'tous'}
                options={[{ id: 'tous', nom: trTb('filtre.tous') }, ...donnees.badges.filter(b => !b.auto || b.autoActif).map(b => ({ id: b.id, nom: `${b.icone ? `${b.icone} ` : ''}${b.nom}`, couleur: b.couleur }))]}
                onChoisir={badge => setFiltres(f => ({ ...f, badge }))}
                testID="esport-trombi-filtre-badge"
              />
            ) : null}
            {postes.length ? (
              <Choix theme={theme} libelle={trTb('filtre.poste')} valeur={filtres.poste} options={[{ id: 'tous', nom: trTb('filtre.tous') }, ...postes]} onChoisir={poste => setFiltres(f => ({ ...f, poste }))} testID="esport-trombi-filtre-poste" />
            ) : null}
            {actifs || filtres.recherche ? (
              <View style={{ alignSelf: 'flex-start' }}>
                <BoutonHub theme={theme} titre={trTb('filtres_effacer')} onPress={() => setFiltres(FILTRES_VIDES)} testID="esport-trombi-filtres-effacer" />
              </View>
            ) : null}
          </Pliable>
        </View>
      ) : null}
      {!donnees && !erreur ? <SqueletteCartes theme={theme} n={large ? 4 : 2} large={large} /> : null}
      {donnees && visibles.length === 0 ? (
        <Carte theme={theme}>
          <EtatVide theme={theme} glyphe="membres" titre={donnees.fiches.length ? trTb('vide_filtres') : trTb('vide')} texte={donnees.fiches.length ? trTb('vide_filtres_aide') : trTb('vide_aide')} />
        </Carte>
      ) : null}
      {visibles.length ? (
        <Grille min={large ? 200 : 150} etirer={!large} gap={large ? ESP.m : ESP.s} testID="esport-trombi-grille">
          {visibles.map(c => (
            <CarteJoueur
              key={c.compte}
              theme={theme}
              carte={c}
              large={large}
              selection={selection && c.peutBadges ? { coche: selection.has(c.compte), basculer: v => setSelection(s => { const n = new Set(s); if (v) n.add(c.compte); else n.delete(c.compte); return n; }) } : undefined}
              onOuvrir={() => setOuvert({ compte: c.compte, edition: false })}
            />
          ))}
        </Grille>
      ) : null}
      {ouvert ? (
        <Volet theme={theme} visible titre={donnees?.fiches.find(f => f.compte === ouvert.compte)?.pseudo ?? trTb('fiche')} onFermer={() => setOuvert(undefined)} testID="esport-trombi-fiche" largeur={large ? 760 : 560}>
          <FicheTrombi
            key={`${ouvert.compte}-${ouvert.edition}`}
            theme={theme}
            api={api}
            compte={ouvert.compte}
            large={large}
            editionInitiale={ouvert.edition}
            onExporter={onExporter}
            onModifiee={() => void agir('', recharger)}
          />
        </Volet>
      ) : null}
      {gestion && droitsBadges ? (
        <Volet theme={theme} visible titre={trTb('badges.gerer')} onFermer={() => setGestion(false)} testID="esport-trombi-badges-volet" largeur={large ? 680 : 560}>
          <GestionBadges theme={theme} api={api} fondateur={Boolean(droitsBadges.fondateur)} onChange={recharger} />
        </Volet>
      ) : null}
    </ScrollView>
  );
}

function CarteJoueur({ theme, carte: c, large, selection, onOuvrir }: { theme: ThemeHub; carte: CarteTrombi; large: boolean; selection?: { coche: boolean; basculer(v: boolean): void }; onOuvrir(): void }) {
  const t0 = c.teams[0];
  const couleur = t0 ? couleurTeam(t0.slug) : theme.accent;
  const ligneTeams = c.teams.map(t => `${t.nom} · ${t.jeuNom}`).join(' / ');
  const postes = [...new Set(c.teams.flatMap(postesAffiches))];
  return (
    <Pressable
      testID={`esport-trombi-carte-${c.compte}`}
      accessibilityRole={selection ? 'checkbox' : 'button'}
      accessibilityState={selection ? { checked: selection.coche } : undefined}
      accessibilityLabel={selection ? trTb('selection.cocher', { pseudo: c.pseudo }) : trTb('ouvrir_fiche', { pseudo: c.pseudo })}
      onPress={selection ? () => selection.basculer(!selection.coche) : onOuvrir}
      style={(etat: EtatPresse) => ({
        backgroundColor: theme.surface,
        borderColor: selection?.coche || etat.hovered || etat.focused ? theme.accent : theme.ligne,
        borderWidth: selection?.coche ? 2 : 1,
        borderRadius: Math.min(theme.rayonGrand, 18),
        padding: large ? ESP.s : ESP.xs,
        gap: ESP.xs,
        opacity: etat.pressed ? 0.85 : 1,
        height: '100%',
      })}>
      <View>
        <PhotoJoueur theme={theme} url={c.photo} pseudo={c.pseudo} couleur={couleur} testID={`esport-trombi-carte-${c.compte}-photo`} />
        {selection ? (
          <View style={{ position: 'absolute', top: ESP.xs, left: ESP.xs, backgroundColor: theme.surface, borderRadius: 6, padding: 2 }}>
            <Case theme={theme} coche={selection.coche} libelle={trTb('selection.cocher', { pseudo: c.pseudo })} onChanger={selection.basculer} testID={`esport-trombi-carte-${c.compte}-case`} />
          </View>
        ) : null}
      </View>
      <View style={{ gap: 2, paddingHorizontal: ESP.xxs }}>
        <Text style={{ ...texte(theme, large ? 17 : 15), fontWeight: '800' }} numberOfLines={1}>
          {c.pseudo}
        </Text>
        <Text style={attenue(theme, 12)} numberOfLines={2}>
          {ligneTeams || trTb('sans_team')}
        </Text>
      </View>
      {c.badges.length ? (
        <View style={{ paddingHorizontal: ESP.xxs }}>
          <PucesBadges theme={theme} badges={c.badges} max={3} testID={`esport-trombi-carte-${c.compte}-badges`} />
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ESP.xxs, paddingHorizontal: ESP.xxs }}>
        {postes.slice(0, 3).map(p => (
          <Badge key={p} theme={theme} texte={p} />
        ))}
        {c.elo ? <Badge theme={theme} ton="accent" texte={[c.elo.rang, c.elo.valeur].filter(Boolean).join(' · ')} testID={`esport-trombi-carte-${c.compte}-elo`} /> : null}
      </View>
      <View style={{ flex: 1 }} />
      {c.reseaux.length || c.palmares ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: ESP.xxs, paddingHorizontal: ESP.xxs }}>
          {c.reseaux.slice(0, 6).map(r => (
            <PastilleReseau key={`${r.reseau}-${r.url}`} theme={theme} reseau={r.reseau} libelle={r.libelle} />
          ))}
          {c.palmares ? <Text style={{ ...attenue(theme, 12), marginLeft: 'auto' }}>{trnTb('titres', c.palmares)}</Text> : null}
        </View>
      ) : null}
    </Pressable>
  );
}
