/**
 * Statistiques globales de la team (accueil) : présence, tâches, résumés et
 * activité sur une période (7, 30 ou 90 jours). Le serveur ne renvoie que les
 * blocs que le membre a le droit de voir (`null` sinon) : rien n'est filtré
 * ici. Barres accompagnées de leur valeur en texte (lisible sans couleur).
 */

import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { police, teinteTransparente, type ThemeHub } from '../../hub/themes';
import { nomModule, type ClientEsport, type DetailTeam, type StatsTeam as Stats } from '../client';
import { aujourdhui } from '../libelles';
import { Choix, Intertitre, Panneau } from './commun';
import { tr, trn } from '../i18n';

const PERIODES = [
  { id: '7', get nom() {
      return tr('journal.7_jours');
    } },
  { id: '30', get nom() {
      return tr('journal.30_jours');
    } },
  { id: '90', get nom() {
      return tr('journal.90_jours');
    } },
] as const;

/** Nom d'un module dans les statistiques d'activité. */
const nomBloc = (cle: string): string => (cle === 'coeur' ? tr('journal.team_et_membres') : nomModule(cle));

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
      <Intertitre theme={theme}>{tr('statsTeam.statistiques_de_la_team')}</Intertitre>
      <Choix theme={theme} libelle={tr('journal.periode')} valeur={periode} options={PERIODES} onChoisir={v => setPeriode(v as '7' | '30' | '90')} testID="esport-stats-periode" />
      {s ? (
        <View style={{ gap: 16 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            <Chiffre theme={theme} valeur={s.membres.actifs} libelle={tr('statsTeam.membres_actifs')} testID="esport-stats-membres" />
            {s.presence ? <Chiffre theme={theme} valeur={s.presence.taux === null ? tr('presence.rien_de_marque') : `${s.presence.taux} %`} libelle={tr('statsTeam.presence_seances', { seances: trn('statsTeam.seances', s.presence.seances) })} testID="esport-stats-presence" /> : null}
            {s.taches ? <Chiffre theme={theme} valeur={s.taches.terminees} libelle={tr('statsTeam.taches_faites_sur_creees', { creees: s.taches.creees })} testID="esport-stats-taches" /> : null}
            {s.taches ? <Chiffre theme={theme} valeur={s.taches.enRetard} libelle={tr('statsTeam.taches_en_retard')} /> : null}
            {s.resumes ? <Chiffre theme={theme} valeur={s.resumes.deposes} libelle={tr('statsTeam.reunions_deposees_a_resumer', { enAttente: s.resumes.enAttente })} testID="esport-stats-resumes" /> : null}
            {s.activite ? <Chiffre theme={theme} valeur={s.activite.actions} libelle={tr('statsTeam.actions_de', { membres: trn('statsTeam.membres', s.activite.membresActifs) })} testID="esport-stats-activite" /> : null}
          </View>
          {s.presence && s.presence.joueurs.length > 0 ? (
            <View style={{ gap: 6 }} testID="esport-stats-joueurs">
              <Text style={attenue}>{tr('statsTeam.presence_par_joueur_present')}</Text>
              {s.presence.joueurs.slice(0, 10).map(j => (
                <Barre key={j.compte} theme={theme} libelle={j.pseudo ?? tr('resumes.compte_supprime')} valeur={j.taux ?? 0} max={100} texte={j.taux === null ? tr('statsTeam.non_marque') : `${j.taux} % (${j.marques})`} />
              ))}
            </View>
          ) : null}
          {modules.length > 0 ? (
            <View style={{ gap: 6 }} testID="esport-stats-modules">
              <Text style={attenue}>{tr('statsTeam.activite_par_module')}</Text>
              {modules.map(([m, n]) => (
                <Barre key={m} theme={theme} libelle={nomBloc(m)} valeur={n} max={modules[0][1]} texte={String(n)} />
              ))}
            </View>
          ) : null}
          {vide ? <Text style={attenue}>{tr('statsTeam.votre_role_ne_donne')}</Text> : null}
        </View>
      ) : null}
    </Panneau>
  );
}
