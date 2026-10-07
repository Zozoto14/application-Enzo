/**
 * Voix naturelles : la synthèse neuronale de Microsoft, celle de la lecture
 * à voix haute d'Edge (Denise, Vivienne, Henri…).
 *
 * Les voix installées dans Windows (Hortense, Paul) sonnent robotiques ; ces
 * voix-là respirent, accentuent, marquent les pauses. Elles demandent une
 * connexion : sans elle, le lecteur retombe sur les voix de Windows.
 *
 * Le service parle WebSocket et exige quelques en-têtes qu'un navigateur ne
 * laisse pas fixer : c'est pour cela que la synthèse se fait ici, dans le
 * processus principal, et que la fenêtre ne reçoit que le MP3.
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';

const JETON_CLIENT = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const VERSION_CHROMIUM = '143.0.3650.75';
const VERSION_MAJEURE = VERSION_CHROMIUM.split('.')[0];
const ADRESSE =
  'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
/** Secondes entre l'an 1601 (origine des horloges Windows) et 1970. */
const EPOQUE_WINDOWS = 11_644_473_600n;
const DELAI_MS = 20_000;
const LONGUEUR_MAX = 3000;

/** Voix proposées, et la seule liste que le rendu peut demander. */
export const VOIX_NATURELLES = [
  { id: 'fr-FR-VivienneMultilingualNeural', nom: 'Vivienne', langue: 'fr-FR' },
  { id: 'fr-FR-DeniseNeural', nom: 'Denise', langue: 'fr-FR' },
  { id: 'fr-FR-RemyMultilingualNeural', nom: 'Rémy', langue: 'fr-FR' },
  { id: 'fr-FR-HenriNeural', nom: 'Henri', langue: 'fr-FR' },
  { id: 'en-US-AvaMultilingualNeural', nom: 'Ava', langue: 'en-US' },
];

/** Jeton anti-abus : empreinte de l'heure, arrondie aux cinq minutes. */
export function jetonGec(maintenantMs = Date.now()) {
  let secondes = BigInt(Math.floor(maintenantMs / 1000)) + EPOQUE_WINDOWS;
  secondes -= secondes % 300n;
  const graduations = secondes * 10_000_000n;
  return createHash('sha256').update(`${graduations}${JETON_CLIENT}`).digest('hex').toUpperCase();
}

function horodatage(date = new Date()) {
  const jours = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const mois = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const deux = n => String(n).padStart(2, '0');
  return (
    `${jours[date.getUTCDay()]} ${mois[date.getUTCMonth()]} ${deux(date.getUTCDate())} ${date.getUTCFullYear()} ` +
    `${deux(date.getUTCHours())}:${deux(date.getUTCMinutes())}:${deux(date.getUTCSeconds())} ` +
    'GMT+0000 (Coordinated Universal Time)'
  );
}

