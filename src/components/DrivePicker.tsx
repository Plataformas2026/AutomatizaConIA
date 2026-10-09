'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SheetSelection } from '@/lib/parsing/parse';
import { SheetPicker, isValidSelection } from './SheetPicker';
import { IconPlus } from './Icons';

/* Google Picker se carga como script externo; tipamos lo mínimo que usamos. */
/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    gapi?: any;
    google?: any;
  }
}

const PICKER_MIME_TYPES = [
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.google-apps.spreadsheet',
].join(',');

let pickerReady: Promise<void> | null = null;

function loadPicker(): Promise<void> {
  if (pickerReady) return pickerReady;
  pickerReady = new Promise<void>((resolve, reject) => {
    const boot = () => window.gapi.load('picker', { callback: () => resolve(), onerror: reject });
    if (window.gapi) return boot();
    const s = document.createElement('script');
    s.src = 'https://apis.google.com/js/api.js';
    s.async = true;
    s.onload = boot;
    s.onerror = () => reject(new Error('No se pudo cargar Google Picker'));
    document.head.appendChild(s);
  });
  return pickerReady;
}

const ERRORS: Record<string, string> = {
  already_added: 'Ese archivo ya está compartido.',
  unsupported_type: 'Solo se admiten Excel (.xlsx/.xls), CSV y Hojas de cálculo de Google.',
  file_not_accessible: 'No tenemos acceso a ese archivo. Vuelve a elegirlo en el selector.',
  file_too_large: 'El archivo es demasiado grande para leerlo.',
  watch_failed: 'No se pudo activar el aviso en tiempo real para ese archivo.',
  google_not_connected: 'Conecta primero tu Google Drive.',
};

interface Pending {
  driveFileId: string;
  name: string;
  sheets: string[];
}

export function DrivePicker({ label = 'Añadir archivo' }: { label?: string }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [selection, setSelection] = useState<SheetSelection>({ mode: 'selected', names: [] });

  // Abre el diálogo nativo cuando hay un Excel con varias hojas por configurar.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (pending && !dialog.open) dialog.showModal();
    if (!pending && dialog.open) dialog.close();
  }, [pending]);

  async function register(driveFileId: string, sel: SheetSelection) {
    const res = await fetch('/api/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driveFileId, sheetMode: sel.mode, sheetNames: sel.names }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(ERRORS[body.error] ?? 'No se pudo añadir el archivo.');
    } else {
      router.refresh();
    }
    setPending(null);
    setBusy(false);
  }

  /** Mira cuántas hojas tiene el archivo (lectura al vuelo) antes de registrarlo. */
  async function inspectThenRegister(driveFileId: string) {
    try {
      const res = await fetch('/api/files/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driveFileId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(ERRORS[body.error] ?? 'No se pudo leer el archivo.');
        setBusy(false);
        return;
      }
      const sheets: string[] = body.sheets ?? [];
      if (sheets.length > 1) {
        setSelection({ mode: 'selected', names: [sheets[0]] });
        setPending({ driveFileId, name: body.name, sheets });
        return; // el usuario decide en el diálogo
      }
      await register(driveFileId, { mode: 'first', names: [] });
    } catch {
      setError('No se pudo leer el archivo.');
      setBusy(false);
    }
  }

  async function open() {
    setError(null);
    setBusy(true);
    try {
      const tokenRes = await fetch('/api/google/picker-token', { cache: 'no-store' });
      if (!tokenRes.ok) throw new Error('token');
      const { accessToken } = await tokenRes.json();
      await loadPicker();

      const g = window.google.picker;
      const myDrive = new g.DocsView(g.ViewId.DOCS).setMimeTypes(PICKER_MIME_TYPES).setIncludeFolders(true);
      const shared = new g.DocsView(g.ViewId.DOCS)
        .setMimeTypes(PICKER_MIME_TYPES)
        .setIncludeFolders(true)
        .setOwnedByMe(false);

      new g.PickerBuilder()
        .addView(myDrive)
        .addView(shared)
        .setOAuthToken(accessToken)
        .setDeveloperKey(process.env.NEXT_PUBLIC_GOOGLE_API_KEY!)
        .setAppId(process.env.NEXT_PUBLIC_GOOGLE_APP_ID!)
        .setLocale('es')
        .setTitle('Elige el archivo que quieres vigilar')
        .setCallback((data: any) => {
          if (data.action === g.Action.PICKED && data.docs?.[0]) {
            void inspectThenRegister(data.docs[0].id);
          } else if (data.action === g.Action.CANCEL) {
            setBusy(false);
          }
        })
        .build()
        .setVisible(true);
    } catch {
      setError('No se pudo abrir el selector de Google Drive.');
      setBusy(false);
    }
  }

  function cancelDialog() {
    setPending(null);
    setBusy(false);
  }

  async function confirmDialog() {
    if (!pending || !isValidSelection(selection)) return;
    setBusy(true);
    await register(pending.driveFileId, selection);
  }

  return (
    <div>
      <button className="btn primary" onClick={open} disabled={busy}>
        {!busy && <IconPlus size={16} />}
        {busy ? 'Un momento…' : label}
      </button>
      {error && <div className="err">{error}</div>}

      <dialog ref={dialogRef} className="dialog" onCancel={cancelDialog} aria-labelledby="sheets-dialog-title">
        {pending && (
          <>
            <h2 id="sheets-dialog-title">¿Qué hojas quieres vigilar?</h2>
            <p className="muted">
              <strong>{pending.name}</strong> tiene {pending.sheets.length} hojas. Puedes cambiar esta elección más
              adelante.
            </p>
            <SheetPicker sheets={pending.sheets} value={selection} onChange={setSelection} />
            {!isValidSelection(selection) && <p className="err">Marca al menos una hoja.</p>}
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={cancelDialog}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={confirmDialog}
                disabled={busy || !isValidSelection(selection)}
              >
                {busy ? 'Añadiendo…' : 'Añadir archivo'}
              </button>
            </div>
          </>
        )}
      </dialog>
    </div>
  );
}
