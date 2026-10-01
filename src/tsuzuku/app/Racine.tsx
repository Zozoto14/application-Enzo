/**
 * Tsuzuku, app du hub : écran racine.
 *
 * Même mot de passe, mêmes profils et mêmes permissions que le hub : l'app
 * n'a ni serveur ni compte à elle. Ses données sont dans la base chiffrée du
 * profil ouvert (`plateforme/stockage.ts`), le réseau passe par l'adaptateur de
 * la plateforme (`plateforme/reseau.ts`). Rien de technique ici : les sources,
 * clés d'API et options du moteur sont en Paramètres › Administration › Tsuzuku
 * (Fondateurs) ; le confort et les sources partagées, en Paramètres › Tsuzuku.
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
import { useMobile } from '../../ui/mobile/useMobile';
import { FournisseurTsuzuku, type Route } from './contexte';
import { CoqueTsuzukuMobile } from './mobile/CoqueTsuzuku';
import { FicheAnimeEcran } from './FicheAnime';
import { FicheFilmEcran } from './FicheFilm';
import { ImportBibliotheque } from './Import';
import { LecteurEcran } from './Lecteur';
import { creerServices, type ServicesTsuzuku } from './services';
import { lireAvances } from './gestion';
import { PiedTsuzuku } from './PiedTsuzuku';
import { LIBELLE_MODE, themeDuMode, type Mode } from './themeTsuzuku';
import { Avis, Bouton } from './ui';
import { MESSAGE_SITE } from '../plateforme/reseauWeb';

const ONGLETS: ReadonlyArray<readonly [Route['t'], string]> = [
  ['accueil', 'Découvrir'],
  ['catalogue', 'Catalogue'],
  ['bibliotheque', 'Ma bibliothèque'],
];

function avancesDe(base: { lire(cle: string): string | undefined | null }) {
  try {
    return lireAvances(base.lire(CLES.avance));
  } catch {
    return undefined;
  }
}

/** Services du profil ouvert. Une instance par profil : rien n'est partagé d'un profil à l'autre. */
export function useServices(contexte: PropsRacineApp['contexte'], choix?: ChoixReseau): ServicesTsuzuku {
  const base = contexte.baseProfil;
  // Rangs : seuls les Fondateurs gèrent les sources (`gestion.ts`) ; les autres
  // utilisent celles qui leur sont partagées.
  const rang = rangDe(contexte.profil);
  const idProfil = contexte.profil?.id ?? 'principal';
  return useMemo(
    () =>
      creerServices({
        choix: choix ?? choisirReseau(),
        stockage: base ? stockageDepuisBase(base) : stockageMemoire(),
        rang,
        // Options avancées du moteur (Administration › Tsuzuku), lues dans la base du profil.
        avances: base ? avancesDe(base) : undefined,
      }),
    // La base est propre au profil : un autre profil = de nouveaux services.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base, idProfil, rang, choix],
  );
}

export function Tsuzuku(props: PropsRacineApp & { choix?: ChoixReseau }) {
  const services = useServices(props.contexte, props.choix);
  return <TsuzukuEcrans {...props} services={services} />;
}

/** État de l'app (mode, pile d'écrans, contexte), tenu par le parent : tourner le téléphone ne fait pas perdre la place. */
function useEtat({ theme: themeHub, onParametres, contexte, services: s }: PropsRacineApp & { services: ServicesTsuzuku }, mobile: boolean) {
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
      mobile,
      onParametres: onParametres ? () => onParametres('tsuzuku') : undefined,
      enregistrerFichier: contexte.enregistrerFichier,
    }),
    [s, theme, themeHub, mode, aller, remplacer, retour, version, changee, large, mobile, onParametres, contexte.enregistrerFichier],
  );

  const ongletActif: Route['t'] = route.t === 'fiche' || route.t === 'lecteur' ? (pile.find(r => r.t === 'catalogue') ? 'catalogue' : 'accueil') : route.t === 'import' ? 'bibliotheque' : route.t;
  return { mode, theme, themeHub, pile, route, ctx, choisirMode, onglet, retour, ongletActif };
}

/** L'écran de la route courante. */
function EcranCourant({ route, mode }: { route: Route; mode: Mode }) {
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
    case 'import':
      return <ImportBibliotheque />;
  }
}

