/** Direcciones de correo. Sin dependencias de servidor: lo usan el constructor de reglas y el motor. */

const ADDRESS = /^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/;

/** «ana@x.com; luis@y.com» → lista limpia, o null si alguna no es válida (máx. 10). */
export function parseRecipients(text: string): string[] | null {
  const parts = text
    .split(/[;,]/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0 || parts.length > 10) return null;
  return parts.every((p) => p.length <= 254 && ADDRESS.test(p)) ? parts : null;
}