export function echapper(texte) {
  return texte
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** « fr-FR-DeniseNeural » devient le nom long qu'attend le service. */
function nomLong(voix) {
  const [langue, region, ...reste] = voix.split('-');
  return `Microsoft Server Speech Text to Speech Voice (${langue}-${region}, ${reste.join('-')})`;
}

/** Vitesse 1,15 devient « +15% ». */
export function debit(vitesse) {
  const pourcent = Math.round((Number(vitesse) - 1) * 100);
  const borne = Math.max(-50, Math.min(100, Number.isFinite(pourcent) ? pourcent : 0));
  return `${borne >= 0 ? '+' : ''}${borne}%`;
}

export function messageConfiguration(date = new Date()) {
  return (
    `X-Timestamp:${horodatage(date)}\r\n` +
    'Content-Type:application/json; charset=utf-8\r\n' +
    'Path:speech.config\r\n\r\n' +
    '{"context":{"synthesis":{"audio":{"metadataoptions":{' +
    '"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},' +
    '"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n'
  );
}

export function messageSsml(texte, voix, vitesse, date = new Date()) {
  const ssml =
    "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>" +
    `<voice name='${nomLong(voix)}'><prosody pitch='+0Hz' rate='${debit(vitesse)}' volume='+0%'>` +
    `${echapper(texte)}</prosody></voice></speak>`;
  return (
    `X-RequestId:${randomUUID().replace(/-/g, '')}\r\n` +
    'Content-Type:application/ssml+xml\r\n' +
    `X-Timestamp:${horodatage(date)}Z\r\n` +
    'Path:ssml\r\n\r\n' +
    ssml
  );
}

/**
 * Un message binaire : deux octets de longueur d'en-tête, l'en-tête, puis
 * un morceau de MP3. Rend ce morceau, ou `undefined` si ce n'est pas du son.
 */
export function morceauAudio(octets) {
  if (octets.length < 2) {
    return undefined;
  }
  const longueur = (octets[0] << 8) | octets[1];
  const entete = Buffer.from(octets.subarray(2, 2 + longueur)).toString('utf8');
  if (!/Path:audio\r\n/.test(entete)) {
    return undefined;
  }
  return octets.subarray(2 + longueur);
}

/**
 * Synthétise une phrase et rend le MP3.
 *
 * @param {string} texte
 * @param {string} voix identifiant court, pris dans VOIX_NATURELLES
 * @param {number} vitesse 1 pour le débit normal
 */
export function synthetiser(texte, voix, vitesse = 1, { adresse = ADRESSE, FabriqueSocket = WebSocket } = {}) {
  if (!VOIX_NATURELLES.some(connue => connue.id === voix)) {
    return Promise.reject(new Error(`Voix inconnue : ${voix}`));
  }
  const phrase = String(texte).trim().slice(0, LONGUEUR_MAX);
  if (!phrase) {
    return Promise.resolve(new Uint8Array());
  }

  const url =
    `${adresse}?TrustedClientToken=${JETON_CLIENT}` +
    `&ConnectionId=${randomUUID().replace(/-/g, '')}` +
    `&Sec-MS-GEC=${jetonGec()}&Sec-MS-GEC-Version=1-${VERSION_CHROMIUM}`;

  return new Promise((resoudre, rejeter) => {
    const morceaux = [];
    let fini = false;
    const socket = new FabriqueSocket(url, {
      headers: {
        Pragma: 'no-cache',
        'Cache-Control': 'no-cache',
        Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        'User-Agent':
          `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ` +
          `Chrome/${VERSION_MAJEURE}.0.0.0 Safari/537.36 Edg/${VERSION_MAJEURE}.0.0.0`,
        'Accept-Language': 'en-US,en;q=0.9',
        Cookie: `muid=${randomBytes(16).toString('hex').toUpperCase()};`,
      },
    });
    socket.binaryType = 'arraybuffer';

    const terminer = erreur => {
      if (fini) {
        return;
      }
      fini = true;
      clearTimeout(minuterie);
      try {
        socket.close();
      } catch {
        // Déjà fermée.
      }
      if (erreur) {
        rejeter(erreur);
      } else {
        resoudre(new Uint8Array(Buffer.concat(morceaux)));
      }
    };
    const minuterie = setTimeout(() => terminer(new Error('La voix naturelle ne répond pas.')), DELAI_MS);

    socket.onopen = () => {
      socket.send(messageConfiguration());
      socket.send(messageSsml(phrase, voix, vitesse));
    };
    socket.onmessage = evenement => {
      if (typeof evenement.data === 'string') {
        if (evenement.data.includes('Path:turn.end')) {
          terminer(
            morceaux.length > 0 ? undefined : new Error('La voix naturelle n’a renvoyé aucun son.'),
          );
        }
        return;
      }
      const morceau = morceauAudio(new Uint8Array(evenement.data));
      if (morceau && morceau.length > 0) {
        morceaux.push(Buffer.from(morceau));
      }
    };
    socket.onerror = () => terminer(new Error('Connexion à la voix naturelle impossible.'));
    socket.onclose = () =>
      terminer(morceaux.length > 0 ? undefined : new Error('Connexion à la voix naturelle interrompue.'));
  });
}
