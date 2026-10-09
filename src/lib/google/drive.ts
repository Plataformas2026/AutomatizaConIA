import 'server-only';
import { env } from '@/lib/env';
import { GOOGLE_SHEET_MIME } from '@/lib/parsing/parse';

const API = 'https://www.googleapis.com/drive/v3';

export const ALLOWED_MIME_TYPES = new Set([
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
  GOOGLE_SHEET_MIME,
]);

export class GoogleApiError extends Error {
  constructor(
    public status: number,
    public reason: string,
  ) {
    super(`Google Drive API ${status}: ${reason}`);
    this.name = 'GoogleApiError';
  }
}

export class FileTooLargeError extends Error {
  constructor(public maxBytes: number) {
    super(`El archivo supera el límite de ${Math.round(maxBytes / 1024 / 1024)} MB`);
    this.name = 'FileTooLargeError';
  }
}

export interface DriveFileMeta {
  id: string;
  name: string;
  mimeType: string;
  version: string;
  modifiedTime: string;
  trashed?: boolean;
  size?: string;
}

async function driveFetch(accessToken: string, url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, ...(init?.headers ?? {}) },
    cache: 'no-store',
  });
  if (!res.ok) {
    let reason = res.statusText;
    try {
      reason = ((await res.json()) as { error?: { message?: string } }).error?.message ?? reason;
    } catch {
      /* cuerpo no JSON */
    }
    throw new GoogleApiError(res.status, reason);
  }
  return res;
}

/** Solo metadatos (barato): sirve para deduplicar por `version`. */
export async function getFileMeta(accessToken: string, fileId: string): Promise<DriveFileMeta> {
  const fields = 'id,name,mimeType,version,modifiedTime,trashed,size';
  const res = await driveFetch(
    accessToken,
    `${API}/files/${encodeURIComponent(fileId)}?fields=${fields}&supportsAllDrives=true`,
  );
  return (await res.json()) as DriveFileMeta;
}

/** LECTURA EFÍMERA: devuelve los bytes a quien llama; nadie los persiste. */
export async function downloadFile(accessToken: string, meta: DriveFileMeta): Promise<ArrayBuffer> {
  const max = env().MAX_FILE_BYTES;
  if (meta.size && Number(meta.size) > max) throw new FileTooLargeError(max);

  const id = encodeURIComponent(meta.id);
  const url =
    meta.mimeType === GOOGLE_SHEET_MIME
      ? `${API}/files/${id}/export?mimeType=${encodeURIComponent('text/csv')}`
      : `${API}/files/${id}?alt=media&supportsAllDrives=true`;

  const res = await driveFetch(accessToken, url);
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > max) throw new FileTooLargeError(max);

  const buf = await res.arrayBuffer();
  if (buf.byteLength > max) throw new FileTooLargeError(max);
  return buf;
}
