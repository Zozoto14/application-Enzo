/**
 * Onglet « Suivi » de l'app Abonnements : suivi MANUEL de qui a payé son
 * abonnement au hub. Rappels seulement : aucun paiement automatique, aucune
 * coupure automatique. Réservé aux Fondateurs (`actionsAbo.ts` revérifie le rang).
 *
 * Les données restent celles de l'Administration (`DonneesAdmin.abonnements`,
 * base chiffrée du Fondateur, même synchronisation) : seul l'écran a changé d'app.
 */

import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { Profil } from '../../profils/profils';
import {
  LIBELLES_PERIODICITE,
  LIBELLES_STATUT,
  PERIODICITES,
  centimesDepuisTexte,
  dateDuJour,
  dateFr,
  dateValide,
  enregistrerPaiement,
  filtrerLignes,
  formaterMontant,
  lignesAbo,
  marquerPaye,
  messageRappel,
  modifierEcheance,
  resumeRappels,
  configurerCompte,
  definirMode,
  type LigneAbo,
  type Periodicite,
  type StatutAbo,
} from './abonnements';
import { comptesSuivis, exporterPaiementsPar, modifierCompteAboPar, suspendrePourImpayePar } from './actionsAbo';
import { police } from '../themes';
import { reactiverPar } from '../admin/actions';
import { Avis, BoutonHub, Champ, Intertitre, Panneau, Pilule, Segments, commun, type OutilsAdmin } from '../admin/ui/commun';
import { ChampDate } from '../../ui/dates';

/** Ce que l'app Abonnements fournit à son onglet « Suivi » (sous-ensemble des outils de l'Administration). */
export type OutilsAbo = Pick<OutilsAdmin, 'theme' | 'donnees' | 'tous' | 'acteur' | 'maintenant' | 'majDonnees' | 'journaliser' | 'agir' | 'services' | 'modifierProfils'>;

export const AIDE_ABONNEMENTS =
  'Suivi manuel et informatif : vous notez qui a payé, l’application calcule les échéances et vous rappelle. Aucun paiement n’est prélevé ni vérifié, et aucun compte n’est coupé automatiquement. Ce n’est ni une facturation ni un conseil fiscal ou juridique.';

const FILTRES: ReadonlyArray<readonly ['tous' | 'en-retard' | 'echeance', string]> = [
  ['tous', 'Tous'],
  ['en-retard', 'En retard'],
  ['echeance', 'Échéance proche'],
];

type Formulaire = 'paye' | 'partiel' | 'echeance' | 'modifier' | 'suspendre' | 'historique' | 'message';

