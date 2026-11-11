/**
 * Administration › Événements › fiche › « Site LigneZero » (evenements.gerer ; docs/esport/evenements.md) : lien de
 * l'événement avec un tournoi du site lz.appdashboard.fr. Les équipes passent ensuite d'un côté à l'autre (le serveur
 * synchronise après chaque changement, toutes les 5 minutes, ou avec « Synchroniser ») ; la fiche est relue après.
 */

import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Avis, BoutonHub } from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import { formaterDate } from '../../i18n';
import { trEv, type CleEv } from '../../i18n/evenements';
import type { FicheEvenement, SiteEvenement as Site, apiEvenements } from '../../evenements/api';
import { Choix, Retours, styles, useAgir } from '../commun';
import { Carte, TitreCarte, attenue } from '../design';

type Api = ReturnType<typeof apiEvenements>;
const AUCUN = '-';

export function SiteEvenement({ theme, api, fiche, onFiche }: { theme: ThemeHub; api: Api; fiche: FicheEvenement; onFiche(f: FicheEvenement): void }) {
  const id = fiche.evenement.id;
  const [site, setSite] = useState<Site | undefined>();
  const [choix, setChoix] = useState<string>(AUCUN);
  const { erreur, avis, agir } = useAgir();
  useEffect(() => {
    void agir('site', async () => {
      const s = await api.site(id);
      setSite(s);
      setChoix(s.tournoiId ?? AUCUN);
    });
  }, [agir, api, id]);
  const apres = async (s: Site, message: string) => {
    setSite(s);
    onFiche(await api.lire(id));
    return message;
  };
  const e = site?.etat;
  return (
    <Carte theme={theme} dense testID="esport-ev-site">
      <TitreCarte theme={theme} titre={trEv('site.titre')} />
      <Text style={attenue(theme, 13)}>{trEv('site.aide')}</Text>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-ev-site" />
      {site?.erreur ? <Avis theme={theme} genre="critique" texte={trEv('site.erreur', { erreur: site.erreur })} testID="esport-ev-site-erreur" /> : null}
      {site && !site.erreur ? (
        <Choix
          theme={theme}
          libelle={trEv('site.tournoi')}
          valeur={choix}
          options={[{ id: AUCUN, nom: trEv('site.aucun') }, ...site.tournois.map(t => ({ id: t.id, nom: `${t.nom} (${trEv(`statut_site.${t.statut}` as CleEv)})` }))]}
          onChoisir={setChoix}
          testID="esport-ev-site-tournoi"
        />
      ) : null}
      {e ? (
        <Text style={attenue(theme, 13)} testID="esport-ev-site-dernier">
          {trEv('site.dernier', { le: formaterDate(e.le, { dateStyle: 'medium', timeStyle: 'short' }), envoyees: String(e.envoyees), recues: String(e.recues), maj: String(e.majSite + e.majApp), supprimees: String(e.supprimees) })}
        </Text>
      ) : null}
      {e?.erreurs?.length ? <Avis theme={theme} genre="alerte" texte={trEv('site.erreurs', { liste: e.erreurs.join(' ; ') })} testID="esport-ev-site-erreurs" /> : null}
      <View style={styles.ligne}>
        <BoutonHub
          theme={theme}
          variante="plein"
          titre={trEv('site.lier')}
          onPress={() => void agir('site-lier', async () => apres(await api.lierSite(id, choix === AUCUN ? null : choix), trEv(choix === AUCUN ? 'site.delie' : 'site.lie')))}
          testID="esport-ev-site-lier"
        />
        {site?.tournoiId ? <BoutonHub theme={theme} titre={trEv('site.synchro')} onPress={() => void agir('site-synchro', async () => apres(await api.synchroniserSite(id), trEv('site.synchro_ok')))} testID="esport-ev-site-synchro" /> : null}
      </View>
    </Carte>
  );
}