export function TsuzukuEcrans(props: PropsRacineApp & { services: ServicesTsuzuku }) {
  const mobile = useMobile();
  const etat = useEtat(props, mobile);
  const ecran = <EcranCourant route={etat.route} mode={etat.mode} />;
  return (
    <FournisseurTsuzuku value={etat.ctx}>
      {mobile ? (
        <CoqueTsuzukuMobile
          theme={etat.theme}
          themeHub={etat.themeHub}
          mode={etat.mode}
          route={etat.route}
          ongletActif={etat.ongletActif}
          peutRevenir={etat.pile.length > 1}
          estAdmin={props.services.estAdmin}
          siteSeulement={!props.services.lectureSources}
          onRetourHub={props.onRetour}
          onParametres={props.onParametres}
          choisirMode={etat.choisirMode}
          onglet={etat.onglet}
          retour={etat.retour}>
          {ecran}
        </CoqueTsuzukuMobile>
      ) : (
        <TsuzukuBureau {...props} etat={etat}>
          {ecran}
        </TsuzukuBureau>
      )}
    </FournisseurTsuzuku>
  );
}

function TsuzukuBureau({ theme: themeHub, onRetour, onParametres, services: s, etat, children }: PropsRacineApp & { services: ServicesTsuzuku; etat: ReturnType<typeof useEtat>; children: React.ReactNode }) {
  const { theme, mode, route, ongletActif, choisirMode, onglet } = etat;
  const { large } = etat.ctx;
  const ecran = children;
  return (
      <View style={[st.racine, { backgroundColor: theme.fond }]} testID="tsuzuku-racine">
        <ScrollView style={{ flex: 1 }} contentContainerStyle={st.defilement} keyboardShouldPersistTaps="handled">
          <View style={st.page}>
            <RetourHub theme={themeHub} onRetour={onRetour} titre="Tsuzuku" />
            {/* En-tête comme l'ancienne version : marque, sélecteur Animés | Films (l'actif prend l'accent de son univers), sections. */}
            <View style={[st.entete, { borderBottomColor: theme.ligne }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 34, height: 34, borderRadius: Math.min(theme.rayonMoyen, 8), backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: theme.surAccent, fontSize: 15, fontWeight: '900' }}>▶</Text>
                </View>
                <Text accessibilityRole="header" style={{ color: theme.texte, fontSize: 24, fontWeight: theme.poidsTitre, letterSpacing: -0.4, ...police(theme.policeTitre) }}>
                  Tsuzuku <Text style={{ color: theme.accent }}>続く</Text>
                </Text>
              </View>
              <View style={[st.modes, { backgroundColor: themeHub.surface, borderColor: themeHub.ligne }]} accessibilityRole="radiogroup" accessibilityLabel="Type de contenu">
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
                      style={[st.mode, { backgroundColor: actif ? t.accent : 'transparent' }]}>
                      <Text style={{ color: actif ? t.surAccent : themeHub.attenue, fontWeight: '800', fontSize: 14, ...police(themeHub.policeTexte) }}>
                        {m === 'anime' ? '✦ ' : '▤ '}
                        {LIBELLE_MODE[m]}
                      </Text>
                    </Pressable>
                  );
                })}
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
                      <Text style={{ color: actif ? theme.texte : theme.attenue, fontWeight: actif ? '800' : '600', fontSize: 15, ...police(theme.policeTexte) }}>{titre}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {onParametres ? <Bouton titre={large ? '⚙︎ Réglages' : '⚙︎'} libelle="Réglages de Tsuzuku (Paramètres)" onPress={() => onParametres('tsuzuku')} testID="tsuzuku-reglages" style={{ marginLeft: 'auto' }} /> : null}
            </View>
            {!s.lectureSources ? <Avis texte={MESSAGE_SITE} testID="tsuzuku-site" /> : null}
            <View testID={`ecran-${route.t}`}>{ecran}</View>
            <PiedTsuzuku theme={theme} onEnSavoirPlus={onParametres ? () => onParametres('apropos') : undefined} />
          </View>
        </ScrollView>
      </View>
  );
}

const st = StyleSheet.create({
  racine: { flex: 1 },
  defilement: { flexGrow: 1 },
  page: { width: '100%', maxWidth: 1100, alignSelf: 'center', paddingHorizontal: 16, paddingTop: 20, paddingBottom: 56, gap: 18 },
  entete: { flexDirection: 'row', alignItems: 'center', gap: 14, rowGap: 10, flexWrap: 'wrap', paddingBottom: 12, borderBottomWidth: 1 },
  modes: { flexDirection: 'row', gap: 4, padding: 4, borderRadius: 999, borderWidth: 1 },
  mode: { minHeight: 38, minWidth: 96, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderRadius: 999 },
  onglets: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  onglet: { minHeight: 44, paddingHorizontal: 8, justifyContent: 'center', borderBottomWidth: 2 },
});