function idPaiement(): string {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Copie dans le presse-papiers (web ou Electron) ; faux si indisponible. */
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

function couleurStatut(statut: StatutAbo, theme: OutilsAbo['theme']): string {
  return statut === 'en-retard' ? theme.critique : statut === 'echeance-proche' ? theme.alerte : statut === 'a-jour' ? theme.ok : theme.attenue;
}

function texteEcheance(l: LigneAbo): string {
  if (!l.echeance) return 'Échéance à définir';
  const jours = l.jours ?? 0;
  const relatif = jours < 0 ? `en retard de ${-jours} j` : jours === 0 ? 'aujourd’hui' : `dans ${jours} j`;
  return `Échéance ${dateFr(l.echeance)} (${relatif})`;
}

export function SuiviAbonnements({ outils, onReglages }: { outils: OutilsAbo; onReglages?(): void }) {
  const { theme, donnees, tous } = outils;
  const reglages = donnees.abonnements.reglages;
  const aujourdhui = dateDuJour(outils.maintenant());
  const suivis = comptesSuivis(outils.acteur, tous);
  const lignes = lignesAbo(suivis, donnees.abonnements, aujourdhui);
  const [filtre, setFiltre] = useState<'tous' | 'en-retard' | 'echeance'>('tous');
  const [sous, setSous] = useState('30');
  const [ouvert, setOuvert] = useState<{ id: string; genre: Formulaire } | undefined>();
  const [info, setInfo] = useState<string | undefined>();
  const joursSous = Math.max(0, Number(sous.replace(/[^\d]/g, '')) || 0);
  const affichees = filtrerLignes(lignes, filtre === 'en-retard' ? { statut: 'en-retard' } : filtre === 'echeance' ? { echeanceSous: joursSous } : {});
  const resume = resumeRappels(lignes);
  const texte = { color: theme.texte, ...police(theme.policeTexte) };
  const attenue = { color: theme.attenue, ...police(theme.policeTexte) };

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
    <View style={{ gap: 16 }} testID="admin-section-abonnements">
      <Panneau theme={theme}>
        <Intertitre theme={theme}>Abonnements</Intertitre>
        <Text style={[attenue, { fontSize: 13 }]} testID="admin-abonnements-aide">
          {AIDE_ABONNEMENTS}
        </Text>
        <Text style={[texte, { fontWeight: '700' }]} testID="admin-abonnements-resume">
          {resume.texte || 'Aucun retard, aucune échéance cette semaine.'}
        </Text>
        <Text style={[attenue, { fontSize: 12 }]} testID="admin-abonnements-regle">
          Règle en cas de retard : {reglages.actionRetard === 'restreindre' ? 'restreindre l’accès (suspension manuelle, avec confirmation)' : 'rappel seulement (rien de bloquant)'}. Réglable dans l’onglet Réglages de cette app.
        </Text>
        <View style={commun.actions}>
          <Segments<'tous' | 'en-retard' | 'echeance'> theme={theme} libelle="Filtre" valeur={filtre} options={FILTRES} onChoisir={setFiltre} testID="admin-abo-filtre" />
          {filtre === 'echeance' ? (
            <Champ theme={theme} libelle="Sous (jours)" valeur={sous} onChanger={v => setSous(v.replace(/[^\d]/g, ''))} clavier="number-pad" maxLength={3} testID="admin-abo-sous" style={{ width: 110 }} />
          ) : null}
          <BoutonHub theme={theme} titre="Exporter l’historique (CSV)" onPress={exporter} testID="admin-abo-export" />
          {onReglages ? <BoutonHub theme={theme} titre="Réglages des abonnements" onPress={onReglages} testID="admin-abo-reglages" /> : null}
        </View>
        {info ? <Avis theme={theme} genre="info" texte={info} testID="admin-abo-info" /> : null}
      </Panneau>

      {affichees.length === 0 ? (
        <Panneau theme={theme}>
          <Text style={attenue}>{lignes.length === 0 ? 'Aucun compte à suivre : seuls les rangs inférieurs au vôtre sont listés.' : 'Aucun compte ne correspond au filtre.'}</Text>
        </Panneau>
      ) : null}

      {affichees.map(l => {
        const couleur = couleurStatut(l.statut, theme);
        const actif = ouvert?.id === l.id ? ouvert.genre : undefined;
        const ouvrir = (genre: Formulaire) => setOuvert(actif === genre ? undefined : { id: l.id, genre });
        const profil = suivis.find(p => p.id === l.id)!;
        return (
          <Panneau theme={theme} key={l.id} testID={`admin-abo-${l.id}`}>
            <View style={[commun.ligne, { flexWrap: 'wrap', paddingVertical: 0 }]}>
              <Text style={[texte, { fontWeight: '700', fontSize: 17 }]}>{l.nom}</Text>
              <Pilule theme={theme} texte={LIBELLES_STATUT[l.statut]} couleur={couleur} testID={`admin-abo-statut-${l.id}`} />
            </View>
            <Text style={[texte, { fontSize: 13 }]} testID={`admin-abo-echeance-${l.id}`}>
              {texteEcheance(l)}
            </Text>
            <Text style={[attenue, { fontSize: 13 }]} testID={`admin-abo-dernier-${l.id}`}>
              {l.dernier
                ? `Dernier paiement : ${dateFr(l.dernier.date)} · ${formaterMontant(l.dernier.montant, reglages.devise)}${l.dernier.remise > 0 ? ` (remise ${formaterMontant(l.dernier.remise, reglages.devise)})` : ''}${l.dernier.moyen ? ` · ${l.dernier.moyen}` : ''}`
                : 'Aucun paiement enregistré'}
            </Text>
            <Text style={[attenue, { fontSize: 13 }]}>
              {LIBELLES_PERIODICITE[l.compte.periodicite]} · {formaterMontant(l.compte.montant, reglages.devise)}
              {l.echeance && l.resteDu !== l.compte.montant ? ` · reste dû ${formaterMontant(l.resteDu, reglages.devise)}` : ''}
            </Text>
            {l.compte.notes ? <Text style={[attenue, { fontSize: 12, fontStyle: 'italic' }]}>Note privée : {l.compte.notes}</Text> : null}

            <View style={commun.actions}>
              <BoutonHub theme={theme} variante="plein" couleur={theme.teintes.admin} titre="Marquer payé" onPress={() => ouvrir('paye')} testID={`admin-abo-paye-${l.id}`} />
              <BoutonHub theme={theme} titre="Partiel / remise" onPress={() => ouvrir('partiel')} testID={`admin-abo-partiel-${l.id}`} />
              <BoutonHub
                theme={theme}
                titre={l.compte.mode === 'offert' ? 'Retirer l’offre' : 'Offrir / exempter'}
                onPress={() =>
                  modifier(
                    l.id,
                    l.compte.mode === 'offert' ? `Abonnement de ${l.nom} : offre retirée` : `Abonnement de ${l.nom} offert (exempté)`,
                    (c, _r) => definirMode(c, c.mode === 'offert' ? 'normal' : 'offert', new Date(outils.maintenant()).toISOString()),
                    l.compte.mode === 'offert' ? `${l.nom} : offre retirée.` : `${l.nom} : abonnement offert.`,
                  )
                }
                testID={`admin-abo-offrir-${l.id}`}
              />
              <BoutonHub
                theme={theme}
                titre={l.compte.mode === 'pause' ? 'Reprendre' : 'Mettre en pause'}
                onPress={() =>
                  modifier(
                    l.id,
                    l.compte.mode === 'pause' ? `Abonnement de ${l.nom} repris` : `Abonnement de ${l.nom} mis en pause`,
                    c => definirMode(c, c.mode === 'pause' ? 'normal' : 'pause', new Date(outils.maintenant()).toISOString()),
                    l.compte.mode === 'pause' ? `${l.nom} : suivi repris.` : `${l.nom} : suivi en pause (ni retard ni rappel).`,
                  )
                }
                testID={`admin-abo-pause-${l.id}`}
              />
              <BoutonHub theme={theme} titre="Échéance" onPress={() => ouvrir('echeance')} testID={`admin-abo-echeance-bouton-${l.id}`} />
              <BoutonHub theme={theme} titre="Modifier" onPress={() => ouvrir('modifier')} testID={`admin-abo-modifier-${l.id}`} />
              <BoutonHub theme={theme} titre="Historique" onPress={() => ouvrir('historique')} testID={`admin-abo-historique-${l.id}`} />
              <BoutonHub theme={theme} titre="Copier un message de rappel" onPress={() => ouvrir('message')} testID={`admin-abo-message-${l.id}`} />
              {reglages.actionRetard === 'restreindre' && l.statut === 'en-retard' && profil.actif !== false ? (
                <BoutonHub theme={theme} titre="Suspendre pour impayé" couleur={theme.critique} onPress={() => ouvrir('suspendre')} testID={`admin-abo-suspendre-${l.id}`} />
              ) : null}
              {reglages.actionRetard === 'restreindre' && profil.actif === false ? (
                <BoutonHub
                  theme={theme}
                  titre="Réactiver le compte"
                  onPress={() =>
                    outils.modifierProfils(
                      liste => reactiverPar(outils.acteur, liste, l.id),
                      [{ type: 'abonnement', cible: l.id, nomCible: l.nom, action: `Compte de ${l.nom} réactivé (abonnement réglé)` }],
                      `${l.nom} : compte réactivé.`,
                    )
                  }
                  testID={`admin-abo-reactiver-${l.id}`}
                />
              ) : null}
            </View>

            {actif === 'paye' || actif === 'partiel' ? (
              <FormulairePaiement
                outils={outils}
                ligne={l}
                partiel={actif === 'partiel'}
                onValider={saisie => {
                  const maintenant = new Date(outils.maintenant()).toISOString();
                  const libelle = `${formaterMontant(saisie.montant, reglages.devise)}${saisie.remise ? ` + remise ${formaterMontant(saisie.remise, reglages.devise)}` : ''}`;
                  modifier(
                    l.id,
                    `Paiement de ${l.nom} enregistré : ${libelle} le ${dateFr(saisie.date)}${saisie.moyen ? ` (${saisie.moyen})` : ''}`,
                    c =>
                      actif === 'paye' && saisie.remise === 0
                        ? marquerPaye(c, { date: saisie.date, moyen: saisie.moyen, id: idPaiement(), montant: saisie.montant }, maintenant)
                        : enregistrerPaiement(c, { date: saisie.date, moyen: saisie.moyen, id: idPaiement(), montant: saisie.montant, remise: saisie.remise }, maintenant),
                    `Paiement de ${l.nom} enregistré (${libelle}).`,
                  );
                }}
              />
            ) : null}
            {actif === 'echeance' ? (
              <FormulaireEcheance
                outils={outils}
                ligne={l}
                onValider={date =>
                  modifier(l.id, `Échéance de ${l.nom} fixée au ${dateFr(date)}`, c => modifierEcheance(c, date, new Date(outils.maintenant()).toISOString()), `Échéance de ${l.nom} : ${dateFr(date)}.`)
                }
              />
            ) : null}
            {actif === 'modifier' ? (
              <FormulaireCompte
                outils={outils}
                ligne={l}
                onValider={changement =>
                  modifier(l.id, `Abonnement de ${l.nom} modifié (périodicité, montant ou note)`, c => configurerCompte(c, changement, new Date(outils.maintenant()).toISOString()), `${l.nom} : abonnement mis à jour.`)
                }
              />
            ) : null}
            {actif === 'historique' ? <Historique outils={outils} ligne={l} /> : null}
            {actif === 'message' ? (
              <MessageRappel
                outils={outils}
                ligne={l}
                onCopie={copie => {
                  outils.journaliser({ type: 'abonnement', cible: l.id, nomCible: l.nom, action: `Message de rappel copié pour ${l.nom}` });
                  setInfo(copie ? `Message de rappel copié pour ${l.nom}.` : 'Copie automatique indisponible : sélectionnez le texte ci-dessus.');
                }}
              />
            ) : null}
            {actif === 'suspendre' ? (
              <FormulaireSuspension
                outils={outils}
                ligne={l}
                onValider={jours =>
                  outils.modifierProfils(
                    liste => suspendrePourImpayePar(outils.acteur, donnees, liste, l.id, jours, outils.maintenant()),
                    [{ type: 'abonnement', cible: l.id, nomCible: l.nom, action: `Compte de ${l.nom} suspendu pour impayé (${jours} jour${jours > 1 ? 's' : ''})` }],
                    `${l.nom} : compte suspendu ${jours} jour${jours > 1 ? 's' : ''}. Vous pouvez le réactiver à tout moment.`,
                  )
                }
              />
            ) : null}
          </Panneau>
        );
      })}
    </View>
  );
}

