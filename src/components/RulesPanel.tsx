'use client';

import { AdminUserSelect } from './AdminUserSelect';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConditionBuilder } from './rules/ConditionBuilder';
import {
  describeCondition,
  fromCondition,
  newGroup,
  newLeaf,
  toCondition,
  validateDraft,
  type GroupDraft,
  type NodeDraft,
} from '@/lib/rules/draft';
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
  condition: unknown;
  actions: {
    type: string;
    message?: string;
    severity?: string;
    assignColumn?: string;
    templateId?: string;
    from?: string;
    to?: string;
    cc?: string;
    subject?: string;
    body?: string;
    mode?: string;
  }[];
  last_error: string | null;
  last_evaluated_at: string | null;
}

export interface TemplateOption {
  id: string;
  name: string;
}

/** «{col:Importe}» → «Importe» para mostrar en la lista. */
function humanizeEmailTemplate(t: string): string {
  return humanizeTemplate(t.replace(/\{col:([^{}]{1,200})\}/g, '‹$1›'));
}

function firstLeafColumn(n: NodeDraft): string {
  return n.kind === 'leaf' ? n.column : (n.children.map(firstLeafColumn).find(Boolean) ?? '');
}

/** Corrige las columnas de los borradores que ya no existen (o aún no se eligieron). */
function fixColumns(n: NodeDraft, names: string[]): NodeDraft {
  if (n.kind === 'group') return { ...n, children: n.children.map((c) => fixColumns(c, names)) };
  return {
    ...n,
    column: names.includes(n.column) ? n.column : names[0],
    rightColumn: names.includes(n.rightColumn) ? n.rightColumn : (names[1] ?? names[0]),
  };
}

const SEVERITIES = [
  { value: 'info', label: 'Informativa' },
  { value: 'warning', label: 'Aviso' },
  { value: 'critical', label: 'Crítica' },
] as const;

