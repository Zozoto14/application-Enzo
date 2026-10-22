/**
 * Modèles des e-mails d'AppDashboard (pur, sans dépendance).
 *
 * Chaque e-mail a DEUX versions (multipart/alternative) : HTML soigné (mise en page en tableaux,
 * styles en ligne : ce que comprennent Gmail, Outlook, Apple Mail) et texte brut. FR ou EN.
 *
 * Le texte vient de l'éditeur riche de l'app (Markdown limité : **gras**, *italique*, ~~barré~~,
 * ==surlignage==, {{couleur|texte}}, `code`, blocs de code, citations, listes, titres, liens
 * [texte](https://…)). TOUT est échappé d'abord (`<`, `>`, `&`, guillemets) : aucune balise venue
 * du texte n'atteint le HTML ; seuls les liens http(s) deviennent des liens.
 *
 * Modèles : `libre` (Messagerie de l'Administration), `invitation` (Administration et Esport, avec un
 * gros bouton vers le lien), `support` (réponse du Fondateur à une demande), `recap` (récapitulatif
 * des notifications Esport importantes).
 */

const COULEURS = { rouge: '#d64545', orange: '#e8833a', jaune: '#c9a227', vert: '#22a06b', bleu: '#3b82f6', violet: '#8b5cf6', rose: '#e0559a', gris: '#8b8b9a' };
const ACCENT = '#5b5bd6';

const TEXTES = {
  fr: {
    pied: 'Vous recevez cet e-mail parce que vous avez un compte AppDashboard.',
    automatique: 'Message automatique : ne répondez pas à cette adresse.',
    ouvrir: 'Ouvrir AppDashboard',
    invitationBouton: 'Accepter l’invitation',
    invitationLien: 'Si le bouton ne marche pas, copiez ce lien dans votre navigateur :',
    supportObjet: 'Réponse à votre demande #{numero} : {titre}',
    supportIntro: 'Le Fondateur a répondu à votre demande de support #{numero} « {titre} » :',
    supportSuite: 'Retrouvez la conversation dans l’app : Support › Mes demandes.',
    recapObjet: 'Esport : votre récapitulatif ({n} notification(s))',
    recapIntro: 'Voici les notifications importantes de l’Esport depuis votre dernier récapitulatif :',
    recapReglage: 'Pour ne plus recevoir ce récapitulatif : Esport › Profil › Récapitulatif par e-mail.',
    bonjour: 'Bonjour {prenom},',
  },
  en: {
    pied: 'You are receiving this e-mail because you have an AppDashboard account.',
    automatique: 'Automated message: please do not reply to this address.',
    ouvrir: 'Open AppDashboard',
    invitationBouton: 'Accept the invitation',
    invitationLien: 'If the button does not work, copy this link into your browser:',
    supportObjet: 'Reply to your request #{numero}: {titre}',
    supportIntro: 'The Founder replied to your support request #{numero} “{titre}”:',
    supportSuite: 'See the whole conversation in the app: Support › My requests.',
    recapObjet: 'Esport: your digest ({n} notification(s))',
    recapIntro: 'Here are the important Esport notifications since your last digest:',
    recapReglage: 'To stop this digest: Esport › Profile › E-mail digest.',
    bonjour: 'Hello {prenom},',
  },
};

export const langueCourriel = l => (l === 'en' ? 'en' : 'fr');
const remplir = (modele, v) => modele.replace(/\{(\w+)\}/g, (_, k) => (v[k] === undefined || v[k] === null ? '' : String(v[k])));

