/**
 * Contenu des réglages du portefeuille, un composant par réglage.
 *
 * Ils sont montrés dans la page Paramètres du hub (section Portefeuille et
 * Sécurité), qui les entoure de son titre et de sa carte : ces composants ne
 * dessinent donc ni carte ni titre. Avant la réunion des paramètres, ils
 * vivaient dans l'écran Réglages du portefeuille, l'écran Podcast et l'écran
 * Sauvegarde.
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Alerte, Bouton, Champ, SousTitre, usePalette } from '../composants';
import { Segments } from '../elements';
import { ESPACEMENT, RAYON } from '../theme';
import { INTERVALLES_ACTUALISATION, INTERVALLE_PAR_DEFAUT_S, libelleIntervalle } from '../../cours/marche';
import type { FournisseurCours } from '../../cours/fournisseur';
import { tt } from '../mobile/jetons';

export function ReglageIntervalle({ intervalle, onChoisir }: { intervalle?: number; onChoisir(secondes: number): void }) {
  return (
    <View style={{ gap: ESPACEMENT.s }}>
      <SousTitre>
        Tant que la fenêtre est ouverte, les cours de vos valeurs sont relus à ce rythme, pendant les séances de Paris et de New York.
      </SousTitre>
      <Segments<string>
        options={INTERVALLES_ACTUALISATION.map(String)}
        actif={String(intervalle ?? INTERVALLE_PAR_DEFAUT_S)}
        libelle={valeur => libelleIntervalle(Number(valeur))}
        onChoisir={valeur => onChoisir(Number(valeur))}
        prefixeTest="intervalle"
      />
    </View>
  );
}

export function ReglageFournisseur({
  fournisseurs,
  fournisseurActuel,
  cleEnregistree,
  onEnregistrer,
}: {
  fournisseurs: readonly FournisseurCours[];
  fournisseurActuel?: string;
  /** Vrai si une clé est déjà enregistrée. Sa valeur n'est jamais transmise. */
  cleEnregistree: boolean;
  onEnregistrer(fournisseurId: string, cle?: string): void;
}) {
  const palette = usePalette();
  const [choisi, setChoisi] = useState(fournisseurActuel ?? fournisseurs[0]?.id ?? '');
  const [cle, setCle] = useState('');
  const fournisseur = fournisseurs.find(candidat => candidat.id === choisi);
  const cleManquante = Boolean(fournisseur?.cleRequise) && !cleEnregistree && cle === '';
  return (
    <View style={{ gap: ESPACEMENT.s }}>
      <SousTitre>Choisissez un fournisseur de cotations et renseignez sa clé d'API.</SousTitre>
      <View style={styles.pastilles} accessibilityRole="radiogroup">
        {fournisseurs.map(candidat => {
          const actif = candidat.id === choisi;
          return (
            <Pressable
              key={candidat.id}
              testID={`fournisseur-${candidat.id}`}
              accessibilityRole="radio"
              accessibilityState={{ selected: actif }}
              onPress={() => setChoisi(candidat.id)}
              style={[
                styles.pastille,
                { backgroundColor: actif ? palette.accentPlein : 'transparent', borderColor: actif ? palette.accent : palette.bordure },
              ]}>
              <Text style={{ color: actif ? palette.surAccent : palette.texte }}>{candidat.libelle}</Text>
            </Pressable>
          );
        })}
      </View>
      {fournisseur?.provisoire ? (
        <Alerte
          message={
            "Ce fournisseur n'a jamais été confronté à une vraie réponse : son " +
            'mapping est une hypothèse. Comparez le premier cours obtenu à ' +
            'celui de votre courtier avant de vous y fier.'
          }
        />
      ) : null}
      <Champ
        etiquette="Clé d'API"
        value={cle}
        onChangeText={setCle}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={cleEnregistree ? 'Clé enregistrée — saisir pour remplacer' : ''}
        indication="Conservée dans la base chiffrée, illisible sans déverrouillage."
      />
      {cleManquante ? <Alerte message="Ce fournisseur exige une clé d'API." /> : null}
      <View style={{ alignSelf: 'flex-start' }}>
        <Bouton
          titre="Enregistrer"
          testID="bouton-enregistrer-reglages"
          desactive={cleManquante || choisi === ''}
          onPress={() => onEnregistrer(choisi, cle || undefined)}
        />
      </View>
    </View>
  );
}

