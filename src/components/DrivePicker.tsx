'use client';

import { useState } from 'react';
import { useFileIntake } from './intake/useFileIntake';
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

/** Elegir uno o VARIOS archivos de Google Drive (multiselección con Ctrl/Cmd o Mayús). */
export function DrivePicker({
  label = 'Añadir archivos de Google Drive',
  projectId = null,
}: {
  label?: string;
  projectId?: string | null;
}) {
  const { busy, setBusy, setError, addDriveFiles, feedback, dialog } = useFileIntake(projectId);
  const [opening, setOpening] = useState(false);

  async function open() {
    setError(null);
    setOpening(true);
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
        .enableFeature(g.Feature.MULTISELECT_ENABLED)
        .setOAuthToken(accessToken)
        .setDeveloperKey(process.env.NEXT_PUBLIC_GOOGLE_API_KEY!)
        .setAppId(process.env.NEXT_PUBLIC_GOOGLE_APP_ID!)
        .setLocale('es')
        .setTitle('Elige los archivos que quieres vigilar')
        .setCallback((data: any) => {
          if (data.action === g.Action.PICKED && data.docs?.length) {
            setOpening(false);
            void addDriveFiles(data.docs.map((d: { id: string }) => d.id));
          } else if (data.action === g.Action.CANCEL) {
            setOpening(false);
            setBusy(false);
          }
        })
        .build()
        .setVisible(true);
    } catch {
      setError('No se pudo abrir el selector de Google Drive.');
      setOpening(false);
      setBusy(false);
    }
  }

  return (
    <div className="intake">
      <button className="btn primary" onClick={open} disabled={busy}>
        {!busy && <IconPlus size={16} />}
        {busy && !opening ? 'Añadiendo…' : busy ? 'Un momento…' : label}
      </button>
      {feedback}
      {dialog}
    </div>
  );
}
