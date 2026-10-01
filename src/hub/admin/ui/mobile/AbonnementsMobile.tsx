/**
 * Abonnements, version téléphone : le tableau devient une liste de cartes (nom, statut, échéance,
 * montant). « Marquer payé » est le bouton principal de chaque carte (sous le pouce) ; les autres
 * actions sont dans une feuille « Plus d'actions » ; chaque formulaire s'ouvre dans sa feuille basse.
 * Suivi manuel : aucun paiement automatique, aucune coupure automatique.
 */

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonPrincipal, Cellule, ChampMobile, ESPACE, FeuilleBasse, GroupeCellules, TEXTE, rayonCarte } from '../../../../ui/mobile';
import {
  LIBELLES_PERIODICITE,
  LIBELLES_STATUT,
  PERIODICITES,
  centimesDepuisTexte,
  configurerCompte,
  dateDuJour,
  dateFr,
  dateValide,
  definirMode,
  enregistrerPaiement,
  filtrerLignes,
  formaterMontant,
  lignesAbo,
  marquerPaye,
  messageRappel,
  modifierEcheance,
  resumeRappels,
  type LigneAbo,
  type Periodicite,
  type StatutAbo,
} from '../../../abonnements/abonnements';
import { comptesSuivis, exporterPaiementsPar, modifierCompteAboPar, suspendrePourImpayePar } from '../../../abonnements/actionsAbo';
import { police } from '../../../themes';
import { reactiverPar } from '../../actions';
import { Avis, Pilule, Segments, type OutilsAdmin } from '../commun';
import { AIDE_ABONNEMENTS } from '../Abonnements';
import { Aide, CadreAdmin } from './briques';

type Filtre = 'tous' | 'en-retard' | 'echeance';
type Genre = 'menu' | 'paye' | 'partiel' | 'echeance' | 'modifier' | 'suspendre' | 'historique' | 'message';