export function ReglageSymboles({ sansSymbole, onSymboles }: { sansSymbole?: number; onSymboles(): void }) {
  return (
    <View style={{ gap: ESPACEMENT.s }}>
      <SousTitre>
        {sansSymbole
          ? `${sansSymbole} valeur(s) détenue(s) n’ont pas de symbole : leurs cours ne peuvent pas être rafraîchis.`
          : 'Le symbole dit à quel marché demander le cours. Une même société cote parfois sur plusieurs places, à des cours différents.'}
      </SousTitre>
      <View style={{ alignSelf: 'flex-start' }}>
        <Bouton titre="Régler les symboles" testID="bouton-symboles" variante="discret" onPress={onSymboles} />
      </View>
    </View>
  );
}

export function ReglageHistorique({
  onCharger,
  avecSymbole,
  enCours,
  message,
}: {
  onCharger(): void;
  avecSymbole?: number;
  enCours?: boolean;
  message?: string;
}) {
  const palette = usePalette();
  return (
    <View style={{ gap: ESPACEMENT.s }}>
      <SousTitre>
        Sans historique, les onglets Performances et Risque restent muets plusieurs mois : il faut trente relevés pour une corrélation et
        quatre-vingt-dix jours pour annualiser un rendement. Ce chargement reprend deux ans d’un coup.
      </SousTitre>
      <SousTitre>
        Les cours retenus sont les clôtures brutes, pas les clôtures ajustées : vos dividendes sont déjà saisis comme opérations, et les
        compter deux fois gonflerait la performance.
      </SousTitre>
      <View style={{ alignSelf: 'flex-start' }}>
        <Bouton
          titre={enCours ? 'Chargement…' : 'Charger deux ans d’historique'}
          testID="bouton-charger-historique"
          variante="discret"
          desactive={enCours || avecSymbole === 0}
          onPress={onCharger}
        />
      </View>
      {avecSymbole === 0 ? <SousTitre>Aucune valeur n’a de symbole : réglez-les d’abord.</SousTitre> : null}
      {message ? (
        <Text accessibilityLiveRegion="polite" style={{ color: palette.texte }}>
          {message}
        </Text>
      ) : null}
    </View>
  );
}

export function ReglageExport({ onExporter, message }: { onExporter(): void; message?: string }) {
  const palette = usePalette();
  return (
    <View style={{ gap: ESPACEMENT.s }}>
      <SousTitre>
        Tout votre portefeuille dans un fichier Excel : positions, opérations, dividendes et comptes, une feuille chacun, avec des nombres
        qu’on peut trier et additionner.
      </SousTitre>
      <View style={{ alignSelf: 'flex-start' }}>
        <Bouton titre="Exporter vers Excel (.xlsx)" onPress={onExporter} testID="bouton-export-excel" />
      </View>
      {message ? (
        <Text style={{ color: palette.texte }} testID="message-export">
          {message}
        </Text>
      ) : null}
    </View>
  );
}

