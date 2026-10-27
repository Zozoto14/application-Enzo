/**
 * Rubrique Sponsors : briques partagées des fiches (prospect, partenaire) — contacts (e-mail par modèle FR / EN
 * en `mailto:`, téléphone, réseaux), historique des échanges, pièces jointes (lien ou fichier envoyé par
 * morceaux, portée « sponsors »), badges.
 */

import React, { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { BoutonHub, Case, Champ } from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import { CATEGORIES_PIECE, GENRES_ECHANGE, PORTEE_SPONSORS, type ApiSponsors, type CategoriePiece, type Cible, type Contact, type Echange, type GenreEchange, type IssueEtape, type Piece, type Priorite } from '../../sponsors/api';
import { lienMailto, lienReseau, lienTel, prenomDe } from '../../sponsors/regles';
import { ACCEPT_CM, choisirFichier, choixFichierDisponible } from '../../medias/choixFichier';
import { tailleMedia } from '../../medias/envoi';
import { langueCourante, tr } from '../../i18n';
import { CLES_MODELES, trSp, type CleSp } from '../../i18n/sponsors';
import { BoutonConfirme, Choix, Intertitre, Panneau, styles } from '../commun';
import { Badge, ESP, MenuActions, attenue, texte, type Ton } from '../design';
import { BarreEnvoi, useEnvoi } from '../medias/EnvoiMedia';
import { ouvrirLienDiffere } from '../ouvrirLien';
import { Aide, ChampInstant, quand } from '../cm/commun';

export type Faire = (cle: string, action: () => Promise<unknown>, message?: string) => Promise<boolean>;

export const TON_ISSUE: Record<IssueEtape, Ton> = { ouverte: 'neutre', gagnee: 'ok', perdue: 'critique' };
export const TON_PRIORITE: Record<Priorite, Ton> = { basse: 'neutre', normale: 'accent', haute: 'alerte' };
export const GLYPHE_ECHANGE: Record<GenreEchange, string> = { appel: '☎', email: '✉', reunion: '◷', note: '✎' };

export function BadgePriorite({ theme, priorite }: { theme: ThemeHub; priorite: Priorite }) {
  return <Badge theme={theme} ton={TON_PRIORITE[priorite]} texte={trSp(`priorite.${priorite}` as CleSp)} />;
}

/** Nom d'un compte (pseudo), « Compte supprimé » sinon. */
export const nomCompte = (noms: Record<string, string | null>, id: string | null): string => (id ? (noms[id] ?? (id === 'principal' ? tr('jr.fondateur') : tr('jr.compte_supprime'))) : '—');

// ------------------------------------------------------------------ Contacts

const contactVide = { nom: '', role: '', email: '', telephone: '', reseaux: '', principal: false, notes: '' };

export function Contacts({
  theme,
  api,
  cible,
  contacts,
  entreprise,
  club,
  gerer,
  faire,
  onEchangeEmail,
}: {
  theme: ThemeHub;
  api: ApiSponsors;
  cible: Cible;
  contacts: Contact[];
  entreprise: string;
  club: string;
  gerer: boolean;
  faire: Faire;
  /** Après l'ouverture d'un e-mail : proposer de le noter dans l'historique. */
  onEchangeEmail?(contact: Contact, sujet: string): void;
}) {
  const [saisie, setSaisie] = useState<(typeof contactVide & { id?: string }) | undefined>();
  const [langue, setLangue] = useState<'fr' | 'en'>(langueCourante());
  const enregistrer = () =>
    saisie &&
    faire(
      'contact',
      async () => {
        const corps = { nom: saisie.nom.trim(), role: saisie.role.trim(), email: saisie.email.trim(), telephone: saisie.telephone.trim(), reseaux: saisie.reseaux.split(/[\s,;]+/).filter(Boolean), principal: saisie.principal, notes: saisie.notes };
        if (saisie.id) await api.modifierContact(saisie.id, corps);
        else await api.ajouterContact(cible, corps);
        setSaisie(undefined);
      },
      trSp('c.enregistre'),
    );
  return (
    <Panneau theme={theme} testID="esport-sp-contacts">
      <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
        <Intertitre theme={theme}>{trSp('contacts.titre')}</Intertitre>
        {gerer && !saisie ? <BoutonHub theme={theme} titre={trSp('contacts.ajouter')} onPress={() => setSaisie({ ...contactVide, principal: !contacts.length })} testID="esport-sp-contact-ajouter" /> : null}
      </View>
      {!contacts.length && !saisie ? <Text style={attenue(theme)}>{trSp('contacts.vide')}</Text> : null}
      {contacts.length ? (
        <View style={[styles.ligne, { gap: ESP.xs }]} accessibilityRole="radiogroup" accessibilityLabel={trSp('contacts.langue_modele')}>
          <Text style={attenue(theme)}>{trSp('contacts.langue_modele')}</Text>
          {(['fr', 'en'] as const).map(l => (
            <BoutonHub key={l} theme={theme} titre={l.toUpperCase()} variante={langue === l ? 'plein' : 'normal'} onPress={() => setLangue(l)} testID={`esport-sp-modele-langue-${l}`} />
          ))}
        </View>
      ) : null}
      {contacts.map(c => {
        const tel = lienTel(c.telephone);
        return (
          <View key={c.id} style={{ gap: ESP.xxs, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.xs }} testID={`esport-sp-contact-${c.id}`}>
            <View style={[styles.ligne, { gap: ESP.xs }]}>
              <Text style={{ ...texte(theme), fontWeight: '700' }}>{c.nom}</Text>
              {c.role ? <Text style={attenue(theme)}>{c.role}</Text> : null}
              {c.principal ? <Badge theme={theme} ton="accent" texte={trSp('contacts.principal')} /> : null}
            </View>
            {c.email ? (
              <Text selectable style={texte(theme, 13)}>
                {c.email}
              </Text>
            ) : null}
            {c.telephone ? (
              <Text selectable style={texte(theme, 13)}>
                {c.telephone}
              </Text>
            ) : null}
            {c.reseaux.length ? <Text style={attenue(theme)}>{c.reseaux.join(' · ')}</Text> : null}
            {c.notes ? <Text style={attenue(theme)}>{c.notes}</Text> : null}
            <View style={[styles.ligne, { gap: ESP.xs }]}>
              {c.email ? (
                <MenuActions
                  theme={theme}
                  titreBouton={trSp('contacts.ecrire')}
                  libelle={trSp('contacts.ecrire_a', { nom: c.nom })}
                  testID={`esport-sp-contact-${c.id}-ecrire`}
                  actions={CLES_MODELES.map(m => ({
                    titre: trSp(`modele.${m}` as CleSp),
                    testID: `esport-sp-contact-${c.id}-modele-${m}`,
                    onPress: () => {
                      const lien = lienMailto(c.email, m, langue, { prenom: prenomDe(c.nom), entreprise, club });
                      if (!lien) return;
                      void Linking.openURL(lien);
                      onEchangeEmail?.(c, trSp(`modele.${m}` as CleSp));
                    },
                  }))}
                />
              ) : null}
              {tel ? <BoutonHub theme={theme} titre={trSp('contacts.appeler')} libelle={trSp('contacts.appeler_nom', { nom: c.nom })} onPress={() => void Linking.openURL(tel)} testID={`esport-sp-contact-${c.id}-appeler`} /> : null}
              {c.reseaux.map(r => lienReseau(r)).filter((x): x is string => Boolean(x)).slice(0, 3).map((u, i) => (
                <BoutonHub key={u} theme={theme} titre={trSp('contacts.profil_n', { n: i + 1 })} libelle={u} onPress={() => void Linking.openURL(u)} testID={`esport-sp-contact-${c.id}-reseau-${i}`} />
              ))}
              {gerer ? <BoutonHub theme={theme} titre={trSp('c.modifier')} onPress={() => setSaisie({ id: c.id, nom: c.nom, role: c.role, email: c.email, telephone: c.telephone, reseaux: c.reseaux.join(' '), principal: c.principal, notes: c.notes })} testID={`esport-sp-contact-${c.id}-modifier`} /> : null}
              {gerer ? <BoutonConfirme theme={theme} titre={trSp('c.supprimer')} confirmation={trSp('contacts.confirmer_suppression')} onConfirme={() => void faire('contact', () => api.supprimerContact(c.id))} testID={`esport-sp-contact-${c.id}-supprimer`} /> : null}
            </View>
          </View>
        );
      })}
      {saisie ? (
        <View style={{ gap: ESP.xs }} testID="esport-sp-contact-saisie">
          <View style={[styles.ligne, { gap: ESP.xs }]}>
            <Champ theme={theme} libelle={trSp('contacts.nom')} valeur={saisie.nom} onChanger={nom => setSaisie({ ...saisie, nom })} maxLength={120} testID="esport-sp-contact-nom" style={{ flex: 1, minWidth: 180 }} />
            <Champ theme={theme} libelle={trSp('contacts.role')} valeur={saisie.role} onChanger={role => setSaisie({ ...saisie, role })} maxLength={80} testID="esport-sp-contact-role" style={{ flex: 1, minWidth: 160 }} />
          </View>
          <View style={[styles.ligne, { gap: ESP.xs }]}>
            <Champ theme={theme} libelle={trSp('contacts.email')} valeur={saisie.email} onChanger={email => setSaisie({ ...saisie, email })} maxLength={254} testID="esport-sp-contact-email" style={{ flex: 1, minWidth: 200 }} />
            <Champ theme={theme} libelle={trSp('contacts.telephone')} valeur={saisie.telephone} onChanger={telephone => setSaisie({ ...saisie, telephone })} maxLength={30} testID="esport-sp-contact-telephone" style={{ flex: 1, minWidth: 160 }} />
          </View>
          <Champ theme={theme} libelle={trSp('contacts.reseaux')} valeur={saisie.reseaux} onChanger={reseaux => setSaisie({ ...saisie, reseaux })} placeholder={trSp('contacts.reseaux_exemple')} maxLength={1100} testID="esport-sp-contact-reseaux" />
          <Champ theme={theme} libelle={trSp('c.notes')} valeur={saisie.notes} onChanger={notes => setSaisie({ ...saisie, notes })} multiligne maxLength={2000} testID="esport-sp-contact-notes" />
          <View style={[styles.ligne, { gap: ESP.xs }]}>
            <Case theme={theme} coche={saisie.principal} libelle={trSp('contacts.principal')} onChanger={principal => setSaisie({ ...saisie, principal })} testID="esport-sp-contact-principal" />
            <Text style={texte(theme)}>{trSp('contacts.principal')}</Text>
          </View>
          <Aide theme={theme}>{trSp('contacts.rgpd')}</Aide>
          <View style={[styles.ligne, { gap: ESP.xs }]}>
            <BoutonHub theme={theme} titre={trSp('c.enregistrer')} variante="plein" desactive={!saisie.nom.trim()} onPress={() => void enregistrer()} testID="esport-sp-contact-enregistrer" />
            <BoutonHub theme={theme} titre={trSp('c.annuler')} onPress={() => setSaisie(undefined)} testID="esport-sp-contact-annuler" />
          </View>
        </View>
      ) : null}
    </Panneau>
  );
}

// ------------------------------------------------------------------ Échanges

export function Echanges({
  theme,
  api,
  cible,
  echanges,
  contacts,
  noms,
  gerer,
  faire,
  prefill,
  avecProchaineAction,
}: {
  theme: ThemeHub;
  api: ApiSponsors;
  cible: Cible;
  echanges: Echange[];
  contacts: Contact[];
  noms: Record<string, string | null>;
  gerer: boolean;
  faire: Faire;
  /** Saisie préparée (ex. après l'ouverture d'un e-mail). */
  prefill?: { genre: GenreEchange; resume: string; contactId?: string; cle: number };
  avecProchaineAction?: boolean;
}) {
  const [saisie, setSaisie] = useState<{ genre: GenreEchange; resume: string; date: string | null; contactId?: string; action: string; actionLe: string | null } | undefined>();
  const [vu, setVu] = useState<number | undefined>();
  if (prefill && prefill.cle !== vu) {
    setVu(prefill.cle);
    setSaisie({ genre: prefill.genre, resume: prefill.resume, date: null, contactId: prefill.contactId, action: '', actionLe: null });
  }
  const nomContact = (id: string | null) => contacts.find(c => c.id === id)?.nom;
  return (
    <Panneau theme={theme} testID="esport-sp-echanges">
      <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
        <Intertitre theme={theme}>{trSp('echanges.titre')}</Intertitre>
        {gerer && !saisie ? <BoutonHub theme={theme} titre={trSp('echanges.ajouter')} onPress={() => setSaisie({ genre: 'appel', resume: '', date: null, action: '', actionLe: null })} testID="esport-sp-echange-ajouter" /> : null}
      </View>
      {saisie ? (
        <View style={{ gap: ESP.xs }} testID="esport-sp-echange-saisie">
          <Choix theme={theme} libelle={trSp('echanges.genre')} valeur={saisie.genre} options={GENRES_ECHANGE.map(g => ({ id: g, nom: `${GLYPHE_ECHANGE[g]} ${trSp(`echange.${g}` as CleSp)}` }))} onChoisir={genre => setSaisie({ ...saisie, genre })} testID="esport-sp-echange-genre" />
          {contacts.length ? <Choix theme={theme} libelle={trSp('echanges.contact')} valeur={saisie.contactId ?? ''} options={[{ id: '', nom: '—' }, ...contacts.map(c => ({ id: c.id, nom: c.nom }))]} onChoisir={id => setSaisie({ ...saisie, contactId: id || undefined })} testID="esport-sp-echange-contact" /> : null}
          <Champ theme={theme} libelle={trSp('echanges.resume')} valeur={saisie.resume} onChanger={resume => setSaisie({ ...saisie, resume })} multiligne maxLength={4000} testID="esport-sp-echange-resume" />
          <ChampInstant theme={theme} libelle={trSp('echanges.date')} valeur={saisie.date} fuseau="Europe/Paris" onChanger={date => setSaisie({ ...saisie, date })} testID="esport-sp-echange-date" />
          {avecProchaineAction ? (
            <>
              <Champ theme={theme} libelle={trSp('prospect.prochaine_action')} valeur={saisie.action} onChanger={action => setSaisie({ ...saisie, action })} maxLength={200} testID="esport-sp-echange-action" />
              <ChampInstant theme={theme} libelle={trSp('prospect.prochaine_action_le')} valeur={saisie.actionLe} fuseau="Europe/Paris" onChanger={actionLe => setSaisie({ ...saisie, actionLe })} testID="esport-sp-echange-action-le" />
            </>
          ) : null}
          <View style={[styles.ligne, { gap: ESP.xs }]}>
            <BoutonHub
              theme={theme}
              titre={trSp('c.enregistrer')}
              variante="plein"
              desactive={!saisie.resume.trim()}
              onPress={() =>
                void faire(
                  'echange',
                  async () => {
                    await api.ajouterEchange(cible, {
                      genre: saisie.genre,
                      resume: saisie.resume.trim(),
                      ...(saisie.date ? { date: saisie.date } : {}),
                      ...(saisie.contactId ? { contactId: saisie.contactId } : {}),
                      ...(avecProchaineAction && (saisie.action.trim() || saisie.actionLe) ? { prochaineAction: saisie.action.trim(), prochaineActionLe: saisie.actionLe } : {}),
                    });
                    setSaisie(undefined);
                  },
                  trSp('c.enregistre'),
                )
              }
              testID="esport-sp-echange-enregistrer"
            />
            <BoutonHub theme={theme} titre={trSp('c.annuler')} onPress={() => setSaisie(undefined)} testID="esport-sp-echange-annuler" />
          </View>
        </View>
      ) : null}
      {!echanges.length && !saisie ? <Text style={attenue(theme)}>{trSp('echanges.vide')}</Text> : null}
      {echanges.map(x => (
        <View key={x.id} style={{ gap: 2, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.xs }} testID={`esport-sp-echange-${x.id}`}>
          <View style={[styles.ligne, { gap: ESP.xs, justifyContent: 'space-between' }]}>
            <Text style={{ ...texte(theme, 13), fontWeight: '700', flexShrink: 1 }}>
              {[`${GLYPHE_ECHANGE[x.genre]} ${trSp(`echange.${x.genre}` as CleSp)}`, quand(x.date), nomContact(x.contactId) ?? '', x.auteur ? trSp('echanges.par', { qui: nomCompte(noms, x.auteur) }) : ''].filter(Boolean).join(' · ')}
            </Text>
            {gerer ? <BoutonHub theme={theme} titre="×" libelle={trSp('echanges.supprimer')} onPress={() => void faire('echange', () => api.supprimerEchange(x.id))} testID={`esport-sp-echange-${x.id}-supprimer`} /> : null}
          </View>
          <Text selectable style={texte(theme, 14)}>
            {x.resume}
          </Text>
        </View>
      ))}
    </Panneau>
  );
}

// ------------------------------------------------------------------ Pièces jointes

export function PiecesSp({
  theme,
  api,
  cible,
  pieces,
  gerer,
  faire,
  logoPieceId,
  onLogo,
}: {
  theme: ThemeHub;
  api: ApiSponsors;
  cible: Cible;
  pieces: Piece[];
  gerer: boolean;
  faire: Faire;
  logoPieceId?: string | null;
  onLogo?(pieceId: string | null): void;
}) {
  const [url, setUrl] = useState('');
  const [nom, setNom] = useState('');
  const [categorie, setCategorie] = useState<CategoriePiece>('deck');
  const envoi = useEnvoi();
  const ouvrir = (id: string, telecharger: boolean) => void ouvrirLienDiffere(async () => (await api.lienPiece(id, telecharger)).url);
  return (
    <Panneau theme={theme} testID="esport-sp-pieces">
      <Intertitre theme={theme}>{trSp('pieces.titre')}</Intertitre>
      {!pieces.length ? <Text style={attenue(theme)}>{trSp('pieces.vide')}</Text> : null}
      {pieces.map(p => (
        <View key={p.id} style={[styles.ligne, { gap: ESP.xs, justifyContent: 'space-between' }]} testID={`esport-sp-piece-${p.id}`}>
          <View style={{ flex: 1, minWidth: 160, gap: 2 }}>
            <Text style={{ ...texte(theme), fontWeight: '600' }} numberOfLines={1}>
              {p.nom}
            </Text>
            <Text style={attenue(theme, 12)} numberOfLines={1}>
              {[trSp(`piece.${p.categorie}` as CleSp), p.fichier ? `${p.fichier.type} · ${tailleMedia(p.fichier.taille, langueCourante())}` : (p.url ?? '')].join(' · ')}
            </Text>
          </View>
          {logoPieceId === p.id ? <Badge theme={theme} ton="accent" texte={trSp('pieces.logo_actuel')} /> : null}
          {p.genre === 'fichier' && p.fichier ? (
            <>
              <BoutonHub theme={theme} titre={trSp('pieces.ouvrir')} libelle={trSp('pieces.ouvrir_nom', { nom: p.nom })} onPress={() => ouvrir(p.id, false)} testID={`esport-sp-piece-${p.id}-ouvrir`} />
              <BoutonHub theme={theme} titre={trSp('pieces.telecharger')} libelle={trSp('pieces.telecharger_nom', { nom: p.nom })} onPress={() => ouvrir(p.id, true)} testID={`esport-sp-piece-${p.id}-telecharger`} />
            </>
          ) : p.url ? (
            <BoutonHub theme={theme} titre={trSp('pieces.ouvrir')} libelle={trSp('pieces.ouvrir_nom', { nom: p.nom })} onPress={() => void Linking.openURL(p.url!)} testID={`esport-sp-piece-${p.id}-ouvrir`} />
          ) : null}
          {gerer && onLogo && p.fichier && p.fichier.type.startsWith('image/') && logoPieceId !== p.id ? <BoutonHub theme={theme} titre={trSp('pieces.utiliser_logo')} onPress={() => onLogo(p.id)} testID={`esport-sp-piece-${p.id}-logo`} /> : null}
          {gerer ? <BoutonHub theme={theme} titre="×" libelle={trSp('pieces.retirer', { nom: p.nom })} onPress={() => void faire('piece', () => api.supprimerPiece(p.id))} testID={`esport-sp-piece-${p.id}-retirer`} /> : null}
        </View>
      ))}
      {gerer ? (
        <View style={{ gap: ESP.xs }}>
          <Choix theme={theme} libelle={trSp('pieces.categorie')} valeur={categorie} options={CATEGORIES_PIECE.map(c => ({ id: c, nom: trSp(`piece.${c}` as CleSp) }))} onChoisir={v => setCategorie(v as CategoriePiece)} testID="esport-sp-piece-categorie" />
          <View style={[styles.ligne, { gap: ESP.xs }]}>
            <Champ theme={theme} libelle={trSp('pieces.url')} valeur={url} onChanger={setUrl} placeholder="https://" maxLength={2000} testID="esport-sp-piece-url" style={{ flex: 2, minWidth: 200 }} />
            <Champ theme={theme} libelle={trSp('c.nom')} valeur={nom} onChanger={setNom} maxLength={140} testID="esport-sp-piece-nom" style={{ flex: 1, minWidth: 140 }} />
          </View>
          <View style={[styles.ligne, { gap: ESP.xs }]}>
            <BoutonHub
              theme={theme}
              titre={trSp('pieces.ajouter_lien')}
              desactive={!/^https:\/\//i.test(url.trim())}
              onPress={() =>
                void faire('lien', async () => {
                  await api.ajouterLien(cible, url.trim(), nom.trim(), categorie);
                  setUrl('');
                  setNom('');
                })
              }
              testID="esport-sp-piece-ajouter-lien"
            />
            {choixFichierDisponible ? (
              <BoutonHub
                theme={theme}
                titre={trSp('pieces.ajouter_fichier')}
                desactive={envoi.enCours}
                onPress={() =>
                  void faire('fichier', async () => {
                    const f = await choisirFichier(ACCEPT_CM, 'esport-sp-piece-fichier');
                    if (!f) return undefined;
                    const { etat, oublier } = await envoi.lancer({ client: api.client, teamId: PORTEE_SPONSORS, section: 'cm', fichier: f });
                    await api.ajouterFichier(cible, etat.id, categorie);
                    oublier();
                    envoi.effacer();
                    return undefined;
                  })
                }
                testID="esport-sp-piece-ajouter-fichier"
              />
            ) : (
              <Aide theme={theme}>{trSp('pieces.fichier_depuis_pc')}</Aide>
            )}
          </View>
          <BarreEnvoi theme={theme} progression={envoi.progression} enCours={envoi.enCours} onAnnuler={envoi.annuler} testID="esport-sp-piece-envoi" />
        </View>
      ) : null}
    </Panneau>
  );
}

/** Teams concernées : pastilles à cocher (teams connues de l'espace CM et déjà citées). */
export function ChoixTeams({ theme, teams, valeur, onChanger, testID }: { theme: ThemeHub; teams: Array<{ id: string; nom: string }>; valeur: string[]; onChanger(v: string[]): void; testID: string }) {
  if (!teams.length) return <Text style={attenue(theme)}>{trSp('c.aucune_team')}</Text>;
  return (
    <View style={{ gap: ESP.xxs }}>
      <Text style={{ ...texte(theme, 13), fontWeight: '600' }}>{trSp('c.teams')}</Text>
      <View style={[styles.ligne, { gap: ESP.xs }]}>
        {teams.map(t => {
          const actif = valeur.includes(t.id);
          return <BoutonHub key={t.id} theme={theme} titre={t.nom} variante={actif ? 'plein' : 'normal'} onPress={() => onChanger(actif ? valeur.filter(x => x !== t.id) : [...valeur, t.id])} testID={`${testID}-${t.id}`} />;
        })}
      </View>
    </View>
  );
}
