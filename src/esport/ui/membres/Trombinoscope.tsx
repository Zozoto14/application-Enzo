/**
 * Trombinoscope (page Membres, premier sous-onglet) : grille de cartes — photo, pseudo, team(s) et jeu, postes,
 * elo, réseaux — avec recherche et filtres (team, jeu, poste du profil de jeu), puis la FICHE détaillée au clic
 * (FicheTrombi.tsx). Ce que chacun voit est décidé par le serveur (GET /trombi) : le CM et le staff tout leur
 * périmètre, un joueur les membres de ses teams (champs « membres » seulement), chacun sa propre fiche.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { BoutonHub, Champ } from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import type { ClientEsport } from '../../client';
import { apiTrombi, filtrerCartes, postesAffiches, type CarteTrombi, type FiltresTrombi, type Trombinoscope as Donnees } from '../../trombi/api';
import { trTb, trnTb, type CleTb } from '../../i18n/trombi';
import { Choix, Retours, useAgir } from '../commun';
import { Badge, Carte, ESP, EnTetePage, EtatVide, Grille, LARGEUR_CONTENU, Pliable, SqueletteCartes, Volet, attenue, couleurTeam, texte, type EtatPresse } from '../design';
import { FicheTrombi } from './FicheTrombi';
import { PastilleReseau, PhotoJoueur } from './commun';

const FILTRES_VIDES: FiltresTrombi = { recherche: '', team: 'toutes', jeu: 'tous', poste: 'tous' };

export function Trombinoscope({ theme, client, large, onExporter }: { theme: ThemeHub; client: ClientEsport; large: boolean; onExporter?(nom: string, contenu: string, type?: string): Promise<boolean> }) {
  const api = useMemo(() => apiTrombi(client), [client]);
  const [donnees, setDonnees] = useState<Donnees | undefined>();
  const [filtres, setFiltres] = useState<FiltresTrombi>(FILTRES_VIDES);
  const [ouvert, setOuvert] = useState<{ compte: string; edition: boolean } | undefined>();
  const { erreur, agir } = useAgir();

  const recharger = useCallback(async () => setDonnees(await api.liste()), [api]);
  useEffect(() => {
    void agir('', recharger);
  }, [agir, recharger]);

  const visibles = useMemo(() => (donnees ? filtrerCartes(donnees.fiches, filtres) : []), [donnees, filtres]);
  const postes = useMemo(() => {
    const jeux = (donnees?.jeux ?? []).filter(j => filtres.jeu === 'tous' || j.cle === filtres.jeu);
    const vus = new Map<string, string>();
    for (const j of jeux) for (const r of j.rolesJoueurs) if (!vus.has(r.cle)) vus.set(r.cle, r.nom);
    return [...vus].map(([id, nom]) => ({ id, nom }));
  }, [donnees, filtres.jeu]);
  const actifs = Number(filtres.team !== 'toutes') + Number(filtres.jeu !== 'tous') + Number(filtres.poste !== 'tous');
  const moi = donnees?.fiches.find(f => f.moi);
  const portee = donnees ? trTb(`portee.${donnees.droits.voir}` as CleTb) : trTb('chargement');

  return (
    <ScrollView
      contentContainerStyle={{ paddingHorizontal: large ? ESP.xxl : ESP.m, paddingTop: large ? ESP.l : ESP.m, paddingBottom: ESP.xxxl, gap: large ? ESP.l : ESP.m, maxWidth: LARGEUR_CONTENU + 2 * ESP.xxl, width: '100%', alignSelf: 'center' }}
      keyboardShouldPersistTaps="handled"
      testID="esport-trombi">
      <EnTetePage
        theme={theme}
        large={large}
        titre={trTb('titre')}
        sous={donnees ? `${trnTb('fiches', donnees.fiches.length)} · ${portee}` : portee}
        action={moi ? <BoutonHub theme={theme} titre={trTb('ma_fiche')} variante="plein" onPress={() => setOuvert({ compte: moi.compte, edition: true })} testID="esport-trombi-ma-fiche" /> : undefined}
        testID="esport-trombi-entete"
      />
      <Retours theme={theme} erreur={erreur} prefixe="esport-trombi" />
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
          <EtatVide theme={theme} glyphe="☺" titre={donnees.fiches.length ? trTb('vide_filtres') : trTb('vide')} texte={donnees.fiches.length ? trTb('vide_filtres_aide') : trTb('vide_aide')} />
        </Carte>
      ) : null}
      {visibles.length ? (
        <Grille min={large ? 200 : 150} gap={large ? ESP.m : ESP.s} testID="esport-trombi-grille">
          {visibles.map(c => (
            <CarteJoueur key={c.compte} theme={theme} carte={c} large={large} onOuvrir={() => setOuvert({ compte: c.compte, edition: false })} />
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
    </ScrollView>
  );
}

function CarteJoueur({ theme, carte: c, large, onOuvrir }: { theme: ThemeHub; carte: CarteTrombi; large: boolean; onOuvrir(): void }) {
  const t0 = c.teams[0];
  const couleur = t0 ? couleurTeam(t0.slug) : theme.accent;
  const ligneTeams = c.teams.map(t => `${t.nom} · ${t.jeuNom}`).join(' / ');
  const postes = [...new Set(c.teams.flatMap(postesAffiches))];
  return (
    <Pressable
      testID={`esport-trombi-carte-${c.compte}`}
      accessibilityRole="button"
      accessibilityLabel={trTb('ouvrir_fiche', { pseudo: c.pseudo })}
      onPress={onOuvrir}
      style={(etat: EtatPresse) => ({
        backgroundColor: theme.surface,
        borderWidth: 1,
        borderColor: etat.hovered || etat.focused ? theme.accent : theme.ligne,
        borderRadius: Math.min(theme.rayonGrand, 18),
        padding: large ? ESP.s : ESP.xs,
        gap: ESP.xs,
        opacity: etat.pressed ? 0.85 : 1,
        height: '100%',
      })}>
      <PhotoJoueur theme={theme} url={c.photo} pseudo={c.pseudo} couleur={couleur} testID={`esport-trombi-carte-${c.compte}-photo`} />
      <View style={{ gap: 2, paddingHorizontal: ESP.xxs }}>
        <Text style={{ ...texte(theme, large ? 17 : 15), fontWeight: '800' }} numberOfLines={1}>
          {c.pseudo}
        </Text>
        <Text style={attenue(theme, 12)} numberOfLines={2}>
          {ligneTeams || trTb('sans_team')}
        </Text>
      </View>
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