export function ReglageCodes({ onRenouveler }: { onRenouveler(): string[] }) {
  const palette = usePalette();
  const [confirmer, setConfirmer] = useState(false);
  const [nouveaux, setNouveaux] = useState<string[] | undefined>();
  return (
    <View style={{ gap: ESPACEMENT.s }}>
      <SousTitre>
        Ils servent si vous oubliez votre mot de passe : à l’écran de déverrouillage, « Mot de passe oublié ». Chacun ne sert qu’une fois.
        Générez-en de nouveaux si vous les avez perdus ou presque tous utilisés : les anciens cesseront de fonctionner.
      </SousTitre>
      {nouveaux ? (
        <View style={{ gap: ESPACEMENT.s }} testID="nouveaux-codes">
          <Alerte message="Notez-les maintenant, sur papier ou dans votre gestionnaire de mots de passe : ils ne seront plus jamais affichés." />
          {nouveaux.map(code => (
            <Text key={code} selectable style={[styles.code, { color: palette.texte, borderColor: palette.bordure }]}>
              {code}
            </Text>
          ))}
          <View style={{ alignSelf: 'flex-start' }}>
            <Bouton titre="C’est noté" variante="discret" onPress={() => setNouveaux(undefined)} />
          </View>
        </View>
      ) : confirmer ? (
        <View style={{ gap: ESPACEMENT.s }}>
          <Text style={{ color: palette.danger }}>Les codes actuels ne marcheront plus. Continuer ?</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ESPACEMENT.s }}>
            <Bouton
              titre="Générer de nouveaux codes"
              testID="bouton-confirmer-codes"
              onPress={() => {
                setNouveaux(onRenouveler());
                setConfirmer(false);
              }}
            />
            <Bouton titre="Annuler" variante="discret" onPress={() => setConfirmer(false)} />
          </View>
        </View>
      ) : (
        <View style={{ alignSelf: 'flex-start' }}>
          <Bouton titre="Générer de nouveaux codes…" variante="discret" testID="bouton-renouveler-codes" onPress={() => setConfirmer(true)} />
        </View>
      )}
    </View>
  );
}

export function ReglageVisite({ onRevoir }: { onRevoir(): void }) {
  return (
    <View style={{ alignSelf: 'flex-start' }}>
      <Bouton titre="Revoir la visite des nouveautés" variante="discret" onPress={onRevoir} testID="revoir-visite" />
    </View>
  );
}

export function ReglageDiscretion({ discret, onBasculer }: { discret: boolean; onBasculer(): void }) {
  const palette = usePalette();
  return (
    <View style={styles.ligneSwitch}>
      <Switch value={discret} onValueChange={onBasculer} accessibilityLabel="Masquer les montants en euros" testID="reglage-discretion" />
      <Text style={{ color: palette.texteSecondaire, fontSize: tt(13), flexShrink: 1 }}>
        {discret ? 'Montants masqués (mode discret actif).' : 'Montants affichés.'}
      </Text>
    </View>
  );
}

export function ReglagePodcast({ heureAuto, onChanger }: { heureAuto?: string; onChanger(heure: string | undefined): void }) {
  const palette = usePalette();
  const [heureSaisie, setHeureSaisie] = useState(heureAuto ?? '07:30');
  return (
    <View style={styles.ligneSwitch} testID="podcast-auto">
      <Switch
        value={Boolean(heureAuto)}
        onValueChange={actif => onChanger(actif && /^\d{2}:\d{2}$/.test(heureSaisie) ? heureSaisie : undefined)}
        accessibilityLabel="Préparer le podcast automatiquement"
      />
      <Text style={{ color: palette.texteSecondaire, fontSize: tt(13) }}>Prêt chaque jour à</Text>
      <View style={{ width: 90 }}>
        <Champ
          etiquette="Heure"
          value={heureSaisie}
          onChangeText={texte => {
            setHeureSaisie(texte);
            if (heureAuto && /^([01]\d|2[0-3]):[0-5]\d$/.test(texte)) onChanger(texte);
          }}
          placeholder="07:30"
          testID="champ-heure-podcast"
        />
      </View>
      <Text style={{ color: palette.texteSecondaire, fontSize: tt(12), flexShrink: 1 }}>
        {heureAuto ? 'L’application doit être ouverte (même réduite) : une notification vous prévient.' : 'Désactivé.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  code: {
    fontFamily: 'monospace',
    fontSize: 17,
    letterSpacing: 1,
    borderWidth: 1,
    borderRadius: RAYON.s,
    paddingHorizontal: ESPACEMENT.m,
    paddingVertical: ESPACEMENT.s,
    alignSelf: 'flex-start',
  },
  pastilles: { flexDirection: 'row', flexWrap: 'wrap', gap: ESPACEMENT.s },
  pastille: {
    borderRadius: RAYON.l,
    borderWidth: 1,
    paddingVertical: ESPACEMENT.xs + 2,
    paddingHorizontal: ESPACEMENT.m - 4,
  },
  ligneSwitch: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: ESPACEMENT.s },
});
