/**
 * Présence d'une séance : la vue « Présence » (détail d'un événement,
 * historique) et la « Feuille d'appel » rapide (pendant ou après la séance,
 * pensée pour l'iPhone). Une seule brique, deux tailles.
 *
 *  - En haut, les compteurs : convoqués, réponses Oui / Peut-être / Non / sans
 *    réponse, puis l'avancement du marquage (« 3 sur 5 marqués »).
 *  - Une ligne par convoqué : sa réponse (et ce qu'il a annoncé : retard prévu,
 *    motif), et un sélecteur de présence réelle en UN appui (Présent, En retard,
 *    Absent, Excusé) qui ENREGISTRE aussitôt, avec un « ✓ Enregistré » sur la
 *    ligne. En retard : minutes en option (5, 10, 15, 30 ou saisies) ; Absent ou
 *    Excusé : motif en option.
 *  - « Tout le monde présent » marque d'un coup les convoqués pas encore
 *    marqués (les exceptions déjà saisies restent), puis on ajuste.
 *  - « Ajouter quelqu'un de non convoqué » : un remplaçant venu quand même
 *    (hors des taux, compté à part).
 *
 * Rien n'est à « enregistrer » à la fin : quitter l'écran ne perd rien.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { BoutonHub } from '../../../hub/admin/ui/commun';
import { police, teinteTransparente, type ThemeHub } from '../../../hub/themes';
import type { ApiPlanning, LignePresence, Marque, PresenceOccurrence, Reel } from '../../planning/api';
import { LIBELLES_REEL, LIBELLES_RSVP, dateCourteJour, typeEvenement } from '../../planning/libelles';
import { Retours, useAgir } from '../commun';
import { Badge, ESP, Pliable, TYPO, attenue as styleAttenue, rayonControle, texte as styleTexte, type EtatPresse, type Ton } from '../design';
import { tr, trn } from '../../i18n';
import { Pastille } from './commun';

export const MARQUES: ReadonlyArray<Exclude<Reel, 'inconnu'>> = ['present', 'retard', 'absent', 'excuse'];
const MINUTES = [5, 10, 15, 30];

/** Ton (couleur) d'une présence réelle : jamais seul, toujours avec son libellé. */
export const tonReel = (r: Reel): Ton => (r === 'present' ? 'ok' : r === 'retard' ? 'alerte' : r === 'absent' ? 'critique' : r === 'excuse' ? 'accent' : 'neutre');
const tonRsvp = (r: string): Ton => (r === 'oui' ? 'ok' : r === 'peut_etre' ? 'alerte' : r === 'non' ? 'critique' : 'neutre');
const couleurTon = (theme: ThemeHub, t: Ton) => (t === 'ok' ? theme.ok : t === 'alerte' ? theme.alerte : t === 'critique' ? theme.critique : t === 'accent' ? theme.accent : theme.attenue);

/** Libellé court d'un bouton (iPhone : 4 boutons sur une ligne). */
const court = (r: Exclude<Reel, 'inconnu'>) => (r === 'retard' ? tr('presence.bouton_retard') : LIBELLES_REEL[r]);

/** Réponse du joueur, et ce qu'il a annoncé. */
export function texteReponse(l: Pick<LignePresence, 'rsvp' | 'retardPrevu' | 'motifPrevu'>): string {
  const base = tr('planning.listePresence.reponse', { reponse: LIBELLES_RSVP[l.rsvp] });
  if (l.rsvp !== 'non' && l.retardPrevu) return `${base} · ${tr('presence.retard_annonce', { n: l.retardPrevu })}`;
  if (l.rsvp === 'non' && l.motifPrevu) return `${base} · ${l.motifPrevu}`;
  return base;
}

/** Présence réelle lisible : « En retard (12 min) », « Excusé : Examen ». */
export function texteReel(l: Pick<LignePresence, 'reel' | 'retardMinutes' | 'motif'>): string {
  if (l.reel === 'retard' && l.retardMinutes) return tr('presence.retard_minutes', { n: l.retardMinutes });
  if ((l.reel === 'absent' || l.reel === 'excuse') && l.motif) return `${LIBELLES_REEL[l.reel]} : ${l.motif}`;
  return LIBELLES_REEL[l.reel];
}

