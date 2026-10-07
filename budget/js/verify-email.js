const iconEl = document.getElementById('status-icon');
const titleEl = document.getElementById('status-title');
const messageEl = document.getElementById('status-message');
const backLink = document.getElementById('back-link');

function show(icon, title, message) {
  iconEl.textContent = icon;
  titleEl.textContent = title;
  messageEl.textContent = message;
  backLink.style.display = 'block';
}

const token = new URLSearchParams(window.location.search).get('token');

if (!token) {
  show('⚠️', 'Lien invalide', 'Ce lien de confirmation est incomplet. Demandez un nouvel email depuis l\'application.');
} else {
  fetch('/api/auth/verify-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  })
    .then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        show('✅', 'Adresse confirmée', 'Votre compte est activé. Vous pouvez maintenant vous connecter et synchroniser vos appareils.');
      } else {
        show('⚠️', 'Confirmation impossible', data.message || 'Ce lien est invalide ou a expiré.');
      }
    })
    .catch(() => {
      show('⚠️', 'Serveur injoignable', 'Impossible de contacter le serveur. Réessayez plus tard.');
    });
}
