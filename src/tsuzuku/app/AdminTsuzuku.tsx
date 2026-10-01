/**
 * Réglages de Tsuzuku rendus dans la page Paramètres unifiée.
 *
 *  - Administration › Tsuzuku (rangs habilités, voir `gestion.ts`) :
 *    `ReglageSourcesTsuzuku` (sources, partage, assistant) et
 *    `ReglageAvancesTsuzuku` (clés d'API, options avancées du moteur) ;
 *  - Tsuzuku (tous) : `ReglageSourcesPartagees` — les sources partagées avec
 *    le compte, activables pour lui seul, sans rien de technique.
 *
 * Les services sont ceux du profil ouvert (sa base chiffrée) : une clé d'API
 * n'est jamais lue dans la base d'un autre compte, jamais réaffichée en entier.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View, useWindowDimensions } from 'react-native';
import type { Rang } from '../../hub/admin/roles';
import { police, type ThemeHub } from '../../hub/themes';
import { choisirReseau, type ChoixReseau } from '../plateforme/reseau';
import { CLES, stockageDepuisBase, type BasePrefs } from '../plateforme/stockage';
import { FournisseurTsuzuku, useCharger, useTsuzuku, type CtxTsuzuku } from './contexte';
import { BORNES_AVANCES, lireAvances, masquerCle, peutGererSources, type ReglagesAvances, type VueSourcePartagee } from './gestion';
import { creerServices, type ServicesTsuzuku } from './services';
import { Sources, type CompteTsuzuku } from './Sources';
import { Avis, Bouton, Champ, styleAttenue, styleTexte } from './ui';

export interface PropsReglageTsuzuku {
  theme: ThemeHub;
  base: BasePrefs;
  rang: Rang;
  /** Tests : réseau simulé, services déjà créés. */
  choix?: Pick<ChoixReseau, 'plateforme' | 'reseau' | 'lectureSources' | 'pont'>;
  services?: ServicesTsuzuku;
}

function useServicesReglage({ base, rang, choix, services }: PropsReglageTsuzuku): ServicesTsuzuku {
  return useMemo(() => {
    if (services) return services;
    let avances: ReglagesAvances | undefined;
    try {
      avances = lireAvances(base.lire(CLES.avance));
    } catch {
      avances = undefined;
    }
    return creerServices({ choix: choix ?? choisirReseau(), stockage: stockageDepuisBase(base), rang, avances });
  }, [base, rang, choix, services]);
}

/** Contexte minimal des écrans de Tsuzuku, hors de l'app (pas de navigation). */
function Cadre({ theme, s, children, enregistrerFichier }: { theme: ThemeHub; s: ServicesTsuzuku; children: React.ReactNode; enregistrerFichier?: CtxTsuzuku['enregistrerFichier'] }) {
  const [version, setVersion] = useState(0);
  const rien = useCallback(() => undefined, []);
  const changee = useCallback(() => setVersion(v => v + 1), []);
  const large = useWindowDimensions().width >= 700;
  const ctx = useMemo<CtxTsuzuku>(
    () => ({ s, theme, themeHub: theme, mode: 'anime', aller: rien, remplacer: rien, retour: rien, version, changee, large, enregistrerFichier }),
    [s, theme, version, changee, rien, large, enregistrerFichier],
  );
  return <FournisseurTsuzuku value={ctx}>{children}</FournisseurTsuzuku>;
}

const Interdit = ({ theme }: { theme: ThemeHub }) => (
  <Text testID="tsuzuku-admin-interdit" style={{ color: theme.attenue, fontSize: 13, ...police(theme.policeTexte) }}>
    Réservé aux Fondateurs.
  </Text>
);

/**
 * Administration › Tsuzuku › Sources : la MÊME page que l'onglet « Sources »
 * de l'app (`Sources.tsx`). `partageActif` : faux pour un Fondateur autre que
 * le compte historique.
 */
export function ReglageSourcesTsuzuku(props: PropsReglageTsuzuku & { comptes?: readonly CompteTsuzuku[]; partageActif?: boolean; enregistrerFichier?: CtxTsuzuku['enregistrerFichier'] }) {
  const s = useServicesReglage(props);
  if (!peutGererSources(props.rang)) return <Interdit theme={props.theme} />;
  return (
    <Cadre theme={props.theme} s={s} enregistrerFichier={props.enregistrerFichier}>
      <Sources comptes={props.comptes} partageActif={props.partageActif} />
    </Cadre>
  );
}

