/**
 * Journal d'audit, version téléphone : recherche en haut, filtres dans une feuille basse, entrées
 * en cartes (date et type, puis l'action en entier), export JSON / CSV dans une feuille d'actions.
 */

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonPrincipal, Cellule, ChampMobile, ESPACE, FeuilleBasse, GroupeCellules, TEXTE, rayonCarte } from '../../../../ui/mobile';
import { police } from '../../../themes';
import { exporterJournalPar } from '../../actions';
import { LIBELLES_TYPE, TYPES_EVENEMENT, filtrerJournal, type TypeEvenement } from '../../journal';
import { autorise } from '../../roles';
import { Avis, Pilule, dateLisible, type OutilsAdmin } from '../commun';
import { Aide, CadreAdmin, FeuilleFiltres } from './briques';

const PAGE = 30;

export function Journal({ outils, onRetour }: { outils: OutilsAdmin; onRetour(): void }) {
  const { theme, donnees, tous } = outils;
  const [type, setType] = useState<string>('tous');
  const [cible, setCible] = useState<string>('tous');
  const [du, setDu] = useState('');
  const [au, setAu] = useState('');
  const [recherche, setRecherche] = useState('');
  const [limite, setLimite] = useState(PAGE);
  const [message, setMessage] = useState<string | undefined>();
  const [filtres, setFiltres] = useState(false);
  const [export_, setExport] = useState(false);
  const dateValide = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
  const liste = filtrerJournal(donnees.journal, {
    types: type === 'tous' ? undefined : [type as TypeEvenement],
    cible: cible === 'tous' ? undefined : cible,
    du: dateValide(du) ? du : undefined,
    au: dateValide(au) ? au : undefined,
    recherche,
  });
  const cibles = new Map<string, string>();
  for (const e of donnees.journal) {
    if (e.cible) cibles.set(e.cible, e.nomCible ?? e.cible);
  }
  for (const p of tous) cibles.set(p.id, p.nom);
  const actifs = (type !== 'tous' ? 1 : 0) + (cible !== 'tous' ? 1 : 0) + (dateValide(du) ? 1 : 0) + (dateValide(au) ? 1 : 0);
  const peutExporter = autorise(outils.acteur, 'exporter-journal').ok;

  const exporter = (format: 'json' | 'csv') => {
    setExport(false);
    const contenu = exporterJournalPar(outils.acteur, format, [...liste].reverse());
    const nom = `journal-administration-${new Date(outils.maintenant()).toISOString().slice(0, 10)}.${format}`;
    const enregistrer = outils.services?.enregistrerFichier;
    if (!enregistrer) {
      setMessage('Export indisponible sur cette plateforme.');
      return;
    }
    outils.agir('Export du journal…', async () => {
      const fait = await enregistrer(nom, contenu, format === 'json' ? 'application/json' : 'text/csv;charset=utf-8');
      if (fait) {
        outils.journaliser({ type: 'export', action: `Journal exporté (${format.toUpperCase()}, ${liste.length} entrée${liste.length > 1 ? 's' : ''})` });
        setMessage(`Journal exporté : ${nom}`);
      } else {
        setMessage('Export annulé.');
      }
    });
  };

  return (
    <CadreAdmin
      theme={theme}
      titre="Journal d’audit"
      libelleRetour="Administration"
      onRetour={onRetour}
      testID="admin-section-journal"
      actions={peutExporter ? [{ titre: '⇩', libelle: 'Exporter le journal', onPress: () => setExport(true), testID: 'admin-journal-exporter' }] : undefined}>
      <ChampMobile theme={theme} etiquette="Rechercher" nature="recherche" value={recherche} onChangeText={setRecherche} placeholder="ex. Lucas, désactivé" testID="admin-journal-recherche" />
      <GroupeCellules theme={theme}>
        <Cellule theme={theme} titre="Filtres" valeur={actifs > 0 ? `${actifs} actif${actifs > 1 ? 's' : ''}` : 'Aucun'} chevron testID="admin-journal-filtres" onPress={() => setFiltres(true)} />
      </GroupeCellules>
      {message ? <Avis theme={theme} genre="info" texte={message} testID="admin-journal-message" /> : null}
      {!peutExporter ? (
        <Aide theme={theme} testID="admin-journal-perso">
          Ce journal ne contient que vos propres actions, sans aucun secret. L’export est réservé à l’administrateur.
        </Aide>
      ) : null}
      <Text accessibilityRole="header" style={{ color: theme.attenue, fontSize: TEXTE.legende, fontWeight: '600', ...police(theme.policeTexte) }}>
        {`${liste.length} événement${liste.length > 1 ? 's' : ''} · conservés ${donnees.reglages.retentionJours} j`}
      </Text>
      <View testID="admin-journal-liste" style={{ gap: ESPACE.s }}>
        {liste.length === 0 ? <Aide theme={theme}>Aucun événement ne correspond.</Aide> : null}
        {liste.slice(0, limite).map((e, index) => (
          <View
            key={`${e.date}-${index}`}
            style={{ padding: ESPACE.m, gap: ESPACE.xs, borderWidth: 1, borderColor: theme.ligne, backgroundColor: theme.surface, borderRadius: rayonCarte(theme) }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESPACE.xs, flexWrap: 'wrap' }}>
              <Pilule theme={theme} texte={LIBELLES_TYPE[e.type]} couleur={theme.teintes.admin} />
              <Text style={{ color: theme.attenue, fontSize: TEXTE.legende, ...police(theme.policeChiffres) }}>{dateLisible(e.date, true)}</Text>
            </View>
            <Text style={{ color: theme.texte, fontSize: TEXTE.corps, lineHeight: 24, ...police(theme.policeTexte) }}>
              {e.acteur ? <Text style={{ fontWeight: '700' }}>[{e.acteur}] </Text> : null}
              {e.action}
            </Text>
          </View>
        ))}
        {liste.length > limite ? <BoutonPrincipal theme={theme} variante="discret" titre={`Afficher ${Math.min(PAGE, liste.length - limite)} de plus`} onPress={() => setLimite(l => l + PAGE)} /> : null}
      </View>

      <FeuilleFiltres
        theme={theme}
        visible={filtres}
        onFermer={() => setFiltres(false)}
        champs={[
          { id: 'type', libelle: 'Type d’événement', valeur: type, options: [{ cle: 'tous', titre: 'Tous' }, ...TYPES_EVENEMENT.map(t => ({ cle: t, titre: LIBELLES_TYPE[t] }))] },
          { id: 'cible', libelle: 'Utilisateur', valeur: cible, options: [{ cle: 'tous', titre: 'Tous' }, ...[...cibles.entries()].map(([id, nom]) => ({ cle: id, titre: nom }))] },
        ]}
        onChoisir={(id, cle) => {
          if (id === 'type') setType(cle);
          else setCible(cle);
          setLimite(PAGE);
        }}
        onReinitialiser={() => {
          setType('tous');
          setCible('tous');
          setDu('');
          setAu('');
          setLimite(PAGE);
        }}
        enfants={
          <View style={{ gap: ESPACE.s }}>
            <ChampMobile theme={theme} etiquette="Du (AAAA-MM-JJ)" value={du} onChangeText={setDu} placeholder="2026-01-01" maxLength={10} inputMode="numeric" testID="admin-journal-du" />
            <ChampMobile theme={theme} etiquette="Au (AAAA-MM-JJ)" value={au} onChangeText={setAu} placeholder="2026-12-31" maxLength={10} inputMode="numeric" testID="admin-journal-au" />
            {(du && !dateValide(du)) || (au && !dateValide(au)) ? <Avis theme={theme} genre="alerte" texte="Date à saisir au format AAAA-MM-JJ." /> : null}
          </View>
        }
      />

      <FeuilleBasse theme={theme} visible={export_} titre="Exporter le journal" description={`L’export reprend les ${liste.length} entrée${liste.length > 1 ? 's' : ''} filtrée${liste.length > 1 ? 's' : ''} ; il ne contient aucun secret.`} onFermer={() => setExport(false)} testID="admin-journal-export">
        <GroupeCellules theme={theme}>
          <Cellule theme={theme} titre="Exporter en JSON" sousTitre="Fichier structuré, pour archivage" chevron testID="admin-journal-export-json" onPress={() => exporter('json')} />
          <Cellule theme={theme} titre="Exporter en CSV" sousTitre="Tableur (Excel, Numbers)" chevron testID="admin-journal-export-csv" onPress={() => exporter('csv')} />
        </GroupeCellules>
      </FeuilleBasse>
    </CadreAdmin>
  );
}
