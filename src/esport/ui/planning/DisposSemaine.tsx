/**
 * Disponibilités semaine par semaine (migration 0062, docs/esport/planning.md) : pour un membre dont le planning
 * change d'une semaine à l'autre. La semaine type (créneaux récurrents) reste le modèle ; une semaine
 * personnalisée la remplace pour ses sept jours.
 *
 * Choix de la semaine (précédente, cette semaine, suivante, date, bandeau des semaines à venir avec un repère sur
 * celles qui sont personnalisées) ; édition des créneaux de la semaine ; « Copier depuis le modèle », « Copier la
 * semaine précédente », « Revenir au modèle », « Appliquer aux N semaines suivantes ». Le staff qui gère le planning
 * peut choisir un autre membre. Verrou optimiste : la version lue part avec chaque écriture (409 → relecture).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub } from '../../../hub/admin/ui/commun';
import { police, teinteTransparente, type ThemeHub } from '../../../hub/themes';
import { ErreurEsport } from '../../client';
import type { apiPlanning, RegleDispo, SemaineDispos } from '../../planning/api';
import { ajouterJours, aujourdhui, dateCourteJour, dateValide, libelleSemaine, lundiDe, nomFuseau } from '../../planning/libelles';
import { BoutonConfirme, Intertitre, Panneau, Retours, styles, useAgir } from '../commun';
import { Pastille } from './commun';
import { EditeurCreneaux } from './EditeurCreneaux';
import { tr } from '../../i18n';
import { ChampDate } from '../../../ui/dates';

/** Semaines montrées dans le bandeau (à partir de la semaine affichée, ou de la semaine en cours). */
const BANDEAU = 6;
const CHOIX_APPLIQUER = [1, 2, 3, 4, 8] as const;

