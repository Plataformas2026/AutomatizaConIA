'use client';

import { useCallback, useEffect, useState } from 'react';

interface Tpl {
  id: string;
  name: string;
  file_name: string;
  fields: string[];
  mapping: Record<string, string>;
}
interface FileOpt {
  id: string;
  name: string;
}

const UPLOAD_ERRORS: Record<string, string> = {
  not_docx: 'Ese archivo no es un documento Word (.docx).',
  no_fields: 'La plantilla no tiene ningún campo. Escribe los campos entre dobles llaves, por ejemplo {{Cliente}}.',
  too_big: 'La plantilla pesa demasiado (máximo ≈ 1,3 MB).',
  too_many: 'Has llegado al máximo de 30 plantillas para esta persona.',
  invalid_file: 'No se pudo leer el archivo.',
};

function toBase64(buf: ArrayBuffer): string {
  let s = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Plantillas Word de una persona y su mapeo campo → columna. Solo lo ve el administrador. */
export function TemplatesPanel({ userId, files }: { userId: string; files: FileOpt[] }) {
  const [list, setList] = useState<Tpl[]>([]);
  const [maps, setMaps] = useState<Record<string, Record<string, string>>>({});
  const [refFile, setRefFile] = useState('');
  const [columns, setColumns] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/templates?userId=${userId}`, { cache: 'no-store' });
    if (!res.ok) return;
    const b = (await res.json()) as { templates: Tpl[] };
    setList(b.templates);
    setMaps(Object.fromEntries(b.templates.map((t) => [t.id, { ...t.mapping }])));
  }, [userId]);

  useEffect(() => {
    setMsg(null);
    setRefFile('');
    setColumns([]);
    void load();
  }, [load]);

  // Columnas del archivo de referencia (solo para sugerir; el mapeo se guarda por nombre de columna).
  useEffect(() => {
    setColumns([]);
    if (!refFile) return;
    let alive = true;
    void fetch(`/api/files/${refFile}/columns`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { columns?: { name: string }[] } | null) => alive && setColumns((b?.columns ?? []).map((c) => c.name)))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [refFile]);

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!name.trim()) {
      setMsg({ text: 'Primero escribe un nombre para la plantilla.', error: true });
      return;
    }
    setBusy(true);
    setMsg(null);
    const res = await fetch('/api/admin/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, name: name.trim(), fileName: file.name, contentB64: toBase64(await file.arrayBuffer()) }),
    });
    const b = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMsg({ text: UPLOAD_ERRORS[b.error] ?? 'No se pudo subir la plantilla.', error: true });
      return;
    }
    setName('');
    setMsg({ text: `Plantilla subida: ${(b.fields as string[]).length} campos detectados. Revisa el mapeo.` });
    void load();
  }

  async function save(t: Tpl) {
    const res = await fetch(`/api/admin/templates/${t.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mapping: maps[t.id] ?? {} }),
    });
    setMsg(res.ok ? { text: `Mapeo de «${t.name}» guardado.` } : { text: 'No se pudo guardar el mapeo.', error: true });
    void load();
  }

  async function remove(t: Tpl) {
    if (!confirm(`¿Eliminar la plantilla «${t.name}»? Las reglas que la usan perderán el botón «Rellenar».`)) return;
    const res = await fetch(`/api/admin/templates/${t.id}`, { method: 'DELETE' });
    setMsg(res.ok ? { text: 'Plantilla eliminada.' } : { text: 'No se pudo eliminar.', error: true });
    void load();
  }

  return (
    <section className="panel" aria-labelledby="adm-tpl">
      <h2 id="adm-tpl">Plantillas «Rellenar»</h2>
      <p className="muted">
        Sube un documento Word con campos entre dobles llaves, por ejemplo <code>{'{{Cliente}}'}</code> o <code>{'{{Fecha de alta}}'}</code>.
        Cada campo se rellena con la columna del Excel que tenga el mismo nombre; aquí puedes indicar otra columna. También
        existen <code>{'{{hoy}}'}</code>, <code>{'{{fila}}'}</code>, <code>{'{{archivo}}'}</code>, <code>{'{{hoja}}'}</code> y <code>{'{{regla}}'}</code>. Las
        personas solo eligen la plantilla; el mapeo es cosa tuya.
      </p>
      <div className="share-form">
        <div className="field">
          <label htmlFor="tpl-name">Nombre de la plantilla</label>
          <input id="tpl-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Ej.: Informe mensual" />
        </div>
        <label className="btn primary" style={{ cursor: busy ? 'wait' : 'pointer' }}>
          {busy ? 'Subiendo…' : 'Subir documento Word'}
          <input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="sr-only" disabled={busy} onChange={(e) => void upload(e)} />
        </label>
      </div>
      {msg && <p className={msg.error ? 'err' : 'ok'} role="status">{msg.text}</p>}

      {list.length > 0 && files.length > 0 && (
        <div className="field" style={{ marginTop: 14 }}>
          <label htmlFor="tpl-ref">Archivo de referencia (para sugerir columnas)</label>
          <select id="tpl-ref" value={refFile} onChange={(e) => setRefFile(e.target.value)}>
            <option value="">Sin sugerencias</option>
            {files.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {list.length === 0 && <p className="muted">Esta persona aún no tiene plantillas.</p>}
      {list.map((t) => (
        <div key={t.id} className="tpl-card">
          <div className="admin-head">
            <h3 style={{ margin: 0 }}>
              {t.name} <span className="muted">({t.file_name})</span>
            </h3>
            <span className="admin-actions">
              <button type="button" className="btn primary" onClick={() => void save(t)}>
                Guardar mapeo
              </button>
              <button type="button" className="btn ghost-line" onClick={() => void remove(t)}>
                Eliminar
              </button>
            </span>
          </div>
          <ul className="admin-list">
            {t.fields.map((f) => (
              <li key={f}>
                <code className="tpl-field">{`{{${f}}}`}</code>
                <span className="admin-actions">
                  <label className="sr-only" htmlFor={`m-${t.id}-${f}`}>
                    Columna para {f}
                  </label>
                  <input
                    id={`m-${t.id}-${f}`}
                    list={`cols-${t.id}`}
                    value={maps[t.id]?.[f] ?? ''}
                    maxLength={200}
                    placeholder="Misma columna que el campo"
                    onChange={(e) => setMaps((m) => ({ ...m, [t.id]: { ...(m[t.id] ?? {}), [f]: e.target.value } }))}
                  />
                </span>
              </li>
            ))}
          </ul>
          <datalist id={`cols-${t.id}`}>
            {columns.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
      ))}
    </section>
  );
}

/** Nombres por los que se reconoce a una persona en las columnas de reparto. */
export function AliasesPanel({ userId }: { userId: string }) {
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => {
    setMsg(null);
    void fetch(`/api/admin/aliases?userId=${userId}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { aliases?: string[] } | null) => setText((b?.aliases ?? []).join('; ')))
      .catch(() => undefined);
  }, [userId]);

  async function save() {
    const aliases = text.split(/[;\n]+/).map((a) => a.trim()).filter(Boolean);
    const res = await fetch('/api/admin/aliases', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, aliases }),
    });
    setMsg(res.ok ? { text: 'Nombres guardados.' } : { text: 'No se pudieron guardar (máximo 10, de hasta 100 caracteres).', error: true });
  }

  return (
    <section className="panel" aria-labelledby="adm-alias">
      <h2 id="adm-alias">Cómo aparece esta persona en los Excel</h2>
      <p className="muted">
        Para repartir las filas («3 te corresponden a ti») se reconoce su correo de acceso y su parte antes de la @. Añade aquí
        otros nombres con los que figure en la columna de responsable, separados por punto y coma. Ejemplo:{' '}
        <code>María López; M. López</code>.
      </p>
      <div className="share-form">
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="aliases">Nombres (opcional)</label>
          <input id="aliases" value={text} maxLength={600} onChange={(e) => setText(e.target.value)} />
        </div>
        <button type="button" className="btn primary" onClick={() => void save()}>
          Guardar nombres
        </button>
      </div>
      {msg && <p className={msg.error ? 'err' : 'ok'} role="status">{msg.text}</p>}
    </section>
  );
}