function Formulaire({ theme, children, testID }: { theme: OutilsAbo['theme']; children: React.ReactNode; testID: string }) {
  return (
    <View testID={testID} style={{ gap: 10, padding: 12, borderTopWidth: 1, borderTopColor: theme.ligne }}>
      {children}
    </View>
  );
}

function FormulairePaiement({
  outils,
  ligne,
  partiel,
  onValider,
}: {
  outils: OutilsAbo;
  ligne: LigneAbo;
  partiel: boolean;
  onValider(saisie: { date: string; montant: number; remise: number; moyen: string }): void;
}) {
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
    <Formulaire theme={theme} testID={`admin-abo-form-paiement-${ligne.id}`}>
      <Text style={{ color: theme.texte, fontWeight: '700' }}>{partiel ? `Paiement partiel ou remise pour ${ligne.nom}` : `Marquer ${ligne.nom} comme ayant payé`}</Text>
      <View style={commun.grille}>
        <ChampDate theme={theme} libelle="Date du paiement" valeur={date} onChanger={setDate} testID="admin-abo-form-date" style={{ flexBasis: 150, flexGrow: 1 }} />
        <Champ theme={theme} libelle={`Montant reçu (${reglages.devise})`} valeur={montant} onChanger={setMontant} maxLength={10} testID="admin-abo-form-montant" style={{ flexBasis: 150, flexGrow: 1 }} />
        <Champ theme={theme} libelle={`Remise (${reglages.devise})`} valeur={remise} onChanger={setRemise} maxLength={10} testID="admin-abo-form-remise" style={{ flexBasis: 120, flexGrow: 1 }} />
        <Champ theme={theme} libelle="Moyen de paiement" valeur={moyen} onChanger={setMoyen} maxLength={40} testID="admin-abo-form-moyen" placeholder="virement, espèces…" style={{ flexBasis: 180, flexGrow: 1 }} />
      </View>
      {reglages.moyens.length > 0 ? (
        <View style={commun.actions}>
          {reglages.moyens.map(m => (
            <BoutonHub key={m} theme={theme} titre={m.slice(0, 24)} onPress={() => setMoyen(m.slice(0, 40))} />
          ))}
        </View>
      ) : null}
      <Text style={{ color: theme.attenue, fontSize: 12 }}>
        L’échéance avance d’une période quand le reste dû de l’échéance en cours est soldé (paiements et remises cumulés). Sinon, elle ne bouge pas.
      </Text>
      {erreur ? <Avis theme={theme} genre="critique" texte={erreur} testID="admin-abo-form-erreur" /> : null}
      <View style={commun.actions}>
        <BoutonHub theme={theme} variante="plein" couleur={theme.teintes.admin} titre="Enregistrer le paiement" onPress={valider} testID="admin-abo-form-valider" />
      </View>
    </Formulaire>
  );
}