function idPaiement(): string {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function copier(texte: string): Promise<boolean> {
  const presse = (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator?.clipboard;
  if (!presse) return false;
  try {
    await presse.writeText(texte);
    return true;
  } catch {
    return false;
  }
}

function couleurStatut(statut: StatutAbo, theme: OutilsAdmin['theme']): string {
  return statut === 'en-retard' ? theme.critique : statut === 'echeance-proche' ? theme.alerte : statut === 'a-jour' ? theme.ok : theme.attenue;
}

function texteEcheance(l: LigneAbo): string {
  if (!l.echeance) return 'Échéance à définir';
  const jours = l.jours ?? 0;
  const relatif = jours < 0 ? `en retard de ${-jours} j` : jours === 0 ? 'aujourd’hui' : `dans ${jours} j`;
  return `Échéance ${dateFr(l.echeance)} (${relatif})`;
}

export function Abonnements({ outils, onRetour }: { outils: OutilsAdmin; onRetour(): void }) {
  const { theme, donnees, tous } = outils;
  const reglages = donnees.abonnements.reglages;
  const aujourdhui = dateDuJour(outils.maintenant());
  const suivis = comptesSuivis(outils.acteur, tous);
  const lignes = lignesAbo(suivis, donnees.abonnements, aujourdhui);
  const [filtre, setFiltre] = useState<Filtre>('tous');
  const [sous, setSous] = useState('30');
  const [ouvert, setOuvert] = useState<{ id: string; genre: Genre } | undefined>();
  const [info, setInfo] = useState<string | undefined>();
  const joursSous = Math.max(0, Number(sous.replace(/[^\d]/g, '')) || 0);
  const affichees = filtrerLignes(lignes, filtre === 'en-retard' ? { statut: 'en-retard' } : filtre === 'echeance' ? { echeanceSous: joursSous } : {});
  const resume = resumeRappels(lignes);
  const ligneOuverte = ouvert ? lignes.find(l => l.id === ouvert.id) : undefined;
  const fermer = () => setOuvert(undefined);

  const modifier = (id: string, evenement: string, changer: Parameters<typeof modifierCompteAboPar>[4], avis: string) => {
    try {
      const maintenant = outils.maintenant();
      outils.majDonnees(d => modifierCompteAboPar(outils.acteur, d, tous, id, changer, evenement, maintenant));
      setInfo(avis);
      setOuvert(undefined);
    } catch (e) {
      setInfo(e instanceof Error ? e.message : String(e));
    }
  };

  const exporter = () => {
    const enregistrer = outils.services?.enregistrerFichier;
    if (!enregistrer) {
      setInfo('Export indisponible sur cette plateforme.');
      return;
    }
    outils.agir('Export des paiements…', async () => {
      const contenu = exporterPaiementsPar(outils.acteur, donnees, tous);
      const nom = `abonnements-paiements-${aujourdhui}.csv`;
      const fait = await enregistrer(nom, contenu, 'text/csv;charset=utf-8');
      if (fait) {
        outils.journaliser({ type: 'export', action: 'Historique des paiements exporté (CSV)' });
        return `Historique exporté : ${nom}`;
      }
      return 'Export annulé.';
    });
  };

  return (
    <CadreAdmin
      theme={theme}
      titre="Abonnements"
      libelleRetour="Admin"
      onRetour={onRetour}
      testID="admin-section-abonnements"
      actions={[{ titre: '⇩', libelle: 'Exporter l’historique (CSV)', onPress: exporter, testID: 'admin-abo-export' }]}>
      <View style={{ gap: ESPACE.xs, padding: ESPACE.m, borderWidth: 1, borderColor: theme.ligne, backgroundColor: theme.surface, borderRadius: rayonCarte(theme) }}>
        <Text testID="admin-abonnements-resume" style={{ color: theme.texte, fontSize: TEXTE.corps, fontWeight: '700', lineHeight: 24, ...police(theme.policeTexte) }}>
          {resume.texte || 'Aucun retard, aucune échéance cette semaine.'}
        </Text>
        <Text testID="admin-abonnements-regle" style={{ color: theme.attenue, fontSize: TEXTE.legende, lineHeight: 22, ...police(theme.policeTexte) }}>
          Règle en cas de retard : {reglages.actionRetard === 'restreindre' ? 'restreindre l’accès (suspension manuelle, avec confirmation)' : 'rappel seulement (rien de bloquant)'}.
        </Text>
      </View>
      <Segments<Filtre>
        theme={theme}
        libelle="Filtre"
        valeur={filtre}
        options={[['tous', 'Tous'], ['en-retard', 'En retard'], ['echeance', 'Échéance proche']]}
        onChoisir={setFiltre}
        testID="admin-abo-filtre"
      />
      {filtre === 'echeance' ? <ChampMobile theme={theme} etiquette="Échéance sous (jours)" nature="nombre" value={sous} onChangeText={v => setSous(v.replace(/[^\d]/g, ''))} maxLength={3} testID="admin-abo-sous" /> : null}
      {info ? <Avis theme={theme} genre="info" texte={info} testID="admin-abo-info" /> : null}

      {affichees.length === 0 ? <Aide theme={theme}>{lignes.length === 0 ? 'Aucun compte à suivre : seuls les rangs inférieurs au vôtre sont listés.' : 'Aucun compte ne correspond au filtre.'}</Aide> : null}
      {affichees.map(l => (
        <View key={l.id} testID={`admin-abo-${l.id}`} style={{ gap: ESPACE.xs, padding: ESPACE.m, borderWidth: 1, borderColor: theme.ligne, backgroundColor: theme.surface, borderRadius: rayonCarte(theme) }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESPACE.xs, flexWrap: 'wrap' }}>
            <Text style={{ color: theme.texte, fontSize: 19, fontWeight: '700', ...police(theme.policeTexte) }}>{l.nom}</Text>
            <Pilule theme={theme} texte={LIBELLES_STATUT[l.statut]} couleur={couleurStatut(l.statut, theme)} testID={`admin-abo-statut-${l.id}`} />
          </View>
          <Text testID={`admin-abo-echeance-${l.id}`} style={{ color: theme.texte, fontSize: TEXTE.corps, ...police(theme.policeTexte) }}>
            {texteEcheance(l)}
          </Text>
          <Text style={{ color: theme.attenue, fontSize: TEXTE.legende, lineHeight: 22, ...police(theme.policeTexte) }}>
            {LIBELLES_PERIODICITE[l.compte.periodicite]} · {formaterMontant(l.compte.montant, reglages.devise)}
            {l.echeance && l.resteDu !== l.compte.montant ? ` · reste dû ${formaterMontant(l.resteDu, reglages.devise)}` : ''}
          </Text>
          <Text testID={`admin-abo-dernier-${l.id}`} style={{ color: theme.attenue, fontSize: TEXTE.legende, lineHeight: 22, ...police(theme.policeTexte) }}>
            {l.dernier
              ? `Dernier paiement : ${dateFr(l.dernier.date)} · ${formaterMontant(l.dernier.montant, reglages.devise)}${l.dernier.remise > 0 ? ` (remise ${formaterMontant(l.dernier.remise, reglages.devise)})` : ''}${l.dernier.moyen ? ` · ${l.dernier.moyen}` : ''}`
              : 'Aucun paiement enregistré'}
          </Text>
          {l.compte.notes ? <Text style={{ color: theme.attenue, fontSize: TEXTE.legende, fontStyle: 'italic', ...police(theme.policeTexte) }}>Note privée : {l.compte.notes}</Text> : null}
          <View style={{ gap: ESPACE.xs, marginTop: ESPACE.xs }}>
            <BoutonPrincipal theme={theme} titre="Marquer payé" onPress={() => setOuvert({ id: l.id, genre: 'paye' })} testID={`admin-abo-paye-${l.id}`} />
            <BoutonPrincipal theme={theme} variante="discret" titre="Plus d’actions…" onPress={() => setOuvert({ id: l.id, genre: 'menu' })} testID={`admin-abo-plus-${l.id}`} />
          </View>
        </View>
      ))}

      <GroupeCellules theme={theme}>
        <Cellule theme={theme} titre="Réglages des abonnements" sousTitre="Devise, moyens de paiement, règle en retard, modèle de rappel" chevron testID="admin-abo-reglages" onPress={() => outils.onParametres?.('administration')} />
      </GroupeCellules>
      <Aide theme={theme} testID="admin-abonnements-aide">
        {AIDE_ABONNEMENTS}
      </Aide>

      {ouvert && ligneOuverte ? (
        <FeuilleAbo outils={outils} ligne={ligneOuverte} genre={ouvert.genre} onChoisir={g => setOuvert({ id: ligneOuverte.id, genre: g })} onFermer={fermer} modifier={modifier} setInfo={setInfo} />
      ) : null}
    </CadreAdmin>
  );
}

function FeuilleAbo({
  outils,
  ligne: l,
  genre,
  onChoisir,
  onFermer,
  modifier,
  setInfo,
}: {
  outils: OutilsAdmin;
  ligne: LigneAbo;
  genre: Genre;
  onChoisir(g: Genre): void;
  onFermer(): void;
  modifier(id: string, evenement: string, changer: Parameters<typeof modifierCompteAboPar>[4], avis: string): void;
  setInfo(texte: string): void;
}) {
  const { theme, donnees, tous } = outils;
  const reglages = donnees.abonnements.reglages;
  const profil = comptesSuivis(outils.acteur, tous).find(p => p.id === l.id)!;
  const horodatage = () => new Date(outils.maintenant()).toISOString();

  if (genre === 'menu') {
    return (
      <FeuilleBasse theme={theme} visible titre={l.nom} description={texteEcheance(l)} onFermer={onFermer} testID="admin-abo-menu">
        <GroupeCellules theme={theme} titre="Paiement">
          <Cellule theme={theme} titre="Paiement partiel ou remise" chevron testID={`admin-abo-partiel-${l.id}`} onPress={() => onChoisir('partiel')} />
          <Cellule theme={theme} titre="Changer l’échéance" chevron testID={`admin-abo-echeance-bouton-${l.id}`} onPress={() => onChoisir('echeance')} />
          <Cellule theme={theme} titre="Historique des paiements" chevron testID={`admin-abo-historique-${l.id}`} onPress={() => onChoisir('historique')} />
        </GroupeCellules>
        <GroupeCellules theme={theme} titre="Abonnement">
          <Cellule
            theme={theme}
            titre={l.compte.mode === 'offert' ? 'Retirer l’offre' : 'Offrir / exempter'}
            testID={`admin-abo-offrir-${l.id}`}
            onPress={() =>
              modifier(
                l.id,
                l.compte.mode === 'offert' ? `Abonnement de ${l.nom} : offre retirée` : `Abonnement de ${l.nom} offert (exempté)`,
                c => definirMode(c, c.mode === 'offert' ? 'normal' : 'offert', horodatage()),
                l.compte.mode === 'offert' ? `${l.nom} : offre retirée.` : `${l.nom} : abonnement offert.`,
              )
            }
          />
          <Cellule
            theme={theme}
            titre={l.compte.mode === 'pause' ? 'Reprendre le suivi' : 'Mettre en pause'}
            testID={`admin-abo-pause-${l.id}`}
            onPress={() =>
              modifier(
                l.id,
                l.compte.mode === 'pause' ? `Abonnement de ${l.nom} repris` : `Abonnement de ${l.nom} mis en pause`,
                c => definirMode(c, c.mode === 'pause' ? 'normal' : 'pause', horodatage()),
                l.compte.mode === 'pause' ? `${l.nom} : suivi repris.` : `${l.nom} : suivi en pause (ni retard ni rappel).`,
              )
            }
          />
          <Cellule theme={theme} titre="Modifier (périodicité, montant, note)" chevron testID={`admin-abo-modifier-${l.id}`} onPress={() => onChoisir('modifier')} />
          <Cellule theme={theme} titre="Copier un message de rappel" chevron testID={`admin-abo-message-${l.id}`} onPress={() => onChoisir('message')} />
        </GroupeCellules>
        {reglages.actionRetard === 'restreindre' && (l.statut === 'en-retard' && profil.actif !== false) ? (
          <GroupeCellules theme={theme} titre="Compte">
            <Cellule theme={theme} titre="Suspendre pour impayé" danger chevron testID={`admin-abo-suspendre-${l.id}`} onPress={() => onChoisir('suspendre')} />
          </GroupeCellules>
        ) : null}
        {reglages.actionRetard === 'restreindre' && profil.actif === false ? (
          <GroupeCellules theme={theme} titre="Compte">
            <Cellule
              theme={theme}
              titre="Réactiver le compte"
              testID={`admin-abo-reactiver-${l.id}`}
              onPress={() => {
                onFermer();
                outils.modifierProfils(
                  liste => reactiverPar(outils.acteur, liste, l.id),
                  [{ type: 'abonnement', cible: l.id, nomCible: l.nom, action: `Compte de ${l.nom} réactivé (abonnement réglé)` }],
                  `${l.nom} : compte réactivé.`,
                );
              }}
            />
          </GroupeCellules>
        ) : null}
      </FeuilleBasse>
    );
  }
  if (genre === 'paye' || genre === 'partiel') {
    return (
      <FeuillePaiement
        outils={outils}
        ligne={l}
        partiel={genre === 'partiel'}
        onFermer={onFermer}
        onValider={saisie => {
          const libelle = `${formaterMontant(saisie.montant, reglages.devise)}${saisie.remise ? ` + remise ${formaterMontant(saisie.remise, reglages.devise)}` : ''}`;
          modifier(
            l.id,
            `Paiement de ${l.nom} enregistré : ${libelle} le ${dateFr(saisie.date)}${saisie.moyen ? ` (${saisie.moyen})` : ''}`,
            c =>
              genre === 'paye' && saisie.remise === 0
                ? marquerPaye(c, { date: saisie.date, moyen: saisie.moyen, id: idPaiement(), montant: saisie.montant }, horodatage())
                : enregistrerPaiement(c, { date: saisie.date, moyen: saisie.moyen, id: idPaiement(), montant: saisie.montant, remise: saisie.remise }, horodatage()),
            `Paiement de ${l.nom} enregistré (${libelle}).`,
          );
        }}
      />
    );
  }
  if (genre === 'echeance') {
    return <FeuilleEcheance outils={outils} ligne={l} onFermer={onFermer} onValider={date => modifier(l.id, `Échéance de ${l.nom} fixée au ${dateFr(date)}`, c => modifierEcheance(c, date, horodatage()), `Échéance de ${l.nom} : ${dateFr(date)}.`)} />;
  }
  if (genre === 'modifier') {
    return (
      <FeuilleCompte
        outils={outils}
        ligne={l}
        onFermer={onFermer}
        onValider={changement => modifier(l.id, `Abonnement de ${l.nom} modifié (périodicité, montant ou note)`, c => configurerCompte(c, changement, horodatage()), `${l.nom} : abonnement mis à jour.`)}
      />
    );
  }
  if (genre === 'historique') {
    const liste = [...l.compte.paiements].reverse();
    return (
      <FeuilleBasse theme={theme} visible titre={`Historique de ${l.nom}`} onFermer={onFermer} testID={`admin-abo-historique-liste-${l.id}`}>
        {liste.length === 0 ? <Aide theme={theme}>Aucun paiement enregistré.</Aide> : null}
        {liste.length > 0 ? (
          <GroupeCellules theme={theme}>
            {liste.map(p => (
              <Cellule
                key={p.id}
                theme={theme}
                titre={`${dateFr(p.date)} · ${formaterMontant(p.montant, reglages.devise)}${p.remise > 0 ? ` + remise ${formaterMontant(p.remise, reglages.devise)}` : ''}`}
                sousTitre={`${p.moyen || 'moyen non précisé'} · échéance ${dateFr(p.pour)}`}
              />
            ))}
          </GroupeCellules>
        ) : null}
      </FeuilleBasse>
    );
  }
  if (genre === 'message') {
    return (
      <FeuilleMessage
        outils={outils}
        ligne={l}
        onFermer={onFermer}
        onCopie={copie => {
          outils.journaliser({ type: 'abonnement', cible: l.id, nomCible: l.nom, action: `Message de rappel copié pour ${l.nom}` });
          setInfo(copie ? `Message de rappel copié pour ${l.nom}.` : 'Copie automatique indisponible : sélectionnez le texte du message.');
          onFermer();
        }}
      />
    );
  }
  return (
    <FeuilleSuspension
      outils={outils}
      ligne={l}
      onFermer={onFermer}
      onValider={jours => {
        onFermer();
        outils.modifierProfils(
          liste => suspendrePourImpayePar(outils.acteur, donnees, liste, l.id, jours, outils.maintenant()),
          [{ type: 'abonnement', cible: l.id, nomCible: l.nom, action: `Compte de ${l.nom} suspendu pour impayé (${jours} jour${jours > 1 ? 's' : ''})` }],
          `${l.nom} : compte suspendu ${jours} jour${jours > 1 ? 's' : ''}. Vous pouvez le réactiver à tout moment.`,
        );
      }}
    />
  );
}

function FeuillePaiement({ outils, ligne, partiel, onValider, onFermer }: { outils: OutilsAdmin; ligne: LigneAbo; partiel: boolean; onValider(saisie: { date: string; montant: number; remise: number; moyen: string }): void; onFermer(): void }) {
  const { theme, donnees } = outils;
  const { reglages } = donnees.abonnements;
  const [date, setDate] = useState(dateDuJour(outils.maintenant()));
  const defaut = ligne.resteDu > 0 ? ligne.resteDu : ligne.compte.montant;
  const [montant, setMontant] = useState(partiel ? '' : (defaut / 100).toFixed(2).replace('.', ','));
  const [remise, setRemise] = useState('');
  const [moyen, setMoyen] = useState(reglages.moyens[0] ?? '');
  const [erreur, setErreur] = useState<string | undefined>();
  const valider = () => {
    const m = montant.trim() ? centimesDepuisTexte(montant) : 0;
    const r = remise.trim() ? centimesDepuisTexte(remise) : 0;
    if (!dateValide(date)) return setErreur('Date invalide : AAAA-MM-JJ.');
    if (m === undefined || r === undefined) return setErreur('Montant illisible (ex. 5,00).');
    if (m + r <= 0) return setErreur('Indiquez un montant ou une remise.');
    setErreur(undefined);
    onValider({ date, montant: m, remise: r, moyen });
  };
  return (
    <FeuilleBasse
      theme={theme}
      visible
      titre={partiel ? `Paiement partiel · ${ligne.nom}` : `${ligne.nom} a payé`}
      description="L’échéance avance d’une période quand le reste dû est soldé (paiements et remises cumulés)."
      onFermer={onFermer}
      testID={`admin-abo-form-paiement-${ligne.id}`}
      pied={<BoutonPrincipal theme={theme} titre="Enregistrer le paiement" onPress={valider} testID="admin-abo-form-valider" />}>
      <ChampMobile theme={theme} etiquette={`Montant reçu (${reglages.devise})`} nature="decimal" value={montant} onChangeText={setMontant} maxLength={10} testID="admin-abo-form-montant" />
      <ChampMobile theme={theme} etiquette="Date du paiement (AAAA-MM-JJ)" inputMode="numeric" value={date} onChangeText={setDate} maxLength={10} testID="admin-abo-form-date" />
      <ChampMobile theme={theme} etiquette={`Remise (${reglages.devise}, facultatif)`} nature="decimal" value={remise} onChangeText={setRemise} maxLength={10} testID="admin-abo-form-remise" />
      <ChampMobile theme={theme} etiquette="Moyen de paiement" value={moyen} onChangeText={setMoyen} maxLength={40} placeholder="virement, espèces…" testID="admin-abo-form-moyen" />
      {reglages.moyens.length > 0 ? (
        <Segments theme={theme} libelle="Moyens habituels" valeur={moyen} options={reglages.moyens.map(m => [m.slice(0, 40), m.slice(0, 24)] as const)} onChoisir={setMoyen} testID="admin-abo-form-moyen-choix" />
      ) : null}
      {erreur ? <Avis theme={theme} genre="critique" texte={erreur} testID="admin-abo-form-erreur" /> : null}
    </FeuilleBasse>
  );
}

function FeuilleEcheance({ outils, ligne, onValider, onFermer }: { outils: OutilsAdmin; ligne: LigneAbo; onValider(date: string): void; onFermer(): void }) {
  const { theme } = outils;
  const [date, setDate] = useState(ligne.echeance ?? dateDuJour(outils.maintenant()));
  return (
    <FeuilleBasse theme={theme} visible titre={`Échéance de ${ligne.nom}`} onFermer={onFermer} testID={`admin-abo-form-echeance-${ligne.id}`}
      pied={<BoutonPrincipal theme={theme} titre="Enregistrer l’échéance" desactive={!dateValide(date)} onPress={() => onValider(date)} testID="admin-abo-form-echeance-valider" />}>
      <ChampMobile theme={theme} etiquette="Prochaine échéance (AAAA-MM-JJ)" inputMode="numeric" value={date} onChangeText={setDate} maxLength={10} erreur={dateValide(date) ? undefined : 'Date invalide : AAAA-MM-JJ.'} testID="admin-abo-form-echeance" />
    </FeuilleBasse>
  );
}

function FeuilleCompte({ outils, ligne, onValider, onFermer }: { outils: OutilsAdmin; ligne: LigneAbo; onValider(changement: { periodicite: Periodicite; montant: number; notes: string }): void; onFermer(): void }) {
  const { theme, donnees } = outils;
  const [periodicite, setPeriodicite] = useState<Periodicite>(ligne.compte.periodicite);
  const [montant, setMontant] = useState((ligne.compte.montant / 100).toFixed(2).replace('.', ','));
  const [notes, setNotes] = useState(ligne.compte.notes);
  const [erreur, setErreur] = useState<string | undefined>();
  return (
    <FeuilleBasse theme={theme} visible titre={`Abonnement de ${ligne.nom}`} onFermer={onFermer} testID={`admin-abo-form-compte-${ligne.id}`}
      pied={
        <BoutonPrincipal
          theme={theme}
          titre="Enregistrer"
          testID="admin-abo-form-compte-valider"
          onPress={() => {
            const m = centimesDepuisTexte(montant);
            if (m === undefined) return setErreur('Montant illisible (ex. 5,00).');
            onValider({ periodicite, montant: m, notes });
          }}
        />
      }>
      <Segments<Periodicite> theme={theme} libelle="Périodicité" valeur={periodicite} options={PERIODICITES.map(p => [p, LIBELLES_PERIODICITE[p]] as const)} onChoisir={setPeriodicite} testID="admin-abo-form-periodicite" />
      <ChampMobile theme={theme} etiquette={`Montant par période (${donnees.abonnements.reglages.devise})`} nature="decimal" value={montant} onChangeText={setMontant} maxLength={10} testID="admin-abo-form-montant-periode" />
      <ChampMobile theme={theme} etiquette="Notes privées (vous seul·e les voyez)" nature="multiligne" value={notes} onChangeText={setNotes} maxLength={1000} testID="admin-abo-form-notes" />
      {erreur ? <Avis theme={theme} genre="critique" texte={erreur} /> : null}
    </FeuilleBasse>
  );
}

function FeuilleMessage({ outils, ligne, onCopie, onFermer }: { outils: OutilsAdmin; ligne: LigneAbo; onCopie(copie: boolean): void; onFermer(): void }) {
  const { theme, donnees } = outils;
  const [texte, setTexte] = useState(() => messageRappel(ligne, donnees.abonnements.reglages));
  return (
    <FeuilleBasse theme={theme} visible titre="Message de rappel" description="Vous l’envoyez vous-même, par le canal de votre choix : l’application n’envoie rien." onFermer={onFermer} testID={`admin-abo-form-message-${ligne.id}`}
      pied={<BoutonPrincipal theme={theme} titre="Copier le message" onPress={() => void copier(texte).then(onCopie)} testID="admin-abo-message-copier" />}>
      <ChampMobile theme={theme} etiquette="Message" nature="multiligne" value={texte} onChangeText={setTexte} maxLength={600} testID="admin-abo-message-texte" />
    </FeuilleBasse>
  );
}

function FeuilleSuspension({ outils, ligne, onValider, onFermer }: { outils: OutilsAdmin; ligne: LigneAbo; onValider(jours: number): void; onFermer(): void }) {
  const { theme } = outils;
  const [jours, setJours] = useState('30');
  const n = Number(jours);
  return (
    <FeuilleBasse theme={theme} visible titre={`Suspendre ${ligne.nom} ?`} description={`${ligne.nom} ne pourra plus ouvrir son compte pendant la durée choisie (suspension habituelle, réversible à tout moment). Rien n’est automatique : c’est vous qui décidez.`} onFermer={onFermer} testID={`admin-abo-form-suspension-${ligne.id}`}
      pied={<BoutonPrincipal theme={theme} variante="danger" titre="Oui, suspendre le compte" desactive={!(n >= 1 && n <= 365)} onPress={() => onValider(n)} testID="admin-abo-suspension-confirmer" />}>
      <ChampMobile theme={theme} etiquette="Durée (jours, 1 à 365)" nature="nombre" value={jours} onChangeText={v => setJours(v.replace(/[^\d]/g, ''))} maxLength={3} testID="admin-abo-suspension-jours" />
    </FeuilleBasse>
  );
}
