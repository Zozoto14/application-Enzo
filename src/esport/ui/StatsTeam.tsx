/**
 * Statistiques globales de la team (accueil) : présence, tâches, résumés et
 * activité sur une période (7, 30 ou 90 jours). Le serveur ne renvoie que les
 * blocs que le membre a le droit de voir (`null` sinon) : rien n'est filtré
 * ici. Barres accompagnées de leur valeur en texte (lisible sans couleur).
 */

import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Intertitre, Panneau } from '../../hub/admin/ui/commun';
import { police, teinteTransparente, type ThemeHub } from '../../hub/themes';
import { nomModule, type ClientEsport, type DetailTeam, type StatsTeam as Stats } from '../client';
import { aujourdhui } from '../libelles';
import { Choix } from './commun';

const PERIODES = [
  { id: '7', nom: '7 jours' },
  { id: '30', nom: '30 jours' },
  { id: '90', nom: '90 jours' },
] as const;

/** Nom d'un module dans les statistiques d'activité. */
const nomBloc = (cle: string): string => (cle === 'coeur' ? 'Team et membres' : nomModule(cle));

function Chiffre({ theme, valeur, libelle, testID }: { theme: ThemeHub; valeur: string | number; libelle: string; testID?: string }) {
  return (
    <View style={{ minWidth: 96, flexGrow: 1, gap: 2 }} accessible accessibilityLabel={`${libelle} : ${valeur}`} testID={testID}>
      <Text style={{ color: theme.texte, fontSize: 22, fontWeight: '800', ...police(theme.policeChiffres) }}>{valeur}</Text>
      <Text style={{ color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) }}>{libelle}</Text>
    </View>
  );
}

function Barre({ theme, libelle, valeur, max, texte }: { theme: ThemeHub; libelle: string; valeur: number; max: number; texte: string }) {
  const largeur = max > 0 ? Math.max(2, Math.round((valeur / max) * 100)) : 0;
  return (
    <View style={{ gap: 2 }} accessible accessibilityLabel={`${libelle} : ${texte}`}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        <Text style={{ color: theme.texte, fontSize: 13, flexShrink: 1, ...police(theme.policeTexte) }} numberOfLines={1}>
          {libelle}
        </Text>
        <Text style={{ color: theme.texte, fontSize: 13, fontWeight: '700', ...police(theme.policeChiffres) }}>{texte}</Text>
      </View>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: teinteTransparente(theme.accent, 0.15) }}>
        <View style={{ height: 6, borderRadius: 3, width: `${largeur}%`, backgroundColor: theme.accent }} />
      </View>
    </View>
  );
}

export function StatsTeam({ theme, client, detail, maintenant = Date.now }: { theme: ThemeHub; client: ClientEsport; detail: DetailTeam; maintenant?: () => number }) {
  const [periode, setPeriode] = useState<'7' | '30' | '90'>('30');
  const [stats, setStats] = useState<Stats | undefined>();
  useEffect(() => {
    let vivant = true;
    const t = maintenant();
    // Serveur plus ancien (sans statistiques) ou hors ligne : le bloc ne s'affiche simplement pas.
    Promise.resolve()
      .then(() => client.stats(detail.team.id, { du: aujourdhui(t - (Number(periode) - 1) * 86_400_000), au: aujourdhui(t) }))
      .then(
        s => vivant && setStats(s),
        () => vivant && setStats(undefined),
      );
    return () => {
      vivant = false;
    };
  }, [client, detail.team.id, periode, maintenant]);
  if (!stats) return null;
  const s = stats;
  const vide = s && !s.presence && !s.taches && !s.resumes && !s.activite;
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  const modules = s?.activite ? Object.entries(s.activite.parModule).sort((a, b) => b[1] - a[1]) : [];
  return (
    <Panneau theme={theme} testID="esport-stats">
      <Intertitre theme={theme}>Statistiques de la team</Intertitre>
      <Choix theme={theme} libelle="Période" valeur={periode} options={PERIODES} onChoisir={v => setPeriode(v as '7' | '30' | '90')} testID="esport-stats-periode" />
      {s ? (
        <View style={{ gap: 16 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            <Chiffre theme={theme} valeur={s.membres.actifs} libelle="membres actifs" testID="esport-stats-membres" />
            {s.presence ? <Chiffre theme={theme} valeur={s.presence.taux === null ? '—' : `${s.presence.taux} %`} libelle={`présence (${s.presence.seances} séance${s.presence.seances > 1 ? 's' : ''})`} testID="esport-stats-presence" /> : null}
            {s.taches ? <Chiffre theme={theme} valeur={s.taches.terminees} libelle={`tâches faites sur ${s.taches.creees} créées`} testID="esport-stats-taches" /> : null}
            {s.taches ? <Chiffre theme={theme} valeur={s.taches.enRetard} libelle="tâches en retard" /> : null}
            {s.resumes ? <Chiffre theme={theme} valeur={s.resumes.deposes} libelle={`réunions déposées, ${s.resumes.enAttente} à résumer`} testID="esport-stats-resumes" /> : null}
            {s.activite ? <Chiffre theme={theme} valeur={s.activite.actions} libelle={`actions de ${s.activite.membresActifs} membre${s.activite.membresActifs > 1 ? 's' : ''}`} testID="esport-stats-activite" /> : null}
          </View>
          {s.presence && s.presence.joueurs.length > 0 ? (
            <View style={{ gap: 6 }} testID="esport-stats-joueurs">
              <Text style={attenue}>Présence par joueur (présent ou en retard, sur les séances marquées)</Text>
              {s.presence.joueurs.slice(0, 10).map(j => (
                <Barre key={j.compte} theme={theme} libelle={j.pseudo ?? 'Compte supprimé'} valeur={j.taux ?? 0} max={100} texte={j.taux === null ? 'non marqué' : `${j.taux} % (${j.marques})`} />
              ))}
            </View>
          ) : null}
          {modules.length > 0 ? (
            <View style={{ gap: 6 }} testID="esport-stats-modules">
              <Text style={attenue}>Activité par module</Text>
              {modules.map(([m, n]) => (
                <Barre key={m} theme={theme} libelle={nomBloc(m)} valeur={n} max={modules[0][1]} texte={String(n)} />
              ))}
            </View>
          ) : null}
          {vide ? <Text style={attenue}>Votre rôle ne donne pas accès aux statistiques détaillées de la team.</Text> : null}
        </View>
      ) : null}
    </Panneau>
  );
}
