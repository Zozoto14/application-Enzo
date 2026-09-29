/**
 * Paramètres › Synchronisation entre appareils.
 *
 * Relie cet appareil au relais (code de liaison + mot de passe de
 * synchronisation), montre les autres appareils — dont la date d'expiration
 * de l'app iPhone installée par AltStore — et affiche le QR code qui relie
 * un nouvel appareil d'un coup d'appareil photo.
 */

import qrcode from 'qrcode-generator';
import React, { useMemo, useState } from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
import { Alerte, Bouton, Carte, Champ, SousTitre, Titre, usePalette } from '../composants';
import { ESPACEMENT, RAYON } from '../theme';
import type { EtatSynchroApp } from '../../app/synchroApp';
import { joursRestants } from '../../natif/signature';
import { SITE_PRINCIPAL } from '../../config/site';
import { encoderLiaison, lienApp, lienSite, type Liaison } from '../../sync/relais/liaison';

export interface CarteSynchroProps {
  synchro: EtatSynchroApp;
  /** Relais déjà connu (script du PC, lien scanné) : proposé sans rien saisir. */
  liaisonDuPc?: Liaison;
  nomParDefaut: string;
  onRelier(code: string, nom: string): Promise<void>;
  onSynchroniser(): void;
  onDelier(): void;
  onOublier(appareil: string): void;
  /** Horloge, remplaçable dans les tests. */
  maintenant?: Date;
}

const EMOJI: Record<string, string> = { bureau: '💻', ios: '📱', site: '🌐', android: '📱' };

