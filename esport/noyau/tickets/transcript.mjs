/**
 * Tickets : transcript HTML d'un ticket (téléchargé depuis l'app, envoyé en MP par /ticket transcript). Page
 * autonome, sans script ni ressource externe, imprimable en PDF (navigateur : Imprimer › Enregistrer en PDF). Tout le
 * texte est échappé. `notes` : inclure les notes internes (staff seulement ; jamais dans ce qui part sur Discord).
 */

import { jsonOu } from '../outils.mjs';

const echapper = v =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const NOMS = {
  fr: { ticket: 'Ticket n°', categorie: 'Catégorie', statut: 'Statut', auteur: 'Auteur', ouvert: 'Ouvert le', ferme: 'Fermé le', raison: 'Raison', note: 'Note', reponses: 'Formulaire', interne: 'Note interne', systeme: 'Bot', app: 'Réponse depuis l’app', supprime: 'supprimé sur Discord', piece: 'Pièce jointe', genere: 'Transcript généré le' },
  en: { ticket: 'Ticket #', categorie: 'Category', statut: 'Status', auteur: 'Author', ouvert: 'Opened', ferme: 'Closed', raison: 'Reason', note: 'Rating', reponses: 'Form', interne: 'Internal note', systeme: 'Bot', app: 'Reply from the app', supprime: 'deleted on Discord', piece: 'Attachment', genere: 'Transcript generated' },
};

/** Rend `{ nom, contenu }` (fichier HTML). */
export function transcriptHtml({ ticket, categorie, messages, pieces = [], langue = 'fr', notes = false, maintenant = Date.now() }) {
  const n = NOMS[langue === 'en' ? 'en' : 'fr'];
  const date = v => (v ? new Intl.DateTimeFormat(langue === 'en' ? 'en-GB' : 'fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Paris' }).format(new Date(v)) : '—');
  const parMessage = new Map();
  for (const p of pieces) {
    if (!parMessage.has(p.message_id)) parMessage.set(p.message_id, []);
    parMessage.get(p.message_id).push(p);
  }
  const lignes = messages
    .filter(m => notes || m.genre !== 'note')
    .map(m => {
      const genre = m.genre === 'note' ? ` <span class="g note">${n.interne}</span>` : m.genre === 'systeme' ? ` <span class="g">${n.systeme}</span>` : m.genre === 'app' ? ` <span class="g">${n.app}</span>` : '';
      const ps = (parMessage.get(m.id) ?? []).map(p => `<li>${n.piece} : ${echapper(p.nom)} (${Math.round(Number(p.taille) / 1024)} Ko)</li>`).join('');
      return `<article class="${m.genre}${m.staff ? ' staff' : ''}"><header><strong>${echapper(m.auteur_nom || '—')}</strong>${genre} <time>${date(m.cree_le)}</time>${m.supprime_le ? ` <em>(${n.supprime})</em>` : ''}</header><p>${echapper(m.contenu).replace(/\n/g, '<br>')}</p>${ps ? `<ul>${ps}</ul>` : ''}</article>`;
    })
    .join('\n');
  const reponses = jsonOu(ticket.reponses, [])
    .map(r => `<dt>${echapper(r.libelle?.[langue] || r.libelle?.fr || r.id)}</dt><dd>${echapper(r.valeur).replace(/\n/g, '<br>')}</dd>`)
    .join('');
  const titre = `${n.ticket}${ticket.numero}`;
  const contenu = `<!doctype html>
<html lang="${langue === 'en' ? 'en' : 'fr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${echapper(titre)}</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:860px;margin:24px auto;padding:0 16px;color:#1d1d1f;background:#fff}
h1{font-size:22px}dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 12px}dt{font-weight:600}dd{margin:0}
article{border-left:3px solid #c7c7cc;padding:6px 12px;margin:10px 0;break-inside:avoid}article.staff{border-color:#5865f2}article.note{border-color:#e8a23a;background:#fff8ec}article.systeme{border-color:#8e8e93;color:#3a3a3c}
header{font-size:13px;color:#3a3a3c}time{color:#6e6e73}.g{font-size:11px;border:1px solid #c7c7cc;border-radius:4px;padding:0 4px}.g.note{border-color:#e8a23a}
p{margin:4px 0;white-space:normal;overflow-wrap:anywhere}footer{margin-top:24px;font-size:12px;color:#6e6e73}
@media print{body{margin:0}}
</style></head><body>
<h1>${echapper(titre)}</h1>
<dl><dt>${n.categorie}</dt><dd>${echapper(categorie ?? '—')}</dd><dt>${n.statut}</dt><dd>${echapper(ticket.statut)}</dd><dt>${n.auteur}</dt><dd>${echapper(ticket.auteur_nom || ticket.auteur_discord_id)}</dd><dt>${n.ouvert}</dt><dd>${date(ticket.ouvert_le)}</dd><dt>${n.ferme}</dt><dd>${date(ticket.ferme_le)}</dd>${ticket.raison_fermeture ? `<dt>${n.raison}</dt><dd>${echapper(ticket.raison_fermeture)}</dd>` : ''}${ticket.note ? `<dt>${n.note}</dt><dd>${Number(ticket.note)}/5${ticket.note_commentaire ? ` · ${echapper(ticket.note_commentaire)}` : ''}</dd>` : ''}</dl>
${reponses ? `<h2>${n.reponses}</h2><dl>${reponses}</dl>` : ''}
<section>
${lignes}
</section>
<footer>${n.genere} ${date(maintenant)}</footer>
</body></html>
`;
  return { nom: `ticket-${String(ticket.numero).padStart(4, '0')}.html`, contenu };
}
