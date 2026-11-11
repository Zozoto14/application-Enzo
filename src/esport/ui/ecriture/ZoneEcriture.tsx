/**
 * Assistant d'écriture attaché à un champ de message (docs/esport/ia-api.md, « Assistant d'écriture ») :
 *
 *  - petite barre sous le champ : « Corriger », « Traduire en anglais » et, derrière « ⋯ », « Traduire en français »
 *    et « Reformuler poliment » (icônes monochromes) ; raccourci Ctrl+Maj+K (Cmd+Maj+K) = corriger, sur le web, quand
 *    le curseur est dans la zone. Rien ne part sans un clic (ou le raccourci) : jamais automatique ;
 *  - aperçu du résultat, changements surlignés (différences mot à mot ; une traduction est montrée telle quelle),
 *    boutons « Remplacer », « Insérer en dessous » (version bilingue FR + EN), « Annuler » ; après un remplacement,
 *    « Annuler le remplacement » remet le texte d'avant ;
 *  - mention sous le résultat : « Texte envoyé à l'IA (Claude) pour correction » (moteur réellement utilisé).
 *
 * SEUL le texte de CE champ part. Masqué (rien n'est rendu en plus du champ) : champ confidentiel (`confidentiel`),
 * assistant désactivé ou rôle non permis (réglages du Fondateur, Administration IA), IA non configurée, ou aucun
 * client Esport (fourni par `FournisseurEcriture` ou la prop `client`).
 */

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { Avis, BoutonHub } from '../../../hub/admin/ui/commun';
import { police, teinteTransparente, type ThemeHub } from '../../../hub/themes';
import { ErreurEsport, type ClientEsport } from '../../client';
import { apiEcriture, diffMots, estRaccourciCorriger, etatEcriture, insererDessous, TAILLE_MAX_ECRITURE, type ChampEcriture, type EtatEcriture, type ModeEcriture, type ResultatEcriture } from '../../ecriture/api';
import { trEc, type CleEc } from '../../i18n/ecriture';
import { ESP, attenue, texte } from '../design';

const ContexteEcriture = createContext<ClientEsport | undefined>(undefined);

/** Donne le client Esport aux champs de la page (racine de l'Esport, Administration › Messagerie). */
export function FournisseurEcriture({ client, children }: { client: ClientEsport | undefined; children: React.ReactNode }) {
  return <ContexteEcriture.Provider value={client}>{children}</ContexteEcriture.Provider>;
}

const ICONES: Record<ModeEcriture, 'coche' | 'globe' | 'bulle'> = { corriger: 'coche', 'traduire-en': 'globe', 'traduire-fr': 'globe', reformuler: 'bulle' };
const LIBELLES: Record<ModeEcriture, CleEc> = { corriger: 'corriger', 'traduire-en': 'traduire_en', 'traduire-fr': 'traduire_fr', reformuler: 'reformuler' };
const genreAction = (m: ModeEcriture): 'corriger' | 'traduire' | 'reformuler' => (m.startsWith('traduire') ? 'traduire' : m === 'reformuler' ? 'reformuler' : 'corriger');
const FOURNISSEURS = ['nvidia', 'openai', 'mistral', 'gemini', 'deepseek', 'groq'] as const;

/** Nom du moteur pour la mention « Texte envoyé à l'IA (…) ». */
export function nomMoteurEcriture(r: Pick<ResultatEcriture, 'moteur' | 'fournisseur'>): string {
  if (r.moteur === 'claude') return trEc('moteur_claude');
  if (r.moteur === 'local') return trEc('moteur_local');
  const f = FOURNISSEURS.find(x => x === r.fournisseur);
  return f ? trEc(`fournisseur.${f}`) : trEc('moteur_api');
}

let compteur = 0;

/** Ce que le raccourci clavier lit du document (web ; pas de types DOM dans ce projet). */
type ToucheDocument = { key?: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; preventDefault(): void };
type DocumentMinimal = {
  activeElement: unknown;
  getElementById(id: string): { contains(n: unknown): boolean } | null;
  addEventListener(t: 'keydown', f: (e: ToucheDocument) => void): void;
  removeEventListener(t: 'keydown', f: (e: ToucheDocument) => void): void;
};

