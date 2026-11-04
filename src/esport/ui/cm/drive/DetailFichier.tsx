/**
 * Volet d'un fichier du Drive : aperçu (image, vidéo, audio, police, texte, PDF), infos (type, taille,
 * dimensions, durée, auteur, dates, emplacement, origine), étiquettes, versions (télécharger, restaurer,
 * supprimer une ancienne), utilisations (cartes CM, visuels, sponsors), actions.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub, Champ } from '../../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../../hub/themes';
import { dureeLisible, lienInterneDrive, type ApiDrive, type DetailFichierDrive } from '../../../cm/drive';
import { choisirFichier, choixFichierDisponible } from '../../../medias/choixFichier';
import { tr } from '../../../i18n';
import { trDr, trnDr, type CleDr } from '../../../i18n/drive';
import { BoutonConfirme, Intertitre, Panneau, Retours, styles, useAgir } from '../../commun';
import { Badge, ESP, Volet, attenue, texte } from '../../design';
import { BarreEnvoi, useEnvoi } from '../../medias/EnvoiMedia';
import { ouvrirLienDiffere } from '../../ouvrirLien';
import { copierTexte, quand } from '../commun';
import { ApercuDrive } from './ApercuDrive';
import { infosFichier, nomDossier, nomGenre, taille } from './commun';

export function DetailFichier({
  theme,
  api,
  id,
  onFermer,
  onChange,
  onDeplacer,
  onCopier,
  onOuvrirCarte,
}: {
  theme: ThemeHub;
  api: ApiDrive;
  id: string | undefined;
  onFermer(): void;
  /** Le fichier a changé (nom, version, corbeille) : la liste se recharge. */
  onChange(): void;
  onDeplacer(id: string): void;
  onCopier(id: string): void;
  onOuvrirCarte?(tableauId: string): void;
}) {
  const [d, setD] = useState<DetailFichierDrive | undefined>();
  const [nom, setNom] = useState('');
  const [tags, setTags] = useState('');
  const envoi = useEnvoi();
  const { erreur, avis, agir, setAvis } = useAgir();
  const charger = useCallback(async () => {
    if (!id) return;
    const x = await api.detail(id);
    setD(x);
    setNom(x.fichier.nom);
    setTags(x.fichier.tags.join(', '));
  }, [api, id]);
  useEffect(() => {
    setD(undefined);
    void agir('', charger);
  }, [agir, charger]);
  const obtenirUrl = useCallback(async () => (await api.lien(id ?? '', {})).url, [api, id]);
  if (!id) return null;
  const f = d?.fichier;
  const modifier = Boolean(d?.droits.modifier) && !f?.supprimeLe;
  const faire = (cle: string, action: () => Promise<unknown>, message?: string) =>
    agir(cle, async () => {
      await action();
      await charger();
      onChange();
      return message;
    });
  const telecharger = (version?: number) => void ouvrirLienDiffere(async () => (await api.lien(id, { telecharger: true, version })).url);
  const remplacer = () =>
    agir('version', async () => {
      const fichier = await choisirFichier('', 'esport-drive-version-fichier');
      if (!fichier || !f) return undefined;
      const { etat, oublier } = await envoi.lancer({ client: api.client, teamId: f.portee, section: 'drive', fichier });
      const x = await api.nouvelleVersion(id, etat.id, f.version);
      oublier();
      envoi.effacer();
      setD(x);
      setNom(x.fichier.nom);
      onChange();
      return trDr('action.fait');
    });
  const lienInterne = async () => {
    const lien = lienInterneDrive(id);
    setAvis((await copierTexte(lien)) ? trDr('action.lien_copie') : trDr('action.lien_non_copie', { lien }));
  };
  const ligne = (cle: CleDr, valeur: string) =>
    valeur ? (
      <View style={[styles.ligne, { gap: ESP.xs }]}>
        <Text style={{ ...attenue(theme, 13), minWidth: 110 }}>{trDr(cle)}</Text>
        <Text selectable style={{ ...texte(theme, 13), flex: 1 }}>
          {valeur}
        </Text>
      </View>
    ) : null;
  const nomDe = (c: string | null) => (c ? (d?.noms[c] ?? (c === 'principal' ? tr('jr.fondateur') : tr('jr.compte_supprime'))) : tr('jr.compte_supprime'));

  return (
    <Volet theme={theme} visible titre={f?.nom ?? trDr('detail.titre')} onFermer={onFermer} testID="esport-drive-detail" largeur={620}>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-drive-detail" />
      {f && d ? (
        <>
          <ApercuDrive theme={theme} fichier={f} obtenirUrl={obtenirUrl} />
          <View style={[styles.ligne, { gap: ESP.xs }]}>
            <BoutonHub theme={theme} titre={trDr('action.telecharger')} variante="plein" onPress={() => telecharger()} testID="esport-drive-detail-telecharger" />
            {!f.supprimeLe ? <BoutonHub theme={theme} titre={f.favori ? trDr('action.retirer_favori') : trDr('action.favori')} onPress={() => void faire('favori', () => api.favori('fichier', f.id, !f.favori))} testID="esport-drive-detail-favori" /> : null}
            {!f.supprimeLe ? <BoutonHub theme={theme} titre={trDr('action.lien_interne')} onPress={() => void lienInterne()} testID="esport-drive-detail-lien" /> : null}
            {modifier && !f.ressource ? <BoutonHub theme={theme} titre={trDr('action.deplacer')} onPress={() => onDeplacer(f.id)} testID="esport-drive-detail-deplacer" /> : null}
            {!f.supprimeLe && d.droits.envoyer && !f.ressource ? <BoutonHub theme={theme} titre={trDr('action.copier')} onPress={() => onCopier(f.id)} testID="esport-drive-detail-copier" /> : null}
            {modifier && choixFichierDisponible ? <BoutonHub theme={theme} titre={trDr('action.nouvelle_version')} desactive={envoi.enCours} onPress={() => void remplacer()} testID="esport-drive-detail-version" /> : null}
          </View>
          <BarreEnvoi theme={theme} progression={envoi.progression} enCours={envoi.enCours} onAnnuler={envoi.annuler} testID="esport-drive-detail-envoi" />

          <Panneau theme={theme} testID="esport-drive-detail-infos">
            <Intertitre theme={theme}>{trDr('detail.infos')}</Intertitre>
            {ligne('detail.type', `${nomGenre(f.genre)} · ${f.meta.nomFormat ?? f.type}`)}
            {ligne('detail.taille', taille(f.taille))}
            {ligne('detail.dimensions', f.meta.largeur && f.meta.hauteur ? `${f.meta.largeur} × ${f.meta.hauteur} px` : '')}
            {ligne('detail.duree', f.meta.duree ? dureeLisible(f.meta.duree) : '')}
            {ligne('detail.codecs', [f.meta.codecVideo, f.meta.codecAudio].filter(Boolean).join(' · '))}
            {ligne('detail.auteur', nomDe(f.creePar))}
            {ligne('detail.ajoute_le', quand(f.creeLe))}
            {ligne('detail.modifie_le', f.majLe !== f.creeLe ? quand(f.majLe) : '')}
            {ligne('detail.emplacement', [trDr('racine'), ...d.chemin.map(nomDossier)].join(' › '))}
            {ligne('detail.origine', trDr(`origine.${f.origine}` as CleDr))}
          </Panneau>

          {modifier ? (
            <Panneau theme={theme}>
              <Champ theme={theme} libelle={trDr('dialogue.nom')} valeur={nom} onChanger={setNom} maxLength={140} testID="esport-drive-detail-nom" />
              {nom.trim() && nom !== f.nom ? <BoutonHub theme={theme} titre={trDr('action.renommer')} onPress={() => void faire('nom', () => api.modifier(f.id, { nom: nom.trim() }), trDr('action.fait'))} testID="esport-drive-detail-nom-ok" /> : null}
              <Champ theme={theme} libelle={`${trDr('detail.tags')} — ${trDr('detail.tags_aide')}`} valeur={tags} onChanger={setTags} maxLength={400} testID="esport-drive-detail-tags" />
              {tags !== f.tags.join(', ') ? (
                <BoutonHub
                  theme={theme}
                  titre={trDr('dialogue.enregistrer')}
                  onPress={() => void faire('tags', () => api.modifier(f.id, { tags: tags.split(',').map(t => t.trim()).filter(Boolean) }), trDr('action.fait'))}
                  testID="esport-drive-detail-tags-ok"
                />
              ) : null}
            </Panneau>
          ) : (
            <>
              {f.tags.length ? (
                <View style={[styles.ligne, { gap: 4 }]}>
                  {f.tags.map(t => (
                    <Badge key={t} theme={theme} texte={`#${t}`} />
                  ))}
                </View>
              ) : null}
              {!f.supprimeLe ? <Text style={attenue(theme, 12)}>{trDr('detail.lecture_seule')}</Text> : null}
            </>
          )}

          <Panneau theme={theme} testID="esport-drive-detail-versions">
            <Intertitre theme={theme}>{trDr('detail.versions')}</Intertitre>
            {d.versions.map(v => (
              <View key={v.version} style={[styles.ligne, { gap: ESP.xs, justifyContent: 'space-between' }]} testID={`esport-drive-version-${v.version}`}>
                <View style={{ flex: 1, minWidth: 160 }}>
                  <Text style={{ ...texte(theme, 13), fontWeight: v.actuelle ? '700' : '500' }} numberOfLines={1}>{`${trDr('detail.version', { n: v.version })}${v.actuelle ? ` · ${trDr('detail.actuelle')}` : ''} · ${v.nom}`}</Text>
                  <Text style={attenue(theme, 12)}>{`${taille(v.taille)} · ${nomDe(v.creePar)} · ${quand(v.creeLe)}`}</Text>
                </View>
                <BoutonHub theme={theme} titre="⤓" libelle={`${trDr('action.telecharger')} ${trDr('detail.version', { n: v.version })}`} onPress={() => telecharger(v.version)} testID={`esport-drive-version-${v.version}-telecharger`} />
                {modifier && !v.actuelle ? <BoutonHub theme={theme} titre={trDr('detail.restaurer')} onPress={() => void faire('restaurer', () => api.restaurerVersion(f.id, v.version), trDr('action.fait'))} testID={`esport-drive-version-${v.version}-restaurer`} /> : null}
                {d.droits.gerer && !v.actuelle ? (
                  <BoutonConfirme theme={theme} titre={trDr('detail.supprimer')} confirmation={trDr('corbeille.confirmer')} onConfirme={() => void faire('supprimer', () => api.supprimerVersion(f.id, v.version))} testID={`esport-drive-version-${v.version}-supprimer`} />
                ) : null}
              </View>
            ))}
          </Panneau>

          <Panneau theme={theme}>
            <Intertitre theme={theme}>{trDr('detail.utilisations')}</Intertitre>
            {!d.utilisations.cartes.length && !d.utilisations.visuels && !d.utilisations.sponsors ? <Text style={attenue(theme)}>{trDr('detail.utilisations_aucune')}</Text> : null}
            {d.utilisations.cartes.length ? <Text style={texte(theme, 13)}>{trnDr('detail.utilisations_cartes', d.utilisations.cartes.length)}</Text> : null}
            {d.utilisations.cartes.slice(0, 8).map(c =>
              onOuvrirCarte ? <BoutonHub key={c.id} theme={theme} titre={c.titre} onPress={() => onOuvrirCarte(c.tableauId)} testID={`esport-drive-detail-carte-${c.id}`} /> : <Text key={c.id} style={attenue(theme, 12)}>{`· ${c.titre}`}</Text>,
            )}
            {d.utilisations.visuels ? <Text style={texte(theme, 13)}>{trDr('detail.utilisations_visuels', { n: d.utilisations.visuels })}</Text> : null}
            {d.utilisations.sponsors ? <Text style={texte(theme, 13)}>{trDr('detail.utilisations_sponsors', { n: d.utilisations.sponsors })}</Text> : null}
          </Panneau>

          {modifier && !f.ressource ? (
            <BoutonConfirme
              theme={theme}
              titre={trDr('action.corbeille')}
              confirmation={trDr('action.corbeille')}
              onConfirme={() =>
                void agir('corbeille', async () => {
                  await api.corbeilleFichier(f.id);
                  onChange();
                  onFermer();
                })
              }
              testID="esport-drive-detail-corbeille"
            />
          ) : null}
          <Text style={attenue(theme, 12)}>{infosFichier(f)}</Text>
        </>
      ) : null}
    </Volet>
  );
}
