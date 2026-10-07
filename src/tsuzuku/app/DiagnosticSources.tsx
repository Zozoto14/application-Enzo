/**
 * Pourquoi une fiche ne trouve rien sur les sources : la vraie raison (aucune
 * source, site web, source en erreur, titre non trouvé, aucun épisode…),
 * « Réessayer », « Chercher avec un autre titre » et le détail du diagnostic
 * (quelle source, quelle requête, combien de résultats, quel titre retenu ou
 * écarté). Partagé par la fiche (« Sur vos sources ») et le lecteur.
 */

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { teinteTransparente } from '../../hub/themes';
import type { DiagnosticSource, StatutSource } from '../moteur/resolution';
import { useTsuzuku } from './contexte';
import type { DiagnosticLecture } from './resoudre';
import { Avis, Bouton, Champ, styleAttenue, styleTexte } from './ui';

export const LIBELLE_STATUT_SOURCE: Record<StatutSource, string> = {
  ok: 'trouvé',
  erreur: 'en erreur',
  'titre-introuvable': 'titre non reconnu',
  'aucun-resultat': 'aucun résultat',
  'aucun-episode': 'aucun épisode lu',
  'non-configuree': 'non configurée pour ce type',
};

/** Lignes du diagnostic, en texte (aussi copiées telles quelles). */
export function lignesDiagnostic(d: DiagnosticLecture): string[] {
  const lignes = [`Titres cherchés : ${d.titres.map(t => `« ${t} »`).join(', ') || '(aucun)'}`];
  if (!d.sources.length) lignes.push('Aucune source interrogée.');
  for (const x of d.sources) lignes.push(...lignesSource(x));
  return lignes;
}

function lignesSource(x: DiagnosticSource): string[] {
  const l = [`Source « ${x.source} » : ${LIBELLE_STATUT_SOURCE[x.statut]}${x.statut === 'ok' || x.statut === 'aucun-episode' ? ` (${x.episodes} épisode(s))` : ''}`];
  for (const r of x.requetes) l.push(`  · « ${r.requete} » → ${r.erreur ? `erreur : ${r.erreur}` : `${r.resultats} résultat(s)`}${r.url ? ` — ${r.url}` : ''}`);
  if (x.serie) l.push(`  · retenu : « ${x.serie.title} » (ressemblance ${x.serie.score}) — ${x.serie.url}`);
  if (x.refuse) l.push(`  · écarté : « ${x.refuse.title} » (ressemblance ${x.refuse.score}, minimum 600)`);
  if (x.erreur && !x.requetes.some(r => r.erreur === x.erreur)) l.push(`  · ${x.erreur}`);
  return l;
}

export function PanneauEchec({
  message,
  diagnostic,
  titrePerso,
  enCours,
  onReessayer,
  onAutreTitre,
  testID = 'sources-echec',
}: {
  message: string;
  diagnostic?: DiagnosticLecture;
  titrePerso?: string;
  enCours?: boolean;
  onReessayer(): void;
  /** Titre vide : revient aux titres du catalogue. */
  onAutreTitre?(titre: string): void;
  testID?: string;
}) {
  const { theme } = useTsuzuku();
  const [detail, setDetail] = useState(false);
  const [autre, setAutre] = useState(titrePerso ?? '');
  const recherchable = diagnostic && diagnostic.raison !== 'site' && diagnostic.raison !== 'aucune-source';
  return (
    <View testID={testID} style={{ gap: 10, padding: 12, borderRadius: Math.max(theme.rayonMoyen, 8), borderWidth: 1, borderColor: theme.ligne, backgroundColor: teinteTransparente(theme.texte, 0.03) }}>
      <Avis genre={diagnostic?.raison === 'erreur' ? 'critique' : 'alerte'} texte={message} testID={`${testID}-message`} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {diagnostic?.raison !== 'aucune-source' ? <Bouton titre={enCours ? 'Recherche…' : 'Réessayer'} desactive={enCours} onPress={onReessayer} testID={`${testID}-reessayer`} /> : null}
        {diagnostic ? <Bouton titre={detail ? 'Masquer le détail' : 'Détail du diagnostic'} onPress={() => setDetail(v => !v)} testID={`${testID}-detail-bouton`} /> : null}
      </View>
      {recherchable && onAutreTitre ? (
        <View style={{ gap: 6 }}>
          <Champ libelle="Chercher avec un autre titre" valeur={autre} onChanger={setAutre} placeholder="Le titre tel que le site l’écrit" onValider={() => onAutreTitre(autre)} testID={`${testID}-autre-titre`} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Bouton titre="Chercher" variante="plein" desactive={enCours || !autre.trim()} onPress={() => onAutreTitre(autre)} testID={`${testID}-chercher`} />
            {titrePerso ? <Bouton titre="Revenir aux titres du catalogue" onPress={() => { setAutre(''); onAutreTitre(''); }} testID={`${testID}-titres-catalogue`} /> : null}
          </View>
        </View>
      ) : null}
      {detail && diagnostic ? (
        <View style={{ gap: 2 }} testID={`${testID}-detail`}>
          {lignesDiagnostic(diagnostic).map((l, i) => (
            <Text key={i} selectable style={l.startsWith('  ') ? styleAttenue(theme, 12) : styleTexte(theme, 13)}>
              {l}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}
