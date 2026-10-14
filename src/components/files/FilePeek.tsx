'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FileItem } from '@/lib/projects/types';
import {
  LOCAL_ERROR_TEXT,
  LocalAgentError,
  localOpen,
  localPreview,
  type PreviewData,
} from '@/lib/agents/local-api';
import styles from './FilePeek.module.css';

/** Botón que envuelve el icono del archivo: al pulsarlo se abre el menú de acciones. */
export function FileIconButton({ name, onOpen, children }: { name: string; onOpen: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className={styles.iconBtn} onClick={onOpen} aria-label={`Opciones de ${name}: ver datos, abrir carpeta`} title="Ver datos y abrir">
      {children}
    </button>
  );
}

/**
 * Menú de un archivo: vista previa de los datos y (si está en tu ordenador) abrir su carpeta o el propio archivo.
 * La vista previa NO se guarda: llega del agente de tu PC (archivos locales) o se lee al vuelo (Drive).
 */
export function FilePeek({ file, onClose }: { file: FileItem | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [view, setView] = useState<'menu' | 'preview'>('menu');
  const [data, setData] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isLocal = file?.source === 'local';

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (file && !d.open) d.showModal();
    if (!file && d.open) d.close();
    setView('menu');
    setData(null);
    setError(null);
    setNotice(null);
  }, [file]);

  const load = useCallback(
    async (sheet?: string) => {
      if (!file) return;
      setLoading(true);
      setError(null);
      try {
        if (file.source === 'local') {
          setData(await localPreview(file.id, sheet));
        } else {
          const q = sheet ? `?sheet=${encodeURIComponent(sheet)}` : '';
          const res = await fetch(`/api/files/${file.id}/preview${q}`, { cache: 'no-store' });
          if (!res.ok) throw new Error(String(res.status));
          setData((await res.json()) as PreviewData);
        }
      } catch (e) {
        setData(null);
        setError(
          e instanceof LocalAgentError
            ? LOCAL_ERROR_TEXT[e.code]
            : 'No se pudo leer el archivo para la vista previa. Comprueba que sigues conectado a Google Drive.',
        );
      } finally {
        setLoading(false);
      }
    },
    [file],
  );

  async function open(what: 'folder' | 'file') {
    if (!file) return;
    setError(null);
    setNotice(null);
    try {
      await localOpen(file.id, what);
      setNotice(what === 'folder' ? 'Se ha abierto la carpeta en tu ordenador.' : 'Se está abriendo el archivo en tu ordenador.');
    } catch (e) {
      setError(e instanceof LocalAgentError ? LOCAL_ERROR_TEXT[e.code] : LOCAL_ERROR_TEXT.error);
    }
  }

  return (
    <dialog ref={ref} className="dialog dialog-wide" onClose={onClose} aria-labelledby="peek-title">
      {file && (
        <>
          <h2 id="peek-title">{file.name}</h2>

          {view === 'menu' && (
            <div className={styles.menu}>
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  setView('preview');
                  void load();
                }}
              >
                Ver los datos (vista previa)
              </button>
              {isLocal && (
                <>
                  <button type="button" className="btn" onClick={() => void open('folder')}>
                    Abrir la carpeta donde está guardado
                  </button>
                  <button type="button" className="btn" onClick={() => void open('file')}>
                    Abrir el archivo para editarlo
                  </button>
                </>
              )}
              <Link className="btn" href={`/files/${file.id}`}>
                Reglas y hojas
              </Link>
              {isLocal && (
                <p className="muted">
                  Estas acciones las hace el agente de tu ordenador. La vista previa se muestra aquí pero no se guarda en
                  ningún sitio.
                </p>
              )}
            </div>
          )}

          {notice && <p role="status">{notice}</p>}
          {error && (
            <p className="err" role="alert">
              {error}
            </p>
          )}

          {view === 'preview' && (
            <>
              <div className={styles.toolbar}>
                <button type="button" className="btn" onClick={() => setView('menu')}>
                  ← Volver
                </button>
                {data && data.sheets.length > 1 && (
                  <label>
                    <span className="field-title">Hoja </span>
                    <select value={data.sheet ?? ''} onChange={(e) => void load(e.target.value)} disabled={loading}>
                      {data.sheets.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {loading && <span className="muted">Leyendo el archivo…</span>}
              </div>

              {data && (
                <>
                  {data.headers.length === 0 ? (
                    <p className="muted">La hoja está vacía.</p>
                  ) : (
                    <div className={styles.scroll}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th className={styles.rownum} scope="col">
                              Fila
                            </th>
                            {data.headers.map((h) => (
                              <th key={h} scope="col" title={h}>
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {data.rows.map((r) => (
                            <tr key={r.n}>
                              <th className={styles.rownum} scope="row">
                                {r.n}
                              </th>
                              {r.cells.map((c, i) => (
                                <td key={i} title={c}>
                                  {c}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <p className={`muted ${styles.note}`}>
                    Mostrando {data.rows.length} de {data.totalRows} filas
                    {data.truncated ? ' (y solo las primeras columnas)' : ''}. Los números de fila son los mismos que verás en las
                    alertas. Esta vista no se guarda.
                  </p>
                </>
              )}
            </>
          )}

          <div className="dialog-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cerrar
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
