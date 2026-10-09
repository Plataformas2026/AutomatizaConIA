'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { OPERATORS, OPERATOR_LABELS, isUnary, type Operator } from '@/lib/rules/operators';
import { humanizeTemplate } from '@/lib/messages/variables';
import { MessageBuilder, MESSAGE_MAX_LENGTH } from './MessageBuilder';

export interface ColumnInfo {
  name: string;
  /** Hojas vigiladas en las que existe la columna ([] en CSV). */
  sheets: string[];
}

export interface RuleRow {
  id: string;
  name: string;
  enabled: boolean;
  condition: {
    left?: { column?: string };
    operator?: Operator;
    right?: { type?: 'column' | 'value'; column?: string; value?: string | number };
  };
  actions: { type: string; message?: string; severity?: string }[];
  last_error: string | null;
  last_evaluated_at: string | null;
}

function describe(c: RuleRow['condition']): string {
  const op = c.operator ? OPERATOR_LABELS[c.operator] : '?';
  if (c.operator && isUnary(c.operator)) return `«${c.left?.column}» ${op}`;
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
  const [message, setMessage] = useState('');
  const [msgReset, setMsgReset] = useState(0);
  const [severity, setSeverity] = useState<'info' | 'warning' | 'critical'>('info');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Al llegar (o cambiar) las columnas, conserva la elección si sigue existiendo.
  useEffect(() => {
    if (!columns?.length) return;
    const names = columns.map((c) => c.name);
    setLeft((cur) => (names.includes(cur) ? cur : names[0]));
    setRightColumn((cur) => (names.includes(cur) ? cur : (names[1] ?? names[0])));
  }, [columns]);

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

    if (!message.trim()) {
      setFormError('Escribe el texto del aviso.');
      return;
    }
    if (message.length > MESSAGE_MAX_LENGTH) {
      setFormError(`El texto del aviso no puede pasar de ${MESSAGE_MAX_LENGTH} caracteres.`);
      return;
    }

    setSaving(true);
    const condition = {
      kind: 'compare',
      left: { type: 'column', column: left },
      operator,
      ...(isUnary(operator)
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
        actions: [{ type: 'alert', message, severity }],
      }),
    });
    setSaving(false);

    if (!res.ok) {
      setFormError('Revisa los campos: falta algún dato o no es válido.');
      return;
    }
    setName('');
    setMessage('');
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
                    {OPERATORS.map((o) => (
                      <option key={o} value={o}>
                        {OPERATOR_LABELS[o]}
                      </option>
                    ))}
                  </select>
                </div>

                {!isUnary(operator) && (
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
            <div className="rule-msg">{humanizeTemplate(r.actions[0]?.message ?? '')}</div>
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
