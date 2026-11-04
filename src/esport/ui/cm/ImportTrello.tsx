/**
 * Import d'un tableau Trello (section CM, cm.gerer) : 1. choisir l'export JSON (Trello › Menu ⋯ › Imprimer,
 * exporter et partager › Exporter au format JSON) ; 2. aperçu (listes, cartes, étiquettes, checklists,
 * commentaires, pièces jointes) et correspondance des membres Trello avec les comptes de l'app ; 3. import.
 * Relancer l'import du même tableau le met à jour sans rien dupliquer. Aucune requête vers Trello : le fichier
 * est lu ici et analysé par le serveur ; les fichiers déposés sur Trello restent des liens vers Trello.
 */

import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub, Case } from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import { PORTEE_CLUB, type ApiCm, type ApercuTrello, type ResultatImport, type TeamCm } from '../../cm/api';
import { ACCEPT_JSON, choisirFichier, choixFichierDisponible } from '../../medias/choixFichier';
import { cleLibelleUrgence } from '../../cm/urgence';
import { trCm, trnCm } from '../../i18n/cm';
import { Choix, Retours, styles, useAgir } from '../commun';
import { Carte, ESP, TitreCarte, attenue, texte } from '../design';
import { Aide } from './commun';

/** Taille maximale de l'export accepté (le serveur refuse au-delà). */
export const TAILLE_MAX_EXPORT = 15 * 1024 * 1024;