export function echapper(texte) {
  return String(texte ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Texte nettoyé (contrôles et caractères de direction retirés), borné. */
export function nettoyerTexte(valeur, max = 20_000) {
  return String(valeur ?? '')
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/g, '')
    .slice(0, max);
}

const lienSur = cible => /^https?:\/\/[^\s<>"'`\\]{1,2000}$/i.test(String(cible ?? '').trim());

/** Une ligne de Markdown limité → HTML (le texte est déjà échappé). */
function enLigne(texteEchappe) {
  const codes = [];
  let t = texteEchappe.replace(/`([^`\n]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  // Liens [texte](https://…) : la cible est relue décodée, puis ré-échappée.
  t = t.replace(/\[([^\]\n]{1,300})\]\(([^)\s]{1,2000})\)/g, (tout, libelle, cible) => {
    const brute = cible.replace(/&amp;/g, '&');
    return lienSur(brute) ? `<a href="${echapper(brute)}" style="color:${ACCENT};text-decoration:underline">${libelle}</a>` : libelle;
  });
  // Adresses nues.
  t = t.replace(/(^|[\s(])(https?:\/\/[^\s<]{3,2000})/g, (tout, avant, url) => {
    const propre = url.replace(/[.,;:!?)]+$/, '');
    const reste = url.slice(propre.length);
    const brute = propre.replace(/&amp;/g, '&');
    return lienSur(brute) ? `${avant}<a href="${echapper(brute)}" style="color:${ACCENT};text-decoration:underline">${propre}</a>${reste}` : tout;
  });
  t = t
    .replace(/\{\{([a-z]+)\|([^}]*)\}\}/g, (_, c, x) => (COULEURS[c] ? `<span style="color:${COULEURS[c]}">${x}</span>` : x))
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~\n]+)~~/g, '<s>$1</s>')
    .replace(/==([^=\n]+)==/g, '<mark style="background:#fff3a3;color:inherit">$1</mark>');
  // eslint-disable-next-line no-control-regex
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code style="font-family:Consolas,Menlo,monospace;background:#f1f1f6;padding:1px 4px;border-radius:4px">${codes[Number(i)]}</code>`);
}

/** Markdown limité → HTML sûr (blocs : titres, listes, cases, citations, code, séparateur, paragraphes). */
export function markdownVersHtml(source) {
  const lignes = nettoyerTexte(source).split('\n');
  const sortie = [];
  let paragraphe = [];
  let liste;
  const fermerParagraphe = () => {
    if (paragraphe.length) sortie.push(`<p style="margin:0 0 14px">${paragraphe.map(l => enLigne(echapper(l))).join('<br>')}</p>`);
    paragraphe = [];
  };
  const fermerListe = () => {
    if (liste) sortie.push(`<${liste.genre} style="margin:0 0 14px;padding-left:22px">${liste.items.join('')}</${liste.genre}>`);
    liste = undefined;
  };
  for (let i = 0; i < lignes.length; i++) {
    const l = lignes[i];
    if (/^\s{0,3}```/.test(l)) {
      fermerParagraphe();
      fermerListe();
      const bloc = [];
      for (i++; i < lignes.length && !/^\s{0,3}```\s*$/.test(lignes[i]); i++) bloc.push(lignes[i]);
      sortie.push(`<pre style="margin:0 0 14px;padding:10px 12px;background:#f1f1f6;border-radius:8px;font-family:Consolas,Menlo,monospace;font-size:13px;white-space:pre-wrap">${echapper(bloc.join('\n'))}</pre>`);
      continue;
    }
    const titre = /^(#{1,3})\s+(.*)$/.exec(l);
    const puce = /^\s*[-*]\s+(?:\[( |x|X)\]\s+)?(.*)$/.exec(l);
    const numero = /^\s*\d{1,3}[.)]\s+(.*)$/.exec(l);
    if (!l.trim()) {
      fermerParagraphe();
      fermerListe();
    } else if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) {
      fermerParagraphe();
      fermerListe();
      sortie.push('<hr style="border:0;border-top:1px solid #e3e3ea;margin:18px 0">');
    } else if (titre) {
      fermerParagraphe();
      fermerListe();
      const taille = { 1: 20, 2: 17, 3: 15 }[titre[1].length];
      sortie.push(`<p style="margin:6px 0 10px;font-size:${taille}px;font-weight:700">${enLigne(echapper(titre[2]))}</p>`);
    } else if (/^\s*>/.test(l)) {
      fermerParagraphe();
      fermerListe();
      sortie.push(`<blockquote style="margin:0 0 14px;padding:4px 12px;border-left:3px solid #c9c9d6;color:#55556a">${enLigne(echapper(l.replace(/^\s*>\s?/, '')))}</blockquote>`);
    } else if (puce || numero) {
      fermerParagraphe();
      const genre = puce ? 'ul' : 'ol';
      if (liste && liste.genre !== genre) fermerListe();
      if (!liste) liste = { genre, items: [] };
      const coche = puce?.[1] ? (puce[1].toLowerCase() === 'x' ? '☑ ' : '☐ ') : '';
      liste.items.push(`<li style="margin:0 0 4px">${coche}${enLigne(echapper(puce ? puce[2] : numero[1]))}</li>`);
    } else {
      fermerListe();
      paragraphe.push(l);
    }
  }
  fermerParagraphe();
  fermerListe();
  return sortie.join('\n');
}

/** Markdown limité → texte brut lisible (version texte de l'e-mail). */
export function markdownVersTexte(source) {
  return nettoyerTexte(source)
    .replace(/\{\{[a-z]+\|([^}]*)\}\}/g, '$1')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2')
    .replace(/~~([^~\n]+)~~/g, '$1')
    .replace(/==([^=\n]+)==/g, '$1')
    .replace(/^#{1,3}\s+/gm, '')
    .replace(/^\s*```.*$/gm, '')
    .replace(/^\s*- \[( |x)\]\s+/gim, (_, c) => (c.toLowerCase() === 'x' ? '[x] ' : '[ ] '))
    .trim();
}

