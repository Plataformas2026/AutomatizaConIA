'use client';

import { QUALITY_LABELS, taskInfo, type MlConfig, type MlResult } from '@/lib/ml/types';
import { IconRefresh, IconTrash } from '../Icons';

export interface SavedReport {
  id: string;
  file_id: string;
  title: string;
  config: MlConfig;
  summary: MlResult;
  created_at: string;
}

interface Props {
  reports: SavedReport[];
  fileName: (id: string) => string;
  openId: string | null;
  onOpen: (r: SavedReport) => void;
  onRerun: (r: SavedReport) => void;
  onDelete: (r: SavedReport) => void;
}

export function SavedReports({ reports, fileName, openId, onOpen, onRerun, onDelete }: Props) {
  if (!reports.length) {
    return <p className="muted">Todavía no has guardado ningún informe. Cuando analices un archivo, pulsa «Guardar informe» para conservarlo aquí.</p>;
  }
  return (
    <ul className="report-list">
      {reports.map((r) => {
        const info = taskInfo(r.config.task);
        const q = 'quality' in r.summary ? r.summary.quality : null;
        return (
          <li key={r.id} className={`report-row ${openId === r.id ? 'is-open' : ''}`} style={{ ['--ta' as string]: info.accent }}>
            <div className="grow">
              <button type="button" className="report-title" onClick={() => onOpen(r)}>
                {r.title}
              </button>
              <div className="chips">
                <span className="tag tag-task">{info.plain}</span>
                <span className="tag tag-file">{fileName(r.file_id)}</span>
                {r.config.sheet && <span className="tag tag-sheet">Hoja «{r.config.sheet}»</span>}
                {q && <span className={`qbadge q-${q}`}>{QUALITY_LABELS[q]}</span>}
              </div>
              <span className="muted">{new Date(r.created_at).toLocaleString('es-ES')}</span>
            </div>
            <button type="button" className="btn" onClick={() => onOpen(r)}>Ver informe</button>
            <button type="button" className="btn" onClick={() => onRerun(r)}>
              <IconRefresh size={16} />
              Repetir análisis
            </button>
            <button type="button" className="iconbtn danger" onClick={() => onDelete(r)} title="Eliminar informe">
              <IconTrash size={17} />
              <span className="sr-only">Eliminar informe</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