export function MaSemaine({
  theme,
  api,
  fuseau,
  relire = 0,
  onChange,
}: {
  theme: ThemeHub;
  api: ReturnType<typeof apiPlanning>;
  fuseau: string;
  /** Compteur de relecture (temps réel : modifié ailleurs). */
  relire?: number;
  /** Après une écriture (la page relit la semaine en cours et la heatmap). */
  onChange?(): void;
}) {
  const [qui, setQui] = useState('moi');
  const [moi, setMoi] = useState<string | undefined>();
  const [semaine, setSemaine] = useState(() => lundiDe(aujourdhui(fuseau)));
  const [d, setD] = useState<SemaineDispos | undefined>();
  const [aller, setAller] = useState('');
  const [n, setN] = useState<number>(1);
  const { enCours, erreur, avis, agir } = useAgir();

  const charger = useCallback(async () => {
    const r = await api.semaine(qui, semaine);
    setD(r);
    if (r.soi) setMoi(r.compte);
  }, [api, qui, semaine]);
  useEffect(() => {
    void agir('', charger);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agir, charger, relire]);

  /** Écriture : la réponse est la semaine relue ; un 409 (modifiée ailleurs) relit et le dit. */
  const ecrire = async (action: () => Promise<SemaineDispos>, reussite: string): Promise<string> => {
    try {
      setD(await action());
      onChange?.();
      return reussite;
    } catch (e) {
      if (e instanceof ErreurEsport && e.statut === 409) {
        await charger().catch(() => undefined);
        throw new Error(tr('planning.semaine.conflit'));
      }
      throw e;
    }
  };

  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  const courant = d?.cetteSemaine ?? lundiDe(aujourdhui(fuseau));
  const debutBandeau = semaine < courant ? semaine : courant;
  const bandeau = Array.from({ length: BANDEAU }, (_, i) => ajouterJours(debutBandeau, 7 * i));
  const autres = (d?.membres ?? []).filter(m => m.compte !== moi);
  const libellesJours = Array.from({ length: 7 }, (_, i) => dateCourteJour(ajouterJours(semaine, i)));
  const perso = Boolean(d?.personnalisee);
  const editable = Boolean(d?.modifiable);

  return (
    <Panneau theme={theme} testID="esport-semaine">
      <Intertitre theme={theme}>{tr('planning.semaine.titre')}</Intertitre>
      <Text style={attenue}>{tr('planning.semaine.explication')}</Text>

      {autres.length ? (
        <View style={{ gap: 6 }} testID="esport-semaine-membres">
          <Text style={attenue}>{tr('planning.semaine.membre')}</Text>
          <View style={styles.ligne}>
            <Pastille theme={theme} actif={qui === 'moi'} libelle={tr('planning.semaine.moi')} role="radio" onPress={() => setQui('moi')} testID="esport-semaine-membre-moi" />
            {autres.map(m => (
              <Pastille key={m.compte} theme={theme} actif={qui === m.compte} libelle={m.pseudo} role="radio" onPress={() => setQui(m.compte)} testID={`esport-semaine-membre-${m.compte}`} />
            ))}
          </View>
        </View>
      ) : null}

      {/* Navigation : semaine précédente / cette semaine / suivante, puis aller à une date. */}
      <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
        <View style={styles.ligne}>
          <BoutonHub theme={theme} titre="" icone="precedent" libelle={tr('planning.disponibilites.semaine_precedente')} onPress={() => setSemaine(s => ajouterJours(s, -7))} testID="esport-semaine-precedente" />
          <BoutonHub theme={theme} titre={tr('planning.semaine.cette_semaine')} icone="calendrier" desactive={semaine === courant} onPress={() => setSemaine(courant)} testID="esport-semaine-courante" />
          <BoutonHub theme={theme} titre="" icone="suivant" libelle={tr('planning.disponibilites.semaine_suivante')} onPress={() => setSemaine(s => ajouterJours(s, 7))} testID="esport-semaine-suivante" />
        </View>
        <View style={styles.ligne}>
          <ChampDate theme={theme} libelle={tr('planning.semaine.aller_au')} valeur={aller} onChanger={setAller} style={{ width: 190, maxWidth: '100%' }} testID="esport-semaine-date" />
          <BoutonHub
            theme={theme}
            titre={tr('planning.semaine.aller')}
            desactive={!dateValide(aller)}
            onPress={() => {
              if (dateValide(aller)) setSemaine(lundiDe(aller));
            }}
            testID="esport-semaine-aller"
          />
        </View>
      </View>

      {/* Bandeau des semaines : un repère (point plein + « Perso ») sur les semaines personnalisées. */}
      <View style={styles.ligne} testID="esport-semaine-bandeau">
        {bandeau.map(l => {
          const p = Boolean(d?.personnalisees.includes(l));
          const actif = l === semaine;
          return (
            <BoutonHub
              key={l}
              theme={theme}
              titre={`${l.slice(8, 10)}/${l.slice(5, 7)}${p ? ` · ${tr('planning.semaine.perso')}` : ''}`}
              libelle={`${libelleSemaine(l)}${p ? ` (${tr('planning.semaine.personnalisee')})` : ''}`}
              variante={actif ? 'plein' : undefined}
              onPress={() => setSemaine(l)}
              testID={`esport-semaine-bandeau-${l}${p ? '-perso' : ''}`}
            />
          );
        })}
      </View>

      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-semaine" />

      {d ? (
        <View style={{ gap: 10 }}>
          <View
            testID={perso ? 'esport-semaine-etat-perso' : 'esport-semaine-etat-modele'}
            style={{
              gap: 4,
              padding: 10,
              borderRadius: 10,
              borderWidth: perso ? 2 : 1,
              borderColor: perso ? theme.accent : theme.ligne,
              backgroundColor: perso ? teinteTransparente(theme.accent, 0.1) : 'transparent',
            }}>
            <Text style={{ color: theme.texte, fontWeight: '700', fontSize: 15, ...police(theme.policeTexte) }} testID="esport-semaine-libelle">
              {libelleSemaine(d.semaine)}
              {d.semaine === d.cetteSemaine ? ` · ${tr('planning.semaine.en_cours')}` : ''}
            </Text>
            <Text style={{ color: perso ? theme.accent : theme.attenue, fontWeight: '600', fontSize: 13, ...police(theme.policeTexte) }}>
              {perso ? tr('planning.semaine.etat_perso') : tr('planning.semaine.etat_modele')}
            </Text>
            {!d.soi && d.pseudo ? <Text style={attenue}>{tr('planning.semaine.pour', { v: d.pseudo })}</Text> : null}
            {perso && d.majPar ? <Text style={attenue}>{tr('planning.semaine.modifiee_par', { v: d.majPar })}</Text> : null}
            <Text style={attenue}>{tr('planning.disponibilites.heures_de_elles_suivent', { v: nomFuseau(d.fuseau) })}</Text>
            {!editable ? <Text style={attenue} testID="esport-semaine-lecture-seule">{tr('planning.semaine.lecture_seule')}</Text> : null}
          </View>

          <EditeurCreneaux
            theme={theme}
            regles={d.regles}
            cle={`${d.compte}|${d.semaine}|${d.version}|${d.personnalisee}`}
            libellesJours={libellesJours}
            prefixe="esport-semaine-creneau"
            lectureSeule={!editable}
            toujoursEnregistrable={!perso}
            titreEnregistrer={tr('planning.semaine.enregistrer')}
            avisEnregistre={tr('planning.semaine.enregistree')}
            onEnregistrer={async (regles: RegleDispo[]) => {
              await ecrire(() => api.enregistrerSemaine(qui, d.semaine, { regles, fuseau: d.fuseau, versionAttendue: d.version }), '');
            }}
          />

          {editable ? (
            <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: 10 }} testID="esport-semaine-actions">
              <View style={styles.ligne}>
                <BoutonHub
                  theme={theme}
                  titre={tr('planning.semaine.copier_modele')}
                  icone="document"
                  desactive={Boolean(enCours)}
                  onPress={() => void agir('modele', () => ecrire(() => api.enregistrerSemaine(qui, d.semaine, { copier: 'modele', versionAttendue: d.version }), tr('planning.semaine.copie_modele_faite')))}
                  testID="esport-semaine-copier-modele"
                />
                <BoutonHub
                  theme={theme}
                  titre={tr('planning.semaine.copier_precedente')}
                  icone="synchro"
                  libelle={tr('planning.semaine.copier_precedente_libelle', { v: libelleSemaine(d.precedente.semaine) })}
                  desactive={Boolean(enCours)}
                  onPress={() => void agir('precedente', () => ecrire(() => api.enregistrerSemaine(qui, d.semaine, { copier: 'precedente', versionAttendue: d.version }), tr('planning.semaine.copie_precedente_faite')))}
                  testID="esport-semaine-copier-precedente"
                />
                {perso ? (
                  <BoutonConfirme
                    theme={theme}
                    titre={tr('planning.semaine.reinitialiser')}
                    confirmation={tr('planning.semaine.reinitialiser_confirmer')}
                    onConfirme={() => void agir('reinit', () => ecrire(() => api.reinitialiserSemaine(qui, d.semaine, d.version), tr('planning.semaine.reinitialisee')))}
                    testID="esport-semaine-reinitialiser"
                  />
                ) : null}
              </View>
              <Text style={attenue}>{tr('planning.semaine.appliquer_explication')}</Text>
              <View style={styles.ligne}>
                {CHOIX_APPLIQUER.filter(x => x <= d.appliquerMax).map(x => (
                  <Pastille key={x} theme={theme} actif={n === x} libelle={String(x)} role="radio" onPress={() => setN(x)} testID={`esport-semaine-appliquer-${x}`} />
                ))}
                <BoutonConfirme
                  theme={theme}
                  titre={tr('planning.semaine.appliquer', { n })}
                  confirmation={tr('planning.semaine.appliquer_confirmer', { n })}
                  onConfirme={() =>
                    void agir('appliquer', () => ecrire(() => api.appliquerSemaine(qui, d.semaine, n), tr('planning.semaine.appliquee', { n })))
                  }
                  testID="esport-semaine-appliquer"
                />
              </View>
            </View>
          ) : null}
        </View>
      ) : null}
    </Panneau>
  );
}