function bouton(lien, libelle) {
  if (!lienSur(lien)) return '';
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0 18px"><tr><td style="border-radius:10px;background:${ACCENT}"><a href="${echapper(lien)}" style="display:inline-block;padding:13px 26px;font-weight:700;font-size:15px;color:#ffffff;text-decoration:none;border-radius:10px">${echapper(libelle)}</a></td></tr></table>`;
}

/** Mise en page commune (largeur 600 px, en-tête, carte blanche, pied). */
function page({ langue, titre, corpsHtml, site }) {
  const t = TEXTES[langue];
  const lienSite = lienSur(site) ? `<a href="${echapper(site)}" style="color:#8b8b9a">${echapper(site.replace(/^https?:\/\//, ''))}</a>` : 'AppDashboard';
  return `<!doctype html>
<html lang="${langue}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${echapper(titre)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f8;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1d1d2b">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f4f8"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px">
<tr><td style="padding:0 6px 14px;font-size:18px;font-weight:800;letter-spacing:.2px;color:${ACCENT}">◆ AppDashboard</td></tr>
<tr><td style="background:#ffffff;border-radius:16px;padding:28px 28px 14px;font-size:15px;line-height:1.6;box-shadow:0 1px 3px rgba(20,20,40,.06)">
${corpsHtml}
</td></tr>
<tr><td style="padding:16px 8px;font-size:12px;line-height:1.5;color:#8b8b9a;text-align:center">${echapper(t.pied)}<br>${echapper(t.automatique)}<br>${lienSite}</td></tr>
</table></td></tr></table></body></html>`;
}

/**
 * Rend un e-mail : `{ objet, texte, html }`.
 *  - `libre` : `{ objet, message }` (Markdown) ;
 *  - `invitation` : `{ objet, message, lien }` (message rendu par l'app depuis SON modèle) ;
 *  - `support` : `{ numero, titre, reponse, prenom }` ;
 *  - `recap` : `{ prenom, elements: [{ titre, texte, date }] }`.
 */
