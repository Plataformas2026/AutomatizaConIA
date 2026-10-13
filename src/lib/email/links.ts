/** Enlaces para abrir un correo ya redactado en Outlook. Sin dependencias de servidor. */

const MAX_BODY_IN_LINK = 1800; // los navegadores/Outlook cortan enlaces muy largos

function crlf(s: string): string {
  return s.replace(/\r?\n/g, '\r\n');
}

export function clipBody(body: string): { text: string; clipped: boolean } {
  return body.length > MAX_BODY_IN_LINK
    ? { text: body.slice(0, MAX_BODY_IN_LINK) + '\n[…texto recortado: usa «Copiar texto» para el mensaje completo]', clipped: true }
    : { text: body, clipped: false };
}

/** Abre tu programa de correo predeterminado (Outlook de escritorio si es el tuyo). */
export function mailtoLink(to: string, subject: string, body: string): string {
  const addr = to.split(/[;,]/).map((a) => a.trim()).filter(Boolean).join(',');
  const { text } = clipBody(body);
  return `mailto:${encodeURIComponent(addr).replace(/%40/g, '@').replace(/%2C/g, ',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(crlf(text))}`;
}

/** Outlook en la web (cuentas de trabajo o centro educativo, Microsoft 365). */
export function outlookWebLink(to: string, subject: string, body: string): string {
  const addr = to.split(/[;,]/).map((a) => a.trim()).filter(Boolean).join(';');
  const { text } = clipBody(body);
  return `https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(addr)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
}

/** Outlook.com (cuenta personal: outlook.com, hotmail, live…). */
export function outlookPersonalLink(to: string, subject: string, body: string): string {
  const addr = to.split(/[;,]/).map((a) => a.trim()).filter(Boolean).join(';');
  const { text } = clipBody(body);
  return `https://outlook.live.com/mail/0/deeplink/compose?to=${encodeURIComponent(addr)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
}
