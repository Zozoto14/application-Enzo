/**
 * Discord ID d'un membre (migration 0015) : champ de saisie avec aide (« Comment trouver un Discord
 * ID ? »), badge « Discord ID manquant », modification par le Fondateur SEUL (le serveur répond 403
 * à tout autre rôle, Propriétaire compris), et réglage du récapitulatif e-mail (profil).
 *
 * Le bot pingue les convoqués avec ce Discord ID ; si le membre a aussi lié son compte par /lier,
 * la liaison vérifiée prime (docs/esport/bot-discord.md).
 */

import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BoutonHub, Champ } from '../../hub/admin/ui/commun';
import { police, teinteTransparente, type ThemeHub } from '../../hub/themes';
import type { ClientEsport, CompteEsport, RecapCourriel } from '../client';
import { erreurDiscordId, normaliserDiscordId } from '../comptesHub';
import { tr } from '../i18n';
import { Choix, Retours, styles as communs, useAgir } from './commun';

/** Aide repliable : où trouver l'identifiant numérique dans Discord. */
export function AideDiscordId({ theme, testID = 'esport-discord-id-aide' }: { theme: ThemeHub; testID?: string }) {
  const [ouvert, setOuvert] = useState(false);
  const attenue = { color: theme.attenue, fontSize: 12, lineHeight: 18, ...police(theme.policeTexte) };
  return (
    <View style={{ gap: 4 }}>
      <Pressable onPress={() => setOuvert(v => !v)} accessibilityRole="button" testID={testID} hitSlop={8}>
        <Text style={[attenue, { color: theme.accent, fontWeight: '600' }]}>{`${ouvert ? '▾' : '▸'} ${tr('discordId.aide_titre')}`}</Text>
      </Pressable>
      {ouvert ? (
        <Text style={attenue} testID={`${testID}-texte`}>
          {tr('discordId.aide')}
        </Text>
      ) : null}
    </View>
  );
}

/** Champ Discord ID (obligatoire ou non), avec l'aide et le message d'erreur sous le champ. */
export function ChampDiscordId({ theme, valeur, onChanger, obligatoire, testID, libelle }: { theme: ThemeHub; valeur: string; onChanger(v: string): void; obligatoire: boolean; testID: string; libelle?: string }) {
  const probleme = valeur.trim() ? erreurDiscordId(valeur, obligatoire) : undefined;
  return (
    <View style={{ gap: 4, flexGrow: 1, flexBasis: 220 }}>
      <Champ theme={theme} libelle={libelle ?? (obligatoire ? tr('discordId.libelle_obligatoire') : tr('discordId.libelle_facultatif'))} valeur={valeur} onChanger={v => onChanger(v.replace(/[^\d<@!>\s]/g, ''))} maxLength={26} placeholder={tr('discordId.placeholder')} testID={testID} />
      {probleme ? (
        <Text style={{ color: theme.alerte, fontSize: 12, ...police(theme.policeTexte) }} testID={`${testID}-erreur`}>
          {probleme}
        </Text>
      ) : null}
      <AideDiscordId theme={theme} testID={`${testID}-aide`} />
    </View>
  );
}