function CleTmdb({ avances, onEnregistrer }: { avances: ReglagesAvances; onEnregistrer(a: Partial<ReglagesAvances>): Promise<void> }) {
  const { theme } = useTsuzuku();
  const [saisie, setSaisie] = useState('');
  return (
    <View style={{ gap: 10 }}>
      <Text style={styleTexte(theme, 14)}>Clé TMDB (films)</Text>
      <Text style={styleAttenue(theme, 13)}>
        Facultative. Sans clé, les films viennent de Jikan (films d’animation seulement) ; avec une clé TMDB (gratuite, v3 ou jeton), tout le catalogue de films est disponible. Elle reste dans la base chiffrée de ce compte : jamais synchronisée en clair, jamais partagée avec les autres utilisateurs, jamais réaffichée en entier.
      </Text>
      <TextInput
        testID="tsuzuku-cle-tmdb"
        accessibilityLabel="Clé TMDB"
        value={saisie}
        onChangeText={setSaisie}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={avances.cleTmdb ? `${masquerCle(avances.cleTmdb)} (clé enregistrée)` : 'Coller la clé TMDB'}
        placeholderTextColor={theme.attenue}
        style={{ minHeight: 44, borderWidth: 1, paddingHorizontal: 12, fontSize: 15, color: theme.texte, backgroundColor: theme.fond, borderColor: theme.ligne, borderRadius: Math.min(theme.rayonMoyen, 10), ...police(theme.policeTexte) }}
      />
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Bouton
          titre="Enregistrer"
          libelle="Enregistrer la clé TMDB"
          variante="plein"
          desactive={!saisie.trim()}
          onPress={() => void onEnregistrer({ cleTmdb: saisie.trim() }).then(() => setSaisie(''))}
          testID="tsuzuku-cle-enregistrer"
        />
        {avances.cleTmdb ? <Bouton titre="Effacer" libelle="Effacer la clé TMDB" variante="danger" onPress={() => void onEnregistrer({ cleTmdb: '' })} testID="tsuzuku-cle-effacer" /> : null}
      </View>
      <Text testID="tsuzuku-cle-etat" style={styleTexte(theme, 14)} accessibilityLiveRegion="polite">
        {avances.cleTmdb ? `✓ Clé enregistrée (${masquerCle(avances.cleTmdb)}).` : 'Aucune clé enregistrée.'}
      </Text>
    </View>
  );
}

function Nombre({ libelle, valeur, bornes, unite, onChanger, testID }: { libelle: string; valeur: number; bornes: readonly [number, number]; unite: string; onChanger(v: number): void; testID: string }) {
  const [texte, setTexte] = useState(String(valeur));
  const valider = () => {
    const n = Number(texte.replace(',', '.'));
    const borne = Number.isFinite(n) ? Math.min(bornes[1], Math.max(bornes[0], Math.round(n))) : valeur;
    setTexte(String(borne));
    if (borne !== valeur) onChanger(borne);
  };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
      <Champ libelle={`${libelle} (${bornes[0]} à ${bornes[1]} ${unite})`} valeur={texte} onChanger={setTexte} onValider={valider} testID={testID} style={{ minWidth: 220 }} />
      <Bouton titre="Appliquer" libelle={`Appliquer : ${libelle}`} onPress={valider} testID={`${testID}-appliquer`} />
    </View>
  );
}

function Avances() {
  const { s, theme } = useTsuzuku();
  const [etat, setEtat] = useState<ReglagesAvances | undefined>();
  const [erreur, setErreur] = useState<string | undefined>();
  const charge = useCharger(async () => {
    const a = await s.reglagesAvances();
    setEtat(a);
    return a;
  }, [s]);
  const avances = etat ?? charge.donnees;
  if (!avances) return charge.erreur ? <Avis genre="critique" texte={charge.erreur} /> : null;
  const enregistrer = async (suite: Partial<ReglagesAvances>) => {
    try {
      const nouveau = { ...(await s.reglagesAvances()), ...suite };
      await s.enregistrerReglagesAvances(nouveau);
      setEtat(await s.reglagesAvances());
      setErreur(undefined);
    } catch {
      setErreur('Impossible d’enregistrer (base indisponible).');
    }
  };
  return (
    <View style={{ gap: 18 }} testID="tsuzuku-avances">
      <CleTmdb avances={avances} onEnregistrer={enregistrer} />
      <View style={{ gap: 10 }}>
        <Text style={styleTexte(theme, 14)}>Options avancées du moteur</Text>
        <Text style={styleAttenue(theme, 13)}>S’appliquent aux pages des sources lues par cet appareil (délai d’attente, taille maximale d’une page). Prises en compte à la prochaine ouverture de Tsuzuku.</Text>
        <Nombre libelle="Délai d’une requête" unite="s" valeur={avances.delaiS} bornes={BORNES_AVANCES.delaiS} onChanger={delaiS => void enregistrer({ delaiS })} testID="tsuzuku-avance-delai" />
        <Nombre libelle="Taille maximale d’une page" unite="Mo" valeur={avances.tailleMaxMo} bornes={BORNES_AVANCES.tailleMaxMo} onChanger={tailleMaxMo => void enregistrer({ tailleMaxMo })} testID="tsuzuku-avance-taille" />
      </View>
      {erreur ? <Avis genre="critique" texte={erreur} /> : null}
    </View>
  );
}

