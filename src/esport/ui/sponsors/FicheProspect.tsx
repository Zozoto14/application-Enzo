/**
 * Fiche d'un prospect (volet) : informations (secteur, taille, source, intérêt, priorité, valeur estimée, teams,
 * responsable), prochaine action (date : rappel par notification et récapitulatif), contacts (e-mail par modèle
 * FR / EN), historique des échanges, pièces jointes (deck, proposition), changement d'étape (raison de la
 * perte), conversion en partenaire en un clic, suppression. Lecture seule sans `sponsors.gerer`.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub, Champ } from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import { NIVEAUX, PRIORITES, TAILLES, type ApiSponsors, type Contact, type FicheProspect as Fiche, type GenreEchange, type Niveau, type Priorite, type Taille } from '../../sponsors/api';
import { formaterMontant, nomEtape, saisieMontant } from '../../sponsors/regles';
import { trSp, type CleSp } from '../../i18n/sponsors';
import { BoutonConfirme, Choix, Intertitre, Panneau, Retours, styles, useAgir } from '../commun';
import { Badge, ESP, Squelette, attenue, texte } from '../design';
import { Aide, ChampInstant, quand } from '../cm/commun';
import { BadgePriorite, ChoixTeams, Contacts, Echanges, PiecesSp, TON_ISSUE, nomCompte, type Faire } from './commun';

interface Saisie {
  nom: string;
  site: string;
  secteur: string;
  taille: Taille;
  source: string;
  interet: string;
  priorite: Priorite;
  valeur: string;
  notes: string;
  teams: string[];
  responsable: string;
}

const saisieDe = (f: Fiche): Saisie => ({
  nom: f.prospect.nom,
  site: f.prospect.site,
  secteur: f.prospect.secteur,
  taille: f.prospect.taille,
  source: f.prospect.source,
  interet: String(f.prospect.interet),
  priorite: f.prospect.priorite,
  valeur: saisieMontant(f.prospect.valeurEstimee),
  notes: f.prospect.notes,
  teams: f.prospect.teams,
  responsable: f.prospect.responsable ?? '',
});

export function FicheProspect({
  theme,
  api,
  id,
  teams,
  comptes,
  club,
  onChange,
  onPartenaire,
  onSupprime,
}: {
  theme: ThemeHub;
  api: ApiSponsors;
  id: string;
  teams: Array<{ id: string; nom: string }>;
  comptes: Array<{ compte: string; pseudo: string | null }>;
  club: string;
  onChange(): void;
  onPartenaire(id: string): void;
  onSupprime(): void;
}) {
  const [f, setF] = useState<Fiche | undefined>();
  const [saisie, setSaisie] = useState<Saisie | undefined>();
  const [action, setAction] = useState<{ texte: string; le: string | null } | undefined>();
  const [perte, setPerte] = useState<{ etapeId: string; raison: string } | undefined>();
  const [niveau, setNiveau] = useState<Niveau>('partenaire');
  const [prefill, setPrefill] = useState<{ genre: GenreEchange; resume: string; contactId?: string; cle: number } | undefined>();
  const { erreur, avis, agir } = useAgir();
  const charger = useCallback(async () => {
    const x = await api.prospect(id);
    setF(x);
    setAction({ texte: x.prospect.prochaineAction, le: x.prospect.prochaineActionLe });
  }, [api, id]);
  useEffect(() => {
    void agir('', charger);
  }, [agir, charger]);
  const faire: Faire = (cle, a, m) =>
    agir(cle, async () => {
      await a();
      await charger();
      onChange();
      return m;
    });
  if (!f) return erreur ? <Retours theme={theme} erreur={erreur} prefixe="esport-sp-prospect" /> : <Squelette theme={theme} lignes={6} />;
  const p = f.prospect;
  const gerer = f.gerer;
  const etape = f.etapes.find(e => e.id === p.etapeId);
  const toutesTeams = [...teams, ...p.teams.filter(t => !teams.some(x => x.id === t)).map(t => ({ id: t, nom: f.teams[t] ?? '?' }))];
  const deplacer = (etapeId: string, raisonPerte?: string) =>
    faire('etape', async () => {
      await api.deplacerProspect(p.id, { etapeId, ...(raisonPerte ? { raisonPerte } : {}) });
      setPerte(undefined);
    });
  return (
    <View style={{ gap: ESP.m }} testID="esport-sp-prospect">
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-sp-prospect" />
      <View style={[styles.ligne, { gap: ESP.xs }]}>
        {etape ? <Badge theme={theme} ton={TON_ISSUE[etape.issue]} texte={nomEtape(etape)} testID="esport-sp-prospect-etape" /> : null}
        <BadgePriorite theme={theme} priorite={p.priorite} />
        {p.valeurEstimee ? <Badge theme={theme} texte={formaterMontant(p.valeurEstimee)} /> : null}
        {p.partenaireId ? <Badge theme={theme} ton="ok" texte={trSp('prospect.converti')} /> : null}
      </View>
      {p.raisonPerte ? <Text style={texte(theme)} testID="esport-sp-prospect-raison">{trSp('prospect.raison_perte_texte', { raison: p.raisonPerte })}</Text> : null}

      {/* Étape et conversion */}
      {gerer ? (
        <Panneau theme={theme} testID="esport-sp-prospect-etapes">
          <Intertitre theme={theme}>{trSp('prospect.etape')}</Intertitre>
          <View style={[styles.ligne, { gap: ESP.xs }]} accessibilityRole="radiogroup" accessibilityLabel={trSp('prospect.etape')}>
            {f.etapes
              .filter(e => !e.archive)
              .map(e => (
                <BoutonHub
                  key={e.id}
                  theme={theme}
                  titre={nomEtape(e)}
                  variante={e.id === p.etapeId ? 'plein' : 'normal'}
                  onPress={() => (e.issue === 'perdue' && e.id !== p.etapeId ? setPerte({ etapeId: e.id, raison: '' }) : e.id !== p.etapeId ? void deplacer(e.id) : undefined)}
                  testID={`esport-sp-prospect-etape-${e.cle ?? e.id}`}
                />
              ))}
          </View>
          {perte ? (
            <View style={{ gap: ESP.xs }}>
              <Champ theme={theme} libelle={trSp('prospect.raison_perte')} valeur={perte.raison} onChanger={raison => setPerte({ ...perte, raison })} maxLength={300} testID="esport-sp-prospect-raison-saisie" />
              <View style={[styles.ligne, { gap: ESP.xs }]}>
                <BoutonHub theme={theme} titre={trSp('prospect.marquer_perdu')} variante="danger" desactive={perte.raison.trim().length < 2} onPress={() => void deplacer(perte.etapeId, perte.raison.trim())} testID="esport-sp-prospect-perdu-ok" />
                <BoutonHub theme={theme} titre={trSp('c.annuler')} onPress={() => setPerte(undefined)} testID="esport-sp-prospect-perdu-annuler" />
              </View>
            </View>
          ) : null}
          {p.partenaireId ? (
            <BoutonHub theme={theme} titre={trSp('prospect.voir_partenaire')} onPress={() => onPartenaire(p.partenaireId!)} testID="esport-sp-prospect-voir-partenaire" />
          ) : (
            <View style={{ gap: ESP.xs }}>
              {p.issue === 'gagnee' ? <Aide theme={theme}>{trSp('prospect.signe_aide')}</Aide> : null}
              <Choix theme={theme} libelle={trSp('partenaire.niveau')} valeur={niveau} options={NIVEAUX.map(n => ({ id: n, nom: trSp(`niveau.${n}` as CleSp) }))} onChoisir={v => setNiveau(v as Niveau)} testID="esport-sp-prospect-niveau" />
              <BoutonHub
                theme={theme}
                titre={trSp('prospect.convertir')}
                variante={p.issue === 'gagnee' ? 'plein' : 'normal'}
                onPress={() =>
                  void agir('convertir', async () => {
                    const r = await api.convertir(p.id, niveau);
                    onChange();
                    onPartenaire(r.partenaireId);
                  })
                }
                testID="esport-sp-prospect-convertir"
              />
            </View>
          )}
        </Panneau>
      ) : null}

      {/* Prochaine action */}
      <Panneau theme={theme} testID="esport-sp-prospect-action">
        <Intertitre theme={theme}>{trSp('prospect.prochaine_action')}</Intertitre>
        {!gerer || !action ? (
          <Text style={p.actionEnRetard ? { ...texte(theme), color: theme.critique } : texte(theme)}>{p.prochaineAction || p.prochaineActionLe ? [p.prochaineAction, quand(p.prochaineActionLe)].filter(Boolean).join(' · ') : trSp('prospect.aucune_action')}</Text>
        ) : (
          <View style={{ gap: ESP.xs }}>
            {p.actionEnRetard ? <Badge theme={theme} ton="critique" texte={trSp('prospect.action_en_retard')} /> : null}
            <Champ theme={theme} libelle={trSp('prospect.que_faire')} valeur={action.texte} onChanger={t => setAction({ ...action, texte: t })} maxLength={200} testID="esport-sp-prospect-action-texte" />
            <ChampInstant theme={theme} libelle={trSp('prospect.prochaine_action_le')} valeur={action.le} fuseau="Europe/Paris" onChanger={le => setAction({ ...action, le })} testID="esport-sp-prospect-action-le" />
            <Aide theme={theme}>{trSp('prospect.rappel_aide')}</Aide>
            {action.texte !== p.prochaineAction || action.le !== p.prochaineActionLe ? (
              <BoutonHub theme={theme} titre={trSp('c.enregistrer')} variante="plein" onPress={() => void faire('action', () => api.modifierProspect(p.id, { prochaineAction: action.texte.trim(), prochaineActionLe: action.le }), trSp('c.enregistre'))} testID="esport-sp-prospect-action-enregistrer" />
            ) : null}
          </View>
        )}
      </Panneau>

      {/* Informations */}
      <Panneau theme={theme} testID="esport-sp-prospect-infos">
        <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
          <Intertitre theme={theme}>{trSp('prospect.informations')}</Intertitre>
          {gerer && !saisie ? <BoutonHub theme={theme} titre={trSp('c.modifier')} onPress={() => setSaisie(saisieDe(f))} testID="esport-sp-prospect-modifier" /> : null}
        </View>
        {!saisie ? (
          <View style={{ gap: ESP.xxs }}>
            {[
              [trSp('champ.secteur'), p.secteur],
              [trSp('champ.taille'), p.taille ? trSp(`taille.${p.taille}` as CleSp) : ''],
              [trSp('champ.source'), p.source],
              [trSp('champ.interet'), trSp(`interet.${p.interet}` as CleSp)],
              [trSp('champ.site'), p.site],
              [trSp('champ.responsable'), p.responsable ? nomCompte(f.noms, p.responsable) : ''],
              [trSp('c.teams'), p.teams.map(t => f.teams[t] ?? '?').join(', ')],
            ]
              .filter(([, v]) => v)
              .map(([l, v]) => (
                <Text key={l} selectable style={texte(theme, 14)}>{`${l} : ${v}`}</Text>
              ))}
            {p.notes ? (
              <Text selectable style={{ ...texte(theme, 14), marginTop: ESP.xs }}>
                {p.notes}
              </Text>
            ) : null}
          </View>
        ) : (
          <View style={{ gap: ESP.xs }}>
            <Champ theme={theme} libelle={trSp('champ.nom')} valeur={saisie.nom} onChanger={nom => setSaisie({ ...saisie, nom })} maxLength={120} testID="esport-sp-prospect-nom" />
            <View style={[styles.ligne, { gap: ESP.xs }]}>
              <Champ theme={theme} libelle={trSp('champ.secteur')} valeur={saisie.secteur} onChanger={secteur => setSaisie({ ...saisie, secteur })} maxLength={80} testID="esport-sp-prospect-secteur" style={{ flex: 1, minWidth: 160 }} />
              <Champ theme={theme} libelle={trSp('champ.source')} valeur={saisie.source} onChanger={source => setSaisie({ ...saisie, source })} maxLength={120} testID="esport-sp-prospect-source" style={{ flex: 1, minWidth: 160 }} />
            </View>
            <View style={[styles.ligne, { gap: ESP.xs }]}>
              <Champ theme={theme} libelle={trSp('champ.valeur')} valeur={saisie.valeur} onChanger={valeur => setSaisie({ ...saisie, valeur })} maxLength={16} testID="esport-sp-prospect-valeur" style={{ flex: 1, minWidth: 140 }} />
              <Champ theme={theme} libelle={trSp('champ.site')} valeur={saisie.site} onChanger={site => setSaisie({ ...saisie, site })} placeholder="https://" maxLength={300} testID="esport-sp-prospect-site" style={{ flex: 2, minWidth: 200 }} />
            </View>
            <Choix theme={theme} libelle={trSp('champ.taille')} valeur={saisie.taille} options={TAILLES.map(t => ({ id: t, nom: t ? trSp(`taille.${t}` as CleSp) : '—' }))} onChoisir={taille => setSaisie({ ...saisie, taille })} testID="esport-sp-prospect-taille" />
            <Choix theme={theme} libelle={trSp('champ.interet')} valeur={saisie.interet} options={['0', '1', '2', '3'].map(i => ({ id: i, nom: trSp(`interet.${i}` as CleSp) }))} onChoisir={interet => setSaisie({ ...saisie, interet })} testID="esport-sp-prospect-interet" />
            <Choix theme={theme} libelle={trSp('champ.priorite')} valeur={saisie.priorite} options={PRIORITES.map(x => ({ id: x, nom: trSp(`priorite.${x}` as CleSp) }))} onChoisir={priorite => setSaisie({ ...saisie, priorite })} testID="esport-sp-prospect-priorite" />
            <Choix theme={theme} libelle={trSp('champ.responsable')} valeur={saisie.responsable} options={[{ id: '', nom: '—' }, ...comptes.map(c => ({ id: c.compte, nom: c.pseudo ?? c.compte }))]} onChoisir={responsable => setSaisie({ ...saisie, responsable })} testID="esport-sp-prospect-responsable" />
            <ChoixTeams theme={theme} teams={toutesTeams} valeur={saisie.teams} onChanger={t => setSaisie({ ...saisie, teams: t })} testID="esport-sp-prospect-team" />
            <Champ theme={theme} libelle={trSp('c.notes')} valeur={saisie.notes} onChanger={notes => setSaisie({ ...saisie, notes })} multiligne maxLength={8000} testID="esport-sp-prospect-notes" />
            <View style={[styles.ligne, { gap: ESP.xs }]}>
              <BoutonHub
                theme={theme}
                titre={trSp('c.enregistrer')}
                variante="plein"
                desactive={!saisie.nom.trim()}
                onPress={() =>
                  void faire(
                    'infos',
                    async () => {
                      await api.modifierProspect(p.id, {
                        nom: saisie.nom.trim(),
                        site: saisie.site.trim(),
                        secteur: saisie.secteur,
                        taille: saisie.taille,
                        source: saisie.source,
                        interet: Number(saisie.interet),
                        priorite: saisie.priorite,
                        valeurEstimee: saisie.valeur,
                        notes: saisie.notes,
                        teams: saisie.teams,
                        responsable: saisie.responsable || null,
                        versionAttendue: p.version,
                      });
                      setSaisie(undefined);
                    },
                    trSp('c.enregistre'),
                  )
                }
                testID="esport-sp-prospect-enregistrer"
              />
              <BoutonHub theme={theme} titre={trSp('c.annuler')} onPress={() => setSaisie(undefined)} testID="esport-sp-prospect-annuler" />
            </View>
          </View>
        )}
      </Panneau>

      <Contacts
        theme={theme}
        api={api}
        cible={{ prospectId: p.id }}
        contacts={f.contacts}
        entreprise={p.nom}
        club={club}
        gerer={gerer}
        faire={faire}
        onEchangeEmail={gerer ? (c: Contact, sujet: string) => setPrefill({ genre: 'email', resume: trSp('echanges.email_envoye', { sujet }), contactId: c.id, cle: Date.now() }) : undefined}
      />
      <Echanges theme={theme} api={api} cible={{ prospectId: p.id }} echanges={f.echanges} contacts={f.contacts} noms={f.noms} gerer={gerer} faire={faire} prefill={prefill} avecProchaineAction />
      <PiecesSp theme={theme} api={api} cible={{ prospectId: p.id }} pieces={f.pieces} gerer={gerer} faire={faire} />
      <Text style={attenue(theme)}>{trSp('prospect.cree', { date: quand(p.creeLe), qui: nomCompte(f.noms, p.creePar) })}</Text>
      {gerer ? (
        <BoutonConfirme
          theme={theme}
          titre={trSp('prospect.supprimer')}
          confirmation={trSp('prospect.confirmer_suppression')}
          onConfirme={() =>
            void agir('supprimer', async () => {
              await api.supprimerProspect(p.id);
              onChange();
              onSupprime();
            })
          }
          testID="esport-sp-prospect-supprimer"
        />
      ) : null}
    </View>
  );
}
