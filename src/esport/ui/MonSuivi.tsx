/**
 * « Mon profil de joueur » sur l'accueil de la team :
 *  - ma présence (30 derniers jours) : taux, ponctualité, absences de suite,
 *    dernières séances — les mêmes chiffres que le staff voit, rien de plus ;
 *  - les retours du staff : UNIQUEMENT les notes que le staff a choisi de
 *    partager avec moi, en lecture (sans l'auteur s'il l'a masqué). Les notes
 *    privées ne quittent jamais le serveur pour moi.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import type { ThemeHub } from '../../hub/themes';
import type { ClientEsport, DetailTeam } from '../client';
import { apiPlanning } from '../planning/api';
import { dateCourteJour } from '../planning/libelles';
import { apiSuivi, type NotePartagee } from '../suivi/api';
import { Badge, Carte, ESP, TitreCarte, attenue as styleAttenue, texte as styleTexte } from './design';
import { FichePresenceJoueur } from './planning/FichePresence';
import { NoteMarkdown } from './review/Note';
import { nomCategorie, nomTon, tonDeNote } from './suivi/SuiviJoueurs';
import { tr } from '../i18n';

export function MonSuivi({ theme, client, detail }: { theme: ThemeHub; client: ClientEsport; detail: DetailTeam }) {
  const actif = (cle: string) => detail.modules.some(m => m.cle === cle && m.active);
  const presence = actif('attendance') && detail.moi.permissions.includes('attendance.rsvp_own') && !detail.moi.permissions.includes('attendance.view_all');
  const notes = actif('player_notes') && Boolean(detail.moi.role);
  const planning = useMemo(() => apiPlanning(client, detail.team.id), [client, detail.team.id]);
  const suivi = useMemo(() => apiSuivi(client, detail.team.id), [client, detail.team.id]);
  const [partagees, setPartagees] = useState<NotePartagee[] | undefined>();
  useEffect(() => {
    if (!notes) return;
    Promise.resolve()
      .then(() => suivi.mesNotes())
      .then(r => setPartagees(r.notes), () => setPartagees([]));
  }, [notes, suivi]);
  const periode = useMemo(() => ({ periode: '30' as const, fuseau: detail.team.fuseau }), [detail.team.fuseau]);
  if (!presence && !(notes && partagees?.length)) return null;
  return (
    <Carte theme={theme} testID="esport-mon-suivi">
      <TitreCarte theme={theme} titre={tr('suivi.mon_profil_joueur')} sous={presence ? tr('suivi.mon_profil_sous') : undefined} />
      {presence ? <FichePresenceJoueur theme={theme} api={planning} compte="moi" periode={periode} compact testID="esport-ma-presence-accueil" /> : null}
      {notes && partagees?.length ? (
        <View style={{ gap: ESP.s }} testID="esport-mes-notes">
          <Text accessibilityRole="header" style={{ ...styleTexte(theme), fontWeight: '700' }}>
            {tr('suivi.retours_du_staff')}
          </Text>
          {partagees.map(n => (
            <View key={n.id} style={{ gap: ESP.xxs, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.xs }} testID={`esport-ma-note-${n.id.slice(0, 8)}`}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ESP.xs, alignItems: 'center' }}>
                <Text style={{ ...styleTexte(theme), fontWeight: '700' }}>{dateCourteJour(n.date)}</Text>
                <Badge theme={theme} texte={nomCategorie(n.categorie)} ton="accent" />
                <Badge theme={theme} texte={nomTon(n.ton)} ton={tonDeNote(n.ton)} />
              </View>
              <NoteMarkdown theme={theme} source={n.contenu} />
              <Text style={styleAttenue(theme)}>{n.auteur ? tr('suivi.par', { nom: n.auteur }) : tr('suivi.par_le_staff')}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </Carte>
  );
}
