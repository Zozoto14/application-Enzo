/**
 * Fiche de présence d'un joueur : ses chiffres (taux, ponctualité, retard
 * moyen, absences de suite), ses motifs et son historique séance par séance
 * (réponse, présence réelle). Le staff l'ouvre depuis les statistiques ; le
 * joueur y voit la sienne (« moi »). En mode compact : le résumé de l'accueil.
 */

import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { teinteTransparente, type ThemeHub } from '../../../hub/themes';
import type { ApiPlanning, FichePresence as Fiche, ParamsPeriode } from '../../planning/api';
import { dateCourteJour, typeEvenement } from '../../planning/libelles';
import { Retours, useAgir } from '../commun';
import { Badge, ChiffreCle, ESP, EtatVide, Squelette, TYPO, attenue as styleAttenue, texte as styleTexte } from '../design';
import { tr, trn } from '../../i18n';
import { texteReel, texteReponse, tonReel } from './FeuilleAppel';

/** Pourcentage lisible, ou rien (jamais de « — ») : l'appelant affiche une phrase à la place. */
export const pct = (v: number | null | undefined): string | undefined => (v === null || v === undefined ? undefined : `${Math.round(v * 100)} %`);

/** Barre de taux : la couleur suit le niveau, le chiffre est toujours écrit à côté. */
export function BarreTaux({ theme, taux }: { theme: ThemeHub; taux: number | null }) {
  const c = taux === null ? theme.attenue : taux >= 0.8 ? theme.ok : taux >= 0.5 ? theme.alerte : theme.critique;
  return (
    <View style={{ height: 8, borderRadius: 4, backgroundColor: teinteTransparente(theme.attenue, 0.18), overflow: 'hidden' }}>
      <View style={{ width: `${Math.round((taux ?? 0) * 100)}%`, height: 8, backgroundColor: c }} />
    </View>
  );
}

/** Ligne de détail : « 5 présents · 1 en retard · 2 absents · 1 excusé ». */
export const detailCompteurs = (c: { present: number; retard: number; absent: number; excuse: number }) =>
  [trn('presence.n_presents', c.present), trn('presence.n_retards', c.retard), trn('presence.n_absents', c.absent), trn('presence.n_excuses', c.excuse)].join(' · ');

export function FichePresenceJoueur({ theme, api, compte, periode, compact, testID = 'esport-fiche-presence' }: { theme: ThemeHub; api: ApiPlanning; compte: string; periode: ParamsPeriode; compact?: boolean; testID?: string }) {
  const [f, setF] = useState<Fiche | undefined>();
  const { erreur, agir } = useAgir();
  const cle = JSON.stringify(periode);
  useEffect(() => {
    void agir('', async () => setF(await api.fiche(compte, JSON.parse(cle) as ParamsPeriode)));
  }, [agir, api, compte, cle]);
  if (!f) return erreur ? <Retours theme={theme} erreur={erreur} prefixe={testID} /> : <Squelette theme={theme} lignes={3} />;
  const vide = f.marques === 0;
  const historique = compact ? f.historique.slice(0, 5) : f.historique;
  return (
    <View style={{ gap: ESP.m }} testID={testID}>
      {vide ? (
        <EtatVide
          theme={theme}
          glyphe="✓"
          titre={tr('presence.aucune_seance_marquee')}
          texte={f.nonMarques ? trn('presence.seances_pas_encore_marquees', f.nonMarques ?? 0) : tr('presence.aucune_seance_sur_la_periode')}
          testID={`${testID}-vide`}
        />
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ESP.s }}>
          <ChiffreCle theme={theme} large={!compact} libelle={tr('presence.taux_de_presence')} valeur={pct(f.taux) ?? ''} detail={trn('presence.sur_n_seances_marquees', f.marques)} ton={(f.taux ?? 0) >= 0.8 ? 'ok' : (f.taux ?? 0) >= 0.5 ? 'alerte' : 'critique'} testIDValeur={`${testID}-taux`} />
          <ChiffreCle theme={theme} large={!compact} libelle={tr('presence.ponctualite')} valeur={pct(f.ponctualite) ?? tr('presence.sans_objet')} detail={f.retardMoyen ? tr('presence.retard_moyen', { n: f.retardMoyen }) : trn('presence.n_retards', f.retard)} />
          {!compact || f.serie >= 2 ? (
            <ChiffreCle theme={theme} large={!compact} libelle={tr('presence.absences_de_suite')} valeur={String(f.serie)} detail={tr('presence.record', { n: f.serieMax })} ton={f.serie >= 2 ? 'critique' : 'neutre'} testIDValeur={`${testID}-serie`} />
          ) : null}
        </View>
      )}
      {!vide ? <Text style={styleAttenue(theme)}>{detailCompteurs(f)}{f.nonMarques ? ` · ${trn('presence.n_non_marquees', f.nonMarques)}` : ''}</Text> : null}
      {!compact && f.motifs.length ? (
        <View style={{ gap: ESP.xxs }} testID={`${testID}-motifs`}>
          <Text style={{ ...styleTexte(theme), fontWeight: '700' }}>{tr('presence.motifs')}</Text>
          {f.motifs.map(m => (
            <Text key={m.motif} style={styleTexte(theme)}>
              {`${m.motif} · ${trn('presence.n_fois', m.n)}`}
            </Text>
          ))}
        </View>
      ) : null}
      {historique.length ? (
        <View style={{ gap: ESP.xs }} testID={`${testID}-historique`}>
          <Text style={{ ...styleTexte(theme), fontWeight: '700' }}>{compact ? tr('presence.dernieres_seances') : tr('presence.historique')}</Text>
          {historique.map(l => {
            const t = typeEvenement(l.type);
            return (
              <View key={`${l.evenementId}-${l.cle}`} style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: ESP.xs, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.xs }} testID={`${testID}-seance-${l.jour}`}>
                <Text style={{ ...styleTexte(theme, TYPO.legende), flexGrow: 1, flexBasis: 180 }} numberOfLines={1}>
                  <Text style={{ color: t.couleur }}>● </Text>
                  {`${dateCourteJour(l.jour)} ${l.heureDebut} · ${l.titre}`}
                </Text>
                {l.horsConvocation ? <Badge theme={theme} texte={tr('presence.non_convoque_venu')} ton="accent" /> : <Text style={styleAttenue(theme)}>{texteReponse(l)}</Text>}
                <Badge theme={theme} texte={texteReel(l)} ton={tonReel(l.reel)} />
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}
