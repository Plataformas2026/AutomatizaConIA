'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  DATE_OPERATORS,
  MAX_ELAPSED,
  OPERATORS,
  OPERATOR_LABELS,
  TIME_UNITS,
  TIME_UNIT_LABELS,
  isDateOperator,
  isUnary,
  type Operator,
  type TimeUnit,
} from '@/lib/rules/operators';
import { humanizeTemplate } from '@/lib/messages/variables';
import { MessageBuilder, MESSAGE_MAX_LENGTH } from './MessageBuilder';
import { EmailBox, EMPTY_EMAIL, type EmailDraftValue } from './email/EmailBox';
import { parseRecipients } from '@/lib/email/address';

export interface ColumnInfo {
  name: string;
  /** Hojas vigiladas en las que existe la columna ([] en CSV). */
  sheets: string[];
  /** La columna contiene fechas (habilita «ha pasado al menos…» y «ya llegó la fecha»). */
  isDate?: boolean;
}

export interface RuleRow {
  id: string;
  name: string;
  enabled: boolean;
  condition: {
    left?: { column?: string };
    operator?: Operator;
    unit?: TimeUnit;
    right?: { type?: 'column' | 'value'; column?: string; value?: string | number };
  };
  actions: { type: string; message?: string; severity?: string; to?: string; cc?: string; subject?: string; mode?: string }[];
  last_error: string | null;
  last_evaluated_at: string | null;
}

/** «{col:Importe}» → «Importe» para mostrar en la lista. */
function humanizeEmailTemplate(t: string): string {
  return humanizeTemplate(t.replace(/\{col:([^{}]{1,200})\}/g, '‹$1›'));
}

