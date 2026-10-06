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
import { FournisseurTsuzuku, useCharger, type Route } from './contexte';
import { FicheAnimeEcran } from './FicheAnime';
import { FicheFilmEcran } from './FicheFilm';
import { ImportBibliotheque } from './Import';
import { LecteurEcran } from './Lecteur';
import { creerServices, type ServicesTsuzuku } from './services';
import { comptesPourPartage, lireAvances } from './gestion';
import { PiedTsuzuku } from './PiedTsuzuku';
import { LIBELLE_MODE, themeDuMode, type Mode } from './themeTsuzuku';
import { Avis, Bouton } from './ui';
import { MESSAGE_SITE } from '../plateforme/reseauWeb';
import { BarreOnglets, useMobile, type EntreeOnglet } from '../../ui/mobile';
import { Sources } from './Sources';

const ONGLETS: ReadonlyArray<readonly [Route['t'], string]> = [
  ['accueil', 'Découvrir'],
  ['catalogue', 'Catalogue'],
  ['bibliotheque', 'Ma bibliothèque'],
];
/** Onglet « Sources » : rangs habilités seulement (`gestion.ts`). */
const ONGLET_SOURCES: readonly [Route['t'], string] = ['sources', 'Sources'];

/** Barre basse du téléphone : mêmes sections, libellés courts. */
const GLYPHES: Partial<Record<Route['t'], { glyphe: string; court: string }>> = {
  accueil: { glyphe: '✦', court: 'Découvrir' },
  catalogue: { glyphe: '▦', court: 'Catalogue' },
  bibliotheque: { glyphe: '♥', court: 'Biblio.' },
  sources: { glyphe: '⊕', court: 'Sources' },
};

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

export function TsuzukuEcrans({ theme: themeHub, onRetour, onParametres, contexte, services: s }: PropsRacineApp & { services: ServicesTsuzuku }) {
  const { width } = useWindowDimensions();
  const large = width >= 700;
  const mobile = useMobile();
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
  // Badge de l'onglet « Sources » : nombre de sources actives (rangs habilités seulement).
  const actives = useCharger(async () => (s.estAdmin ? (await s.sourcesPropres()).filter(x => x.enabled).length : 0), [s, version]);
  const onglets = s.estAdmin ? [...ONGLETS, ONGLET_SOURCES] : ONGLETS;

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
      onSection: onParametres ? (section: 'administration' | 'tsuzuku') => onParametres(section) : undefined,
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
      case 'import':
        return <ImportBibliotheque />;
      case 'sources':
        // Même page que Paramètres › Administration › Tsuzuku · Sources ; refusée aux autres rangs.
        return (
          <Sources
            key={route.ajout ?? 'liste'}
            page
            ajoutInitial={route.ajout}
            comptes={comptesPourPartage(contexte.profils?.tous)}
            partageActif={!contexte.profils || contexte.profils.actuel.id === 'principal'}
            onCles={onParametres ? () => onParametres('administration') : undefined}
          />
        );
    }
  })();
  const ongletActif: Route['t'] = route.t === 'fiche' || route.t === 'lecteur' ? (pile.find(r => r.t === 'catalogue') ? 'catalogue' : 'accueil') : route.t === 'import' ? 'bibliotheque' : route.t;

  return (
    <FournisseurTsuzuku value={ctx}>
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
              {!mobile ? (
                <View style={st.onglets} accessibilityRole="tablist" accessibilityLabel="Sections de Tsuzuku">
                  {onglets.map(([t, titre]) => {
                    const actif = ongletActif === t;
                    const badge = t === 'sources' ? actives.donnees : undefined;
                    return (
                      <Pressable
                        key={t}
                        testID={`onglet-app-${t}`}
                        accessibilityRole="tab"
                        accessibilityState={{ selected: actif }}
                        accessibilityLabel={badge !== undefined ? `${titre} (${badge} active${badge > 1 ? 's' : ''})` : titre}
                        onPress={() => onglet(t)}
                        style={[st.onglet, { borderBottomColor: actif ? theme.accent : 'transparent', flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
                        <Text style={{ color: actif ? theme.texte : theme.attenue, fontWeight: actif ? '800' : '600', fontSize: 15, ...police(theme.policeTexte) }}>{titre}</Text>
                        {badge !== undefined ? (
                          <View testID="onglet-sources-badge" style={{ minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: badge ? theme.accent : theme.alerte }}>
                            <Text style={{ color: badge ? theme.surAccent : theme.fond, fontSize: 11, fontWeight: '800' }}>{badge}</Text>
                          </View>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
              {onParametres ? <Bouton titre={large ? '⚙︎ Réglages' : '⚙︎'} libelle="Réglages de Tsuzuku (Paramètres)" onPress={() => onParametres('tsuzuku')} testID="tsuzuku-reglages" style={{ marginLeft: 'auto' }} /> : null}
            </View>
            {!s.lectureSources ? <Avis texte={MESSAGE_SITE} testID="tsuzuku-site" /> : null}
            <View testID={`ecran-${route.t}`}>{ecran}</View>
            <PiedTsuzuku theme={theme} onEnSavoirPlus={onParametres ? () => onParametres('apropos') : undefined} />
          </View>
        </ScrollView>
        {mobile ? (
          // Téléphone : les sections passent dans une barre basse, sous le pouce (Sources pour les rangs habilités).
          <BarreOnglets
            theme={theme}
            testID="onglet-app"
            entrees={onglets.map(([t, titre]): EntreeOnglet => ({
              cle: t,
              libelle: GLYPHES[t]?.court ?? titre,
              glyphe: GLYPHES[t]?.glyphe ?? '•',
              description: t === 'sources' && actives.donnees !== undefined ? `${titre} (${actives.donnees} active${actives.donnees > 1 ? 's' : ''})` : titre,
              pastille: t === 'sources' && actives.donnees !== undefined ? String(actives.donnees) : undefined,
              couleurPastille: t === 'sources' && actives.donnees === 0 ? theme.alerte : undefined,
            }))}
            actif={ongletActif}
            onChoisir={cle => onglet(cle as Route['t'])}
          />
        ) : null}
      </View>
    </FournisseurTsuzuku>
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
