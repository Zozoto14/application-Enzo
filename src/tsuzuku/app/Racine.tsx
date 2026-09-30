/**
 * Tsuzuku, app du hub : écran racine.
 *
 * Même mot de passe, mêmes profils et mêmes permissions que le hub : l'app
 * n'a ni serveur ni compte à elle. Ses données sont dans la base chiffrée du
 * profil ouvert (`plateforme/stockage.ts`), le réseau passe par l'adaptateur de
 * la plateforme (`plateforme/reseau.ts`). Les sources sont réservées à
 * l'administrateur ; il n'y a pas d'écran de réglages ici : Paramètres › Tsuzuku.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { rangDe } from '../../hub/admin/roles';
import { RetourHub } from '../../hub/Hub';
import { police } from '../../hub/themes';
import type { PropsRacineApp } from '../../hub/types';
import { stockageMemoire } from '../moteur/bibliotheque';
import { choisirReseau, type ChoixReseau } from '../plateforme/reseau';
import { CLES, stockageDepuisBase } from '../plateforme/stockage';
import { Accueil } from './Accueil';
import { Bibliotheque } from './Bibliotheque';
import { Catalogue } from './Catalogue';
import { FournisseurTsuzuku, type Route } from './contexte';
import { FicheAnimeEcran } from './FicheAnime';
import { FicheFilmEcran } from './FicheFilm';
import { ImportBibliotheque } from './Import';
import { LecteurEcran } from './Lecteur';
import { creerServices, type ServicesTsuzuku } from './services';
import { Sources } from './Sources';
import { LIBELLE_MODE, themeDuMode, type Mode } from './themeTsuzuku';
import { Avis, Bouton, styleAttenue } from './ui';
import { MESSAGE_SITE } from '../plateforme/reseauWeb';

const ONGLETS: ReadonlyArray<readonly [Route['t'], string]> = [
  ['accueil', 'Accueil'],
  ['catalogue', 'Catalogue'],
  ['bibliotheque', 'Bibliothèque'],
  ['sources', 'Sources'],
];

/** Services du profil ouvert. Une instance par profil : rien n'est partagé d'un profil à l'autre. */
export function useServices(contexte: PropsRacineApp['contexte'], choix?: ChoixReseau): ServicesTsuzuku {
  const base = contexte.baseProfil;
  // Rangs : les sources sont celles d'un Fondateur (le compte historique en tête) ;
  // Administrateurs, Gestionnaires et Amis les utilisent sans les modifier.
  const estAdmin = rangDe(contexte.profil) === 'fondateur';
  const idProfil = contexte.profil?.id ?? 'principal';
  return useMemo(
    () =>
      creerServices({
        choix: choix ?? choisirReseau(),
        stockage: base ? stockageDepuisBase(base) : stockageMemoire(),
        estAdmin,
      }),
    // La base est propre au profil : un autre profil = de nouveaux services.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base, idProfil, estAdmin, choix],
  );
}

export function Tsuzuku(props: PropsRacineApp & { choix?: ChoixReseau }) {
  const services = useServices(props.contexte, props.choix);
  return <TsuzukuEcrans {...props} services={services} />;
}