function FormulaireEcheance({ outils, ligne, onValider }: { outils: OutilsAbo; ligne: LigneAbo; onValider(date: string): void }) {
  const { theme } = outils;
  const [date, setDate] = useState(ligne.echeance ?? dateDuJour(outils.maintenant()));
  const [erreur, setErreur] = useState<string | undefined>();
  return (
    <Formulaire theme={theme} testID={`admin-abo-form-echeance-${ligne.id}`}>
      <ChampDate theme={theme} libelle="Prochaine échéance" valeur={date} onChanger={setDate} testID="admin-abo-form-echeance" style={{ maxWidth: 240 }} />
      {erreur ? <Avis theme={theme} genre="critique" texte={erreur} /> : null}
      <View style={commun.actions}>
        <BoutonHub theme={theme} variante="plein" couleur={theme.teintes.admin} titre="Enregistrer l’échéance" onPress={() => (dateValide(date) ? onValider(date) : setErreur('Date invalide : AAAA-MM-JJ.'))} testID="admin-abo-form-echeance-valider" />
      </View>
    </Formulaire>
  );
}

function FormulaireCompte({
  outils,
  ligne,
  onValider,
}: {
  outils: OutilsAbo;
  ligne: LigneAbo;
  onValider(changement: { periodicite: Periodicite; montant: number; notes: string }): void;
}) {
  const { theme, donnees } = outils;
  const [periodicite, setPeriodicite] = useState<Periodicite>(ligne.compte.periodicite);
  const [montant, setMontant] = useState((ligne.compte.montant / 100).toFixed(2).replace('.', ','));
  const [notes, setNotes] = useState(ligne.compte.notes);
  const [erreur, setErreur] = useState<string | undefined>();
  return (
    <Formulaire theme={theme} testID={`admin-abo-form-compte-${ligne.id}`}>
      <Segments<Periodicite> theme={theme} libelle="Périodicité" valeur={periodicite} options={PERIODICITES.map(p => [p, LIBELLES_PERIODICITE[p]] as const)} onChoisir={setPeriodicite} testID="admin-abo-form-periodicite" />
      <Champ theme={theme} libelle={`Montant par période (${donnees.abonnements.reglages.devise})`} valeur={montant} onChanger={setMontant} maxLength={10} testID="admin-abo-form-montant-periode" style={{ maxWidth: 240 }} />
      <Champ theme={theme} libelle="Notes privées (vous seul·e les voyez)" valeur={notes} onChanger={setNotes} multiligne maxLength={1000} testID="admin-abo-form-notes" />
      {erreur ? <Avis theme={theme} genre="critique" texte={erreur} /> : null}
      <View style={commun.actions}>
        <BoutonHub
          theme={theme}
          variante="plein"
          couleur={theme.teintes.admin}
          titre="Enregistrer"
          onPress={() => {
            const m = centimesDepuisTexte(montant);
            if (m === undefined) return setErreur('Montant illisible (ex. 5,00).');
            onValider({ periodicite, montant: m, notes });
          }}
          testID="admin-abo-form-compte-valider"
        />
      </View>
    </Formulaire>
  );
}

