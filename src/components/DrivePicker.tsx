'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

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
  watch_failed: 'No se pudo activar el aviso en tiempo real para ese archivo.',
  google_not_connected: 'Conecta primero tu Google Drive.',
};

export function DrivePicker({ label = 'Añadir archivo' }: { label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function register(driveFileId: string) {
    const res = await fetch('/api/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driveFileId }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(ERRORS[body.error] ?? 'No se pudo añadir el archivo.');
    } else {
      router.refresh();
    }
    setBusy(false);
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
            void register(data.docs[0].id);
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

  return (
    <div>
      <button className="btn primary" onClick={open} disabled={busy}>
        {busy ? 'Un momento…' : label}
      </button>
      {error && <div className="err">{error}</div>}
    </div>
  );
}