export function ZoneEcriture({
  theme,
  champ,
  valeur,
  onChanger,
  maxLength,
  confidentiel = false,
  client: clientProp,
  testID,
  children,
}: {
  theme: ThemeHub;
  /** Champ (liste fermée, vérifiée par le serveur). */
  champ: ChampEcriture;
  valeur: string;
  onChanger(v: string): void;
  /** Longueur permise du champ (Remplacer / Insérer refusés au-delà). */
  maxLength?: number;
  /** Champ confidentiel (note interne d'un ticket…) : assistant masqué, rien n'est envoyé. */
  confidentiel?: boolean;
  client?: ClientEsport;
  testID: string;
  children: React.ReactNode;
}) {
  const clientContexte = useContext(ContexteEcriture);
  const client = clientProp ?? clientContexte;
  const [etat, setEtat] = useState<EtatEcriture | null>(null);
  const [plus, setPlus] = useState(false);
  const [enCours, setEnCours] = useState<ModeEcriture | undefined>();
  const [erreur, setErreur] = useState<string | undefined>();
  const [avis, setAvis] = useState<string | undefined>();
  const [resultat, setResultat] = useState<(ResultatEcriture & { original: string }) | undefined>();
  const [annulation, setAnnulation] = useState<{ avant: string; apres: string } | undefined>();
  const id = useRef(`zone-ecriture-${++compteur}`).current;
  const vivant = useRef(true);
  useEffect(
    () => () => {
      vivant.current = false;
    },
    [],
  );

  useEffect(() => {
    if (!client || confidentiel) return;
    let actif = true;
    void etatEcriture(client).then(e => {
      if (actif) setEtat(e);
    });
    return () => {
      actif = false;
    };
  }, [client, confidentiel]);

  const visible = Boolean(client && !confidentiel && etat?.actif && etat.autorise && etat.disponible && etat.champs.includes(champ));
  const tailleMax = etat?.tailleMax ?? TAILLE_MAX_ECRITURE;

  const lancer = useCallback(
    async (mode: ModeEcriture) => {
      if (!client || enCours) return;
      setErreur(undefined);
      setAvis(undefined);
      if (!valeur.trim()) return setErreur(trEc('vide'));
      if (valeur.length > tailleMax) return setErreur(trEc('trop_long', { max: tailleMax }));
      setEnCours(mode);
      setResultat(undefined);
      try {
        // Seul le texte du champ part (jamais la conversation ni d'autre contexte).
        const r = await apiEcriture(client).traiter(mode, champ, valeur);
        if (vivant.current) setResultat({ ...r, original: valeur });
      } catch (e) {
        if (vivant.current) setErreur(e instanceof ErreurEsport || e instanceof Error ? e.message : String(e));
      } finally {
        if (vivant.current) setEnCours(undefined);
      }
    },
    [client, enCours, valeur, tailleMax, champ],
  );

  // Raccourci clavier (web) : Ctrl/Cmd+Maj+K quand le curseur est dans la zone.
  useEffect(() => {
    const doc = (globalThis as unknown as { document?: DocumentMinimal }).document;
    if (!visible || Platform.OS !== 'web' || !doc) return;
    const ecouter = (e: ToucheDocument) => {
      if (!estRaccourciCorriger(e)) return;
      const zone = doc.getElementById(id);
      if (!zone || !zone.contains(doc.activeElement)) return;
      e.preventDefault();
      void lancer('corriger');
    };
    doc.addEventListener('keydown', ecouter);
    return () => doc.removeEventListener('keydown', ecouter);
  }, [visible, id, lancer]);

  if (!visible) return <>{children}</>;

  const appliquer = (nouveau: string, message: string) => {
    if (maxLength !== undefined && nouveau.length > maxLength) return setErreur(trEc('depasse', { max: maxLength }));
    setAnnulation({ avant: valeur, apres: nouveau });
    onChanger(nouveau);
    setResultat(undefined);
    setAvis(message);
  };
  const action = resultat ? genreAction(resultat.mode) : 'corriger';
  const diff = resultat && action !== 'traduire' ? diffMots(resultat.original, resultat.texte) : null;
  const perime = resultat !== undefined && resultat.original !== valeur;

  return (
    <View nativeID={id} style={{ gap: ESP.xs, width: '100%' }} testID={testID}>
      {children}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ESP.xs, alignItems: 'center' }} accessibilityLabel={trEc('menu')}>
        {(['corriger', 'traduire-en', ...(plus ? (['traduire-fr', 'reformuler'] as const) : [])] as ModeEcriture[]).map(m => (
          <BoutonHub key={m} theme={theme} icone={ICONES[m]} titre={enCours === m ? trEc('en_cours') : trEc(LIBELLES[m])} desactive={Boolean(enCours)} onPress={() => void lancer(m)} testID={`${testID}-${m}`} />
        ))}
        <BoutonHub theme={theme} icone="etincelles" titre="" libelle={trEc('plus')} desactive={Boolean(enCours)} onPress={() => setPlus(!plus)} testID={`${testID}-plus`} />
        {Platform.OS === 'web' ? <Text style={attenue(theme, 12)}>{trEc('raccourci')}</Text> : null}
      </View>
      {erreur ? <Avis theme={theme} genre="critique" texte={erreur} testID={`${testID}-erreur`} /> : null}
      {avis && !resultat ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ESP.xs, alignItems: 'center' }}>
          <Avis theme={theme} genre="ok" texte={avis} testID={`${testID}-avis`} />
          {annulation && valeur === annulation.apres ? (
            <BoutonHub
              theme={theme}
              titre={trEc('annuler_remplacement')}
              onPress={() => {
                onChanger(annulation.avant);
                setAnnulation(undefined);
                setAvis(undefined);
              }}
              testID={`${testID}-defaire`}
            />
          ) : null}
        </View>
      ) : null}
      {resultat ? (
        <View testID={`${testID}-apercu`} style={{ gap: ESP.xs, borderWidth: 1, borderColor: theme.ligne, borderRadius: Math.min(theme.rayonMoyen, 10), padding: ESP.s, backgroundColor: theme.surface }}>
          <Text style={{ ...texte(theme, 14), fontWeight: '700' }}>{trEc(action === 'traduire' ? 'titre_traduire' : action === 'reformuler' ? 'titre_reformuler' : 'titre_corriger')}</Text>
          {resultat.inchange ? (
            <Text style={texte(theme, 14)} testID={`${testID}-inchange`}>
              {trEc('inchange')}
            </Text>
          ) : (
            <Text style={{ ...texte(theme, 15), lineHeight: 22 }} testID={`${testID}-resultat`} selectable>
              {diff
                ? diff.map((d, i) =>
                    d.genre === 'egal' ? (
                      <Text key={i}>{d.texte}</Text>
                    ) : d.genre === 'retrait' ? (
                      <Text key={i} testID={`${testID}-retrait`} style={{ textDecorationLine: 'line-through', color: theme.critique }}>
                        {d.texte}
                      </Text>
                    ) : (
                      <Text key={i} testID={`${testID}-ajout`} style={{ backgroundColor: teinteTransparente(theme.ok, 0.22), color: theme.texte, fontWeight: '600' }}>
                        {d.texte}
                      </Text>
                    ),
                  )
                : resultat.texte}
            </Text>
          )}
          {diff && !resultat.inchange ? <Text style={attenue(theme, 12)}>{trEc('legende')}</Text> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ESP.xs }}>
            {!resultat.inchange ? <BoutonHub theme={theme} variante="plein" titre={trEc('remplacer')} desactive={perime} onPress={() => appliquer(resultat.texte, trEc('remplace'))} testID={`${testID}-remplacer`} /> : null}
            {!resultat.inchange ? <BoutonHub theme={theme} titre={trEc('inserer')} onPress={() => appliquer(insererDessous(valeur, resultat.texte), trEc('insere'))} testID={`${testID}-inserer`} /> : null}
            <BoutonHub theme={theme} titre={trEc('annuler')} onPress={() => setResultat(undefined)} testID={`${testID}-annuler`} />
          </View>
          <Text style={{ color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) }} testID={`${testID}-mention`}>
            {trEc('envoi', { moteur: nomMoteurEcriture(resultat), action: trEc(`action_${action}`) })}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