function Historique({ outils, ligne }: { outils: OutilsAbo; ligne: LigneAbo }) {
  const { theme } = outils;
  const { devise } = outils.donnees.abonnements.reglages;
  const liste = [...ligne.compte.paiements].reverse();
  return (
    <Formulaire theme={theme} testID={`admin-abo-historique-liste-${ligne.id}`}>
      <Text style={{ color: theme.texte, fontWeight: '700' }}>Historique des paiements de {ligne.nom}</Text>
      {liste.length === 0 ? <Text style={{ color: theme.attenue }}>Aucun paiement enregistré.</Text> : null}
      {liste.map(p => (
        <Text key={p.id} style={{ color: theme.texte, fontSize: 13 }}>
          {dateFr(p.date)} · {formaterMontant(p.montant, devise)}
          {p.remise > 0 ? ` + remise ${formaterMontant(p.remise, devise)}` : ''} · {p.moyen || 'moyen non précisé'} · échéance {dateFr(p.pour)}
        </Text>
      ))}
    </Formulaire>
  );
}

function MessageRappel({ outils, ligne, onCopie }: { outils: OutilsAbo; ligne: LigneAbo; onCopie(copie: boolean): void }) {
  const { theme, donnees } = outils;
  const [texte, setTexte] = useState(() => messageRappel(ligne, donnees.abonnements.reglages));
  return (
    <Formulaire theme={theme} testID={`admin-abo-form-message-${ligne.id}`}>
      <Text style={{ color: theme.attenue, fontSize: 12 }}>
        Modèle personnalisable dans l’onglet Réglages de cette app. Vous l’envoyez vous-même, par le canal de votre choix : l’application n’envoie rien.
      </Text>
      <Champ theme={theme} libelle="Message" valeur={texte} onChanger={setTexte} multiligne maxLength={600} testID="admin-abo-message-texte" />
      <View style={commun.actions}>
        <BoutonHub theme={theme} variante="plein" couleur={theme.teintes.admin} titre="Copier" onPress={() => void copier(texte).then(onCopie)} testID="admin-abo-message-copier" />
      </View>
    </Formulaire>
  );
}