interface Props {
  /** Solo administradores: dueño del archivo (la regla se crea a su nombre). */
  ownerUserId?: string;
  /** Plantillas Word disponibles (las crea el administrador). */
  templates?: TemplateOption[];
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

export function RulesPanel({ ownerUserId, templates = [], fileId, fileName, initialRules, columns, columnsError, active, hasSheets }: Props) {
  const router = useRouter();

  // Formulario: nombre + árbol de condiciones (varias condiciones unidas con «y» / «o»).
  const [name, setName] = useState('');
  const [tree, setTree] = useState<GroupDraft>(() => newGroup('and', [newLeaf('')]));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [assignColumn, setAssignColumn] = useState('');
  const [templateId, setTemplateId] = useState('');
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
    setTree((t) => fixColumns(t, names) as GroupDraft);
    setAssignColumn((cur) => (names.includes(cur) ? cur : ''));
  }, [columns]);

  const left = firstLeafColumn(tree);

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
    const problem = validateDraft(tree, (columns ?? []).map((c) => c.name));
    if (problem) {
      setFormError(problem);
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
    const condition = toCondition(tree);
    const actions = [
      ...(alertOn
        ? [{ type: 'alert', message, severity, ...(assignColumn ? { assignColumn } : {}), ...(templateId ? { templateId } : {}) }]
        : []),
      ...(emailOn
        ? [{ type: 'email', from: email.from, to: email.to, cc: email.cc, subject: email.subject, body: email.body, mode: email.mode }]
        : []),
    ];
    const res = await fetch(editingId ? `/api/rules/${editingId}` : '/api/rules', {
      method: editingId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editingId ? { name, condition, actions } : { fileId, name, condition, actions }),
    });
    setSaving(false);

    if (!res.ok) {
      setFormError('Revisa los campos: falta algún dato o no es válido.');
      return;
    }
    resetForm();
    router.refresh();
  }

  function resetForm() {
    setEditingId(null);
    setName('');
    setMessage('');
    setEmail(EMPTY_EMAIL);
    setEmailOn(false);
    setAlertOn(true);
    setAssignColumn('');
    setTemplateId('');
    setSeverity('info');
    setTree(fixColumns(newGroup('and', [newLeaf('')]), (columns ?? []).map((c) => c.name)) as GroupDraft);
    setMsgReset((n) => n + 1);
  }

  /** Carga una regla guardada en el formulario para modificarla. */
  function startEdit(rule: RuleRow) {
    const names = (columns ?? []).map((c) => c.name);
    const node = fromCondition(rule.condition, names);
    setTree(fixColumns(node.kind === 'group' ? node : newGroup('and', [node]), names) as GroupDraft);
    setEditingId(rule.id);
    setName(rule.name);
    const al = rule.actions.find((a) => a.type === 'alert');
    const em = rule.actions.find((a) => a.type === 'email');
    setAlertOn(!!al);
    setMessage(al?.message ?? '');
    setSeverity((al?.severity as 'info' | 'warning' | 'critical') ?? 'info');
    setAssignColumn(al?.assignColumn && names.includes(al.assignColumn) ? al.assignColumn : '');
    setTemplateId(al?.templateId && templates.some((t) => t.id === al.templateId) ? al.templateId : '');
    setEmailOn(!!em);
    setEmail(
      em
        ? { from: em.from ?? '', to: em.to ?? '', cc: em.cc ?? '', subject: em.subject ?? '', body: em.body ?? '', mode: (em.mode as EmailDraftValue['mode']) ?? 'per_row' }
        : EMPTY_EMAIL,
    );
    setMsgReset((n) => n + 1);
    setFormError(null);
    document.getElementById('new-rule-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
        <h2 id="new-rule-title">{editingId ? 'Editar regla' : 'Nueva regla'}</h2>
        <form onSubmit={onSubmit}>
          {ownerUserId && (
            <AdminUserSelect
              value={ownerUserId}
              disabled
              label="Regla para"
              hint="La regla pertenece al dueño del archivo y se ejecuta en su cuenta y en su agente. Para otra persona, abre uno de sus archivos desde Administración."
            />
          )}
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

              <ConditionBuilder tree={tree} onChange={setTree} columns={columns} active={active} />

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

              <div className="assign-box">
                <div className="field">
                  <label htmlFor="assign-col">¿A quién corresponde cada fila? (opcional)</label>
                  <select id="assign-col" value={assignColumn} onChange={(e) => setAssignColumn(e.target.value)}>
                    <option value="">No repartir</option>
                    {columns.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <span className="muted">
                    Elige la columna con el nombre o el correo de la persona responsable. Cada persona verá en la alerta
                    cuántas filas le corresponden: «Quedan 7 informes sin completar, 3 te corresponden a ti». En la base de
                    datos solo se guardan huellas de los nombres y los números de fila, nunca los nombres.
                  </span>
                </div>
                {templates.length > 0 && (
                  <div className="field">
                    <label htmlFor="tpl">Botón «Rellenar» con una plantilla (opcional)</label>
                    <select id="tpl" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                      <option value="">Sin plantilla</option>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                    <span className="muted">
                      La alerta tendrá un botón «Rellenar» que abre el documento con los datos de la fila ya puestos. El
                      administrador decide qué columna va en cada campo; tú solo eliges la plantilla.
                    </span>
                  </div>
                )}
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
              <div className="dialog-actions" style={{ justifyContent: 'flex-start' }}>
                <button className="btn primary" disabled={saving}>
                  {saving ? 'Guardando…' : editingId ? 'Guardar cambios' : 'Guardar regla'}
                </button>
                {editingId && (
                  <button type="button" className="btn" onClick={resetForm}>
                    Cancelar edición
                  </button>
                )}
              </div>
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
            <div className="muted">Si {describeCondition(r.condition)}</div>
            {r.actions.map((a, i) =>
              a.type === 'email' ? (
                <div className="rule-email" key={i}>
                  ✉ {a.mode === 'summary' ? 'Un correo resumen' : 'Un correo por fila'} a «{humanizeEmailTemplate(a.to ?? '')}» ·
                  asunto «{humanizeEmailTemplate(a.subject ?? '')}»
                </div>
              ) : (
                <div className="rule-msg" key={i}>
                  {humanizeTemplate(a.message ?? '')}
                  {a.assignColumn && <span className="muted"> · reparto por «{a.assignColumn}»</span>}
                  {a.templateId && <span className="muted"> · con botón «Rellenar»</span>}
                </div>
              ),
            )}
            {r.last_error && <div className="err">{r.last_error}</div>}
          </div>
          <button className="btn" onClick={() => startEdit(r)}>
            Editar
          </button>
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
