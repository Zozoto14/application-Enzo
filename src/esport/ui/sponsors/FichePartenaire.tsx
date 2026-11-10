/**
 * Fiche d'un partenaire / sponsor (volet) : logo, niveau, teams concernées, contrats (dates, montant, dotation en
 * nature, renouvellement, préavis), contreparties (obligations par période : avancement fait / à faire, posts CM
 * publiés qui comptent, saisie manuelle, rappels), contacts, échanges, pièces jointes. Lecture seule sans
 * `sponsors.gerer`.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Image, Text, View } from 'react-native';
import { BoutonHub, Champ } from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import { FREQUENCES, GENRES_OBLIGATION, NIVEAUX, RENOUVELLEMENTS, STATUTS_CONTRAT, type ApiSponsors, type Contrat, type FichePartenaire as Fiche, type GenreEchange, type Niveau, type Obligation, type SaisieContrat, type SaisieObligation } from '../../sponsors/api';
import { formaterMontant, nomPeriode, saisieMontant } from '../../sponsors/regles';
import { trSp, trnSp, type CleSp } from '../../i18n/sponsors';
import { BoutonConfirme, Choix, Intertitre, Panneau, Retours, styles, useAgir } from '../commun';
import { Badge, ESP, Squelette, attenue, texte, type Ton } from '../design';
import { Aide } from '../cm/commun';
import { ChoixTeams, Contacts, Echanges, PiecesSp, nomCompte, type Faire } from './commun';
import { ChampDate } from '../../../ui/dates';

const TON_ETAT: Record<'fait' | 'a_faire' | 'en_retard', Ton> = { fait: 'ok', a_faire: 'alerte', en_retard: 'critique' };

function Logo({ theme, api, pieceId, nom }: { theme: ThemeHub; api: ApiSponsors; pieceId: string | null; nom: string }) {
  const [url, setUrl] = useState<string | undefined>();
  useEffect(() => {
    let vivant = true;
    setUrl(undefined);
    if (pieceId)
      api
        .lienPiece(pieceId)
        .then(l => vivant && setUrl(l.url))
        .catch(() => undefined);
    return () => {
      vivant = false;
    };
  }, [api, pieceId]);
  if (!url) return null;
  return <Image source={{ uri: url }} accessibilityLabel={trSp('partenaire.logo_de', { nom })} style={{ width: 96, height: 96, borderRadius: 12, backgroundColor: theme.surface }} resizeMode="contain" testID="esport-sp-partenaire-logo" />;
}

export function FichePartenaire({
  theme,
  api,
  id,
  teams,
  comptes,
  club,
  onChange,
  onProspect,
  onSupprime,
  onOuvrirTableau,
}: {
  theme: ThemeHub;
  api: ApiSponsors;
  id: string;
  teams: Array<{ id: string; nom: string }>;
  comptes: Array<{ compte: string; pseudo: string | null }>;
  club: string;
  onChange(): void;
  onProspect(id: string): void;
  onSupprime(): void;
  onOuvrirTableau?(id: string): void;
}) {
  const [f, setF] = useState<Fiche | undefined>();
  const [infos, setInfos] = useState<{ nom: string; site: string; secteur: string; niveau: Niveau; statut: 'actif' | 'termine'; teams: string[]; responsable: string; notes: string } | undefined>();
  const [prefill, setPrefill] = useState<{ genre: GenreEchange; resume: string; contactId?: string; cle: number } | undefined>();
  const { erreur, avis, agir } = useAgir();
  const charger = useCallback(async () => setF(await api.partenaire(id)), [api, id]);
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
  if (!f) return erreur ? <Retours theme={theme} erreur={erreur} prefixe="esport-sp-partenaire" /> : <Squelette theme={theme} lignes={6} />;
  const p = f.partenaire;
  const gerer = f.gerer;
  const toutesTeams = [...teams, ...p.teams.filter(t => !teams.some(x => x.id === t)).map(t => ({ id: t, nom: f.teams[t] ?? '?' }))];
  return (
    <View style={{ gap: ESP.m }} testID="esport-sp-partenaire">
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-sp-partenaire" />
      <View style={[styles.ligne, { gap: ESP.s }]}>
        <Logo theme={theme} api={api} pieceId={p.logoPieceId} nom={p.nom} />
        <View style={{ gap: ESP.xxs, flexShrink: 1 }}>
          <View style={[styles.ligne, { gap: ESP.xs }]}>
            <Badge theme={theme} ton="accent" texte={trSp(`niveau.${p.niveau}` as CleSp)} testID="esport-sp-partenaire-niveau" />
            <Badge theme={theme} ton={p.statut === 'actif' ? 'ok' : 'neutre'} texte={trSp(`statut_partenaire.${p.statut}` as CleSp)} />
          </View>
          {p.teams.length ? <Text style={attenue(theme)}>{p.teams.map(t => f.teams[t] ?? '?').join(', ')}</Text> : null}
          {p.prospectId ? <BoutonHub theme={theme} titre={trSp('partenaire.voir_prospect')} onPress={() => onProspect(p.prospectId!)} testID="esport-sp-partenaire-prospect" /> : null}
        </View>
      </View>

      <Panneau theme={theme} testID="esport-sp-partenaire-infos">
        <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
          <Intertitre theme={theme}>{trSp('prospect.informations')}</Intertitre>
          {gerer && !infos ? (
            <BoutonHub theme={theme} titre={trSp('c.modifier')} onPress={() => setInfos({ nom: p.nom, site: p.site, secteur: p.secteur, niveau: p.niveau, statut: p.statut, teams: p.teams, responsable: p.responsable ?? '', notes: p.notes })} testID="esport-sp-partenaire-modifier" />
          ) : null}
        </View>
        {!infos ? (
          <View style={{ gap: ESP.xxs }}>
            {[
              [trSp('champ.secteur'), p.secteur],
              [trSp('champ.site'), p.site],
              [trSp('champ.responsable'), p.responsable ? nomCompte(f.noms, p.responsable) : ''],
            ]
              .filter(([, v]) => v)
              .map(([l, v]) => (
                <Text key={l} selectable style={texte(theme, 14)}>{`${l} : ${v}`}</Text>
              ))}
            {p.notes ? (
              <Text selectable style={texte(theme, 14)}>
                {p.notes}
              </Text>
            ) : null}
          </View>
        ) : (
          <View style={{ gap: ESP.xs }}>
            <Champ theme={theme} libelle={trSp('champ.nom')} valeur={infos.nom} onChanger={nom => setInfos({ ...infos, nom })} maxLength={120} testID="esport-sp-partenaire-nom" />
            <View style={[styles.ligne, { gap: ESP.xs }]}>
              <Champ theme={theme} libelle={trSp('champ.secteur')} valeur={infos.secteur} onChanger={secteur => setInfos({ ...infos, secteur })} maxLength={80} testID="esport-sp-partenaire-secteur" style={{ flex: 1, minWidth: 160 }} />
              <Champ theme={theme} libelle={trSp('champ.site')} valeur={infos.site} onChanger={site => setInfos({ ...infos, site })} placeholder="https://" maxLength={300} testID="esport-sp-partenaire-site" style={{ flex: 2, minWidth: 200 }} />
            </View>
            <Choix theme={theme} libelle={trSp('partenaire.niveau')} valeur={infos.niveau} options={NIVEAUX.map(n => ({ id: n, nom: trSp(`niveau.${n}` as CleSp) }))} onChoisir={niveau => setInfos({ ...infos, niveau })} testID="esport-sp-partenaire-niveau-choix" />
            <Choix theme={theme} libelle={trSp('partenaire.statut')} valeur={infos.statut} options={(['actif', 'termine'] as const).map(s => ({ id: s, nom: trSp(`statut_partenaire.${s}` as CleSp) }))} onChoisir={statut => setInfos({ ...infos, statut })} testID="esport-sp-partenaire-statut" />
            <Choix theme={theme} libelle={trSp('champ.responsable')} valeur={infos.responsable} options={[{ id: '', nom: '—' }, ...comptes.map(c => ({ id: c.compte, nom: c.pseudo ?? c.compte }))]} onChoisir={responsable => setInfos({ ...infos, responsable })} testID="esport-sp-partenaire-responsable" />
            <ChoixTeams theme={theme} teams={toutesTeams} valeur={infos.teams} onChanger={t => setInfos({ ...infos, teams: t })} testID="esport-sp-partenaire-team" />
            <Champ theme={theme} libelle={trSp('c.notes')} valeur={infos.notes} onChanger={notes => setInfos({ ...infos, notes })} multiligne maxLength={8000} testID="esport-sp-partenaire-notes" />
            <View style={[styles.ligne, { gap: ESP.xs }]}>
              <BoutonHub
                theme={theme}
                titre={trSp('c.enregistrer')}
                variante="plein"
                desactive={!infos.nom.trim()}
                onPress={() =>
                  void faire(
                    'infos',
                    async () => {
                      await api.modifierPartenaire(p.id, { ...infos, nom: infos.nom.trim(), site: infos.site.trim(), responsable: infos.responsable || null, versionAttendue: p.version });
                      setInfos(undefined);
                    },
                    trSp('c.enregistre'),
                  )
                }
                testID="esport-sp-partenaire-enregistrer"
              />
              <BoutonHub theme={theme} titre={trSp('c.annuler')} onPress={() => setInfos(undefined)} testID="esport-sp-partenaire-annuler" />
            </View>
          </View>
        )}
      </Panneau>

      <Contrats theme={theme} api={api} partenaireId={p.id} contrats={f.contrats} gerer={gerer} faire={faire} />
      <Contreparties theme={theme} api={api} partenaireId={p.id} obligations={f.obligations} contrats={f.contrats} comptes={comptes} noms={f.noms} gerer={gerer} faire={faire} onOuvrirTableau={onOuvrirTableau} />
      <Contacts
        theme={theme}
        api={api}
        cible={{ partenaireId: p.id }}
        contacts={f.contacts}
        entreprise={p.nom}
        club={club}
        gerer={gerer}
        faire={faire}
        onEchangeEmail={gerer ? (c, sujet) => setPrefill({ genre: 'email', resume: trSp('echanges.email_envoye', { sujet }), contactId: c.id, cle: Date.now() }) : undefined}
      />
      <Echanges theme={theme} api={api} cible={{ partenaireId: p.id }} echanges={f.echanges} contacts={f.contacts} noms={f.noms} gerer={gerer} faire={faire} prefill={prefill} />
      <PiecesSp theme={theme} api={api} cible={{ partenaireId: p.id }} pieces={f.pieces} gerer={gerer} faire={faire} logoPieceId={p.logoPieceId} onLogo={pieceId => void faire('logo', () => api.modifierPartenaire(p.id, { logoPieceId: pieceId }), trSp('c.enregistre'))} />
      {gerer ? (
        <BoutonConfirme
          theme={theme}
          titre={trSp('partenaire.supprimer')}
          confirmation={trSp('partenaire.confirmer_suppression')}
          onConfirme={() =>
            void agir('supprimer', async () => {
              await api.supprimerPartenaire(p.id);
              onChange();
              onSupprime();
            })
          }
          testID="esport-sp-partenaire-supprimer"
        />
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------ Contrats

type SaisieC = { id?: string; intitule: string; debut: string; fin: string; montant: string; dotation: string; valeurDotation: string; renouvellement: SaisieContrat['renouvellement']; preavis: string; statut: SaisieContrat['statut']; notes: string };

function Contrats({ theme, api, partenaireId, contrats, gerer, faire }: { theme: ThemeHub; api: ApiSponsors; partenaireId: string; contrats: Contrat[]; gerer: boolean; faire: Faire }) {
  const [s, setS] = useState<SaisieC | undefined>();
  const depuis = (c: Contrat): SaisieC => ({ id: c.id, intitule: c.intitule, debut: c.debut, fin: c.fin, montant: saisieMontant(c.montant), dotation: c.dotation, valeurDotation: saisieMontant(c.valeurDotation), renouvellement: c.renouvellement, preavis: String(c.preavisJours), statut: c.statut, notes: c.notes });
  return (
    <Panneau theme={theme} testID="esport-sp-contrats">
      <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
        <Intertitre theme={theme}>{trSp('contrats.titre')}</Intertitre>
        {gerer && !s ? <BoutonHub theme={theme} titre={trSp('contrats.ajouter')} onPress={() => setS({ intitule: '', debut: '', fin: '', montant: '', dotation: '', valeurDotation: '', renouvellement: 'manuel', preavis: '30', statut: 'actif', notes: '' })} testID="esport-sp-contrat-ajouter" /> : null}
      </View>
      {!contrats.length && !s ? <Text style={attenue(theme)}>{trSp('contrats.vide')}</Text> : null}
      {contrats.map(c => (
        <View key={c.id} style={{ gap: 2, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.xs }} testID={`esport-sp-contrat-${c.id}`}>
          <View style={[styles.ligne, { gap: ESP.xs }]}>
            <Text style={{ ...texte(theme), fontWeight: '700' }}>{c.intitule || trSp('contrats.sans_titre')}</Text>
            <Badge theme={theme} ton={c.statut === 'actif' ? 'ok' : 'neutre'} texte={trSp(`statut_contrat.${c.statut}` as CleSp)} />
            {c.statut === 'actif' && c.joursRestants >= 0 && c.joursRestants <= 60 ? <Badge theme={theme} ton="alerte" texte={trnSp('contrats.fin_dans', c.joursRestants)} /> : null}
            {c.statut === 'actif' && c.joursRestants < 0 ? <Badge theme={theme} ton="critique" texte={trSp('contrats.expire')} /> : null}
          </View>
          <Text style={texte(theme, 14)}>{trSp('contrats.du_au', { debut: c.debut, fin: c.fin })}</Text>
          <Text style={texte(theme, 14)}>{[c.montant ? trSp('contrats.numeraire', { montant: formaterMontant(c.montant) }) : '', c.dotation || c.valeurDotation ? trSp('contrats.nature', { dotation: c.dotation || '—', valeur: formaterMontant(c.valeurDotation) }) : ''].filter(Boolean).join(' · ') || '—'}</Text>
          <Text style={attenue(theme)}>{trSp('contrats.renouvellement_texte', { mode: trSp(`renouvellement.${c.renouvellement}` as CleSp), n: c.preavisJours })}</Text>
          {c.notes ? <Text style={attenue(theme)}>{c.notes}</Text> : null}
          {gerer ? (
            <View style={[styles.ligne, { gap: ESP.xs }]}>
              <BoutonHub theme={theme} titre={trSp('c.modifier')} onPress={() => setS(depuis(c))} testID={`esport-sp-contrat-${c.id}-modifier`} />
              <BoutonConfirme theme={theme} titre={trSp('c.supprimer')} confirmation={trSp('contrats.confirmer_suppression')} onConfirme={() => void faire('contrat', () => api.supprimerContrat(c.id))} testID={`esport-sp-contrat-${c.id}-supprimer`} />
            </View>
          ) : null}
        </View>
      ))}
      {s ? (
        <View style={{ gap: ESP.xs }} testID="esport-sp-contrat-saisie">
          <Champ theme={theme} libelle={trSp('contrats.intitule')} valeur={s.intitule} onChanger={intitule => setS({ ...s, intitule })} maxLength={120} testID="esport-sp-contrat-intitule" />
          <View style={[styles.ligne, { gap: ESP.xs }]}>
            <ChampDate theme={theme} libelle={trSp('contrats.debut')} valeur={s.debut} onChanger={debut => setS({ ...s, debut })} testID="esport-sp-contrat-debut" style={{ flex: 1, minWidth: 130 }} />
            <ChampDate theme={theme} min={/^\d{4}-\d{2}-\d{2}$/.test(s.debut) ? s.debut : undefined} libelle={trSp('contrats.fin')} valeur={s.fin} onChanger={fin => setS({ ...s, fin })} testID="esport-sp-contrat-fin" style={{ flex: 1, minWidth: 130 }} />
          </View>
          <View style={[styles.ligne, { gap: ESP.xs }]}>
            <Champ theme={theme} libelle={trSp('contrats.montant')} valeur={s.montant} onChanger={montant => setS({ ...s, montant })} maxLength={16} testID="esport-sp-contrat-montant" style={{ flex: 1, minWidth: 140 }} />
            <Champ theme={theme} libelle={trSp('contrats.valeur_dotation')} valeur={s.valeurDotation} onChanger={valeurDotation => setS({ ...s, valeurDotation })} maxLength={16} testID="esport-sp-contrat-valeur-dotation" style={{ flex: 1, minWidth: 140 }} />
          </View>
          <Champ theme={theme} libelle={trSp('contrats.dotation')} valeur={s.dotation} onChanger={dotation => setS({ ...s, dotation })} multiligne maxLength={2000} testID="esport-sp-contrat-dotation" />
          <Choix theme={theme} libelle={trSp('contrats.renouvellement')} valeur={s.renouvellement} options={RENOUVELLEMENTS.map(r => ({ id: r, nom: trSp(`renouvellement.${r}` as CleSp) }))} onChoisir={renouvellement => setS({ ...s, renouvellement })} testID="esport-sp-contrat-renouvellement" />
          <Champ theme={theme} libelle={trSp('contrats.preavis')} valeur={s.preavis} onChanger={preavis => setS({ ...s, preavis })} clavier="number-pad" maxLength={3} testID="esport-sp-contrat-preavis" />
          <Choix theme={theme} libelle={trSp('contrats.statut')} valeur={s.statut} options={STATUTS_CONTRAT.map(x => ({ id: x, nom: trSp(`statut_contrat.${x}` as CleSp) }))} onChoisir={statut => setS({ ...s, statut })} testID="esport-sp-contrat-statut" />
          <Champ theme={theme} libelle={trSp('c.notes')} valeur={s.notes} onChanger={notes => setS({ ...s, notes })} multiligne maxLength={4000} testID="esport-sp-contrat-notes" />
          <View style={[styles.ligne, { gap: ESP.xs }]}>
            <BoutonHub
              theme={theme}
              titre={trSp('c.enregistrer')}
              variante="plein"
              desactive={!/^\d{4}-\d{2}-\d{2}$/.test(s.debut) || !/^\d{4}-\d{2}-\d{2}$/.test(s.fin)}
              onPress={() =>
                void faire(
                  'contrat',
                  async () => {
                    const corps: SaisieContrat = { intitule: s.intitule, debut: s.debut, fin: s.fin, montant: s.montant, dotation: s.dotation, valeurDotation: s.valeurDotation, renouvellement: s.renouvellement, preavisJours: Number(s.preavis) || 0, statut: s.statut, notes: s.notes };
                    if (s.id) await api.modifierContrat(s.id, corps);
                    else await api.creerContrat(partenaireId, corps);
                    setS(undefined);
                  },
                  trSp('c.enregistre'),
                )
              }
              testID="esport-sp-contrat-enregistrer"
            />
            <BoutonHub theme={theme} titre={trSp('c.annuler')} onPress={() => setS(undefined)} testID="esport-sp-contrat-annuler" />
          </View>
        </View>
      ) : null}
    </Panneau>
  );
}

// ------------------------------------------------------------------ Contreparties

type SaisieO = { id?: string; intitule: string; genre: NonNullable<SaisieObligation['genre']>; comptage: NonNullable<SaisieObligation['comptage']>; frequence: NonNullable<SaisieObligation['frequence']>; quantite: string; contratId: string; debut: string; fin: string; rappel: string; responsable: string; notes: string };

function Contreparties({
  theme,
  api,
  partenaireId,
  obligations,
  contrats,
  comptes,
  noms,
  gerer,
  faire,
  onOuvrirTableau,
}: {
  theme: ThemeHub;
  api: ApiSponsors;
  partenaireId: string;
  obligations: Obligation[];
  contrats: Contrat[];
  comptes: Array<{ compte: string; pseudo: string | null }>;
  noms: Record<string, string | null>;
  gerer: boolean;
  faire: Faire;
  onOuvrirTableau?(id: string): void;
}) {
  const [s, setS] = useState<SaisieO | undefined>();
  const [histo, setHisto] = useState<string | undefined>();
  const depuis = (o: Obligation): SaisieO => ({ id: o.id, intitule: o.intitule, genre: o.genre, comptage: o.comptage, frequence: o.frequence, quantite: String(o.quantite), contratId: o.contratId ?? '', debut: o.debut, fin: o.fin ?? '', rappel: String(o.rappelJours), responsable: o.responsable ?? '', notes: o.notes });
  const enCours = contrats.find(c => c.enCours) ?? contrats.at(-1);
  return (
    <Panneau theme={theme} testID="esport-sp-obligations">
      <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
        <Intertitre theme={theme}>{trSp('obligations.titre')}</Intertitre>
        {gerer && !s ? (
          <BoutonHub
            theme={theme}
            titre={trSp('obligations.ajouter')}
            onPress={() => setS({ intitule: '', genre: 'posts', comptage: 'cartes', frequence: 'mensuelle', quantite: '1', contratId: enCours?.id ?? '', debut: '', fin: '', rappel: '7', responsable: '', notes: '' })}
            testID="esport-sp-obligation-ajouter"
          />
        ) : null}
      </View>
      <Aide theme={theme}>{trSp('obligations.aide')}</Aide>
      {!obligations.length && !s ? <Text style={attenue(theme)}>{trSp('obligations.vide')}</Text> : null}
      {obligations.map(o => {
        const c = o.courante;
        return (
          <View key={o.id} style={{ gap: ESP.xxs, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.xs, opacity: o.archive ? 0.6 : 1 }} testID={`esport-sp-obligation-${o.id}`}>
            <View style={[styles.ligne, { gap: ESP.xs }]}>
              <Text style={{ ...texte(theme), fontWeight: '700' }}>{o.intitule}</Text>
              <Badge theme={theme} texte={trSp(`genre_obligation.${o.genre}` as CleSp)} />
              <Badge theme={theme} texte={trSp('obligations.rythme', { n: o.quantite, frequence: trSp(`frequence.${o.frequence}` as CleSp) })} />
              {o.comptage === 'cartes' ? <Badge theme={theme} ton="accent" texte={trSp('obligations.comptage_cartes')} /> : null}
              {o.enRetard ? <Badge theme={theme} ton="critique" texte={trnSp('obligations.en_retard_n', o.enRetard)} testID={`esport-sp-obligation-${o.id}-retard`} /> : null}
              {o.archive ? <Badge theme={theme} texte={trSp('c.archivee')} /> : null}
            </View>
            {c ? (
              <View style={[styles.ligne, { gap: ESP.xs }]}>
                <Text style={texte(theme, 14)} testID={`esport-sp-obligation-${o.id}-courante`}>
                  {trSp('obligations.courante', { periode: nomPeriode(c.cle), fait: c.fait, quantite: c.quantite })}
                </Text>
                <Badge theme={theme} ton={TON_ETAT[c.etat]} texte={trSp(`etat.${c.etat}` as CleSp)} />
                {gerer ? (
                  <>
                    <BoutonHub theme={theme} titre="−" libelle={trSp('obligations.moins')} desactive={c.manuel <= 0} onPress={() => void faire('suivi', () => api.suivre(o.id, c.cle, c.manuel - 1, c.note))} testID={`esport-sp-obligation-${o.id}-moins`} />
                    <BoutonHub theme={theme} titre="+" libelle={trSp('obligations.plus')} onPress={() => void faire('suivi', () => api.suivre(o.id, c.cle, c.manuel + 1, c.note))} testID={`esport-sp-obligation-${o.id}-plus`} />
                  </>
                ) : null}
              </View>
            ) : (
              <Text style={attenue(theme)}>{trSp('obligations.pas_commencee', { debut: o.debut })}</Text>
            )}
            {c?.cartes.length ? (
              <View style={[styles.ligne, { gap: ESP.xs }]}>
                <Text style={attenue(theme)}>{trSp('obligations.posts_comptes')}</Text>
                {c.cartes.map((x, i) =>
                  x.masque || !x.id || !x.tableauId ? (
                    <Badge key={`masque-${i}`} theme={theme} icone="cadenas" texte={trSp('obligations.post_restreint')} />
                  ) : onOuvrirTableau ? (
                    <BoutonHub key={x.id} theme={theme} titre={x.titre ?? ''} onPress={() => onOuvrirTableau(x.tableauId as string)} testID={`esport-sp-obligation-carte-${x.id}`} />
                  ) : (
                    <Badge key={x.id} theme={theme} texte={x.titre ?? ''} />
                  ),
                )}
              </View>
            ) : null}
            <Text style={attenue(theme)}>{[trSp('obligations.du_au', { debut: o.debut, fin: o.fin ?? '…' }), o.responsable ? nomCompte(noms, o.responsable) : '', trSp('obligations.rappel', { n: o.rappelJours })].filter(Boolean).join(' · ')}</Text>
            <View style={[styles.ligne, { gap: ESP.xs }]}>
              {o.periodes.length > 1 ? <BoutonHub theme={theme} titre={histo === o.id ? trSp('obligations.masquer_historique') : trSp('obligations.historique')} onPress={() => setHisto(h => (h === o.id ? undefined : o.id))} testID={`esport-sp-obligation-${o.id}-historique`} /> : null}
              {gerer ? <BoutonHub theme={theme} titre={trSp('c.modifier')} onPress={() => setS(depuis(o))} testID={`esport-sp-obligation-${o.id}-modifier`} /> : null}
              {gerer ? <BoutonHub theme={theme} titre={o.archive ? trSp('c.desarchiver') : trSp('c.archiver')} onPress={() => void faire('obligation', () => api.modifierObligation(o.id, { archive: !o.archive }))} testID={`esport-sp-obligation-${o.id}-archiver`} /> : null}
              {gerer ? <BoutonConfirme theme={theme} titre={trSp('c.supprimer')} confirmation={trSp('obligations.confirmer_suppression')} onConfirme={() => void faire('obligation', () => api.supprimerObligation(o.id))} testID={`esport-sp-obligation-${o.id}-supprimer`} /> : null}
            </View>
            {histo === o.id ? (
              <View style={{ gap: 2 }}>
                {[...o.periodes].reverse().map(x => (
                  <View key={x.cle} style={[styles.ligne, { gap: ESP.xs }]}>
                    <Text style={texte(theme, 13)}>{`${nomPeriode(x.cle)} : ${x.fait} / ${x.quantite}`}</Text>
                    <Badge theme={theme} ton={TON_ETAT[x.etat]} texte={trSp(`etat.${x.etat}` as CleSp)} />
                    {gerer && x.cle !== c?.cle ? <BoutonHub theme={theme} titre="+" libelle={trSp('obligations.plus_periode', { periode: nomPeriode(x.cle) })} onPress={() => void faire('suivi', () => api.suivre(o.id, x.cle, x.manuel + 1, x.note))} testID={`esport-sp-obligation-${o.id}-plus-${x.cle}`} /> : null}
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        );
      })}
      {s ? (
        <View style={{ gap: ESP.xs }} testID="esport-sp-obligation-saisie">
          <Champ theme={theme} libelle={trSp('obligations.intitule')} valeur={s.intitule} onChanger={intitule => setS({ ...s, intitule })} placeholder={trSp('obligations.intitule_exemple')} maxLength={160} testID="esport-sp-obligation-intitule" />
          <Choix theme={theme} libelle={trSp('obligations.genre')} valeur={s.genre} options={GENRES_OBLIGATION.map(g => ({ id: g, nom: trSp(`genre_obligation.${g}` as CleSp) }))} onChoisir={genre => setS({ ...s, genre })} testID="esport-sp-obligation-genre" />
          <Choix theme={theme} libelle={trSp('obligations.comptage')} valeur={s.comptage} options={(['cartes', 'manuel'] as const).map(x => ({ id: x, nom: trSp(`comptage.${x}` as CleSp) }))} onChoisir={comptage => setS({ ...s, comptage })} testID="esport-sp-obligation-comptage" />
          <Choix theme={theme} libelle={trSp('obligations.frequence')} valeur={s.frequence} options={FREQUENCES.map(x => ({ id: x, nom: trSp(`frequence.${x}` as CleSp) }))} onChoisir={frequence => setS({ ...s, frequence })} testID="esport-sp-obligation-frequence" />
          <View style={[styles.ligne, { gap: ESP.xs }]}>
            <Champ theme={theme} libelle={trSp('obligations.quantite')} valeur={s.quantite} onChanger={quantite => setS({ ...s, quantite })} clavier="number-pad" maxLength={4} testID="esport-sp-obligation-quantite" style={{ flex: 1, minWidth: 120 }} />
            <Champ theme={theme} libelle={trSp('obligations.rappel_jours')} valeur={s.rappel} onChanger={rappel => setS({ ...s, rappel })} clavier="number-pad" maxLength={2} testID="esport-sp-obligation-rappel" style={{ flex: 1, minWidth: 120 }} />
          </View>
          {contrats.length ? <Choix theme={theme} libelle={trSp('obligations.contrat')} valeur={s.contratId} options={[{ id: '', nom: '—' }, ...contrats.map(c => ({ id: c.id, nom: c.intitule || trSp('contrats.du_au', { debut: c.debut, fin: c.fin }) }))]} onChoisir={contratId => setS({ ...s, contratId })} testID="esport-sp-obligation-contrat" /> : null}
          <View style={[styles.ligne, { gap: ESP.xs }]}>
            <ChampDate theme={theme} placeholder={trSp('obligations.debut_defaut')} libelle={trSp('obligations.debut')} valeur={s.debut} onChanger={debut => setS({ ...s, debut })} testID="esport-sp-obligation-debut" style={{ flex: 1, minWidth: 140 }} />
            <ChampDate theme={theme} placeholder={trSp('obligations.debut_defaut')} libelle={trSp('obligations.fin')} valeur={s.fin} onChanger={fin => setS({ ...s, fin })} testID="esport-sp-obligation-fin" style={{ flex: 1, minWidth: 140 }} />
          </View>
          <Choix theme={theme} libelle={trSp('champ.responsable')} valeur={s.responsable} options={[{ id: '', nom: '—' }, ...comptes.map(c => ({ id: c.compte, nom: c.pseudo ?? c.compte }))]} onChoisir={responsable => setS({ ...s, responsable })} testID="esport-sp-obligation-responsable" />
          <Champ theme={theme} libelle={trSp('c.notes')} valeur={s.notes} onChanger={notes => setS({ ...s, notes })} multiligne maxLength={2000} testID="esport-sp-obligation-notes" />
          <View style={[styles.ligne, { gap: ESP.xs }]}>
            <BoutonHub
              theme={theme}
              titre={trSp('c.enregistrer')}
              variante="plein"
              desactive={!s.intitule.trim()}
              onPress={() =>
                void faire(
                  'obligation',
                  async () => {
                    const corps: SaisieObligation = {
                      intitule: s.intitule.trim(),
                      genre: s.genre,
                      comptage: s.comptage,
                      frequence: s.frequence,
                      quantite: Number(s.quantite) || 1,
                      rappelJours: Number(s.rappel) || 0,
                      contratId: s.contratId || null,
                      responsable: s.responsable || null,
                      notes: s.notes,
                      ...(s.debut.trim() ? { debut: s.debut.trim() } : {}),
                      ...(s.fin.trim() ? { fin: s.fin.trim() } : s.id ? { fin: null } : {}),
                    };
                    if (s.id) await api.modifierObligation(s.id, corps);
                    else await api.creerObligation(partenaireId, corps);
                    setS(undefined);
                  },
                  trSp('c.enregistre'),
                )
              }
              testID="esport-sp-obligation-enregistrer"
            />
            <BoutonHub theme={theme} titre={trSp('c.annuler')} onPress={() => setS(undefined)} testID="esport-sp-obligation-annuler" />
          </View>
        </View>
      ) : null}
    </Panneau>
  );
}
