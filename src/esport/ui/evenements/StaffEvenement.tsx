/**
 * Administration › Événements › fiche › « Staff de l'événement » (evenements.gerer ; docs/esport/evenements.md) : les
 * personnes qui reçoivent le rôle staff de l'événement (créé par le bot, placé sous le rôle repère, ouvert sur les
 * catégories de tickets de l'événement et sur tous les salons vocaux des équipes). Recherche parmi les membres de
 * l'app qui ont lié leur Discord, puis parmi les membres du serveur Discord ; ajout et retrait (le rôle suit).
 */

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { Avis, BoutonHub, Champ } from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import { trEv, type CleEv } from '../../i18n/evenements';
import type { CandidatStaff, FicheEvenement, apiEvenements } from '../../evenements/api';
import { Retours, styles, useAgir } from '../commun';
import { Badge, Carte, ESP, TitreCarte, attenue, texte } from '../design';

type Api = ReturnType<typeof apiEvenements>;

/** Message après un ajout ou un retrait : bilan du rôle staff, ou pourquoi rien n'a été fait sur Discord. */
function messageStaff(f: FicheEvenement, defaut: string): string {
  if (f.discord?.erreur) return trEv(`eq.discord_erreur.${f.discord.erreur}` as CleEv);
  const b = f.discord?.staff;
  return b ? `${defaut} ${trEv('staff.bilan', { attribues: String(b.attribues), categories: String(b.categories), vocaux: String(b.vocaux) })}` : defaut;
}

export function StaffEvenement({ theme, api, fiche, onFiche }: { theme: ThemeHub; api: Api; fiche: FicheEvenement; onFiche(f: FicheEvenement): void }) {
  const [q, setQ] = useState('');
  const [candidats, setCandidats] = useState<CandidatStaff[] | undefined>();
  const { erreur, avis, agir, enCours } = useAgir();
  const id = fiche.evenement.id;
  const chercher = () =>
    void agir('chercher', async () => {
      setCandidats((await api.candidatsStaff(q.trim())).candidats);
    });
  const deja = new Set(fiche.staff.map(m => m.discordId));
  return (
    <Carte theme={theme} dense testID="esport-ev-staff">
      <TitreCarte theme={theme} titre={trEv('staff.titre')} />
      <Text style={attenue(theme, 13)}>{trEv('staff.aide')}</Text>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-ev-staff" />
      <Badge theme={theme} ton={fiche.evenement.discord.staffRoleId ? 'ok' : 'neutre'} texte={trEv(fiche.evenement.discord.staffRoleId ? 'staff.role_cree' : 'staff.role_absent')} testID="esport-ev-staff-role" />
      {!fiche.staff.length ? <Text style={attenue(theme)}>{trEv('staff.vide')}</Text> : null}
      {fiche.staff.map(m => (
        <View key={m.id} style={[styles.ligne, { justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.xxs }]} testID={`esport-ev-staff-${m.discordId}`}>
          <Text style={{ ...texte(theme), flex: 1, minWidth: 0 }} numberOfLines={1}>
            {m.nom || m.discordId} · {m.discordId}
            {m.roleStatut ? ` · ${trEv(`eq.statut.${m.roleStatut}` as CleEv)}` : ''}
          </Text>
          <BoutonHub theme={theme} variante="danger" titre={trEv('staff.retirer')} onPress={() => void agir('retirer', async () => { const f = await api.retirerStaff(id, m.id); onFiche(f); return messageStaff(f, trEv('staff.retire')); })} testID={`esport-ev-staff-${m.discordId}-retirer`} />
        </View>
      ))}
      <View style={[styles.ligne, { alignItems: 'flex-end' }]}>
        <Champ theme={theme} libelle={trEv('staff.chercher')} valeur={q} onChanger={setQ} maxLength={32} testID="esport-ev-staff-q" style={{ flexGrow: 1, flexBasis: 220, minWidth: 0 }} />
        <BoutonHub theme={theme} titre={trEv('staff.chercher_bouton')} desactive={q.trim().length < 2 || enCours === 'chercher'} onPress={chercher} testID="esport-ev-staff-chercher" />
      </View>
      {candidats ? (
        <View style={{ gap: 4 }} testID="esport-ev-staff-candidats">
          {!candidats.length ? <Text style={attenue(theme)}>{trEv('staff.aucun_resultat')}</Text> : null}
          {candidats.map(c => (
            <View key={c.discordId} style={[styles.ligne, { justifyContent: 'space-between' }]}>
              <Text style={{ ...texte(theme), flex: 1, minWidth: 0 }} numberOfLines={1}>
                {c.nom} · {trEv(`staff.source.${c.source}` as CleEv)}
              </Text>
              <BoutonHub
                theme={theme}
                titre={trEv('staff.ajouter')}
                desactive={deja.has(c.discordId) || enCours === 'ajouter'}
                onPress={() =>
                  void agir('ajouter', async () => {
                    const f = await api.ajouterStaff(id, { discordId: c.discordId, nom: c.nom });
                    onFiche(f);
                    return messageStaff(f, trEv('staff.ajoute'));
                  })
                }
                testID={`esport-ev-staff-ajouter-${c.discordId}`}
              />
            </View>
          ))}
        </View>
      ) : null}
      {fiche.discord?.staff?.absents.length ? <Avis theme={theme} genre="alerte" texte={trEv('eq.bilan_absents', { liste: fiche.discord.staff.absents.map(a => a.nom || a.discordId).join(', ') })} /> : null}
    </Carte>
  );
}
