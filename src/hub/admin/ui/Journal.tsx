/** Section « Journal » : filtres, recherche, export JSON/CSV sans secrets. */

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { police } from '../../themes';
import { exporterJournalPar } from '../actions';
import { LIBELLES_TYPE, TYPES_EVENEMENT, filtrerJournal, type TypeEvenement } from '../journal';
import { autorise } from '../roles';
import { Avis, BoutonHub, Champ, Intertitre, Panneau, Segments, commun, dateLisible, type OutilsAdmin } from './commun';

const PAGE = 50;

export function Journal({ outils }: { outils: OutilsAdmin }) {
  const { theme, donnees, tous } = outils;
  const [type, setType] = useState<TypeEvenement | 'tous'>('tous');
  const [cible, setCible] = useState<string>('tous');
  const [du, setDu] = useState('');
  const [au, setAu] = useState('');
  const [recherche, setRecherche] = useState('');
  const [limite, setLimite] = useState(PAGE);
  const [message, setMessage] = useState<string | undefined>();
  const dateValide = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
  const filtres = filtrerJournal(donnees.journal, {
    types: type === 'tous' ? undefined : [type],
    cible: cible === 'tous' ? undefined : cible,
    du: dateValide(du) ? du : undefined,
    au: dateValide(au) ? au : undefined,
    recherche,
  });
  const texte = { color: theme.texte, ...police(theme.policeTexte) };
  const attenue = { color: theme.attenue, ...police(theme.policeTexte) };
  // Les cibles possibles : profils actuels et prénoms déjà vus dans le journal.
  const cibles = new Map<string, string>();
  for (const e of donnees.journal) {
    if (e.cible) {
      cibles.set(e.cible, e.nomCible ?? e.cible);
    }
  }
  for (const p of tous) {
    cibles.set(p.id, p.nom);
  }

  const peutExporter = autorise(outils.acteur, 'exporter-journal').ok;
  const exporter = (format: 'json' | 'csv') => {
    const contenu = exporterJournalPar(outils.acteur, format, [...filtres].reverse());
    const nom = `journal-administration-${new Date(outils.maintenant()).toISOString().slice(0, 10)}.${format}`;
    const enregistrer = outils.services?.enregistrerFichier;
    if (!enregistrer) {
      setMessage('Export indisponible sur cette plateforme.');
      return;
    }
    outils.agir('Export du journal…', async () => {
      const fait = await enregistrer(nom, contenu, format === 'json' ? 'application/json' : 'text/csv;charset=utf-8');
      if (fait) {
        outils.journaliser({ type: 'export', action: `Journal exporté (${format.toUpperCase()}, ${filtres.length} entrée${filtres.length > 1 ? 's' : ''})` });
        setMessage(`Journal exporté : ${nom}`);
      } else {
        setMessage('Export annulé.');
      }
    });
  };

  return (
    <View style={{ gap: 16 }} testID="admin-section-journal">
      <Panneau theme={theme}>
        <Intertitre theme={theme}>Filtres</Intertitre>
        <Segments
          theme={theme}
          libelle="Type d’événement"
          valeur={type}
          options={[['tous', 'Tous'], ...TYPES_EVENEMENT.map(t => [t, LIBELLES_TYPE[t]] as const)]}
          onChoisir={v => {
            setType(v);
            setLimite(PAGE);
          }}
          testID="admin-journal-type"
        />
        <Segments
          theme={theme}
          libelle="Utilisateur"
          valeur={cible}
          options={[['tous', 'Tous'], ...[...cibles.entries()].map(([id, nom]) => [id, nom] as const)]}
          onChoisir={setCible}
          testID="admin-journal-cible"
        />
        <View style={[commun.grille, { alignItems: 'flex-end' }]}>
          <Champ theme={theme} libelle="Du (AAAA-MM-JJ)" valeur={du} onChanger={setDu} testID="admin-journal-du" placeholder="2026-01-01" maxLength={10} style={{ flexBasis: 150, flexGrow: 1 }} />
          <Champ theme={theme} libelle="Au (AAAA-MM-JJ)" valeur={au} onChanger={setAu} testID="admin-journal-au" placeholder="2026-12-31" maxLength={10} style={{ flexBasis: 150, flexGrow: 1 }} />
          <Champ theme={theme} libelle="Rechercher" valeur={recherche} onChanger={setRecherche} testID="admin-journal-recherche" placeholder="ex. Lucas, désactivé" style={{ flexBasis: 220, flexGrow: 2 }} />
        </View>
        {(du && !dateValide(du)) || (au && !dateValide(au)) ? <Avis theme={theme} genre="alerte" texte="Date à saisir au format AAAA-MM-JJ." /> : null}
        <View style={commun.actions}>
          {peutExporter ? (
            <>
              <BoutonHub theme={theme} titre="Exporter en JSON" onPress={() => exporter('json')} testID="admin-journal-export-json" />
              <BoutonHub theme={theme} titre="Exporter en CSV" onPress={() => exporter('csv')} testID="admin-journal-export-csv" />
              <Text style={[attenue, { fontSize: 12 }]}>L’export reprend les entrées filtrées ; il ne contient aucun secret.</Text>
            </>
          ) : (
            <Text style={[attenue, { fontSize: 12 }]} testID="admin-journal-perso">
              Ce journal ne contient que vos propres actions, sans aucun secret. L’export est réservé à l’administrateur.
            </Text>
          )}
        </View>
        {message ? <Avis theme={theme} genre="info" texte={message} testID="admin-journal-message" /> : null}
      </Panneau>

      <Panneau theme={theme} testID="admin-journal-liste">
        <Intertitre theme={theme}>{`${filtres.length} événement${filtres.length > 1 ? 's' : ''} · rétention ${donnees.reglages.retentionJours} j · ${donnees.reglages.tailleJournal} max`}</Intertitre>
        {filtres.length === 0 ? <Text style={attenue}>Aucun événement ne correspond.</Text> : null}
        {filtres.slice(0, limite).map((e, index) => (
          <View key={`${e.date}-${index}`} style={[commun.ligne, { alignItems: 'flex-start', flexWrap: 'wrap' }, index > 0 && { borderTopWidth: 1, borderTopColor: theme.ligne }]}>
            <Text style={[attenue, { fontSize: 12, width: 128 }, police(theme.policeChiffres)]}>{dateLisible(e.date, true)}</Text>
            <Text style={[texte, { fontSize: 12, fontWeight: '700', width: 96 }]}>{LIBELLES_TYPE[e.type]}</Text>
            <Text style={[texte, { fontSize: 13, flex: 1, minWidth: 180 }]}>
              {e.acteur ? <Text style={{ fontWeight: '700' }}>[{e.acteur}] </Text> : null}
              {e.action}
            </Text>
          </View>
        ))}
        {filtres.length > limite ? <BoutonHub theme={theme} titre={`Afficher ${Math.min(PAGE, filtres.length - limite)} de plus`} onPress={() => setLimite(l => l + PAGE)} /> : null}
      </Panneau>
    </View>
  );
}
