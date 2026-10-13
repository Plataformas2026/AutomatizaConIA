'use client';

import { useRef, useState } from 'react';
import { useFileIntake } from './useFileIntake';
import { IconUpload } from '../Icons';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MIME_BY_EXT: Record<string, string> = {
  xlsx: XLSX,
  xls: 'application/vnd.ms-excel',
  csv: 'text/csv',
};
/** Mismo límite que la lectura en servidor (MAX_FILE_BYTES por defecto). El servidor lo vuelve a comprobar. */
const MAX_BYTES = 15 * 1024 * 1024;
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name';

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}

/**
 * Sube archivos del ORDENADOR directamente a TU Google Drive desde el navegador
 * (sin pasar por Vercel: sin límite de 4,5 MB y sin guardar nada en nuestros servidores)
 * y luego los vincula como cualquier otro archivo de Drive, con alertas en tiempo real.
 */
export function LocalUpload({ projectId = null }: { projectId?: string | null }) {
  const { busy, setBusy, setStatus, setError, addDriveFiles, feedback, dialog } = useFileIntake(projectId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);

  async function uploadOne(token: string, file: File, mimeType: string): Promise<string> {
    const boundary = `aci${crypto.randomUUID().replace(/-/g, '')}`;
    const metadata = JSON.stringify({ name: file.name, mimeType });
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
      `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
      file,
      `\r\n--${boundary}--`,
    ]);
    const res = await fetch(UPLOAD_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    if (!res.ok) throw new Error(String(res.status));
    const json = (await res.json()) as { id?: string };
    if (!json.id) throw new Error('no_id');
    return json.id;
  }

  async function handleFiles(list: FileList | File[]) {
    const files = Array.from(list);
    if (!files.length) return;
    setError(null);
    setRejected([]);

    const problems: string[] = [];
    const valid: { file: File; mime: string }[] = [];
    for (const file of files) {
      const mime = MIME_BY_EXT[extOf(file.name)];
      if (!mime) problems.push(`«${file.name}»: solo se admiten .xlsx, .xls y .csv.`);
      else if (file.size > MAX_BYTES) problems.push(`«${file.name}»: supera ${MAX_BYTES / 1024 / 1024} MB.`);
      else if (file.size === 0) problems.push(`«${file.name}»: está vacío.`);
      else valid.push({ file, mime });
    }
    setRejected(problems);
    if (!valid.length) return;

    setBusy(true);
    let token: string;
    try {
      const res = await fetch('/api/google/picker-token', { cache: 'no-store' });
      if (!res.ok) throw new Error('token');
      token = (await res.json()).accessToken as string;
    } catch {
      setError('Conecta primero tu Google Drive para poder subir archivos.');
      setBusy(false);
      return;
    }

    const ids: string[] = [];
    for (let i = 0; i < valid.length; i++) {
      const { file, mime } = valid[i];
      setStatus(valid.length > 1 ? `Subiendo ${i + 1} de ${valid.length}: ${file.name}…` : `Subiendo ${file.name}…`);
      try {
        ids.push(await uploadOne(token, file, mime));
      } catch {
        problems.push(`«${file.name}»: no se pudo subir a tu Google Drive.`);
        setRejected([...problems]);
      }
    }

    if (!ids.length) {
      setStatus(null);
      setBusy(false);
      return;
    }
    await addDriveFiles(ids); // gestiona hojas, alta, avisos y refresco; deja busy=false al terminar
  }

  return (
    <div className="intake">
      <div
        className={`dropzone ${over ? 'is-over' : ''} ${busy ? 'is-busy' : ''}`}
        onDragEnter={(e) => {
          if (e.dataTransfer.types.includes('Files')) setOver(true);
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) e.preventDefault();
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          setOver(false);
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          if (!busy) void handleFiles(e.dataTransfer.files);
        }}
      >
        <div className="grow">
          <strong>Subir desde tu ordenador</strong>
          <div className="muted">
            Elige uno o varios Excel/CSV, o arrástralos aquí. Se guarda una copia en tu Google Drive para avisarte en
            tiempo real.
          </div>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".xlsx,.xls,.csv"
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            const picked = e.target.files ? Array.from(e.target.files) : [];
            e.target.value = ''; // permite volver a elegir el mismo archivo
            void handleFiles(picked);
          }}
        />
        <button type="button" className="btn primary" onClick={() => inputRef.current?.click()} disabled={busy}>
          <IconUpload size={16} />
          {busy ? 'Un momento…' : 'Elegir archivos'}
        </button>
      </div>
      {rejected.map((r, i) => (
        <div className="err" key={i}>
          {r}
        </div>
      ))}
      {feedback}
      {dialog}
    </div>
  );
}