/** Sélecteur de présence : 4 boutons d'égale largeur, sur UNE ligne, 44 px au moins (52 en feuille d'appel). */
export function SelecteurPresence({ theme, valeur, onChoisir, testID, grand, libelle }: { theme: ThemeHub; valeur: Reel; onChoisir(r: Reel): void; testID: string; grand?: boolean; libelle: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: ESP.xxs }} accessibilityRole="radiogroup" accessibilityLabel={libelle}>
      {MARQUES.map(r => {
        const actif = valeur === r;
        const c = couleurTon(theme, tonReel(r));
        return (
          <Pressable
            key={r}
            testID={`${testID}-${r}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: actif }}
            accessibilityLabel={`${libelle} : ${LIBELLES_REEL[r]}`}
            onPress={() => onChoisir(r)}
            style={(etat: EtatPresse) => ({
              flex: 1,
              minWidth: 0,
              minHeight: grand ? 52 : 44,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 2,
              borderWidth: actif ? 2 : 1,
              borderColor: actif ? c : etat.hovered ? theme.accent : theme.ligne,
              backgroundColor: actif ? teinteTransparente(c, theme.sombre ? 0.32 : 0.2) : theme.surface,
              borderRadius: rayonControle(theme) === 999 ? 22 : rayonControle(theme),
            })}>
            <Text numberOfLines={1} style={{ color: theme.texte, fontSize: 14, fontWeight: actif ? '800' : '600', ...police(theme.policeTexte) }}>
              {actif ? '✓ ' : ''}
              {court(r)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Compteur({ theme, libelle, n, ton, testID }: { theme: ThemeHub; libelle: string; n: number; ton: Ton; testID: string }) {
  const c = couleurTon(theme, ton);
  return (
    <View testID={testID} style={{ flexGrow: 1, flexBasis: 90, minWidth: 0, paddingVertical: ESP.xs, paddingHorizontal: ESP.s, borderRadius: 10, backgroundColor: teinteTransparente(c, theme.sombre ? 0.16 : 0.1), borderWidth: 1, borderColor: teinteTransparente(c, 0.35) }}>
      <Text style={{ color: theme.texte, fontSize: 22, fontWeight: '800', ...police(theme.policeChiffres) }}>{n}</Text>
      <Text numberOfLines={1} style={styleAttenue(theme)}>
        {libelle}
      </Text>
    </View>
  );
}

export function FeuilleAppel({
  theme,
  api,
  evenementId,
  cle,
  marquer,
  mode = 'vue',
  onMarque,
  rechargement,
}: {
  theme: ThemeHub;
  api: ApiPlanning;
  evenementId: string;
  cle: string;
  marquer: boolean;
  /** « vue » : détail d'un événement ; « appel » : feuille d'appel rapide (iPhone). */
  mode?: 'vue' | 'appel';
  onMarque?(): void;
  /** Change quand la liste doit être relue (réponse donnée dans le même détail). */
  rechargement?: string;
}) {
  const [p, setP] = useState<PresenceOccurrence | undefined>();
  const [etat, setEtat] = useState<Record<string, 'enCours' | 'ok' | 'erreur'>>({});
  const [motifs, setMotifs] = useState<Record<string, string>>({});
  const [minutes, setMinutes] = useState<Record<string, string>>({});
  const { erreur, avis, agir } = useAgir();

  const charger = useCallback(async () => {
    const pr = await api.presence(evenementId, cle);
    setP(pr);
    setMotifs(Object.fromEntries(pr.lignes.map(l => [l.compte, l.motif ?? ''])));
    setMinutes(Object.fromEntries(pr.lignes.map(l => [l.compte, l.retardMinutes ? String(l.retardMinutes) : ''])));
  }, [api, evenementId, cle]);
  useEffect(() => {
    void agir('', charger);
  }, [agir, charger, rechargement]);

  /** Un appui = une requête ; la ligne montre « ✓ Enregistré » (ou revient en arrière si le serveur refuse). */
  const envoyer = (m: Marque, phrase: string) => {
    if (!p) return;
    const avant = p;
    setEtat(e => ({ ...e, [m.compte]: 'enCours' }));
    setP({ ...p, lignes: p.lignes.map(l => (l.compte === m.compte ? { ...l, reel: m.reel, ...(m.retardMinutes !== undefined ? { retardMinutes: m.retardMinutes } : {}), ...(m.motif !== undefined ? { motif: m.motif } : {}) } : l)) });
    void agir('presence', async () => {
      try {
        setP(await api.marquer(evenementId, cle, [m]));
        setEtat(e => ({ ...e, [m.compte]: 'ok' }));
      } catch (e) {
        setP(avant);
        setEtat(x => ({ ...x, [m.compte]: 'erreur' }));
        throw e;
      }
      onMarque?.();
      return phrase;
    });
  };

  if (!p) return <View testID="esport-presence-liste"><Retours theme={theme} erreur={erreur} prefixe="esport-presence" /></View>;
  const c = p.compteurs;
  const convoques = p.lignes.filter(l => !l.horsConvocation);
  const ajoutes = p.lignes.filter(l => l.horsConvocation);
  const appel = mode === 'appel';
  const pct = c && c.convoques > 0 ? Math.round((c.marques / c.convoques) * 100) : 0;
  const t = typeEvenement(p.occurrence.type);

  const ligne = (l: LignePresence) => {
    const nom = l.pseudo ?? tr('resumes.compte_supprime');
    const e = etat[l.compte];
    return (
      <View key={l.compte} testID={`esport-presence-${l.compte}`} style={{ gap: ESP.xs, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.s }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.xs, flexWrap: 'wrap' }}>
          <Text style={{ ...styleTexte(theme, appel ? 17 : TYPO.texte), fontWeight: '700', flexShrink: 1 }} numberOfLines={1}>
            {nom}
          </Text>
          {l.horsConvocation ? <Badge theme={theme} texte={tr('presence.non_convoque_venu')} ton="accent" testID={`esport-presence-${l.compte}-hors`} /> : <Badge theme={theme} texte={texteReponse(l)} ton={tonRsvp(l.rsvp)} />}
          <View style={{ flex: 1 }} />
          {e === 'enCours' ? <Text style={styleAttenue(theme)}>{tr('presence.enregistrement')}</Text> : null}
          {e === 'ok' ? (
            <Text testID={`esport-presence-${l.compte}-ok`} style={{ ...styleAttenue(theme), color: theme.ok, fontWeight: '700' }}>
              {tr('presence.enregistre_court')}
            </Text>
          ) : null}
          {e === 'erreur' ? <Text style={{ ...styleAttenue(theme), color: theme.critique, fontWeight: '700' }}>{tr('presence.non_enregistre')}</Text> : null}
        </View>
        {marquer ? (
          <>
            <SelecteurPresence
              theme={theme}
              grand={appel}
              valeur={l.reel}
              libelle={tr('planning.listePresence.presence_de', { pseudo: nom })}
              onChoisir={r => envoyer({ compte: l.compte, reel: r, ...(l.horsConvocation ? { horsConvocation: true } : {}) }, tr('planning.listePresence.enregistre', { pseudo: nom, v: LIBELLES_REEL[r].toLowerCase() }))}
              testID={`esport-marque-${l.compte}`}
            />
            {l.reel === 'retard' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.xs, flexWrap: 'wrap' }} testID={`esport-presence-${l.compte}-minutes`}>
                <Text style={styleAttenue(theme)}>{tr('presence.minutes_facultatif')}</Text>
                {MINUTES.map(n => (
                  <Pastille key={n} theme={theme} actif={l.retardMinutes === n} libelle={tr('presence.n_min', { n })} role="radio" onPress={() => envoyer({ compte: l.compte, reel: 'retard', retardMinutes: n }, tr('presence.retard_enregistre', { pseudo: nom, n }))} testID={`esport-presence-${l.compte}-min-${n}`} />
                ))}
                <TextInput
                  testID={`esport-presence-${l.compte}-min-autre`}
                  accessibilityLabel={tr('presence.minutes_de_retard_de', { pseudo: nom })}
                  value={minutes[l.compte] ?? ''}
                  onChangeText={v => setMinutes(m => ({ ...m, [l.compte]: v.replace(/[^0-9]/g, '').slice(0, 3) }))}
                  onSubmitEditing={() => {
                    const n = Number(minutes[l.compte]);
                    if (Number.isInteger(n) && n > 0) envoyer({ compte: l.compte, reel: 'retard', retardMinutes: n }, tr('presence.retard_enregistre', { pseudo: nom, n }));
                  }}
                  onBlur={() => {
                    const n = Number(minutes[l.compte]);
                    if (Number.isInteger(n) && n > 0 && n !== l.retardMinutes) envoyer({ compte: l.compte, reel: 'retard', retardMinutes: n }, tr('presence.retard_enregistre', { pseudo: nom, n }));
                  }}
                  keyboardType="number-pad"
                  placeholder={tr('presence.autre_min')}
                  placeholderTextColor={theme.attenue}
                  style={{ width: 84, minHeight: 44, borderWidth: 1, borderColor: theme.ligne, borderRadius: rayonControle(theme) === 999 ? 22 : rayonControle(theme), paddingHorizontal: ESP.s, color: theme.texte, backgroundColor: theme.surface, ...police(theme.policeTexte) }}
                />
              </View>
            ) : null}
            {l.reel === 'absent' || l.reel === 'excuse' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.xs }}>
                <TextInput
                  testID={`esport-presence-${l.compte}-motif`}
                  accessibilityLabel={tr('presence.motif_de', { pseudo: nom })}
                  value={motifs[l.compte] ?? ''}
                  onChangeText={v => setMotifs(m => ({ ...m, [l.compte]: v }))}
                  maxLength={200}
                  placeholder={l.motifPrevu ? tr('presence.motif_annonce', { motif: l.motifPrevu }) : tr('presence.motif_facultatif')}
                  placeholderTextColor={theme.attenue}
                  style={{ flex: 1, minWidth: 0, minHeight: 44, borderWidth: 1, borderColor: theme.ligne, borderRadius: rayonControle(theme) === 999 ? 22 : rayonControle(theme), paddingHorizontal: ESP.s, color: theme.texte, backgroundColor: theme.surface, ...police(theme.policeTexte) }}
                />
                <BoutonHub
                  theme={theme}
                  titre={tr('presence.enregistrer_le_motif')}
                  desactive={(motifs[l.compte] ?? '') === (l.motif ?? '')}
                  onPress={() => envoyer({ compte: l.compte, reel: l.reel, motif: motifs[l.compte] ?? '' }, tr('presence.motif_enregistre', { pseudo: nom }))}
                  testID={`esport-presence-${l.compte}-motif-ok`}
                />
              </View>
            ) : null}
            {l.horsConvocation ? (
              <View style={{ alignSelf: 'flex-start' }}>
                <BoutonHub theme={theme} titre={tr('presence.retirer_de_la_feuille')} onPress={() => envoyer({ compte: l.compte, reel: 'inconnu' }, tr('presence.retire', { pseudo: nom }))} testID={`esport-presence-retirer-${l.compte}`} />
              </View>
            ) : null}
          </>
        ) : (
          <Badge theme={theme} texte={texteReel(l)} ton={tonReel(l.reel)} testID={`esport-presence-${l.compte}-reel`} />
        )}
      </View>
    );
  };

  return (
    <View style={{ gap: ESP.s }} testID="esport-presence-liste">
      {appel ? (
        <View style={{ gap: 2 }}>
          <Text style={{ ...styleTexte(theme, TYPO.titreCarte), fontWeight: '800' }}>{p.occurrence.titre}</Text>
          <Text style={styleAttenue(theme)}>
            <Text style={{ color: t.couleur }}>● </Text>
            {`${t.nom} · ${dateCourteJour(p.occurrence.jour)} · ${p.occurrence.heureDebut}–${p.occurrence.heureFin}`}
          </Text>
        </View>
      ) : null}
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-presence" />
      {c ? (
        <View style={{ gap: ESP.xs }} testID="esport-presence-compteurs">
          {appel ? (
            <Text style={styleAttenue(theme, TYPO.texte)} testID="esport-presence-compteur-convoques">
              {tr('presence.resume_reponses', { convoques: c.convoques, oui: c.oui, peutEtre: c.peutEtre, non: c.non, sansReponse: c.sansReponse })}
            </Text>
          ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ESP.xs }}>
            <Compteur theme={theme} libelle={tr('presence.convoques')} n={c.convoques} ton="neutre" testID="esport-presence-compteur-convoques" />
            <Compteur theme={theme} libelle={tr('presence.ont_dit_oui')} n={c.oui} ton="ok" testID="esport-presence-compteur-oui" />
            <Compteur theme={theme} libelle={tr('planning.libelles.peut_etre')} n={c.peutEtre} ton="alerte" testID="esport-presence-compteur-peut-etre" />
            <Compteur theme={theme} libelle={tr('planning.libelles.non')} n={c.non} ton="critique" testID="esport-presence-compteur-non" />
            <Compteur theme={theme} libelle={tr('planning.libelles.sans_reponse')} n={c.sansReponse} ton="neutre" testID="esport-presence-compteur-sans-reponse" />
          </View>
          )}
          {marquer || c.marques > 0 ? (
            <View style={{ gap: ESP.xxs }}>
              <Text style={{ ...styleTexte(theme), fontWeight: '600' }} testID="esport-presence-avancement">
                {tr('presence.avancement', { marques: c.marques, convoques: c.convoques })}
                {c.marques > 0 ? ` · ${[trn('presence.n_presents', c.present), trn('presence.n_retards', c.retard), trn('presence.n_absents', c.absent), trn('presence.n_excuses', c.excuse)].join(', ')}` : ''}
                {c.enPlus > 0 ? ` · ${trn('presence.en_plus', c.enPlus)}` : ''}
              </Text>
              <View style={{ height: 8, borderRadius: 4, backgroundColor: teinteTransparente(theme.attenue, 0.18), overflow: 'hidden' }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pct }}>
                <View style={{ width: `${pct}%`, height: 8, backgroundColor: pct === 100 ? theme.ok : theme.accent }} />
              </View>
            </View>
          ) : null}
        </View>
      ) : null}
      {p.lignes.length === 0 ? <Text style={styleAttenue(theme, TYPO.texte)}>{tr('planning.listePresence.personne_n_est_convoque')}</Text> : null}
      {marquer && p.commence === false && convoques.length ? <Text style={styleAttenue(theme)}>{tr('presence.pas_encore_commence')}</Text> : null}
      {marquer && c && c.nonMarques > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ESP.xs, alignItems: 'center' }}>
          <BoutonHub
            theme={theme}
            variante="plein"
            titre={tr('presence.tout_le_monde_present')}
            onPress={() =>
              void agir('tout', async () => {
                const avant = c.nonMarques;
                setP(await api.marquer(evenementId, cle, [], { toutPresent: true }));
                onMarque?.();
                return trn('presence.tous_presents', avant);
              })
            }
            testID="esport-presence-tout-present"
          />
          <Text style={{ ...styleAttenue(theme), flexShrink: 1 }}>{tr('presence.puis_ajustez')}</Text>
        </View>
      ) : null}
      {convoques.map(ligne)}
      {ajoutes.length ? <Text style={{ ...styleAttenue(theme), fontWeight: '700', marginTop: ESP.xs }}>{tr('presence.venus_sans_convocation')}</Text> : null}
      {ajoutes.map(ligne)}
      {marquer && p.ajoutables?.length ? (
        <Pliable theme={theme} titre={tr('presence.ajouter_non_convoque')} testID="esport-presence-ajouter">
          <Text style={styleAttenue(theme)}>{tr('presence.ajouter_explication')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ESP.xs }}>
            {p.ajoutables.map(m => (
              <Pastille
                key={m.compte}
                theme={theme}
                actif={false}
                libelle={`+ ${m.pseudo}`}
                onPress={() => envoyer({ compte: m.compte, reel: 'present', horsConvocation: true }, tr('presence.ajoute', { pseudo: m.pseudo }))}
                testID={`esport-presence-ajouter-${m.compte}`}
              />
            ))}
          </View>
        </Pliable>
      ) : null}
    </View>
  );
}
