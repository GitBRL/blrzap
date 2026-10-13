// Envio de e-mails da régua de cobrança via SMTP (nodemailer).
import nodemailer from 'nodemailer'
import { getSmtp } from './config.js'

let cached = { key: '', transporter: null }

function transport() {
  const smtp = getSmtp()
  if (!smtp.host || !smtp.fromEmail) throw new Error('Configure o SMTP (servidor e remetente) em Cobrança → Configurações.')
  const key = JSON.stringify(smtp)
  if (cached.key !== key) {
    cached = {
      key,
      transporter: nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure, // true para a porta 465; STARTTLS nas demais
        auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
        connectionTimeout: 20_000,
        greetingTimeout: 20_000,
        socketTimeout: 60_000,
      }),
    }
  }
  return { transporter: cached.transporter, smtp }
}

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/** Texto simples → HTML: links clicáveis, *negrito* e quebras de linha. */
export function textToHtml(text) {
  const body = escapeHtml(String(text || ''))
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
    .replace(/(^|\s)\*(?!\s)([^*\n]+?)\*(?=\s|$|[.,!?])/gm, '$1<strong>$2</strong>')
    .replace(/\n/g, '<br>')
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#1f2933">${body}</div>`
}

export async function sendMail({ to, subject, text, attachments }) {
  const { transporter, smtp } = transport()
  const from = smtp.fromName ? { name: smtp.fromName, address: smtp.fromEmail } : smtp.fromEmail
  const info = await transporter.sendMail({ from, to, subject, text, html: textToHtml(text), attachments })
  return { messageId: info.messageId }
}

export async function verifySmtp() {
  const { transporter } = transport()
  await transporter.verify()
}