export function rendreCourriel({ modele, langue: l, variables = {}, site = 'https://appdashboard.fr' }) {
  const langue = langueCourriel(l);
  const t = TEXTES[langue];
  const v = variables;
  if (modele === 'support') {
    const objet = remplir(t.supportObjet, { numero: v.numero, titre: nettoyerTexte(v.titre, 100) }).slice(0, 160);
    const intro = remplir(t.supportIntro, { numero: v.numero, titre: nettoyerTexte(v.titre, 100) });
    const bonjour = v.prenom ? remplir(t.bonjour, { prenom: nettoyerTexte(v.prenom, 40) }) : '';
    const html = page({
      langue,
      titre: objet,
      site,
      corpsHtml: `${bonjour ? `<p style="margin:0 0 14px">${echapper(bonjour)}</p>` : ''}<p style="margin:0 0 14px">${echapper(intro)}</p><div style="margin:0 0 16px;padding:14px 16px;background:#f6f6fb;border-left:4px solid #22a06b;border-radius:8px">${markdownVersHtml(v.reponse)}</div><p style="margin:0 0 14px;color:#55556a">${echapper(t.supportSuite)}</p>${bouton(site, t.ouvrir)}`,
    });
    const texte = [bonjour, intro, '', markdownVersTexte(v.reponse), '', t.supportSuite, site].filter(x => x !== undefined).join('\n');
    return { objet, texte, html };
  }
  if (modele === 'recap') {
    const elements = Array.isArray(v.elements) ? v.elements.slice(0, 50) : [];
    const objet = remplir(t.recapObjet, { n: elements.length });
    const bonjour = v.prenom ? remplir(t.bonjour, { prenom: nettoyerTexte(v.prenom, 40) }) : '';
    const lignesHtml = elements
      .map(e => `<tr><td style="padding:10px 0;border-bottom:1px solid #eeeef3"><div style="font-weight:700">${echapper(nettoyerTexte(e.titre, 200))}</div>${e.texte ? `<div style="color:#55556a;font-size:14px">${echapper(nettoyerTexte(e.texte, 400))}</div>` : ''}${e.date ? `<div style="color:#8b8b9a;font-size:12px">${echapper(e.date)}</div>` : ''}</td></tr>`)
      .join('');
    const html = page({
      langue,
      titre: objet,
      site,
      corpsHtml: `${bonjour ? `<p style="margin:0 0 14px">${echapper(bonjour)}</p>` : ''}<p style="margin:0 0 14px">${echapper(t.recapIntro)}</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 16px">${lignesHtml}</table>${bouton(site, t.ouvrir)}<p style="margin:0 0 14px;color:#8b8b9a;font-size:13px">${echapper(t.recapReglage)}</p>`,
    });
    const texte = [bonjour, t.recapIntro, '', ...elements.map(e => `• ${nettoyerTexte(e.titre, 200)}${e.texte ? ` — ${nettoyerTexte(e.texte, 400)}` : ''}${e.date ? ` (${e.date})` : ''}`), '', site, '', t.recapReglage].join('\n');
    return { objet, texte, html };
  }
  const objet = nettoyerTexte(v.objet, 160).replace(/\s+/g, ' ').trim();
  const message = nettoyerTexte(v.message, 20_000);
  if (modele === 'invitation') {
    const lien = String(v.lien ?? '').trim();
    const html = page({
      langue,
      titre: objet,
      site,
      corpsHtml: `${bouton(lien, t.invitationBouton)}${markdownVersHtml(message)}${lienSur(lien) ? `<p style="margin:0 0 14px;color:#8b8b9a;font-size:12px">${echapper(t.invitationLien)}<br><a href="${echapper(lien)}" style="color:${ACCENT};word-break:break-all">${echapper(lien)}</a></p>` : ''}`,
    });
    return { objet, texte: markdownVersTexte(message), html };
  }
  // libre
  const html = page({ langue, titre: objet, site, corpsHtml: markdownVersHtml(message) });
  return { objet, texte: markdownVersTexte(message), html };
}

/** Adresse masquée pour le journal : « l***@e***.fr ». Jamais l'adresse en clair. */
export function masquerAdresse(adresse) {
  const m = /^([^@\s]+)@([^@\s]+)$/.exec(String(adresse ?? '').trim());
  if (!m) return '***';
  const [, local, domaine] = m;
  const points = domaine.split('.');
  const ext = points.length > 1 ? points.pop() : '';
  return `${local[0]}***@${(points.join('.')[0] ?? '*')}***${ext ? `.${ext}` : ''}`;
}

/** Adresse plausible (la vraie vérification est l'envoi) ; jamais de retour à la ligne (injection d'en-têtes). */
export function adresseValide(adresse) {
  const e = String(adresse ?? '').trim();
  if (e.length < 6 || e.length > 254 || /[\s<>,;"]/.test(e)) return false;
  const m = /^([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+)@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)$/.exec(e);
  if (!m) return false;
  return m[1].length <= 64 && !m[1].startsWith('.') && !m[1].endsWith('.') && !m[1].includes('..') && /\.[A-Za-z]{2,}$/.test(m[2]);
}