/** Administration › Tsuzuku › Clés d'API et options avancées. */
export function ReglageAvancesTsuzuku(props: PropsReglageTsuzuku) {
  const s = useServicesReglage(props);
  if (!peutGererSources(props.rang)) return <Interdit theme={props.theme} />;
  return (
    <Cadre theme={props.theme} s={s}>
      <Avances />
    </Cadre>
  );
}

const LIBELLE_LANGUE = { vf: 'VF', vostfr: 'VOSTFR', indifferent: 'VF/VOSTFR' } as const;

function Partagees() {
  const { s, theme } = useTsuzuku();
  const [liste, setListe] = useState<VueSourcePartagee[] | undefined>();
  const charge = useCharger(async () => {
    const l = await s.sourcesPartagees();
    setListe(l);
    return l;
  }, [s]);
  const sources = liste ?? charge.donnees;
  if (!sources) return null;
  if (!sources.length) {
    return (
      <Text testID="sources-partagees-vide" style={styleAttenue(theme, 13)}>
        Aucune source ne vous est partagée pour le moment. L’administration choisit les sources partagées ; elles arrivent à la synchronisation.
      </Text>
    );
  }
  return (
    <View style={{ gap: 8 }} testID="sources-partagees">
      <Text style={styleAttenue(theme, 13)}>Sources choisies par l’administration. Vous pouvez désactiver celles que vous ne voulez pas utiliser : ce choix ne concerne que vous.</Text>
      {sources.map(src => (
        <View key={src.id} testID={`source-partagee-${src.id}`} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: 10, borderWidth: 1, borderColor: theme.ligne, borderRadius: Math.min(theme.rayonMoyen, 10), backgroundColor: theme.surface }}>
          <View style={{ flexShrink: 1, gap: 2 }}>
            <Text style={[styleTexte(theme, 15), { fontWeight: '700' }]}>{src.nom}</Text>
            <Text style={styleAttenue(theme, 12)}>
              {[src.animes ? 'Animés' : '', src.films ? 'Films' : ''].filter(Boolean).join(' · ') || 'Incomplète'} · {LIBELLE_LANGUE[src.langue]} · {src.actif ? 'activée pour vous' : 'désactivée pour vous'}
            </Text>
          </View>
          <Pressable
            testID={`source-partagee-activer-${src.id}`}
            accessibilityRole="switch"
            accessibilityState={{ checked: src.actif }}
            accessibilityLabel={`${src.nom} : ${src.actif ? 'activée' : 'désactivée'}`}
            onPress={() => void s.choisirSourcePartagee(src.id, !src.actif).then(() => s.sourcesPartagees().then(setListe))}
            style={{ minHeight: 40, minWidth: 96, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: Math.min(theme.rayonMoyen, 10), borderColor: src.actif ? theme.accent : theme.ligne, backgroundColor: src.actif ? theme.accent : 'transparent' }}>
            <Text style={{ color: src.actif ? theme.surAccent : theme.texte, fontWeight: '600', fontSize: 13, ...police(theme.policeTexte) }}>{src.actif ? 'Activée' : 'Désactivée'}</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

/** Paramètres › Tsuzuku › Sources partagées avec vous (tous les rangs). */
export function ReglageSourcesPartagees(props: PropsReglageTsuzuku) {
  const s = useServicesReglage(props);
  return (
    <Cadre theme={props.theme} s={s}>
      <Partagees />
    </Cadre>
  );
}
