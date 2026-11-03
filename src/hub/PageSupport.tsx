/**
 * Support : écrire à l'équipe depuis l'application.
 *
 * La demande (catégorie, titre, message riche, capture facultative, infos techniques automatiques)
 * part vers le relais, qui la range (seul son auteur et le Fondateur la lisent) et l'annonce sur le
 * salon Discord du support (l'adresse du webhook n'est jamais dans l'application). « Mes demandes »
 * montre l'historique : état de l'envoi (envoyée, erreur, en attente hors ligne avec renvoi
 * automatique), statut côté support (ouverte, en cours, répondu, résolue) et la conversation : une
 * réponse du Fondateur apparaît ici (badge « nouvelle réponse », bouton Support du hub) et l'on peut
 * compléter sa demande. Accessible depuis le hub, les pages d'app et Paramètres › Support.
 */

import React, { useEffect, useState } from 'react';
import { Icone } from '../ui/icones';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ChampNote } from '../esport/ui/ChampNote';
import { NoteMarkdown } from '../esport/ui/review/Note';
import { SelecteurCapture } from '../support/SelecteurCapture';
import type { ServiceSupport } from '../support/service';
import {
  CATEGORIES_TICKET,
  LIBELLES_STATUT,
  LIBELLES_STATUT_SERVEUR,
  TAILLE_MAX_MESSAGE,
  TAILLE_MAX_TITRE,
  erreurFormulaire,
  type CategorieTicket,
  type InfosTechniques,
  type PieceJointe,
  type Ticket,
} from '../support/tickets';
import { BoutonHub } from './Hub';
import { BoutonPrincipal } from '../ui/mobile/BoutonPrincipal';
import { ChampMobile } from '../ui/mobile/ChampMobile';
import { EcranMobile } from '../ui/mobile/EcranMobile';
import { EnTeteMobile } from '../ui/mobile/EnTeteMobile';
import { rayonControle, tailleTexte } from '../ui/mobile/jetons';
import { GroupeCellules } from '../ui/mobile/ListeCellules';
import { BarreBasseHub } from '../ui/mobile/NavigationMobile';
import { useMobile } from '../ui/mobile/useMobile';
import { police, teinteTransparente, type ThemeHub } from './themes';
import { ecouterTouche } from './web';

const categorie = (id: CategorieTicket) => CATEGORIES_TICKET.find(c => c.id === id) ?? CATEGORIES_TICKET[2];

