/**
 * Paramètres › Administration › « Mises à jour » (Fondateur, ou permission du club deploiement.voir) : versions en
 * service (cette app, site, serveur Esport, relais, dernier commit sur GitHub), dernier déploiement, état de la
 * construction GitHub, 10 dernières lignes du journal de déploiement (filtrées par le serveur), « Vérifier
 * maintenant » (drapeau lu par deployer.sh, aucune commande lancée) et « Recharger l'app ».
 * Et Paramètres › À propos › « Mettre à jour automatiquement » (`ReglageMajAuto`). docs/mises-a-jour.md.
 */

import React, { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { useLangue } from '../../esport/i18n';
import { BoutonHub } from '../Hub';
import { police, type ThemeHub } from '../themes';
import { tt } from '../../ui/mobile/jetons';
import { court, phraseEtat, pastillePour, sondeur, useEtatDeploiement, type EtatDeploiement } from './deploiement';
import { couleurTon } from './PastilleDeploiement';
import { versionRelais, type EtatVersionRelais } from './serveurs';
import { dateCourte, depuis, ilYa, tm } from './textes';
import { abonnerMajAuto, definirMajAuto, majAutoActive, rechargerProprement, versionLocale } from './version';

function Ligne({ theme, libelle, valeur, testID }: { theme: ThemeHub; libelle: string; valeur: string; testID?: string }) {
  return (
    <View style={styles.ligne} testID={testID}>
      <Text style={{ color: theme.attenue, fontSize: tt(13), minWidth: 190, ...police(theme.policeTexte) }}>{libelle}</Text>
      <Text style={{ color: theme.texte, fontSize: tt(13), flexShrink: 1, ...police(theme.policeChiffres) }} selectable>
        {valeur}
      </Text>
    </View>
  );
}

/**
 * « Serveurs » : version EN SERVICE du relais (lue au relais lui-même) et du serveur Esport, depuis quand ils
 * tournent, et l'alerte « n'a pas redémarré » quand deployer.sh a déployé un autre commit depuis.
 */
function Serveurs({ theme, e, relais }: { theme: ThemeHub; e: EtatDeploiement | undefined; relais: EtatVersionRelais | undefined }) {
  const texte = { color: theme.texte, fontSize: tt(13), ...police(theme.policeTexte) };
  const alerte = { color: theme.critique, fontSize: tt(13), ...police(theme.policeTexte) };
  const v = relais?.version;
  const esportDuree = e?.serveur.dureeS ?? (e?.serveur.demarreLe ? Math.round(((Date.parse(e.heure) || Date.now()) - Date.parse(e.serveur.demarreLe)) / 1000) : null);
  return (
    <View style={{ gap: 4 }} testID="maj-serveurs">
      <Text style={[styles.section, { color: theme.attenue }]}>{tm('page.serveurs').toUpperCase()}</Text>
      {!relais ? (
        <Text style={texte}>{tm('page.relais.chargement')}</Text>
      ) : v ? (
        <>
          <Text style={texte} testID="maj-serveur-relais" selectable>
            {tm('page.serveur.ligne', { nom: tm('page.serveur.nom.relais'), commit: court(v.commit), depuis: depuis(v.dureeS) })}
          </Text>
          {v.aJour === false ? (
            <Text style={alerte} testID="maj-serveur-relais-pas-redemarre">
              {tm('page.serveur.pas_redemarre', { nom: tm('page.serveur.nom.relais'), commit: court(v.commit), deploye: court(v.codeDeploye), racine: 'application-enzo/relais', app: 'relais' })}
            </Text>
          ) : null}
        </>
      ) : relais.probleme === 'ancien-relais' ? (
        <Text style={alerte} testID="maj-serveur-relais-ancien">
          {tm('page.relais.ancien')}
        </Text>
      ) : (
        <Text style={alerte} testID="maj-serveur-relais-probleme">
          {tm('page.relais.probleme', { message: relais.message ?? '' })}
        </Text>
      )}
      {e ? (
        <>
          <Text style={texte} testID="maj-serveur-esport" selectable>
            {tm('page.serveur.ligne', { nom: tm('page.serveur.nom.esport'), commit: court(e.serveur.commit), depuis: depuis(esportDuree) })}
          </Text>
          {e.serveur.redemarrageEnAttente ? (
            <Text style={alerte} testID="maj-serveur-esport-pas-redemarre">
              {tm('page.serveur.pas_redemarre', { nom: tm('page.serveur.nom.esport'), commit: court(e.serveur.commit), deploye: court(e.deploiement.codeDeploye), racine: 'application-enzo/esport', app: 'esport' })}
            </Text>
          ) : null}
        </>
      ) : null}
      <Text style={{ color: theme.attenue, fontSize: tt(12), ...police(theme.policeTexte) }} selectable>
        {tm('page.journaux')}
      </Text>
    </View>
  );
}

const avecDate = (commit: string | null | undefined, date: string | null | undefined) => (date ? `${court(commit)} · ${dateCourte(date)}` : court(commit));

function Contenu({ theme, e }: { theme: ThemeHub; e: EtatDeploiement }) {
  const pastille = pastillePour(e);
  const couleur = pastille ? couleurTon(theme, pastille.ton) : theme.attenue;
  const locale = versionLocale();
  const wf = e.github.workflow;
  const texte = { color: theme.texte, fontSize: tt(14), ...police(theme.policeTexte) };
  return (
    <View style={{ gap: 12 }}>
      <View style={[styles.etat, { borderColor: couleur }]} testID={`maj-page-etat-${e.etat}`} accessibilityLiveRegion="polite">
        <Text style={[texte, { fontWeight: '700' }]}>{phraseEtat(e)}</Text>
        {e.deploiement.demandeEnAttente ? <Text style={{ color: theme.attenue, fontSize: tt(13) }}>{tm('page.demande_attente')}</Text> : null}
      </View>

      <Text style={[styles.section, { color: theme.attenue }]}>{tm('page.versions').toUpperCase()}</Text>
      <View style={{ gap: 4 }}>
        {locale ? <Ligne theme={theme} libelle={tm('page.version.app')} valeur={avecDate(locale.commit ?? locale.id, locale.date)} testID="maj-version-app" /> : null}
        <Ligne theme={theme} libelle={tm('page.version.site')} valeur={avecDate(e.site?.commit, e.site?.date)} testID="maj-version-site" />
        <Ligne
          theme={theme}
          libelle={tm('page.version.serveur')}
          valeur={`${court(e.serveur.commit)}${e.serveur.redemarrageEnAttente ? ` (${tm('page.redemarrage_attente')})` : ''}`}
          testID="maj-version-serveur"
        />
        <Ligne theme={theme} libelle={tm('page.version.relais')} valeur={avecDate(e.relais.commit, e.relais.redemarreLe)} testID="maj-version-relais" />
        <Ligne
          theme={theme}
          libelle={tm('page.version.github')}
          valeur={e.github.main ? `${court(e.github.main.sha)} · ${e.github.main.message}` : tm('page.inconnu')}
          testID="maj-version-github"
        />
        <Ligne theme={theme} libelle={tm('page.deploiement')} valeur={dateCourte(e.deploiement.dernierDeploiement)} testID="maj-dernier-deploiement" />
        <Ligne theme={theme} libelle={tm('page.verification')} valeur={ilYa(e.deploiement.derniereVerification, Date.parse(e.heure) || Date.now())} />
      </View>

      <Text style={[styles.section, { color: theme.attenue }]}>{tm('page.github').toUpperCase()}</Text>
      <View style={{ gap: 4 }}>
        {wf ? (
          <Text style={texte} testID="maj-github">
            #{wf.numero ?? '?'} · {court(wf.sha)} · {tm(`page.github.${wf.statut}` as const)}
            {wf.message ? ` · ${wf.message}` : ''}
          </Text>
        ) : (
          <Text style={texte}>{tm('page.etat.inconnu')}</Text>
        )}
        {e.github.erreur === 'limite' ? (
          <Text style={{ color: theme.alerte, fontSize: tt(13) }}>{tm('page.github.limite', { heure: dateCourte(e.github.reessaiLe ?? null) })}</Text>
        ) : e.github.erreur ? (
          <Text style={{ color: theme.alerte, fontSize: tt(13) }}>{tm('page.github.injoignable')}</Text>
        ) : null}
        {wf?.url ? (
          <View style={styles.actions}>
            <BoutonHub theme={theme} titre={`↗︎ ${tm('page.github.voir')}`} onPress={() => void Linking.openURL(wf.url!)} testID="maj-github-voir" />
          </View>
        ) : null}
      </View>

      <Text style={[styles.section, { color: theme.attenue }]}>{tm('page.journal').toUpperCase()}</Text>
      <View style={[styles.journal, { borderColor: theme.ligne }]} testID="maj-journal">
        {e.deploiement.journal.length === 0 ? (
          <Text style={{ color: theme.attenue, fontSize: tt(13) }}>{tm('page.journal.vide')}</Text>
        ) : (
          e.deploiement.journal.map((l, i) => (
            <Text key={`${i}-${l.date}`} style={{ color: l.texte.startsWith('ÉCHEC') ? theme.critique : theme.texte, fontSize: tt(12), ...police(theme.policeChiffres) }} selectable>
              {dateCourte(l.date)} {l.texte}
            </Text>
          ))
        )}
      </View>
    </View>
  );
}

export function PageMisesAJour({ theme, actif = true }: { theme: ThemeHub; actif?: boolean }) {
  useLangue();
  const { etat, erreur, chargement } = useEtatDeploiement(actif);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | undefined>();
  const [demande, setDemande] = useState(false);
  const [relais, setRelais] = useState<EtatVersionRelais | undefined>();
  const lireRelais = useCallback(() => {
    void versionRelais()
      .catch(() => ({ probleme: 'reponse' as const, message: '' }))
      .then(setRelais);
  }, []);
  useEffect(() => {
    if (actif) lireRelais();
  }, [actif, lireRelais]);
  return (
    <View style={{ gap: 12 }} testID="maj-page">
      <Text style={{ color: theme.attenue, fontSize: tt(14), ...police(theme.policeTexte) }}>{tm('page.intro')}</Text>
      {actif ? <Serveurs theme={theme} e={etat} relais={relais} /> : null}
      {etat ? (
        <Contenu theme={theme} e={etat} />
      ) : (
        <Text style={{ color: theme.attenue, fontSize: tt(14) }} testID="maj-page-attente">
          {erreur === 'indisponible' ? tm('page.indisponible') : erreur === 'injoignable' ? tm('page.injoignable') : tm('page.chargement')}
        </Text>
      )}
      <View style={styles.actions}>
        {etat ? (
          <BoutonHub
            theme={theme}
            variante="plein"
            titre={tm('page.verifier')}
            libelle={tm('page.verifier.aide')}
            desactive={demande}
            testID="maj-verifier-maintenant"
            onPress={() => {
              setDemande(true);
              void sondeur.verifierMaintenant().then(r => {
                setDemande(false);
                setMessage(r.ok ? { ok: true, texte: tm('page.verifier.ok') } : { ok: false, texte: tm('page.verifier.echec', { motif: r.motif ?? '' }) });
              });
            }}
          />
        ) : null}
        <BoutonHub
          theme={theme}
          titre={`⟳ ${tm('page.actualiser')}`}
          desactive={chargement}
          onPress={() => {
            void sondeur.rafraichir(true);
            lireRelais();
          }}
          testID="maj-actualiser-etat"
        />
        <BoutonHub theme={theme} titre={tm('page.recharger')} onPress={() => void rechargerProprement()} testID="maj-recharger-app" />
      </View>
      {message ? (
        <Text accessibilityLiveRegion="polite" style={{ color: message.ok ? theme.ok : theme.critique, fontSize: tt(13) }} testID="maj-message">
          {message.texte}
        </Text>
      ) : null}
    </View>
  );
}

/** Paramètres › À propos : « Mettre à jour automatiquement » (cet appareil ; activé par défaut). */
export function ReglageMajAuto({ theme }: { theme: ThemeHub }) {
  useLangue();
  const actif = useSyncExternalStore(abonnerMajAuto, () => majAutoActive(), () => true);
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: theme.attenue, fontSize: tt(14), ...police(theme.policeTexte) }}>{tm('reglage.aide')}</Text>
      <View style={styles.actions} accessibilityRole="radiogroup">
        {[true, false].map(v => (
          <BoutonHub
            key={String(v)}
            theme={theme}
            variante={actif === v ? 'plein' : 'normal'}
            titre={v ? tm('reglage.oui') : tm('reglage.non')}
            onPress={() => definirMajAuto(v)}
            testID={`maj-auto-${v ? 'oui' : 'non'}`}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  etat: { borderLeftWidth: 4, paddingVertical: 6, paddingHorizontal: 12, gap: 4 },
  section: { fontSize: 11, fontWeight: '700', letterSpacing: 1.1, marginTop: 4 },
  ligne: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  journal: { borderWidth: 1, borderRadius: 8, padding: 10, gap: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
});
