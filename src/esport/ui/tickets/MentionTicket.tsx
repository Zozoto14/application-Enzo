/**
 * « Mentionner » (vue d'un ticket) : choisir qui le bot mentionne dans le salon — l'auteur, les personnes ajoutées, les
 * rôles qui traitent la catégorie, le staff au compte Discord lié, ou un membre du serveur cherché par son nom — avec
 * un message facultatif. Seules les cibles cochées sont notifiées (le serveur limite `allowed_mentions` à elles) ;
 * 3 mentions par minute et par ticket. Une personne trouvée par la recherche peut être ajoutée au ticket d'abord
 * (sinon elle ne voit pas le salon) : réservé à qui gère les tickets.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BoutonHub, Champ, Interrupteur } from '../../../hub/admin/ui/commun';
import { teinteTransparente, type ThemeHub } from '../../../hub/themes';
import { ErreurEsport } from '../../client';
import { trTk, type CleTk } from '../../i18n/tickets';
import type { ApiTickets, CibleMention, DetailTicket, Mentionnables } from '../../tickets/api';
import { Glyphe } from '../../../ui/icones';
import { Intertitre, Retours, styles, useAgir } from '../commun';
import { ESP, Squelette, Volet, attenue, texte } from '../design';
import { ZoneEcriture } from '../ecriture/ZoneEcriture';

const cle = (c: Pick<CibleMention, 'type' | 'id'>) => `${c.type === 'role' ? 'r' : 'm'}:${c.id}`;

function messageErreur(e: unknown): string {
  if (e instanceof ErreurEsport && typeof e.code === 'string' && e.code.startsWith('ticket-')) {
    const k = `erreur.${e.code.slice(7)}` as CleTk;
    const t = trTk(k);
    if (t !== k) return t;
  }
  return e instanceof Error ? e.message : String(e);
}

function Case({ theme, libelle, detail, coche, onPress, testID }: { theme: ThemeHub; libelle: string; detail?: string; coche: boolean; onPress(): void; testID: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: coche }}
      accessibilityLabel={detail ? `${libelle} · ${detail}` : libelle}
      onPress={onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: ESP.xs, minHeight: 44, paddingHorizontal: ESP.xs, borderRadius: 8, backgroundColor: pressed ? teinteTransparente(theme.attenue, 0.08) : coche ? teinteTransparente(theme.accent, 0.1) : 'transparent' })}
    >
      <View style={{ width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: coche ? theme.accent : theme.attenue, backgroundColor: coche ? theme.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {coche ? <Glyphe valeur="valide" taille={12} couleur="#FFFFFF" /> : null}
      </View>
      <Text style={{ ...texte(theme), flexShrink: 1 }} numberOfLines={1}>
        {libelle}
      </Text>
      {detail ? (
        <Text style={{ ...attenue(theme, 12), flexShrink: 1 }} numberOfLines={1}>
          {detail}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function DialogueMention({ theme, api, ticketId, gerer, large, onFermer, onFait }: { theme: ThemeHub; api: ApiTickets; ticketId: string; gerer: boolean; large: boolean; onFermer(): void; onFait(d: DetailTicket): void }) {
  const [m, setM] = useState<Mentionnables | undefined>();
  const [choix, setChoix] = useState<Map<string, CibleMention>>(new Map());
  const [q, setQ] = useState('');
  const [message, setMessage] = useState('');
  const [ajouter, setAjouter] = useState(true);
  const { erreur, agir: agirBrut, enCours } = useAgir();
  const agir = useCallback(
    (libelle: string, action: () => Promise<string | void>) =>
      agirBrut(libelle, async () => {
        try {
          return await action();
        } catch (e) {
          throw new Error(messageErreur(e));
        }
      }),
    [agirBrut],
  );
  useEffect(() => {
    void agir('mentionnables', async () => setM(await api.mentionnables(ticketId)));
  }, [agir, api, ticketId]);
  const chercher = () => void agir('chercher', async () => setM(await api.mentionnables(ticketId, q)));
  const basculer = (c: CibleMention) => {
    const n = new Map(choix);
    if (n.has(cle(c))) n.delete(cle(c));
    else n.set(cle(c), c);
    setChoix(n);
  };
  const deRecherche = new Set((m?.recherche ?? []).map(x => x.discordId));
  const connus = new Set([m?.auteur.discordId, ...(m?.membres ?? []).map(x => x.discordId)]);
  const envoyer = () =>
    void agir('mentionner', async () => {
      const cibles = [...choix.values()].map(c => (c.type === 'membre' && gerer && ajouter && deRecherche.has(c.id) && !connus.has(c.id) ? { ...c, ajouter: true } : c));
      const d = await api.mentionner(ticketId, { cibles, message: message.trim() || undefined });
      onFait(d);
    });
  const ligne = (c: CibleMention, detail: string | undefined, prefixe: string) => <Case key={`${prefixe}-${cle(c)}`} theme={theme} libelle={c.type === 'role' ? `@${c.nom}` : c.nom} detail={detail} coche={choix.has(cle(c))} onPress={() => basculer(c)} testID={`esport-tk-mention-${prefixe}-${c.id}`} />;
  const staff = (m?.staff ?? []).filter(s => !connus.has(s.discordId));
  return (
    <Volet theme={theme} visible titre={trTk('vue.mentionner_titre')} onFermer={onFermer} largeur={large ? 560 : 480} testID="esport-tk-mention">
      <View style={{ gap: ESP.s }}>
        <Text style={attenue(theme)}>{trTk('vue.mentionner_aide')}</Text>
        <Retours theme={theme} erreur={erreur} prefixe="esport-tk-mention" />
        {!m ? <Squelette theme={theme} lignes={4} /> : null}
        {m ? (
          <>
            <View style={{ gap: 2 }}>
              <Intertitre theme={theme}>{trTk('vue.mentionner_auteur')}</Intertitre>
              {ligne({ type: 'membre', id: m.auteur.discordId, nom: m.auteur.nom }, undefined, 'auteur')}
            </View>
            {m.membres.length ? (
              <View style={{ gap: 2 }}>
                <Intertitre theme={theme}>{trTk('vue.mentionner_membres')}</Intertitre>
                {m.membres.map(x => ligne({ type: 'membre', id: x.discordId, nom: x.nom }, undefined, 'membre'))}
              </View>
            ) : null}
            {m.roles.length ? (
              <View style={{ gap: 2 }}>
                <Intertitre theme={theme}>{trTk('vue.mentionner_roles')}</Intertitre>
                {m.roles.map(x => ligne({ type: 'role', id: x.id, nom: x.nom }, undefined, 'role'))}
              </View>
            ) : null}
            {staff.length ? (
              <View style={{ gap: 2 }}>
                <Intertitre theme={theme}>{trTk('vue.mentionner_staff')}</Intertitre>
                {staff.map(x => ligne({ type: 'membre', id: x.discordId, nom: x.nom }, undefined, 'staff'))}
              </View>
            ) : null}
            <View style={{ gap: ESP.xs }}>
              <Intertitre theme={theme}>{trTk('vue.mentionner_recherche')}</Intertitre>
              <View style={[styles.ligne, { alignItems: 'flex-end' }]}>
                <Champ theme={theme} libelle={trTk('vue.mentionner_recherche')} valeur={q} onChanger={setQ} maxLength={32} testID="esport-tk-mention-q" style={{ flexGrow: 1, flexBasis: 180, minWidth: 0 }} />
                <BoutonHub theme={theme} titre={trTk('vue.mentionner_chercher')} onPress={chercher} desactive={q.trim().length < 2 || enCours === 'chercher'} testID="esport-tk-mention-chercher" />
              </View>
              {m.recherche === null ? <Text style={attenue(theme, 12)}>{trTk('vue.mentionner_recherche_aide')}</Text> : null}
              {m.rechercheErreur ? <Text style={attenue(theme)} testID="esport-tk-mention-recherche-erreur">{trTk('vue.mentionner_recherche_erreur')}</Text> : null}
              {m.recherche && !m.recherche.length && !m.rechercheErreur ? <Text style={attenue(theme)}>{trTk('vue.mentionner_recherche_vide')}</Text> : null}
              {(m.recherche ?? []).map(x => ligne({ type: 'membre', id: x.discordId, nom: x.nom }, x.pseudo && x.pseudo !== x.nom ? `@${x.pseudo}` : undefined, 'trouve'))}
              {gerer && (m.recherche ?? []).some(x => choix.has(cle({ type: 'membre', id: x.discordId })) && !connus.has(x.discordId)) ? (
                <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
                  <Text style={{ ...texte(theme, 13), flex: 1, minWidth: 0 }}>{trTk('vue.mentionner_ajouter')}</Text>
                  <Interrupteur theme={theme} libelle={trTk('vue.mentionner_ajouter')} valeur={ajouter} onChanger={setAjouter} testID="esport-tk-mention-ajouter" />
                </View>
              ) : null}
            </View>
            <ZoneEcriture theme={theme} champ="tickets.mention" valeur={message} onChanger={setMessage} maxLength={500} testID="esport-tk-mention-ecriture">
              <Champ theme={theme} libelle={trTk('vue.mentionner_message')} valeur={message} onChanger={setMessage} multiligne maxLength={500} testID="esport-tk-mention-message" />
            </ZoneEcriture>
            <View style={styles.ligne}>
              <BoutonHub theme={theme} variante="plein" titre={trTk('vue.mentionner_envoyer', { n: choix.size })} onPress={envoyer} desactive={!choix.size || enCours === 'mentionner'} testID="esport-tk-mention-envoyer" />
              <BoutonHub theme={theme} titre={trTk('annuler')} onPress={onFermer} testID="esport-tk-mention-annuler" />
            </View>
          </>
        ) : null}
      </View>
    </Volet>
  );
}
