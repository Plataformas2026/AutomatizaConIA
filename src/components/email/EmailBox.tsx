'use client';

import { useRef, useState } from 'react';
import { MESSAGE_VARIABLES, sampleValues } from '@/lib/messages/variables';

export interface EmailDraftValue {
  from: string;
  to: string;
  subject: string;
  body: string;
  mode: 'per_row' | 'summary';
}

export const EMPTY_EMAIL: EmailDraftValue = { from: '', to: '', subject: '', body: '', mode: 'per_row' };

type Field = 'to' | 'subject' | 'body';

const TOKEN = /\{(count|rows|column|sheet|file|rule)\}|\{col:([^{}]{1,200})\}/g;

interface Props {
  value: EmailDraftValue;
  onChange: (v: EmailDraftValue) => void;
  /** Columnas del Excel que se pueden insertar como dato. */
  columns: string[];
  hasSheets: boolean;
  fileName: string;
  ruleName: string;
  columnName: string;
  sheetName: string;
}

/** Muestra una plantilla con datos de ejemplo: {col:Importe} → «Importe». */
function preview(template: string, p: Pick<Props, 'fileName' | 'ruleName' | 'columnName' | 'sheetName'>): string {
  const sample = sampleValues(p);
  return template.replace(TOKEN, (_m, key: keyof typeof sample | undefined, col: string | undefined) =>
    col !== undefined ? `«${col.trim()}»` : sample[key as keyof typeof sample],
  );
}

/** Correo de Outlook de una regla: remitente, destinatario, asunto y mensaje, con datos del Excel. */
export function EmailBox({ value, onChange, columns, hasSheets, fileName, ruleName, columnName, sheetName }: Props) {
  const refs = useRef<Partial<Record<Field, HTMLInputElement | HTMLTextAreaElement | null>>>({});
  const [last, setLast] = useState<Field>('body');

  function insert(token: string) {
    if (!token) return;
    const el = refs.current[last];
    const current = value[last];
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    const next = current.slice(0, start) + token + current.slice(end);
    onChange({ ...value, [last]: next });
    requestAnimationFrame(() => {
      const target = refs.current[last];
      if (!target) return;
      target.focus();
      const pos = start + token.length;
      target.setSelectionRange(pos, pos);
    });
  }

  const ctx = { fileName, ruleName, columnName, sheetName };
  const set = <K extends keyof EmailDraftValue>(k: K, v: EmailDraftValue[K]) => onChange({ ...value, [k]: v });
  const vars = MESSAGE_VARIABLES.filter((v) => hasSheets || !v.needsSheets);

  return (
    <div className="email-box">
      <p className="muted email-help">
        Esta regla preparará un correo con los datos de tu Excel. Si tu ordenador no está configurado para enviarlo solo,
        aparecerá en tu Dashboard como «pendiente de enviar» para que lo revises y lo mandes tú. Nunca se envía nada en
        tu nombre sin tu permiso.
      </p>

      <div className="field">
        <span className="field-title">¿Cuántos correos?</span>
        <div className="choice-col" role="radiogroup" aria-label="Cuántos correos">
          <label className="choice">
            <input type="radio" name="email-mode" checked={value.mode === 'per_row'} onChange={() => set('mode', 'per_row')} />
            <span>
              <strong>Uno por cada fila que cumpla la condición</strong>
              <span className="muted">Por ejemplo, un correo a cada cliente con su importe. Máximo 25 por vez.</span>
            </span>
          </label>
          <label className="choice">
            <input type="radio" name="email-mode" checked={value.mode === 'summary'} onChange={() => set('mode', 'summary')} />
            <span>
              <strong>Uno solo con el resumen</strong>
              <span className="muted">Los datos de varias filas se juntan en el mismo correo.</span>
            </span>
          </label>
        </div>
      </div>

      <div className="field">
        <label htmlFor="em-from">Remitente (quién lo manda) — opcional</label>
        <input
          id="em-from"
          type="email"
          maxLength={254}
          value={value.from}
          onChange={(e) => set('from', e.target.value.trim())}
          placeholder="tu.nombre@tuempresa.com"
        />
        <span className="muted">La cuenta de Outlook desde la que debe salir. Si lo dejas vacío, sale desde tu cuenta principal.</span>
      </div>

      <div className="field">
        <label htmlFor="em-var">Insertar un dato en el destinatario, el asunto o el mensaje</label>
        <select id="em-var" value="" onChange={(e) => insert(e.target.value)}>
          <option value="">Elige un dato…</option>
          <optgroup label="Columnas de tu Excel (cambian en cada fila)">
            {columns.map((c) => (
              <option key={c} value={`{col:${c}}`}>
                {c}
              </option>
            ))}
          </optgroup>
          <optgroup label="De la regla">
            {vars.map((v) => (
              <option key={v.key} value={`{${v.key}}`}>
                {v.label}
              </option>
            ))}
          </optgroup>
        </select>
        <span className="muted">Se coloca donde tengas el cursor. Verás algo como {'{col:Importe}'}: se sustituirá por el valor real.</span>
      </div>

      <div className="field">
        <label htmlFor="em-to">Destinatario</label>
        <input
          id="em-to"
          ref={(el) => {
            refs.current.to = el;
          }}
          maxLength={500}
          value={value.to}
          onFocus={() => setLast('to')}
          onChange={(e) => set('to', e.target.value)}
          placeholder="Una dirección, o inserta la columna que tiene el correo"
        />
        <span className="muted">Varias direcciones se separan con punto y coma.</span>
      </div>

      <div className="field">
        <label htmlFor="em-subject">Asunto</label>
        <input
          id="em-subject"
          ref={(el) => {
            refs.current.subject = el;
          }}
          maxLength={200}
          value={value.subject}
          onFocus={() => setLast('subject')}
          onChange={(e) => set('subject', e.target.value)}
          placeholder="Ej.: Factura {col:Nº factura} pendiente de pago"
        />
      </div>

      <div className="field">
        <label htmlFor="em-body">Mensaje</label>
        <textarea
          id="em-body"
          ref={(el) => {
            refs.current.body = el;
          }}
          maxLength={4000}
          rows={5}
          value={value.body}
          onFocus={() => setLast('body')}
          onChange={(e) => set('body', e.target.value)}
          placeholder={'Hola {col:Cliente},\nTienes pendiente un pago de {col:Importe}.'}
        />
      </div>

      {(value.subject || value.body) && (
        <div className="field">
          <span className="field-title">Así se verá (con datos de ejemplo)</span>
          <div className="outbox-body">
            {`Para: ${preview(value.to, ctx) || '…'}\nAsunto: ${preview(value.subject, ctx)}\n\n${preview(value.body, ctx)}`}
          </div>
        </div>
      )}
    </div>
  );
}