function FormulaireSuspension({ outils, ligne, onValider }: { outils: OutilsAbo; ligne: LigneAbo; onValider(jours: number): void }) {
  const { theme } = outils;
  const [jours, setJours] = useState('30');
  const [confirme, setConfirme] = useState(false);
  const n = Number(jours);
  return (
    <Formulaire theme={theme} testID={`admin-abo-form-suspension-${ligne.id}`}>
      <Text style={{ color: theme.texte, fontWeight: '700' }}>Suspendre le compte de {ligne.nom} pour impayé ?</Text>
      <Text style={{ color: theme.attenue, fontSize: 13 }}>
        {ligne.nom} ne pourra plus ouvrir son compte pendant la durée choisie (suspension de compte habituelle, réversible à tout moment). Rien n’est automatique : c’est vous qui décidez.
      </Text>
      <Champ theme={theme} libelle="Durée (jours)" valeur={jours} onChanger={v => setJours(v.replace(/[^\d]/g, ''))} clavier="number-pad" maxLength={3} testID="admin-abo-suspension-jours" style={{ maxWidth: 160 }} />
      {confirme ? (
        <View style={commun.actions}>
          <BoutonHub theme={theme} variante="plein" couleur={theme.critique} titre="Oui, suspendre le compte" onPress={() => onValider(n)} desactive={!(n >= 1 && n <= 365)} testID="admin-abo-suspension-confirmer" />
          <BoutonHub theme={theme} titre="Annuler" onPress={() => setConfirme(false)} />
        </View>
      ) : (
        <View style={commun.actions}>
          <Pressable accessibilityRole="button" onPress={() => setConfirme(true)} testID="admin-abo-suspension-continuer">
            <Text style={{ color: theme.critique, fontWeight: '700' }}>Continuer…</Text>
          </Pressable>
        </View>
      )}
    </Formulaire>
  );
}

export type { Profil };
