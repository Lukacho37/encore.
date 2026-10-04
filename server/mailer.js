import nodemailer from 'nodemailer';
import { config } from './config.js';

let transport = null;
if (config.smtp) transport = nodemailer.createTransport(config.smtp);

const COPY = {
  fr: {
    verify: {
      subject: 'Confirme ton adresse e-mail · encore.',
      title: 'Plus qu’une étape',
      body: (u) => `Salut ${u}, confirme ton adresse e-mail pour activer ton compte. Tes 5 boosters de bienvenue t’attendent.`,
      cta: 'Confirmer mon adresse',
      expiry: 'Ce lien expire dans 24 heures.',
    },
    reset: {
      subject: 'Réinitialise ton mot de passe · encore.',
      title: 'Nouveau mot de passe',
      body: (u) => `Salut ${u}, tu as demandé à réinitialiser ton mot de passe. Clique sur le bouton pour en choisir un nouveau.`,
      cta: 'Choisir un mot de passe',
      expiry: 'Ce lien expire dans 1 heure.',
    },
    ignore: 'Si tu n’es pas à l’origine de cette demande, ignore simplement cet e-mail.',
    fallback: 'Le bouton ne marche pas ? Copie ce lien dans ton navigateur :',
  },
  en: {
    verify: {
      subject: 'Confirm your email address · encore.',
      title: 'One more step',
      body: (u) => `Hi ${u}, confirm your email address to activate your account. Your 5 welcome packs are waiting.`,
      cta: 'Confirm my email',
      expiry: 'This link expires in 24 hours.',
    },
    reset: {
      subject: 'Reset your password · encore.',
      title: 'New password',
      body: (u) => `Hi ${u}, you asked to reset your password. Click the button to choose a new one.`,
      cta: 'Choose a password',
      expiry: 'This link expires in 1 hour.',
    },
    ignore: 'If you didn’t request this, you can safely ignore this email.',
    fallback: 'Button not working? Paste this link into your browser:',
  },
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function render(kind, lang, username, link) {
  const L = COPY[lang] || COPY.fr;
  const c = L[kind];
  const text = `${c.title}\n\n${c.body(username)}\n\n${link}\n\n${c.expiry}\n${L.ignore}`;
  const html = `<!doctype html><html><body style="margin:0;background:#100d16;font-family:Helvetica,Arial,sans-serif;color:#f4eee3">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#100d16;padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#1b1624;border:1px solid #352d42;border-radius:16px">
<tr><td style="padding:28px 28px 8px;font-size:26px;font-weight:900;letter-spacing:-0.5px">encore<span style="color:#ff4f7e">.</span></td></tr>
<tr><td style="padding:8px 28px 0;font-size:20px;font-weight:700">${esc(c.title)}</td></tr>
<tr><td style="padding:12px 28px 0;font-size:15px;line-height:1.55;color:#cfc7da">${esc(c.body(username))}</td></tr>
<tr><td style="padding:24px 28px"><a href="${esc(link)}" style="display:inline-block;background:#f4eee3;color:#100d16;text-decoration:none;font-weight:700;padding:13px 22px;border-radius:999px">${esc(c.cta)}</a></td></tr>
<tr><td style="padding:0 28px 8px;font-size:13px;color:#a79fb5">${esc(c.expiry)} ${esc(L.ignore)}</td></tr>
<tr><td style="padding:8px 28px 28px;font-size:12px;color:#a79fb5;word-break:break-all">${esc(L.fallback)}<br><a href="${esc(link)}" style="color:#3fd6c4">${esc(link)}</a></td></tr>
</table></td></tr></table></body></html>`;
  return { subject: c.subject, text, html };
}

export function createMailer(db) {
  async function deliver({ to, subject, text, html }) {
    if (transport) {
      await transport.sendMail({ from: config.mailFrom, to, subject, text, html });
      return;
    }
    // Aucun serveur SMTP configuré : l'e-mail est conservé dans la boîte de test (/dev/mailbox).
    db.prepare('INSERT INTO dev_emails (to_addr, subject, text, html, created_at) VALUES (?, ?, ?, ?, ?)').run(
      to, subject, text, html, Date.now(),
    );
    if (!config.isTest) console.log(`\n✉️  [boîte de test] ${subject} → ${to}\n${text}\n`);
  }

  return {
    devMailbox: !transport && !config.isProd,
    async sendVerification(user, token) {
      const link = `${config.appUrl}/verify?token=${encodeURIComponent(token)}`;
      await deliver({ to: user.email, ...render('verify', user.lang, user.username, link) });
    },
    async sendReset(user, token) {
      const link = `${config.appUrl}/reset?token=${encodeURIComponent(token)}`;
      await deliver({ to: user.email, ...render('reset', user.lang, user.username, link) });
    },
  };
}
