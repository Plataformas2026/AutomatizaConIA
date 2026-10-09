'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SheetSelection } from '@/lib/parsing/parse';
import { SheetPicker, isValidSelection } from './SheetPicker';
import { RulesPanel, type ColumnInfo, type RuleRow } from './RulesPanel';

interface Structure {
  sheets: string[];
  selection: SheetSelection;
  active: string[];
  columns: ColumnInfo[];
}

const LOAD_ERRORS: Record<string, string> = {
  file_too_large: 'El archivo es demasiado grande para leerlo.',
  file_not_accessible: 'Ya no tenemos acceso a este archivo. Vuelve a elegirlo desde «Añadir archivo».',
  google_not_connected: 'Tu Google Drive está desconectado. Reconéctalo desde el panel.',
};

function initialDraft(s: Structure): SheetSelection {
  // Los archivos antiguos ("first") equivalen a vigilar la primera hoja.
  if (s.selection.mode === 'first') return { mode: 'selected', names: s.sheets.slice(0, 1) };
  return s.selection;
}

export function FileWorkspace({
  fileId,
  fileName,
  isCsv,
  initialRules,
}: {
  fileId: string;
  fileName: string;
  isCsv: boolean;
  initialRules: RuleRow[];
}) {
  const router = useRouter();
  const [structure, setStructure] = useState<Structure | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<SheetSelection>({ mode: 'selected', names: [] });
  const [draftKey, setDraftKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/files/${fileId}/columns`, { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(LOAD_ERRORS[body.error] ?? 'No se pudo leer el archivo para listar sus hojas y columnas.');
        return;
      }
      setLoadError(null);
      setStructure(body as Structure);
      setDraft(initialDraft(body as Structure));
      setDraftKey((k) => k + 1);
    } catch {
      setLoadError('No se pudo leer el archivo.');
    }
  }, [fileId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveSheets() {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    const res = await fetch(`/api/files/${fileId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheetMode: draft.mode, sheetNames: draft.names }),
    });
    setSaving(false);
    if (!res.ok) {
      setSaveError('No se pudieron guardar las hojas. Inténtalo de nuevo.');
      return;
    }
    setSaved(true);
    await load();
    router.refresh();
  }

  const hasSheets = !isCsv && !!structure && structure.sheets.length > 0;
  const changed =
    !!structure &&
    JSON.stringify(draft) !== JSON.stringify(initialDraft(structure)) &&
    isValidSelection(draft);

  return (
    <>
      {!isCsv && (
        <section className="panel" aria-labelledby="sheets-title">
          <h2 id="sheets-title">Hojas vigiladas</h2>

          {!structure && !loadError && <p className="muted">Leyendo las hojas de tu archivo…</p>}
          {loadError && <p className="err">{loadError}</p>}

          {structure && structure.sheets.length <= 1 && (
            <p className="muted">Este archivo tiene una sola hoja, así que no hay nada que elegir.</p>
          )}

          {structure && structure.sheets.length > 1 && (
            <>
              <SheetPicker key={draftKey} sheets={structure.sheets} value={draft} onChange={setDraft} />
              <div className="row wrap" style={{ marginTop: 14 }}>
                <button
                  type="button"
                  className="btn primary"
                  onClick={saveSheets}
                  disabled={saving || !changed}
                >
                  {saving ? 'Guardando…' : 'Guardar hojas'}
                </button>
                {!isValidSelection(draft) && <span className="err">Marca al menos una hoja.</span>}
                {saveError && <span className="err">{saveError}</span>}
                {saved && !saveError && <span className="ok">Hojas guardadas. Se están reevaluando las reglas.</span>}
              </div>
            </>
          )}
        </section>
      )}

      {isCsv && (
        <p className="muted note">Los archivos CSV no tienen hojas: se vigila todo el contenido.</p>
      )}

      <RulesPanel
        fileId={fileId}
        fileName={fileName}
        initialRules={initialRules}
        columns={structure?.columns ?? null}
        columnsError={loadError}
        active={structure?.active ?? []}
        hasSheets={hasSheets}
      />
    </>
  );
}