export function ImportTrello({ theme, api, onOuvrir }: { theme: ThemeHub; api: ApiCm; large: boolean; onOuvrir(tableauId: string): void }) {
  const [portees, setPortees] = useState<Array<{ portee: string; team: TeamCm | null }> | undefined>();
  const [portee, setPortee] = useState(PORTEE_CLUB);
  const [archivees, setArchivees] = useState(false);
  const [fichier, setFichier] = useState<{ nom: string; contenu: unknown } | undefined>();
  const [apercu, setApercu] = useState<ApercuTrello | undefined>();
  const [corr, setCorr] = useState<Record<string, string | null>>({});
  const [resultat, setResultat] = useState<ResultatImport | undefined>();
  // Étiquettes Critique / Urgent / Moyen / Faible : proposées en drapeau d'urgence (coché par défaut).
  const [convertir, setConvertir] = useState(true);
  // Listes Trello à marquer colonnes de fin (proposées : archivées ou nommées Fini, Terminé, Done…), cochées d'office.
  const [listesFin, setListesFin] = useState<string[]>([]);
  const { erreur, avis, agir, enCours, setErreur } = useAgir();
  useEffect(() => {
    void agir('', async () => {
      const p = await api.porteesImport();
      setPortees(p.portees);
      if (p.portees[0]) setPortee(p.portees[0].portee);
    });
  }, [agir, api]);

  const choisir = () =>
    agir('fichier', async () => {
      setApercu(undefined);
      setResultat(undefined);
      const f = await choisirFichier(ACCEPT_JSON, 'esport-cm-trello-fichier');
      if (!f) return undefined;
      if (f.taille > TAILLE_MAX_EXPORT) throw new Error(trCm('trello.trop_gros'));
      const Decodeur = (globalThis as { TextDecoder?: new () => { decode(o: Uint8Array): string } }).TextDecoder;
      if (!Decodeur) throw new Error(trCm('trello.illisible'));
      const texteJson = new Decodeur().decode(await f.lire(0, f.taille));
      let contenu: unknown;
      try {
        contenu = JSON.parse(texteJson);
      } catch {
        throw new Error(trCm('trello.illisible'));
      }
      setFichier({ nom: f.nom, contenu });
      await voir(contenu, portee, archivees);
      return undefined;
    });

  const voir = async (contenu: unknown, p: string, a: boolean) => {
    const x = await api.apercuTrello(contenu, p, a);
    setApercu(x);
    setListesFin(x.listes.filter(l => l.proposeFin && l.trelloId).map(l => l.trelloId as string));
    setCorr(x.correspondances);
  };

  if (!choixFichierDisponible) {
    return (
      <Carte theme={theme} testID="esport-cm-trello">
        <TitreCarte theme={theme} titre={trCm('trello.titre')} />
        <Aide theme={theme}>{trCm('trello.depuis_pc')}</Aide>
      </Carte>
    );
  }

  return (
    <View style={{ gap: ESP.m }} testID="esport-cm-trello">
      <Carte theme={theme}>
        <TitreCarte theme={theme} titre={trCm('trello.titre')} sous={trCm('trello.aide_export')} />
        <Aide theme={theme}>{trCm('trello.aide_confiance')}</Aide>
        {portees && portees.length > 1 ? (
          <Choix
            theme={theme}
            libelle={trCm('trello.portee')}
            valeur={portee}
            options={portees.map(p => ({ id: p.portee, nom: p.team ? (p.team.nom ?? '') : trCm('portee.club') }))}
            onChoisir={p => {
              setPortee(p);
              if (fichier) void agir('apercu', () => voir(fichier.contenu, p, archivees));
            }}
            testID="esport-cm-trello-portee"
          />
        ) : null}
        <View style={[styles.ligne, { gap: ESP.xs }]}>
          <Case
            theme={theme}
            coche={archivees}
            libelle={trCm('trello.archivees')}
            onChanger={v => {
              setArchivees(v);
              if (fichier) void agir('apercu', () => voir(fichier.contenu, portee, v));
            }}
            testID="esport-cm-trello-archivees"
          />
          <Text style={texte(theme)}>{trCm('trello.archivees')}</Text>
        </View>
        <BoutonHub theme={theme} titre={fichier ? trCm('trello.autre_fichier') : trCm('trello.choisir')} variante="plein" desactive={Boolean(enCours)} onPress={() => void choisir()} testID="esport-cm-trello-choisir" />
        {fichier ? <Text style={attenue(theme)}>{fichier.nom}</Text> : null}
        <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-cm-trello" />
      </Carte>

      {apercu ? (
        <Carte theme={theme} testID="esport-cm-trello-apercu">
          <TitreCarte theme={theme} titre={trCm('trello.apercu', { nom: apercu.tableau.nom })} />
          {apercu.dejaImporte ? <Aide theme={theme} testID="esport-cm-trello-deja">{trCm('trello.deja')}</Aide> : null}
          <Text style={texte(theme)} testID="esport-cm-trello-bilan">
            {trCm('trello.bilan', { listes: apercu.bilan.listes, cartes: apercu.bilan.cartes, etiquettes: apercu.bilan.etiquettes, checklists: apercu.bilan.checklists, commentaires: apercu.bilan.commentaires, pieces: apercu.bilan.pieces })}
          </Text>
          {apercu.archivees.listes || apercu.archivees.cartes ? <Text style={attenue(theme)}>{trCm('trello.archivees_n', { listes: apercu.archivees.listes, cartes: apercu.archivees.cartes })}</Text> : null}
          {apercu.listes.map((l, i) => (
            <Text key={i} style={texte(theme, 13)}>{`• ${l.nom} (${l.cartes})${l.archivee ? ` · ${trCm('c.archivee')}` : ''}`}</Text>
          ))}
          {apercu.urgences?.length ? (
            <View style={{ gap: ESP.xs }} testID="esport-cm-trello-urgences">
              <Text style={{ ...texte(theme), fontWeight: '700' }}>{trCm('trello.urgences')}</Text>
              {apercu.urgences.map((u, i) => (
                <Text key={i} style={texte(theme, 13)}>
                  {`• ${trnCm('trello.urgences_ligne', u.cartes, { nom: u.nom, niveau: trCm(cleLibelleUrgence(u.niveau)) })}`}
                </Text>
              ))}
              <View style={[styles.ligne, { gap: ESP.xs }]}>
                <Case theme={theme} coche={convertir} libelle={trCm('trello.urgences_convertir')} onChanger={setConvertir} testID="esport-cm-trello-urgences-convertir" />
                <Text style={texte(theme)}>{trCm('trello.urgences_convertir')}</Text>
              </View>
              <Aide theme={theme}>{trCm('trello.urgences_aide')}</Aide>
            </View>
          ) : null}
          {apercu.listes.some(l => l.proposeFin && l.trelloId) ? (
            <View style={{ gap: ESP.xs }} testID="esport-cm-trello-fin">
              <Text style={{ ...texte(theme), fontWeight: '700' }}>{trCm('trello.fin')}</Text>
              {apercu.listes
                .filter(l => l.proposeFin && l.trelloId)
                .map(l => {
                  const libelle = trnCm('trello.fin_ligne', l.cartes, { nom: l.nom });
                  return (
                    <View key={l.trelloId} style={[styles.ligne, { gap: ESP.xs }]}>
                      <Case theme={theme} coche={listesFin.includes(l.trelloId as string)} libelle={libelle} onChanger={v => setListesFin(x => (v ? [...x, l.trelloId as string] : x.filter(y => y !== l.trelloId)))} testID={`esport-cm-trello-fin-${l.trelloId}`} />
                      <Text style={{ ...texte(theme, 13), flex: 1, minWidth: 0 }}>{libelle}</Text>
                    </View>
                  );
                })}
              <Aide theme={theme}>{trCm('trello.fin_aide')}</Aide>
            </View>
          ) : null}
          {apercu.bilan.piecesDeposees ? <Aide theme={theme} testID="esport-cm-trello-fichiers">{trCm('trello.fichiers_liens', { n: apercu.bilan.piecesDeposees })}</Aide> : null}
          {apercu.piecesIgnorees ? <Aide theme={theme}>{trCm('trello.pieces_ignorees', { n: apercu.piecesIgnorees })}</Aide> : null}
          {apercu.membresTrello.length ? (
            <View style={{ gap: ESP.s }} testID="esport-cm-trello-membres">
              <Text style={{ ...texte(theme), fontWeight: '700' }}>{trCm('trello.membres')}</Text>
              <Aide theme={theme}>{trCm('trello.membres_aide')}</Aide>
              {apercu.membresTrello.map(m => (
                <Choix
                  key={m.id}
                  theme={theme}
                  libelle={`${m.nom}${m.identifiant ? ` (@${m.identifiant})` : ''}`}
                  valeur={corr[m.id] ?? ''}
                  options={[{ id: '', nom: trCm('trello.aucun') }, ...apercu.personnes.map(p => ({ id: p.compte, nom: p.pseudo }))]}
                  onChoisir={v => setCorr(c => ({ ...c, [m.id]: v || null }))}
                  testID={`esport-cm-trello-membre-${m.id}`}
                />
              ))}
            </View>
          ) : null}
          <BoutonHub
            theme={theme}
            titre={apercu.dejaImporte ? trCm('trello.mettre_a_jour') : trCm('trello.importer')}
            variante="plein"
            desactive={Boolean(enCours) || !fichier}
            onPress={() =>
              void agir('importer', async () => {
                if (!fichier) return;
                setErreur(undefined);
                const r = await api.importerTrello(fichier.contenu, portee, archivees, corr, convertir && Boolean(apercu.urgences?.length), listesFin);
                setResultat(r);
                return trCm('trello.fait', { cartes: r.bilan.cartesCreees, maj: r.bilan.cartesMisesAJour });
              })
            }
            testID="esport-cm-trello-importer"
          />
        </Carte>
      ) : null}

      {resultat ? (
        <Carte theme={theme} testID="esport-cm-trello-resultat">
          <TitreCarte theme={theme} titre={resultat.nouveau ? trCm('trello.cree') : trCm('trello.mis_a_jour')} />
          <Text style={texte(theme)}>{trCm('trello.resultat', { cartes: resultat.bilan.cartesCreees, maj: resultat.bilan.cartesMisesAJour, posts: resultat.bilan.cartesPostsInchangees, membres: resultat.bilan.membresAssocies })}</Text>
          {resultat.porteeConservee ? <Aide theme={theme}>{trCm('trello.portee_conservee')}</Aide> : null}
          {resultat.bilan.couverturesImages ? <Aide theme={theme}>{trCm('trello.couvertures_images', { n: resultat.bilan.couverturesImages })}</Aide> : null}
          <BoutonHub theme={theme} titre={trCm('trello.ouvrir')} variante="plein" onPress={() => onOuvrir(resultat.tableauId)} testID="esport-cm-trello-ouvrir" />
        </Carte>
      ) : null}
    </View>
  );
}