/** Badge d'un membre sans Discord ID. */
export function BadgeDiscordManquant({ theme, compte }: { theme: ThemeHub; compte: string }) {
  return (
    <Text
      testID={`esport-discord-manquant-${compte}`}
      style={{ color: theme.alerte, backgroundColor: teinteTransparente(theme.alerte, 0.14), fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden', ...police(theme.policeTexte) }}>
      {tr('discordId.manquant')}
    </Text>
  );
}

/** Le Discord ID d'un membre : affiché à tous ceux qui voient le membre ; modifiable par le Fondateur seul. */
export function DiscordIdMembre({ theme, client, compte, modifiable, onFait }: { theme: ThemeHub; client: ClientEsport; compte: CompteEsport; modifiable: boolean; onFait(): Promise<void> | void }) {
  const [edition, setEdition] = useState(false);
  const [valeur, setValeur] = useState(compte.discordId ?? '');
  const { enCours, erreur, avis, agir } = useAgir();
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  const probleme = erreurDiscordId(valeur, true);
  return (
    <View style={{ gap: 6 }} testID={`esport-discord-id-${compte.compte}`}>
      <View style={[communs.ligne, { alignItems: 'center' }]}>
        <Text style={attenue} testID={`esport-discord-id-valeur-${compte.compte}`}>
          {compte.discordId ? tr('discordId.valeur', { id: compte.discordId }) : tr('discordId.manquant')}
          {compte.discordLie ? ` · ${tr('discordId.lie')}` : ''}
        </Text>
        {modifiable && !edition ? <BoutonHub theme={theme} titre={compte.discordId ? tr('discordId.modifier') : tr('discordId.ajouter')} onPress={() => setEdition(true)} testID={`esport-discord-id-modifier-${compte.compte}`} /> : null}
      </View>
      {edition ? (
        <View style={{ gap: 6 }}>
          <ChampDiscordId theme={theme} valeur={valeur} onChanger={setValeur} obligatoire testID={`esport-discord-id-champ-${compte.compte}`} />
          <View style={communs.ligne}>
            <BoutonHub
              theme={theme}
              titre={enCours ? tr('discordId.enregistrement') : tr('discordId.enregistrer')}
              variante="plein"
              desactive={Boolean(enCours) || Boolean(probleme)}
              onPress={() =>
                void agir('discord-id', async () => {
                  await client.majDiscordId(compte.compte, normaliserDiscordId(valeur));
                  setEdition(false);
                  await onFait();
                  return tr('discordId.enregistre', { nom: compte.pseudo });
                })
              }
              testID={`esport-discord-id-enregistrer-${compte.compte}`}
            />
            {compte.discordId ? (
              <BoutonHub
                theme={theme}
                titre={tr('discordId.retirer')}
                onPress={() =>
                  void agir('discord-id', async () => {
                    await client.majDiscordId(compte.compte, null);
                    setValeur('');
                    setEdition(false);
                    await onFait();
                    return tr('discordId.retire', { nom: compte.pseudo });
                  })
                }
                testID={`esport-discord-id-retirer-${compte.compte}`}
              />
            ) : null}
            <BoutonHub theme={theme} titre={tr('assistant.annuler')} onPress={() => setEdition(false)} testID={`esport-discord-id-annuler-${compte.compte}`} />
          </View>
        </View>
      ) : null}
      {!modifiable && !compte.discordId ? <Text style={attenue}>{tr('discordId.seul_fondateur')}</Text> : null}
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe={`esport-discord-id-${compte.compte}`} />
    </View>
  );
}

/** Profil : récapitulatif e-mail des notifications importantes (désactivé par défaut). */
export function ReglageRecapCourriel({ theme, client }: { theme: ThemeHub; client: ClientEsport }) {
  const [etat, setEtat] = useState<RecapCourriel | undefined>();
  const [adresse, setAdresse] = useState('');
  const [frequence, setFrequence] = useState<'quotidien' | 'hebdomadaire'>('quotidien');
  const { enCours, erreur, avis, agir } = useAgir();
  const attenue = { color: theme.attenue, fontSize: 12, lineHeight: 18, ...police(theme.policeTexte) };
  useEffect(() => {
    client.recapCourriel?.().then(
      r => {
        setEtat(r);
        setFrequence(r.frequence);
      },
      () => setEtat(undefined),
    );
  }, [client]);
  if (!etat) return null;
  const frequences = [
    { id: 'quotidien' as const, nom: tr('recap.quotidien') },
    { id: 'hebdomadaire' as const, nom: tr('recap.hebdomadaire') },
  ];
  return (
    <View style={{ gap: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: theme.ligne }} testID="esport-recap">
      <Text style={{ color: theme.texte, fontWeight: '700', ...police(theme.policeTexte) }}>{tr('recap.titre')}</Text>
      <Text style={attenue}>{tr('recap.explication')}</Text>
      <Text style={attenue} testID="esport-recap-etat">
        {etat.actif ? tr('recap.actif', { adresse: etat.adresse ?? '***', frequence: etat.frequence === 'hebdomadaire' ? tr('recap.hebdomadaire') : tr('recap.quotidien') }) : tr('recap.inactif')}
      </Text>
      <Champ theme={theme} libelle={etat.actif ? tr('recap.nouvelle_adresse') : tr('recap.adresse')} valeur={adresse} onChanger={setAdresse} maxLength={254} placeholder={tr('recap.placeholder')} testID="esport-recap-adresse" />
      <Choix<'quotidien' | 'hebdomadaire'> theme={theme} libelle={tr('recap.frequence')} valeur={frequence} options={frequences} onChoisir={setFrequence} testID="esport-recap-frequence" />
      <View style={communs.ligne}>
        <BoutonHub
          theme={theme}
          variante="plein"
          titre={etat.actif ? tr('recap.enregistrer') : tr('recap.activer')}
          desactive={Boolean(enCours) || (!etat.actif && !adresse.trim())}
          onPress={() =>
            void agir('recap', async () => {
              const r = await client.reglerRecapCourriel({ actif: true, frequence, ...(adresse.trim() ? { adresse: adresse.trim() } : {}) });
              setEtat(r);
              setAdresse('');
              return tr('recap.enregistre');
            })
          }
          testID="esport-recap-activer"
        />
        {etat.actif ? (
          <BoutonHub
            theme={theme}
            titre={tr('recap.desactiver')}
            onPress={() =>
              void agir('recap', async () => {
                setEtat(await client.reglerRecapCourriel({ actif: false }));
                return tr('recap.desactive');
              })
            }
            testID="esport-recap-desactiver"
          />
        ) : null}
      </View>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-recap" />
    </View>
  );
}