/** 2026-11-15 → 15/11/2026 */
function formatIso(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

const COMPARATORS: readonly Operator[] = ['gt', 'gte', 'lt', 'lte', 'eq', 'neq'];

function describe(c: RuleRow['condition']): string {
  const op = c.operator ? OPERATOR_LABELS[c.operator] : '?';
  if (c.operator && isUnary(c.operator)) return `«${c.left?.column}» ${op}`;
  if (c.operator === 'elapsed') {
    return `«${c.left?.column}» ha pasado al menos ${c.right?.value} ${TIME_UNIT_LABELS[c.unit ?? 'days']} desde esa fecha`;
  }
  if (c.operator === 'on_date') return `«${c.left?.column}» tiene fecha y ya llegó el ${formatIso(String(c.right?.value ?? ''))}`;
  const right = c.right?.type === 'column' ? `«${c.right.column}»` : `"${c.right?.value}"`;
  return `«${c.left?.column}» ${op} ${right}`;
}

const SEVERITIES = [
  { value: 'info', label: 'Informativa' },
  { value: 'warning', label: 'Aviso' },
  { value: 'critical', label: 'Crítica' },
] as const;

interface Props {
  fileId: string;
  fileName: string;
  initialRules: RuleRow[];
  /** null mientras se leen del archivo. */
  columns: ColumnInfo[] | null;
  columnsError: string | null;
  /** Hojas que se vigilan ahora mismo. */
  active: string[];
  hasSheets: boolean;
}

export function RulesPanel({ fileId, fileName, initialRules, columns, columnsError, active, hasSheets }: Props) {
  const router = useRouter();

  // Formulario: [Variable 1] [Operador] [Variable 2 | Valor fijo]
  const [name, setName] = useState('');
  const [left, setLeft] = useState('');
  const [operator, setOperator] = useState<Operator>('gt');
  const [rightType, setRightType] = useState<'column' | 'value'>('value');
  const [rightColumn, setRightColumn] = useState('');
  const [rightValue, setRightValue] = useState('');
  const [elapsedN, setElapsedN] = useState('30');
  const [unit, setUnit] = useState<TimeUnit>('days');
  const [dateValue, setDateValue] = useState('');
  const [message, setMessage] = useState('');
  const [msgReset, setMsgReset] = useState(0);
  const [severity, setSeverity] = useState<'info' | 'warning' | 'critical'>('info');
  const [alertOn, setAlertOn] = useState(true);
  const [emailOn, setEmailOn] = useState(false);
  const [email, setEmail] = useState<EmailDraftValue>(EMPTY_EMAIL);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Al llegar (o cambiar) las columnas, conserva la elección si sigue existiendo.
  useEffect(() => {
    if (!columns?.length) return;
    const names = columns.map((c) => c.name);
    setLeft((cur) => (names.includes(cur) ? cur : names[0]));
    setRightColumn((cur) => (names.includes(cur) ? cur : (names[1] ?? names[0])));
  }, [columns]);

  const leftIsDate = !!columns?.find((c) => c.name === left)?.isDate;
  const valueIsDate = leftIsDate && COMPARATORS.includes(operator);

  // Las opciones de fecha solo existen para columnas de fecha.
  useEffect(() => {
    if (!leftIsDate && isDateOperator(operator)) setOperator('gt');
  }, [leftIsDate, operator]);
  // El valor fijo cambia de tipo (texto ↔ calendario): se vacía para no dejar algo inválido.
  useEffect(() => {
    setRightValue('');
  }, [valueIsDate]);

  function columnLabel(c: ColumnInfo): string {
    // Con varias hojas, avisa de las columnas que no están en todas.
    if (active.length > 1 && c.sheets.length > 0 && c.sheets.length < active.length) {
      return `${c.name} (solo en ${c.sheets.join(', ')})`;
    }
    return c.name;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!alertOn && !emailOn) {
      setFormError('Elige al menos una cosa que hacer: avisarte en la aplicación o enviar un correo.');
      return;
    }
    if (alertOn && !message.trim()) {
      setFormError('Escribe el texto del aviso.');
      return;
    }
    if (alertOn && message.length > MESSAGE_MAX_LENGTH) {
      setFormError(`El texto del aviso no puede pasar de ${MESSAGE_MAX_LENGTH} caracteres.`);
      return;
    }
    if (operator === 'elapsed') {
      const n = Number(elapsedN);
      if (!elapsedN.trim() || !Number.isInteger(n) || n < 0 || n > MAX_ELAPSED) {
        setFormError(`Indica cuánto tiempo debe pasar: un número entero entre 0 y ${MAX_ELAPSED}.`);
        return;
      }
    }
    if (operator === 'on_date' && !dateValue) {
      setFormError('Elige en el calendario la fecha en la que quieres el aviso.');
      return;
    }
    if (emailOn) {
      if (!email.to.trim() || !email.subject.trim() || !email.body.trim()) {
        setFormError('En el correo faltan el destinatario, el asunto o el mensaje.');
        return;
      }
      // Si el destinatario es fijo (sin datos del Excel), comprueba que sea una dirección válida.
      if (!/\{[^}]+\}/.test(email.to) && !parseRecipients(email.to)) {
        setFormError('El destinatario no es una dirección de correo válida.');
        return;
      }
      if (email.cc.trim() && !/\{[^}]+\}/.test(email.cc) && !parseRecipients(email.cc)) {
        setFormError('Las direcciones en copia (CC) no son válidas. Sepáralas con punto y coma.');
        return;
      }
    }

    setSaving(true);
    const condition = {
      kind: 'compare',
      left: { type: 'column', column: left },
      operator,
      ...(operator === 'elapsed'
        ? { unit, right: { type: 'value', value: Number(elapsedN) } }
        : operator === 'on_date'
          ? { right: { type: 'value', value: dateValue } }
          : isUnary(operator)
            ? {}
            : {
                right:
                  rightType === 'column'
                    ? { type: 'column', column: rightColumn }
                    : { type: 'value', value: rightValue },
              }),
    };

    const res = await fetch('/api/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileId,
        name,
        condition,
        actions: [
          ...(alertOn ? [{ type: 'alert', message, severity }] : []),
          ...(emailOn
            ? [{ type: 'email', from: email.from, to: email.to, cc: email.cc, subject: email.subject, body: email.body, mode: email.mode }]
            : []),
        ],
      }),
    });
    setSaving(false);

    if (!res.ok) {
      setFormError('Revisa los campos: falta algún dato o no es válido.');
      return;
    }
    setName('');
    setMessage('');
    setEmail(EMPTY_EMAIL);
    setEmailOn(false);
    setAlertOn(true);
    setMsgReset((n) => n + 1);
    setRightValue('');
    router.refresh();
  }

  async function toggle(rule: RuleRow) {
    await fetch(`/api/rules/${rule.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !rule.enabled }),
    });
    router.refresh();
  }

  async function remove(rule: RuleRow) {
    if (!confirm(`¿Eliminar la regla «${rule.name}»?`)) return;
    await fetch(`/api/rules/${rule.id}`, { method: 'DELETE' });
    router.refresh();
  }

  return (
    <>
      <section className="panel" aria-labelledby="new-rule-title">
        <h2 id="new-rule-title">Nueva regla</h2>
        <form onSubmit={onSubmit}>
          {columnsError && <p className="err">{columnsError}</p>}
          {!columns && !columnsError && <p className="muted">Leyendo las columnas de tu archivo…</p>}

          {columns && columns.length === 0 && (
            <p className="err">No se encontraron columnas en las hojas que vigilas. Revisa la selección de hojas.</p>
          )}

          {columns && columns.length > 0 && (
            <>
              <div className="field">
                <label htmlFor="rule-name">Nombre de la regla</label>
                <input
                  id="rule-name"
                  required
                  maxLength={120}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ej.: Stock bajo mínimo"
                />
              </div>

              <div className="grid3">
                <div className="field">
                  <label htmlFor="left">Si la columna…</label>
                  <select id="left" value={left} onChange={(e) => setLeft(e.target.value)}>
                    {columns.map((c) => (
                      <option key={c.name} value={c.name}>
                        {columnLabel(c)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label htmlFor="op">…cumple</label>
                  <select id="op" value={operator} onChange={(e) => setOperator(e.target.value as Operator)}>
                    {OPERATORS.filter((o) => !isDateOperator(o)).map((o) => (
                      <option key={o} value={o}>
                        {OPERATOR_LABELS[o]}
                      </option>
                    ))}
                    {leftIsDate && (
                      <optgroup label="Para fechas">
                        {DATE_OPERATORS.map((o) => (
                          <option key={o} value={o}>
                            {OPERATOR_LABELS[o]}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>

                {operator === 'elapsed' && (
                  <div className="field">
                    <label htmlFor="elapsed-n">Tiempo transcurrido</label>
                    <div className="inline-pair">
                      <input
                        id="elapsed-n"
                        type="number"
                        min={0}
                        max={MAX_ELAPSED}
                        step={1}
                        required
                        value={elapsedN}
                        onChange={(e) => setElapsedN(e.target.value)}
                        aria-label="Cantidad"
                      />
                      <select value={unit} onChange={(e) => setUnit(e.target.value as TimeUnit)} aria-label="Unidad de tiempo">
                        {TIME_UNITS.map((u) => (
                          <option key={u} value={u}>
                            {TIME_UNIT_LABELS[u]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <span className="muted">
                      Avisa cuando hayan pasado al menos esos días (o semanas, meses…) desde la fecha de cada celda.
                    </span>
                  </div>
                )}

                {operator === 'on_date' && (
                  <div className="field">
                    <label htmlFor="on-date">Fecha del aviso</label>
                    <input id="on-date" type="date" required value={dateValue} onChange={(e) => setDateValue(e.target.value)} />
                    <span className="muted">
                      Desde ese día avisa de las filas que tengan una fecha en esta columna. La comprobación se repite cada día.
                    </span>
                  </div>
                )}

                {!isUnary(operator) && !isDateOperator(operator) && (
                  <div className="field">
                    <label htmlFor="right-type">Comparar con</label>
                    <div className="inline-pair">
                      <select
                        id="right-type"
                        value={rightType}
                        onChange={(e) => setRightType(e.target.value as 'column' | 'value')}
                        aria-label="Tipo de comparación"
                      >
                        <option value="value">Valor fijo</option>
                        <option value="column">Otra columna</option>
                      </select>
                      {rightType === 'column' ? (
                        <select
                          value={rightColumn}
                          onChange={(e) => setRightColumn(e.target.value)}
                          aria-label="Columna con la que comparar"
                        >
                          {columns.map((c) => (
                            <option key={c.name} value={c.name}>
                              {columnLabel(c)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          required
                          type={valueIsDate ? 'date' : 'text'}
                          maxLength={500}
                          value={rightValue}
                          onChange={(e) => setRightValue(e.target.value)}
                          aria-label="Valor fijo"
                        />
                      )}
                    </div>
                  </div>
                )}
              </div>

              <fieldset className="action-pick">
                <legend className="field-title">¿Qué hacer cuando se cumpla?</legend>
                <label className="choice">
                  <input type="checkbox" checked={alertOn} onChange={(e) => setAlertOn(e.target.checked)} />
                  <span>
                    <strong>Avisarme en la aplicación</strong>
                    <span className="muted">Aparece en la pestaña Alertas del proyecto.</span>
                  </span>
                </label>
                <label className="choice">
                  <input type="checkbox" checked={emailOn} onChange={(e) => setEmailOn(e.target.checked)} />
                  <span>
                    <strong>Enviar también un correo (Outlook)</strong>
                    <span className="muted">Con datos de tu Excel: nombres, importes, estados…</span>
                  </span>
                </label>
              </fieldset>

              {alertOn && (
                <>
              <MessageBuilder
                value={message}
                onChange={setMessage}
                resetKey={msgReset}
                fileName={fileName}
                ruleName={name.trim() || 'Nombre de la regla'}
                columnName={left || 'Columna'}
                sheetName={active[0] ?? ''}
                hasSheets={hasSheets}
              />

              <div className="field" style={{ marginTop: 16 }}>
                <span className="field-title">Importancia</span>
                <div className="sev-choice" role="radiogroup" aria-label="Importancia">
                  {SEVERITIES.map((s) => (
                    <label key={s.value} className={`sev-opt sev-${s.value} ${severity === s.value ? 'is-on' : ''}`}>
                      <input
                        type="radio"
                        name="severity"
                        value={s.value}
                        checked={severity === s.value}
                        onChange={() => setSeverity(s.value)}
                      />
                      {s.label}
                    </label>
                  ))}
                </div>
              </div>
                </>
              )}

              {emailOn && (
                <EmailBox
                  value={email}
                  onChange={setEmail}
                  columns={columns.map((c) => c.name)}
                  hasSheets={hasSheets}
                  fileName={fileName}
                  ruleName={name.trim() || 'Nombre de la regla'}
                  columnName={left || 'Columna'}
                  sheetName={active[0] ?? ''}
                />
              )}

              {formError && <p className="err">{formError}</p>}
              <button className="btn primary" disabled={saving}>
                {saving ? 'Guardando…' : 'Guardar regla'}
              </button>
            </>
          )}
        </form>
      </section>

      <h2>Reglas del archivo</h2>
      {!initialRules.length && <p className="muted">Aún no hay reglas.</p>}
      {initialRules.map((r) => (
        <div className={`rule-item ${r.enabled ? '' : 'is-off'}`} key={r.id}>
          <div className="grow">
            <strong>{r.name}</strong> {!r.enabled && <span className="pill paused">Desactivada</span>}
            <div className="muted">Si {describe(r.condition)}</div>
            {r.actions.map((a, i) =>
              a.type === 'email' ? (
                <div className="rule-email" key={i}>
                  ✉ {a.mode === 'summary' ? 'Un correo resumen' : 'Un correo por fila'} a «{humanizeEmailTemplate(a.to ?? '')}» ·
                  asunto «{humanizeEmailTemplate(a.subject ?? '')}»
                </div>
              ) : (
                <div className="rule-msg" key={i}>
                  {humanizeTemplate(a.message ?? '')}
                </div>
              ),
            )}
            {r.last_error && <div className="err">{r.last_error}</div>}
          </div>
          <button className="btn" onClick={() => toggle(r)}>
            {r.enabled ? 'Desactivar' : 'Activar'}
          </button>
          <button className="btn danger" onClick={() => remove(r)}>
            Eliminar
          </button>
        </div>
      ))}
    </>
  );
}