export function dateCourte(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export interface PropsFormulaireSupport {
  theme: ThemeHub;
  service?: ServiceSupport;
  /** Ce qui partirait avec « Inclure les informations techniques ». */
  infos: InfosTechniques;
  /** Catégorie proposée au départ. */
  categorieInitiale?: CategorieTicket;
}

export function FormulaireSupport({ theme, service, infos, categorieInitiale = 'question' }: PropsFormulaireSupport) {
  const [choix, setChoix] = useState<CategorieTicket>(categorieInitiale);
  const [titre, setTitre] = useState('');
  const [message, setMessage] = useState('');
  const [technique, setTechnique] = useState(true);
  const [piece, setPiece] = useState<PieceJointe | undefined>();
  const [cleSelecteur, setCleSelecteur] = useState(0);
  const [envoi, setEnvoi] = useState(false);
  const [retour, setRetour] = useState<{ genre: 'ok' | 'attente' | 'erreur'; texte: string } | undefined>();
  const rayon = Math.min(theme.rayonMoyen, 10);
  const mobile = useMobile();
  const texte = { color: theme.texte, ...police(theme.policeTexte) };
  const attenue = { color: theme.attenue, fontSize: mobile ? 15 : 13, lineHeight: mobile ? 21 : 19, ...police(theme.policeTexte) };
  const champ = [styles.champ, texte, { borderColor: theme.ligne, backgroundColor: theme.fond, borderRadius: rayon }];

  const vider = () => {
    setTitre('');
    setMessage('');
    setPiece(undefined);
    setCleSelecteur(n => n + 1);
  };

  const envoyer = async () => {
    if (!service) return;
    const invalide = erreurFormulaire({ categorie: choix, titre, message, piece });
    if (invalide) {
      setRetour({ genre: 'erreur', texte: invalide });
      return;
    }
    setEnvoi(true);
    setRetour(undefined);
    try {
      const ticket = await service.creer({ categorie: choix, titre, message, inclureTechnique: technique, piece });
      const n = ticket.numeroServeur ?? ticket.numero;
      if (ticket.statut === 'envoye') {
        setRetour({ genre: ticket.avertissement ? 'attente' : 'ok', texte: `Demande n° ${n} envoyée. ${ticket.avertissement ?? 'Merci : nous la lisons dès que possible, la réponse arrivera ici.'}` });
        vider();
      } else if (ticket.statut === 'attente') {
        setRetour({ genre: 'attente', texte: `Demande n° ${n} enregistrée : ${ticket.erreur ?? 'elle partira dès que possible.'}` });
        vider();
      } else {
        setRetour({ genre: 'erreur', texte: `Demande n° ${n} non envoyée : ${ticket.erreur ?? 'erreur inconnue'} Vous pourrez la renvoyer depuis « Mes demandes ».` });
      }
    } catch (e) {
      setRetour({ genre: 'erreur', texte: e instanceof Error ? e.message : String(e) });
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <View style={{ gap: 12 }} testID="support-formulaire">
      <Text style={attenue}>
        Un bug, une idée, une question, un souci de compte ? Votre demande arrive sur le salon de l’équipe, et la réponse revient ici. Ne mettez jamais de mot de passe, de code ni de clé.
      </Text>
      <View style={[styles.segments, mobile && styles.segmentsMobile, { borderColor: theme.ligne, borderRadius: rayon }]} accessibilityRole="radiogroup" accessibilityLabel="Catégorie de la demande">
        {CATEGORIES_TICKET.map(c => {
          const actif = c.id === choix;
          return (
            <Pressable
              key={c.id}
              testID={`support-categorie-${c.id}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: actif }}
              aria-checked={actif}
              accessibilityLabel={`Catégorie : ${c.libelle}`}
              onPress={() => setChoix(c.id)}
              style={[styles.segment, mobile && styles.segmentMobile, { backgroundColor: actif ? c.couleur : 'transparent' }]}>
              <Text style={{ color: actif ? '#ffffff' : theme.texte, fontWeight: '600', fontSize: mobile ? 15 : 13, ...police(theme.policeTexte) }}>
                <Icone nom={c.icone} /> {c.libelle}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {mobile ? (
        <ChampMobile theme={theme} etiquette="Titre" nature="texte" autoCapitalize="sentences" testID="support-titre" accessibilityLabel="Titre de la demande" value={titre} onChangeText={setTitre} maxLength={TAILLE_MAX_TITRE} placeholder="En quelques mots" />
      ) : (
        <View style={{ gap: 4 }}>
          <Text style={[texte, { fontWeight: '600', fontSize: 13 }]}>Titre</Text>
          <TextInput testID="support-titre" accessibilityLabel="Titre de la demande" value={titre} onChangeText={setTitre} maxLength={TAILLE_MAX_TITRE} placeholder="En quelques mots" placeholderTextColor={theme.attenue} style={champ as never} />
        </View>
      )}
      {mobile ? (
        // Téléphone : champ du système mobile (17 px, pas de zoom iOS) ; la mise en forme Markdown reste possible.
        <ChampMobile
          theme={theme}
          etiquette="Message"
          nature="multiligne"
          autoCapitalize="sentences"
          testID="support-message"
          accessibilityLabel="Message de la demande"
          value={message}
          onChangeText={setMessage}
          maxLength={TAILLE_MAX_MESSAGE}
          numberOfLines={6}
          placeholder="Que s’est-il passé ? Que faisiez-vous ? Qu’attendiez-vous ?"
          indication={`${message.length} / ${TAILLE_MAX_MESSAGE} · **gras**, *italique*, « - » pour une liste`}
        />
      ) : (
        <ChampNote
          theme={theme}
          libelle="Message"
          valeur={message}
          onChanger={setMessage}
          maxLength={TAILLE_MAX_MESSAGE}
          placeholder="Que s’est-il passé ? Que faisiez-vous ? Qu’attendiez-vous ?"
          testID="support-message"
          apercu="bouton"
        />
      )}
      <View style={{ gap: 6 }}>
        <Text style={[texte, { fontWeight: '600', fontSize: mobile ? 15 : 13 }]}>Capture d’écran (facultatif)</Text>
        <SelecteurCapture key={cleSelecteur} couleur={theme.texte} bordure={theme.ligne} rayon={rayonControle(theme)} grand={mobile} onChoisir={setPiece} onErreur={m => setRetour({ genre: 'erreur', texte: m })} />
        {piece ? (
          <Text style={attenue} testID="support-capture-nom">
            Jointe : {piece.nom}
          </Text>
        ) : null}
      </View>
      <Pressable
        testID="support-technique"
        accessibilityRole="checkbox"
        accessibilityState={{ checked: technique }}
        aria-checked={technique}
        onPress={() => setTechnique(v => !v)}
        style={[styles.ligneCase, mobile && styles.ligneCaseMobile]}>
        <View style={[styles.case, { borderColor: technique ? theme.accent : theme.ligne, backgroundColor: technique ? theme.accent : 'transparent' }]}>
          {technique ? <Text style={{ color: theme.surAccent, fontSize: mobile ? 15 : 12, fontWeight: '800' }}>✓</Text> : null}
        </View>
        <Text style={[texte, { flex: 1, fontSize: mobile ? 16 : 14 }]}>Joindre les informations techniques</Text>
      </Pressable>
      <Text style={attenue} testID="support-technique-detail">
        {technique
          ? `Jointes : version ${infos.version}, appareil ${infos.appareil}, app ${infos.app}, langue ${infos.langue}, rang ${infos.rang}. Jamais de mot de passe ni de clé.`
          : 'Aucune information technique ne sera jointe.'}
      </Text>
      {mobile ? (
        <BoutonPrincipal theme={theme} titre={envoi ? 'Envoi…' : 'Envoyer la demande'} enCours={envoi} desactive={!service} onPress={() => void envoyer()} testID="support-envoyer" />
      ) : (
        <View style={styles.actions}>
          <BoutonHub theme={theme} variante="plein" titre={envoi ? 'Envoi…' : 'Envoyer la demande'} desactive={envoi || !service} onPress={() => void envoyer()} testID="support-envoyer" />
        </View>
      )}
      {retour ? (
        <Text
          accessibilityLiveRegion="polite"
          testID="support-resultat"
          style={{ color: retour.genre === 'ok' ? theme.ok : retour.genre === 'attente' ? theme.alerte : theme.critique, fontSize: mobile ? 15 : 13, lineHeight: mobile ? 21 : 19 }}>
          {retour.texte}
        </Text>
      ) : null}
    </View>
  );
}

/** Une demande : en-tête, état, conversation (dépliée), complément. */
function CarteTicket({ theme, t, service }: { theme: ThemeHub; t: Ticket; service?: ServiceSupport }) {
  const mobile = useMobile();
  const [ouvert, setOuvert] = useState(Boolean(t.nonLus));
  const [complement, setComplement] = useState('');
  const [retour, setRetour] = useState<string | undefined>();
  const [enCours, setEnCours] = useState(false);
  const rayon = Math.min(theme.rayonMoyen, 10);
  const t15 = (taille: number) => tailleTexte(taille, mobile);
  const attenue = { color: theme.attenue, fontSize: t15(13), lineHeight: mobile ? 21 : 19, ...police(theme.policeTexte) };
  const c = categorie(t.categorie);
  const couleurEnvoi = t.statut === 'envoye' ? theme.ok : t.statut === 'attente' ? theme.alerte : theme.critique;
  const statut = t.statut === 'envoye' && t.statutServeur ? LIBELLES_STATUT_SERVEUR[t.statutServeur] : LIBELLES_STATUT[t.statut];
  const couleurStatut = t.statut !== 'envoye' ? couleurEnvoi : t.statutServeur === 'repondu' ? theme.accent : t.statutServeur === 'resolu' ? theme.ok : theme.attenue;
  const n = t.numeroServeur ?? t.numero;
  useEffect(() => {
    if (ouvert && t.nonLus) void service?.marquerLu(t.numero);
  }, [ouvert, t.nonLus, t.numero, service]);
  const completer = async () => {
    if (!service) return;
    setEnCours(true);
    const motif = await service.repondre(t.numero, complement);
    setEnCours(false);
    if (motif) setRetour(motif);
    else {
      setComplement('');
      setRetour('Message envoyé.');
    }
  };
  return (
    <View testID={`support-ticket-${t.numero}`} style={[styles.ticket, { borderColor: t.nonLus ? theme.accent : theme.ligne, borderRadius: rayon, borderLeftWidth: 4, borderLeftColor: c.couleur }]}>
      <Pressable onPress={() => setOuvert(v => !v)} accessibilityRole="button" accessibilityLabel={`Demande n° ${n} : ${t.titre}`} testID={`support-ticket-${t.numero}-ouvrir`} style={styles.enteteTicket}>
        <Text style={{ color: theme.texte, fontWeight: '700', fontSize: t15(14), flex: 1, ...police(theme.policeTexte) }} numberOfLines={2}>
          n° {n} · <Icone nom={c.icone} /> {t.titre}
        </Text>
        {t.nonLus ? (
          <Text testID={`support-ticket-${t.numero}-nouveau`} style={[styles.pastille, { backgroundColor: theme.accent, color: theme.surAccent }]}>
            <Icone nom="cloche" /> Nouvelle réponse
          </Text>
        ) : null}
        <Text style={{ color: couleurStatut, fontWeight: '700', fontSize: t15(12) }} testID={`support-ticket-${t.numero}-statut`}>
          {statut}
        </Text>
      </Pressable>
      <Text style={attenue}>
        {c.libelle} · {dateCourte(t.date)}
        {t.pieceNom ? ` · capture : ${t.pieceNom}` : ''}
        {t.messages?.length ? ` · ${t.messages.length} message${t.messages.length > 1 ? 's' : ''}` : ''}
      </Text>
      {t.statut !== 'envoye' && t.erreur ? <Text style={{ color: couleurEnvoi, fontSize: t15(12), lineHeight: mobile ? 21 : 17 }}>{t.erreur}</Text> : null}
      {ouvert ? (
        <View style={{ gap: 8 }} testID={`support-ticket-${t.numero}-conversation`}>
          <NoteMarkdown theme={theme} source={t.message} />
          {(t.messages ?? []).map(m => (
            <View
              key={m.id || m.date}
              testID={`support-ticket-${t.numero}-message-${m.de}`}
              style={[styles.bulle, { borderRadius: rayon, backgroundColor: m.de === 'equipe' ? teinteTransparente(theme.ok, 0.12) : teinteTransparente(theme.accent, 0.08), alignSelf: m.de === 'equipe' ? 'flex-start' : 'flex-end' }]}>
              <Text style={[attenue, { fontWeight: '700' }]}>{m.de === 'equipe' ? 'Réponse du Fondateur' : 'Vous'} · {dateCourte(m.date)}</Text>
              <NoteMarkdown theme={theme} source={m.texte} />
            </View>
          ))}
          {t.id ? (
            <View style={{ gap: 6 }}>
              <TextInput
                testID={`support-ticket-${t.numero}-complement`}
                accessibilityLabel="Compléter la demande"
                value={complement}
                onChangeText={setComplement}
                multiline
                maxLength={TAILLE_MAX_MESSAGE}
                placeholder="Compléter ou répondre…"
                placeholderTextColor={theme.attenue}
                style={[styles.champ, { color: theme.texte, borderColor: theme.ligne, backgroundColor: theme.fond, borderRadius: rayon, minHeight: 64, textAlignVertical: 'top' }] as never}
              />
              <View style={styles.actions}>
                <BoutonHub theme={theme} titre={enCours ? 'Envoi…' : 'Envoyer'} desactive={enCours || complement.trim().length < 2} onPress={() => void completer()} testID={`support-ticket-${t.numero}-repondre`} />
                {retour ? <Text style={attenue}>{retour}</Text> : null}
              </View>
            </View>
          ) : null}
        </View>
      ) : null}
      <View style={styles.actions}>
        {t.statut === 'erreur' ? <BoutonHub theme={theme} titre="Réessayer" onPress={() => void service?.reessayer(t.numero)} testID={`support-ticket-${t.numero}-reessayer`} /> : null}
        {t.statut === 'attente' ? <BoutonHub theme={theme} titre="Envoyer maintenant" onPress={() => void service?.envoyer(t.numero)} testID={`support-ticket-${t.numero}-envoyer`} /> : null}
        {t.statut !== 'attente' ? <BoutonHub theme={theme} titre="Retirer de la liste" onPress={() => service?.supprimer(t.numero)} testID={`support-ticket-${t.numero}-retirer`} /> : null}
      </View>
    </View>
  );
}

export function MesTickets({ theme, tickets, service }: { theme: ThemeHub; tickets: readonly Ticket[]; service?: ServiceSupport }) {
  const mobile = useMobile();
  const attenue = { color: theme.attenue, fontSize: tailleTexte(13, mobile), lineHeight: mobile ? 21 : 19, ...police(theme.policeTexte) };
  if (tickets.length === 0) {
    return (
      <Text style={attenue} testID="support-aucun-ticket">
        Aucune demande pour l’instant. Celles que vous envoyez apparaissent ici, avec leur statut et les réponses.
      </Text>
    );
  }
  return (
    <View style={{ gap: 8 }} testID="support-tickets">
      {tickets.map(t => (
        <CarteTicket key={t.numero} theme={theme} t={t} service={service} />
      ))}
    </View>
  );
}

export interface PropsPageSupport extends PropsFormulaireSupport {
  tickets: readonly Ticket[];
  actif?: boolean;
  onFermer(): void;
}

/** La page Support : formulaire puis « Mes demandes ». */
export function PageSupport({ theme, service, infos, tickets, actif = true, onFermer, categorieInitiale }: PropsPageSupport) {
  useEffect(() => (actif ? ecouterTouche('Escape', onFermer) : undefined), [actif, onFermer]);
  // Ouverture de la page : relecture immédiate des réponses.
  useEffect(() => {
    void service?.synchroniser().catch(() => 0);
  }, [service]);
  const mobile = useMobile();
  const nonLus = tickets.reduce((n, t) => n + (t.nonLus ?? 0), 0);
  const titreListe = `Mes demandes${tickets.length ? ` (${tickets.length})` : ''}${nonLus ? ` · ${nonLus} nouvelle${nonLus > 1 ? 's' : ''} réponse${nonLus > 1 ? 's' : ''}` : ''}`;
  if (mobile) {
    // Téléphone : formulaire pleine page, « Mes demandes » en dessous, barre basse du hub.
    return (
      <View style={[styles.racine, { backgroundColor: theme.fond }]} testID="hub-support" accessibilityLabel="Support">
        <EcranMobile theme={theme} onRetour={onFermer} entete={<EnTeteMobile theme={theme} titre="Support" onRetour={onFermer} libelleRetour="Accueil" testIDRetour="hub-support-fermer" />}>
          <FormulaireSupport theme={theme} service={service} infos={infos} categorieInitiale={categorieInitiale} />
          <GroupeCellules theme={theme} titre={titreListe}>
            <View style={{ padding: 16 }}>
              <MesTickets theme={theme} tickets={tickets} service={service} />
            </View>
          </GroupeCellules>
        </EcranMobile>
        <BarreBasseHub actif="support" />
      </View>
    );
  }
  const titre = { color: theme.texte, fontWeight: theme.poidsTitre, textTransform: theme.majuscules ? ('uppercase' as const) : ('none' as const), ...police(theme.policeTitre) };
  const carte = [styles.carte, { backgroundColor: theme.surface, borderColor: theme.ligne, borderRadius: theme.rayonMoyen }];
  return (
    <View style={[styles.racine, { backgroundColor: theme.fond }]} testID="hub-support" accessibilityLabel="Support">
      <View style={styles.page}>
        <View style={styles.entete}>
          <BoutonHub theme={theme} titre="← Retour" libelle="Fermer le support (Échap)" onPress={onFermer} testID="hub-support-fermer" />
          <Text style={[titre, { fontSize: 28, flex: 1 }]} accessibilityRole="header">
            Support
          </Text>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 14, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
          <View style={carte}>
            <Text style={[titre, { fontSize: 17 }]} accessibilityRole="header">
              Nouvelle demande
            </Text>
            <FormulaireSupport theme={theme} service={service} infos={infos} categorieInitiale={categorieInitiale} />
          </View>
          <View style={carte}>
            <Text style={[titre, { fontSize: 17 }]} accessibilityRole="header" testID="support-mes-demandes">
              {titreListe}
            </Text>
            <MesTickets theme={theme} tickets={tickets} service={service} />
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  racine: { flex: 1 },
  page: { flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: 16, paddingTop: 20, gap: 14 },
  entete: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  carte: { borderWidth: 1, padding: 16, gap: 10 },
  champ: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  segments: { flexDirection: 'row', flexWrap: 'wrap', borderWidth: 1, overflow: 'hidden', alignSelf: 'flex-start' },
  segment: { paddingVertical: 8, paddingHorizontal: 14, minHeight: 36, justifyContent: 'center' },
  ligneCase: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 36 },
  ligneCaseMobile: { minHeight: 48, gap: 12 },
  segmentsMobile: { alignSelf: 'stretch', flexWrap: 'nowrap' },
  segmentMobile: { flex: 1, minHeight: 44, paddingHorizontal: 4, alignItems: 'center' },
  case: { width: 22, height: 22, borderWidth: 2, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  ticket: { borderWidth: 1, padding: 12, gap: 6 },
  enteteTicket: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' },
  pastille: { fontSize: 12, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden' },
  bulle: { padding: 10, gap: 4, maxWidth: '92%' },
});