export function TsuzukuEcrans({ theme: themeHub, onRetour, onParametres, contexte, services: s }: PropsRacineApp & { services: ServicesTsuzuku }) {
  const { width } = useWindowDimensions();
  const large = width >= 700;
  const [mode, setMode] = useState<Mode>('anime');
  const [pile, setPile] = useState<Route[]>([{ t: 'accueil' }]);
  const [version, setVersion] = useState(0);
  const route = pile[pile.length - 1];
  const theme = useMemo(() => themeDuMode(themeHub, mode), [themeHub, mode]);

  // Dernier mode ouvert, retenu dans la base du profil.
  useEffect(() => {
    let vivant = true;
    void s.stockage.lire(CLES.mode).then(v => vivant && (v === 'anime' || v === 'movie') && setMode(v), () => undefined);
    return () => {
      vivant = false;
    };
  }, [s]);
  const choisirMode = useCallback(
    (m: Mode) => {
      setMode(m);
      setPile([{ t: 'accueil' }]);
      void s.stockage.ecrire(CLES.mode, m).catch(() => undefined);
    },
    [s],
  );
  const aller = useCallback((r: Route) => setPile(p => [...p, r]), []);
  const remplacer = useCallback((r: Route) => setPile(p => [...p.slice(0, -1), r]), []);
  const retour = useCallback(() => setPile(p => (p.length > 1 ? p.slice(0, -1) : p)), []);
  const onglet = useCallback((t: Route['t']) => setPile([{ t } as Route]), []);
  const changee = useCallback(() => setVersion(v => v + 1), []);

  const ctx = useMemo(
    () => ({
      s,
      theme,
      themeHub,
      mode,
      aller,
      remplacer,
      retour,
      version,
      changee,
      large,
      onParametres: onParametres ? () => onParametres('tsuzuku') : undefined,
      enregistrerFichier: contexte.enregistrerFichier,
    }),
    [s, theme, themeHub, mode, aller, remplacer, retour, version, changee, large, onParametres, contexte.enregistrerFichier],
  );

  const ecran = (() => {
    switch (route.t) {
      case 'accueil':
        return <Accueil />;
      case 'catalogue':
        return <Catalogue key={`${mode}-${route.q ?? ''}-${route.genre ?? ''}`} q={route.q} genre={route.genre} />;
      case 'fiche':
        return route.kind === 'anime' ? <FicheAnimeEcran key={route.id} id={route.id} /> : <FicheFilmEcran key={route.id} id={route.id} />;
      case 'lecteur':
        return <LecteurEcran kind={route.kind} id={route.id} numero={route.numero} />;
      case 'bibliotheque':
        return <Bibliotheque />;
      case 'sources':
        return <Sources />;
      case 'import':
        return <ImportBibliotheque />;
    }
  })();
  const ongletActif: Route['t'] = route.t === 'fiche' || route.t === 'lecteur' ? (pile.find(r => r.t === 'catalogue') ? 'catalogue' : 'accueil') : route.t === 'import' ? 'bibliotheque' : route.t;

  return (
    <FournisseurTsuzuku value={ctx}>
      <View style={[st.racine, { backgroundColor: theme.fond }]} testID="tsuzuku-racine">
        <ScrollView style={{ flex: 1 }} contentContainerStyle={st.defilement} keyboardShouldPersistTaps="handled">
          <View style={st.page}>
            <RetourHub theme={themeHub} onRetour={onRetour} />
            <View style={st.entete}>
              <View style={{ flexShrink: 1 }}>
                <Text accessibilityRole="header" style={{ color: theme.texte, fontSize: 30, fontWeight: theme.poidsTitre, letterSpacing: -0.5, ...police(theme.policeTitre) }}>
                  Tsuzuku <Text style={{ color: theme.accent }}>続く</Text>
                </Text>
                <Text style={styleAttenue(theme, 13)}>Animés et films, sans serveur.</Text>
              </View>
              <View style={st.modes} accessibilityRole="radiogroup" accessibilityLabel="Type de contenu">
                {(['anime', 'movie'] as const).map(m => {
                  const actif = m === mode;
                  const t = themeDuMode(themeHub, m);
                  return (
                    <Pressable
                      key={m}
                      testID={`mode-${m}`}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: actif }}
                      accessibilityLabel={LIBELLE_MODE[m]}
                      onPress={() => choisirMode(m)}
                      style={[st.mode, { borderRadius: Math.min(t.rayonMoyen, 10), backgroundColor: actif ? t.accent : 'transparent', borderColor: t.accent }]}>
                      <Text style={{ color: actif ? t.surAccent : themeHub.texte, fontWeight: '700', fontSize: 14, ...police(themeHub.policeTexte) }}>{LIBELLE_MODE[m]}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            <View style={st.onglets} accessibilityRole="tablist" accessibilityLabel="Sections de Tsuzuku">
              {ONGLETS.map(([t, titre]) => {
                const actif = ongletActif === t;
                return (
                  <Pressable
                    key={t}
                    testID={`onglet-app-${t}`}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: actif }}
                    accessibilityLabel={titre}
                    onPress={() => onglet(t)}
                    style={[st.onglet, { borderBottomColor: actif ? theme.accent : 'transparent' }]}>
                    <Text style={{ color: actif ? theme.texte : theme.attenue, fontWeight: actif ? '700' : '500', fontSize: 15, ...police(theme.policeTexte) }}>{titre}</Text>
                  </Pressable>
                );
              })}
              {onParametres ? <Bouton titre="⚙︎ Réglages" libelle="Réglages de Tsuzuku (Paramètres)" onPress={() => onParametres('tsuzuku')} testID="tsuzuku-reglages" style={{ marginLeft: 'auto' }} /> : null}
            </View>
            {!s.lectureSources ? <Avis texte={MESSAGE_SITE} testID="tsuzuku-site" /> : null}
            <View testID={`ecran-${route.t}`}>{ecran}</View>
          </View>
        </ScrollView>
      </View>
    </FournisseurTsuzuku>
  );
}

const st = StyleSheet.create({
  racine: { flex: 1 },
  defilement: { flexGrow: 1 },
  page: { width: '100%', maxWidth: 1100, alignSelf: 'center', paddingHorizontal: 16, paddingTop: 20, paddingBottom: 56, gap: 18 },
  entete: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  modes: { flexDirection: 'row', gap: 8 },
  mode: { minHeight: 44, minWidth: 92, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  onglets: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4, borderBottomWidth: 1, borderBottomColor: 'transparent' },
  onglet: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', borderBottomWidth: 3 },
});
