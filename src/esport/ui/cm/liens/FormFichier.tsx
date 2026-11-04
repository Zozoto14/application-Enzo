/**
 * Ajouter des FICHIERS à DATA › Ressources (volet, migration 0051, docs/esport/cm.md « Fichiers ») :
 *  - « Depuis l'appareil » : choix de plusieurs fichiers ou glisser-déposer (site et app PC) ; chaque fichier part par
 *    morceaux avec reprise (barre de progression) et devient UNE ressource, titrée d'après son nom (titre saisi seulement
 *    pour un fichier seul). Le serveur les range dans le dossier « Ressources » du Drive du club (quota du Drive, types
 *    vérifiés par les octets) ;
 *  - « Depuis un Drive » : sélecteur du Drive (choix du Drive) ; rien n'est copié, la ressource suit sa source.
 * Description, étiquette, team, épinglage et « Qui voit la ressource » : comme pour un lien (useChampsRessource).
 */

import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BoutonHub, Champ, Segments } from '../../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../../hub/themes';
import type { ClientEsport } from '../../../client';
import { GLYPHES_DRIVE, type FichierDrive } from '../../../cm/drive';
import type { ApiLiens, ListeLiens } from '../../../cm/liens';
import { choisirFichiers, choixFichierDisponible, type FichierNavigateur } from '../../../medias/choixFichier';
import { tailleMedia } from '../../../medias/envoi';
import { langueCourante } from '../../../i18n';
import { trLi, trnLi } from '../../../i18n/liens';
import { Icone } from '../../../../ui/icones';
import { Retours, styles, useAgir } from '../../commun';
import { ESP, Volet, attenue, texte } from '../../design';
import { BarreEnvoi, useEnvoi } from '../../medias/EnvoiMedia';
import { ChoixDrive } from '../drive/ChoixDrive';
import { ZoneDepot } from '../drive/ZoneDepot';
import { infosFichier } from '../drive/commun';
import { useChampsRessource } from './FormLien';

/** Portée d'envoi des fichiers de DATA › Ressources (rangés par le serveur dans le dossier « Ressources » du Drive du club). */
export const PORTEE_ENVOI_RESSOURCES = 'ressources';

type Mode = 'appareil' | 'drive';

