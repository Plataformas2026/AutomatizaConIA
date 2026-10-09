'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { OPERATORS, OPERATOR_LABELS, isUnary, type Operator } from '@/lib/rules/operators';

interface RuleRow {
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

export function RulesPanel({ fileId, initialRules }: { fileId: string; initialRules: RuleRow[] }) {
  const router = useRouter();

  // Columnas: se leen al vuelo del archivo (no se guardan).
  const [columns, setColumns] = useState<string[] | null>(null);
  const [columnsError, setColumnsError] = useState<string | null>(null);

  // Formulario: [Variable 1] [Operador] [Variable 2 | Valor fijo]
  const [name, setName] = useState('');
  const [left, setLeft] = useState('');
  const [operator, setOperator] = useState<Operator>('gt');
  const [rightType, setRightType] = useState<'column' | 'value'>('value');
  const [rightColumn, setRightColumn] = useState('');
  const [rightValue, setRightValue] = useState('');
  const [message, setMessage] = useState('');
  const [severity, setSeverity] = useState<'info' | 'warning' | 'critical'>('info');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/files/${fileId}/columns`, { cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setColumnsError(
            body.error === 'file_too_large'
              ? 'El archivo es demasiado grande para leerlo.'
              : 'No se pudo leer el archivo para listar sus columnas.',
          );
          return;
        }
        setColumns(body.columns);
        setLeft(body.columns[0] ?? '');
        setRightColumn(body.columns[1] ?? body.columns[0] ?? '');
      })
      .catch(() => !cancelled && setColumnsError('No se pudo leer el archivo.'));
    return () => {
      cancelled = true;
    };
  }, [fileId]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
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
      <h2>Nueva regla</h2>
      <form className="card" onSubmit={onSubmit}>
        {columnsError && <p className="err">{columnsError}</p>}
        {!columns && !columnsError && <p className="muted">Leyendo las columnas de tu archivo…</p>}

        {columns && (
          <>
            <div className="field">
              <label htmlFor="rule-name">Nombre de la regla</label>
              <input id="rule-name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <div className="grid3">
              <div className="field">
                <label htmlFor="left">Si la columna…</label>
                <select id="left" value={left} onChange={(e) => setLeft(e.target.value)}>
                  {columns.map((c) => (
                    <option key={c}>{c}</option>
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
                  <label htmlFor="right-type">
                    <select
                      id="right-type"
                      value={rightType}
                      onChange={(e) => setRightType(e.target.value as 'column' | 'value')}
                      style={{ width: 'auto', padding: '0 4px', fontSize: 13 }}
                    >
                      <option value="value">Valor fijo</option>
                      <option value="column">Otra columna</option>
                    </select>
                  </label>
                  {rightType === 'column' ? (
                    <select value={rightColumn} onChange={(e) => setRightColumn(e.target.value)}>
                      {columns.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  ) : (
                    <input required maxLength={500} value={rightValue} onChange={(e) => setRightValue(e.target.value)} />
                  )}
                </div>
              )}
            </div>

            <div className="field">
              <label htmlFor="msg">Texto de la alerta</label>
              <textarea
                id="msg"
                required
                maxLength={500}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Ej.: Hay {count} productos por debajo del stock mínimo (filas {rows})"
              />
              <span className="muted">Variables disponibles: {'{count} {rows} {file} {rule}'}</span>
            </div>

            <div className="field" style={{ maxWidth: 220 }}>
              <label htmlFor="sev">Importancia</label>
              <select id="sev" value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)}>
                <option value="info">Informativa</option>
                <option value="warning">Aviso</option>
                <option value="critical">Crítica</option>
              </select>
            </div>

            {formError && <p className="err">{formError}</p>}
            <button className="btn primary" disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar regla'}
            </button>
          </>
        )}
      </form>

      <h2>Reglas del archivo</h2>
      {!initialRules.length && <p className="muted">Aún no hay reglas.</p>}
      {initialRules.map((r) => (
        <div className="card row wrap" key={r.id}>
          <div className="grow">
            <strong>{r.name}</strong> {!r.enabled && <span className="pill paused">Desactivada</span>}
            <div className="muted">Si {describe(r.condition)}</div>
            <div className="muted">→ Alerta: {r.actions[0]?.message}</div>
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