function ilYA(iso: string, maintenant: Date): string {
  const minutes = Math.round((maintenant.getTime() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return `il y a ${minutes} min`;
  const heures = Math.round(minutes / 60);
  if (heures < 48) return `il y a ${heures} h`;
  return `il y a ${Math.round(heures / 24)} jours`;
}

/** Côté affiché du QR code, en points. */
const TAILLE_QR = 260;

/**
 * QR code en dessin vectoriel (SVG) : net à toute taille et à tout zoom
 * d'écran. Une image en pixels réduite à l'affichage devient floue, et
 * l'appareil photo ne la lit plus. Hors navigateur (iPhone), l'image en
 * pixels est gardée, à sa taille exacte.
 */
export function imageQr(texte: string, vectoriel = Platform.OS === 'web'): { uri: string; taille: number } {
  const qr = qrcode(0, 'M');
  qr.addData(texte);
  qr.make();
  if (vectoriel) {
    const svg = qr.createSvgTag({ cellSize: 4, margin: 16, scalable: true });
    return { uri: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, taille: TAILLE_QR };
  }
  const case_ = 4;
  return { uri: qr.createDataURL(case_, 16), taille: (qr.getModuleCount() + 8) * case_ };
}

export function QrCode({ texte, legende, testID }: { texte: string; legende: string; testID: string }) {
  const { uri, taille } = useMemo(() => imageQr(texte), [texte]);
  return (
    <View style={styles.qr} testID={testID}>
      <Image source={{ uri }} style={{ width: taille, height: taille }} accessibilityLabel={legende} />
      <Text style={{ color: '#111', fontWeight: '600', textAlign: 'center', maxWidth: taille }}>{legende}</Text>
    </View>
  );
}

export function Expiration({ expireLe, maintenant }: { expireLe: string; maintenant: Date }) {
  const palette = usePalette();
  const jours = joursRestants(expireLe, maintenant);
  const date = new Date(expireLe).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  if (jours < 0) {
    return (
      <Text style={{ color: palette.baisse, fontWeight: '700' }}>
        ⛔ Signature expirée le {date} : passez sur le Wi-Fi du PC pour qu’AltStore la renouvelle.
      </Text>
    );
  }
  return (
    <Text style={{ color: jours <= 2 ? palette.baisse : palette.texteSecondaire, fontWeight: jours <= 2 ? '700' : '400' }}>
      {jours <= 2 ? '⚠️ ' : ''}Expire {jours === 0 ? 'aujourd’hui' : jours === 1 ? 'demain' : `dans ${jours} jours`} ({date})
    </Text>
  );
}

export function CarteSynchro({
  synchro,
  liaisonDuPc,
  nomParDefaut,
  onRelier,
  onSynchroniser,
  onDelier,
  onOublier,
  maintenant = new Date(),
}: CarteSynchroProps) {
  const palette = usePalette();
  const [code, setCode] = useState('');
  const [nom, setNom] = useState(nomParDefaut);
  const [erreur, setErreur] = useState<string | undefined>();
  const [enCours, setEnCours] = useState(false);
  const [montrerCodes, setMontrerCodes] = useState(false);
  const [copie, setCopie] = useState<'code' | 'lien' | undefined>();
  const copier = (texte: string, quoi: 'code' | 'lien') => {
    const pressePapiers = (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator
      ?.clipboard;
    pressePapiers
      ?.writeText(texte)
      .then(() => setCopie(quoi))
      .catch(() => setCopie(undefined));
  };

  const codeUtilise = code.trim() || (liaisonDuPc ? encoderLiaison(liaisonDuPc) : '');

  if (!synchro.configure) {
    const relier = () => {
      setErreur(undefined);
      setEnCours(true);
      onRelier(codeUtilise, nom)
        .catch((e: unknown) => setErreur(e instanceof Error ? e.message : String(e)))
        .finally(() => setEnCours(false));
    };
    return (
      <>
        <Titre>Synchronisation entre appareils</Titre>
        <Carte testID="carte-synchro">
          <SousTitre>
            Le PC, l’iPhone et le site de secours partagent le même portefeuille, et s’ouvrent avec le même mot
            de passe et le même code d’authentification. Tout est chiffré sur l’appareil avant de partir : le
            relais ne voit que du bruit.
          </SousTitre>
          {liaisonDuPc ? (
            <Text style={{ color: palette.hausse, fontWeight: '600' }} testID="relais-du-pc">
              ✅ Relais reconnu : rien à recopier.
            </Text>
          ) : synchro.plateforme === 'bureau' ? (
            <View style={[styles.etapes, { borderColor: palette.bordure }]} testID="relais-a-installer">
              <Text style={{ color: palette.texte, fontWeight: '700' }}>
                Le relais n’est pas encore installé sur ce PC
              </Text>
              <Text style={{ color: palette.texte }}>
                Sur le PC, il n’y a pas de code à recopier : c’est lui qui le crée. Pour cela :
              </Text>
              <Text style={{ color: palette.texte }}>
                1. Ouvrez un terminal (PowerShell) dans le dossier d’AppDashboard — celui où vous lanciez « npm run maj-pc ».
              </Text>
              <Text style={{ color: palette.texte }}>2. Tapez : npm run relais:deployer</Text>
              <Text style={{ color: palette.texte }}>
                3. Connectez-vous à Cloudflare dans le navigateur qui s’ouvre, puis attendez « Terminé ».
              </Text>
              <Text style={{ color: palette.texte }}>
                4. Revenez ici : le relais apparaît tout seul en quelques secondes, avec « ✅ Relais reconnu ».
              </Text>
              <Text style={{ color: palette.texteSecondaire, fontSize: 13 }}>
                Vous avez déjà un code d’un autre appareil ? Collez-le quand même ci-dessous.
              </Text>
              <Champ
                etiquette="Code de liaison (facultatif ici)"
                value={code}
                onChangeText={setCode}
                autoCapitalize="none"
                autoCorrect={false}
                testID="champ-liaison"
              />
            </View>
          ) : (
            <View style={[styles.etapes, { borderColor: palette.bordure }]}>
              <Text style={{ color: palette.texte, fontWeight: '700' }}>Où trouver le code de liaison ?</Text>
              <Text style={{ color: palette.texte }}>
                C’est l’adresse de votre relais et sa clé d’accès, en une ligne. Il se trouve sur le PC déjà relié :
              </Text>
              <Text style={{ color: palette.texte }}>1. Sur le PC, ouvrez Paramètres › Synchronisation entre appareils.</Text>
              <Text style={{ color: palette.texte }}>2. Cliquez sur « Relier un autre appareil ».</Text>
              <Text style={{ color: palette.texte }}>
                3. Le plus simple : scannez le QR code avec l’appareil photo de ce téléphone — le code est rempli tout
                seul. Sinon, recopiez le texte affiché sous « Ou recopiez ce code » : il commence par AB1. et fait une
                centaine de caractères (le plus sûr : l’envoyer par Notes ou iMessage à vous-même, puis le coller).
              </Text>
              <Text style={{ color: palette.texteSecondaire, fontSize: 13 }}>
                Il ne contient aucun mot de passe : l’appareil s’ouvre ensuite avec le mot de passe et le code de
                votre PC.
              </Text>
              <Champ
                etiquette="Code de liaison"
                placeholder="AB1.…"
                value={code}
                onChangeText={setCode}
                autoCapitalize="none"
                autoCorrect={false}
                testID="champ-liaison"
              />
            </View>
          )}
          <Champ etiquette="Nom de cet appareil" value={nom} onChangeText={setNom} testID="champ-nom-appareil" />
          {erreur ? <Alerte message={erreur} /> : null}
          <View style={{ alignSelf: 'flex-start' }}>
            <Bouton
              titre={enCours ? 'Liaison…' : 'Relier cet appareil'}
              desactive={enCours || !codeUtilise}
              onPress={relier}
              testID="bouton-relier"
            />
          </View>
        </Carte>
      </>
    );
  }

  const autres = Object.entries(synchro.appareils).filter(([id]) => id !== synchro.moi);
  const liaison = synchro.liaison;
  return (
    <>
      <Titre>Synchronisation entre appareils</Titre>
      <Carte testID="carte-synchro">
        <Text style={{ color: palette.texte, fontWeight: '700' }}>
          {EMOJI[synchro.plateforme ?? ''] ?? '🔗'} {synchro.nom} · relié
        </Text>
        <SousTitre>
          {synchro.enCours
            ? 'Synchronisation en cours…'
            : synchro.derniere
              ? `Dernière synchronisation ${ilYA(synchro.derniere, maintenant)}. Automatique toutes les 2 minutes.`
              : 'Première synchronisation en attente.'}
        </SousTitre>
        {synchro.expireLe ? <Expiration expireLe={synchro.expireLe} maintenant={maintenant} /> : null}
        {synchro.message ? <Text style={{ color: palette.texte }}>{synchro.message}</Text> : null}
        {synchro.maj ? (
          <Text style={{ color: palette.accent, fontWeight: '600' }} testID="maj-telechargee">
            {synchro.maj}
          </Text>
        ) : null}
        {synchro.erreur ? <Alerte message={synchro.erreur} /> : null}
        <View style={styles.boutons}>
          <Bouton
            titre="Synchroniser maintenant"
            desactive={synchro.enCours}
            onPress={onSynchroniser}
            testID="bouton-synchroniser"
          />
          <Bouton titre={montrerCodes ? 'Masquer le code' : 'Relier un autre appareil'} variante="discret" onPress={() => setMontrerCodes(!montrerCodes)} testID="bouton-montrer-liaison" />
        </View>

        <Text style={{ color: palette.texte, fontWeight: '700', marginTop: ESPACEMENT.s }}>Autres appareils</Text>
        {autres.length === 0 ? (
          <SousTitre>Aucun pour l’instant : reliez l’iPhone avec le QR code ci-dessous.</SousTitre>
        ) : null}
        {autres.map(([id, appareil]) => (
          <View key={id} style={[styles.appareil, { borderColor: palette.bordure }]} testID={`appareil-${id}`}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: palette.texte, fontWeight: '600' }}>
                {EMOJI[appareil.plateforme] ?? '🔗'} {appareil.nom || 'Appareil'}
              </Text>
              {appareil.vuLe ? (
                <Text style={{ color: palette.texteSecondaire, fontSize: 13 }}>Dernier envoi {ilYA(appareil.vuLe, maintenant)}</Text>
              ) : null}
              {appareil.expireLe ? <Expiration expireLe={appareil.expireLe} maintenant={maintenant} /> : null}
            </View>
            <Bouton titre="Oublier" variante="discret" onPress={() => onOublier(id)} testID={`oublier-${id}`} />
          </View>
        ))}

        {montrerCodes && liaison ? (
          <View style={{ gap: ESPACEMENT.s }} testID="codes-liaison">
            <SousTitre>
              Scannez avec l’appareil photo de l’iPhone, puis touchez « Lier à mon compte » : l’appareil s’ouvre
              avec le même mot de passe et le même code que ce PC. Ni l’un ni l’autre n’est dans le QR code.
            </SousTitre>
            <View style={styles.qrs}>
              {lienSite(liaison) ? (
                <QrCode texte={lienSite(liaison)!} legende="Site de secours (Safari)" testID="qr-site" />
              ) : null}
              <QrCode
                texte={lienApp(liaison)}
                legende="App iPhone — seulement une fois l’app installée par AltStore"
                testID="qr-app"
              />
            </View>
            <Text style={{ color: palette.texteSecondaire }}>
              Sans QR code : copiez ce code, envoyez-le-vous (iMessage, WhatsApp, e-mail, Notes), puis collez-le sur
              l’iPhone dans Paramètres › Synchronisation › Code de liaison.
            </Text>
            <Text selectable style={[styles.code, { color: palette.texte, borderColor: palette.bordure }]} testID="code-liaison">
              {encoderLiaison(liaison)}
            </Text>
            <View style={styles.boutons}>
              <Bouton
                titre={copie === 'code' ? '✅ Code copié' : 'Copier le code'}
                variante="discret"
                onPress={() => copier(encoderLiaison(liaison), 'code')}
                testID="copier-code"
              />
              {lienSite(liaison) ? (
                <Bouton
                  titre={copie === 'lien' ? '✅ Lien copié' : 'Copier le lien du site (code inclus)'}
                  variante="discret"
                  onPress={() => copier(lienSite(liaison)!, 'lien')}
                  testID="copier-lien-site"
                />
              ) : null}
            </View>
            <Text selectable style={{ color: palette.accent }}>
              Site de secours : {liaison.site ?? SITE_PRINCIPAL}
            </Text>
          </View>
        ) : null}

        <View style={{ alignSelf: 'flex-start', marginTop: ESPACEMENT.s }}>
          <Bouton titre="Désactiver sur cet appareil" variante="discret" onPress={onDelier} testID="bouton-delier" />
        </View>
      </Carte>
    </>
  );
}

const styles = StyleSheet.create({
  boutons: { flexDirection: 'row', flexWrap: 'wrap', gap: ESPACEMENT.s },
  etapes: { borderWidth: 1, borderRadius: RAYON.m, padding: ESPACEMENT.m, gap: ESPACEMENT.xs + 2 },
  appareil: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ESPACEMENT.s,
    borderWidth: 1,
    borderRadius: RAYON.m,
    padding: ESPACEMENT.s + 2,
  },
  qrs: { flexDirection: 'row', flexWrap: 'wrap', gap: ESPACEMENT.l },
  qr: { alignItems: 'center', gap: ESPACEMENT.xs, backgroundColor: '#fff', padding: ESPACEMENT.s, borderRadius: RAYON.m },
  code: {
    fontFamily: 'monospace',
    fontSize: 12,
    borderWidth: 1,
    borderRadius: RAYON.s,
    padding: ESPACEMENT.s,
  },
});