export function FormFichier({
  theme,
  client,
  api,
  liste,
  onFini,
  onFermer,
  prefixe = 'esport-cm-fichiers-form',
}: {
  theme: ThemeHub;
  client: ClientEsport;
  api: ApiLiens;
  liste: Pick<ListeLiens, 'categories' | 'teams'>;
  /** Des ressources ont été créées (la liste se recharge). */
  onFini(): Promise<void> | void;
  onFermer(): void;
  prefixe?: string;
}) {
  const [mode, setMode] = useState<Mode>(choixFichierDisponible ? 'appareil' : 'drive');
  const [fichiers, setFichiers] = useState<FichierNavigateur[]>([]);
  const [duDrive, setDuDrive] = useState<FichierDrive | undefined>();
  const [choixDrive, setChoixDrive] = useState(false);
  const [titre, setTitre] = useState('');
  const [file, setFile] = useState<{ i: number; n: number; nom: string } | undefined>();
  const envoi = useEnvoi();
  const { erreur, avis, agir, setErreur } = useAgir();
  const champs = useChampsRessource({ theme, categories: liste.categories, teams: liste.teams, optionsAcces: teamId => api.optionsAcces(teamId), prefixe });
  const l = langueCourante();

  const ajouterFichiers = (f: FichierNavigateur[]) => setFichiers(avant => [...avant, ...f.filter(x => !avant.some(y => y.nom === x.nom && y.taille === x.taille))]);
  const n = mode === 'drive' ? (duDrive ? 1 : 0) : fichiers.length;
  const seul = n === 1;

  const envoyer = () =>
    agir('fichiers', async () => {
      if (!n) {
        setErreur(trLi('ff.aucun'));
        return undefined;
      }
      const communs = { genre: 'fichier' as const, ...champs.valeurs(), ...(seul && titre.trim() ? { titre: titre.trim() } : {}) };
      if (mode === 'drive' && duDrive) {
        await api.creer({ ...communs, elementId: duDrive.id });
        await onFini();
        onFermer();
        return undefined;
      }
      // Un fichier après l'autre : chacun devient une ressource ; un refus n'arrête pas les suivants (sauf espace plein).
      const refuses: string[] = [];
      const restants: FichierNavigateur[] = [];
      let ajoutes = 0;
      for (let i = 0; i < fichiers.length; i++) {
        const f = fichiers[i];
        setFile({ i: i + 1, n: fichiers.length, nom: f.nom });
        try {
          const { etat, oublier } = await envoi.lancer({ client, teamId: PORTEE_ENVOI_RESSOURCES, section: 'drive', fichier: f });
          await api.creer({ ...communs, envoi: etat.id });
          oublier();
          ajoutes++;
        } catch (e) {
          const code = (e as { code?: string }).code;
          if (code === 'annule') {
            restants.push(...fichiers.slice(i));
            break;
          }
          restants.push(f);
          refuses.push(`${f.nom} : ${e instanceof Error ? e.message : String(e)}`);
          if (code === 'quota-drive') {
            restants.push(...fichiers.slice(i + 1));
            break;
          }
        }
      }
      setFile(undefined);
      envoi.effacer();
      if (ajoutes) await onFini();
      if (!refuses.length && !restants.length) {
        onFermer();
        return undefined;
      }
      // Les fichiers non ajoutés restent dans la liste (nouvel essai possible).
      setFichiers(restants);
      if (refuses.length) setErreur(trLi('ff.echecs', { n: refuses.length, liste: refuses.join(' · ') }));
      return ajoutes ? trnLi('ff.fini', ajoutes) : undefined;
    });

  return (
    <Volet theme={theme} visible titre={trLi('ff.titre_volet')} onFermer={onFermer} testID={`${prefixe}-volet`} largeur={520}>
      <View style={{ gap: ESP.s, padding: ESP.l }}>
        <Retours theme={theme} erreur={erreur} avis={avis} prefixe={prefixe} />
        <Segments<Mode>
          theme={theme}
          libelle={trLi('ff.source')}
          valeur={mode}
          options={[
            ['appareil', trLi('ff.depuis_appareil')],
            ['drive', trLi('ff.depuis_drive')],
          ]}
          onChoisir={setMode}
          testID={`${prefixe}-mode`}
        />
        {mode === 'appareil' ? (
          choixFichierDisponible ? (
            <ZoneDepot theme={theme} actif={!envoi.enCours} onFichiers={ajouterFichiers} testID={`${prefixe}-zone`}>
              <View style={{ gap: ESP.xs, borderWidth: 1, borderStyle: 'dashed', borderColor: theme.ligne, borderRadius: 12, padding: ESP.m, alignItems: 'flex-start' }}>
                <Text style={attenue(theme, 13)}>{trLi('ff.deposer')}</Text>
                <BoutonHub theme={theme} titre={trLi('ff.choisir')} icone="trombone" desactive={envoi.enCours} onPress={() => void choisirFichiers('', `${prefixe}-champ`).then(ajouterFichiers)} testID={`${prefixe}-choisir`} />
                {fichiers.length ? (
                  <Text style={attenue(theme, 12)} testID={`${prefixe}-n`}>
                    {trnLi('ff.choisis', fichiers.length)}
                  </Text>
                ) : null}
                {fichiers.map(f => (
                  <View key={`${f.nom}-${f.taille}`} style={[styles.ligne, { gap: ESP.xs, flexWrap: 'nowrap', alignSelf: 'stretch' }]}>
                    <Icone nom="document" taille={16} couleur={theme.attenue} />
                    <Text style={{ ...texte(theme, 13), flex: 1, minWidth: 0 }} numberOfLines={1}>
                      {`${f.nom} · ${tailleMedia(f.taille, l)}`}
                    </Text>
                    {!envoi.enCours ? <BoutonHub theme={theme} titre="×" libelle={trLi('ff.retirer', { nom: f.nom })} onPress={() => setFichiers(x => x.filter(y => y !== f))} testID={`${prefixe}-retirer-${f.nom}`} /> : null}
                  </View>
                ))}
              </View>
            </ZoneDepot>
          ) : (
            <Text style={attenue(theme, 13)} testID={`${prefixe}-natif`}>
              {trLi('ff.natif')}
            </Text>
          )
        ) : (
          <View style={{ gap: ESP.xs }}>
            {duDrive ? (
              <Pressable accessibilityRole="button" accessibilityLabel={trLi('ff.changer')} onPress={() => setChoixDrive(true)} style={[styles.ligne, { gap: ESP.xs, flexWrap: 'nowrap' }]} testID={`${prefixe}-drive-choisi`}>
                <Icone nom={GLYPHES_DRIVE[duDrive.genre]} taille={18} couleur={theme.accent} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ ...texte(theme, 14), fontWeight: '700' }} numberOfLines={1}>
                    {duDrive.nom}
                  </Text>
                  <Text style={attenue(theme, 12)} numberOfLines={1}>
                    {infosFichier(duDrive)}
                  </Text>
                </View>
              </Pressable>
            ) : null}
            <BoutonHub theme={theme} titre={duDrive ? trLi('ff.changer') : trLi('ff.choisir_drive')} icone="dossier" onPress={() => setChoixDrive(true)} testID={`${prefixe}-drive`} />
            <Text style={attenue(theme, 12)}>{trLi('ff.aide_drive')}</Text>
          </View>
        )}
        {mode === 'appareil' ? <Text style={attenue(theme, 12)}>{trLi('ff.aide_stockage')}</Text> : null}
        {seul ? (
          <Champ theme={theme} libelle={trLi('ff.titre')} valeur={titre} onChanger={setTitre} maxLength={120} placeholder={mode === 'drive' ? duDrive?.nom : fichiers[0]?.nom} testID={`${prefixe}-titre`} />
        ) : n > 1 ? (
          <Text style={attenue(theme, 12)}>{trLi('ff.titre_plusieurs')}</Text>
        ) : null}
        {champs.rendu}
        {file ? (
          <Text style={attenue(theme, 13)} testID={`${prefixe}-file`}>
            {trLi('ff.envoi', file)}
          </Text>
        ) : null}
        <BarreEnvoi theme={theme} progression={envoi.progression} enCours={envoi.enCours} onAnnuler={envoi.annuler} testID={`${prefixe}-envoi`} />
        <View style={[styles.ligne, { gap: ESP.xs }]}>
          <BoutonHub theme={theme} titre={n > 1 ? trLi('ff.ajouter_n', { n }) : trLi('ff.ajouter')} variante="plein" desactive={envoi.enCours || !n} onPress={() => void envoyer()} testID={`${prefixe}-ok`} />
          <BoutonHub theme={theme} titre={trLi('form.annuler')} onPress={onFermer} testID={`${prefixe}-annuler`} />
        </View>
      </View>
      <ChoixDrive
        theme={theme}
        client={client}
        visible={choixDrive}
        aide={trLi('ff.aide_drive')}
        onChoisir={f => {
          setDuDrive(f);
          setChoixDrive(false);
        }}
        onFermer={() => setChoixDrive(false)}
        testID={`${prefixe}-choix-drive`}
      />
    </Volet>
  );
}
