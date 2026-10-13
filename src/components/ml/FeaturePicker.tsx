'use client';

import type { ColumnKind } from '@/lib/stats/types';

const KIND_LABEL: Record<ColumnKind, string> = { number: 'número', date: 'fecha', text: 'texto' };

export interface Col {
  name: string;
  kind: ColumnKind;
}

interface Props {
  legend: string;
  help?: string;
  columns: Col[];
  selected: string[];
  onChange: (next: string[]) => void;
  max: number;
}

/** Lista de columnas con casillas, para marcar cuáles usar. */
export function FeaturePicker({ legend, help, columns, selected, onChange, max }: Props) {
  const toggle = (name: string) => {
    if (selected.includes(name)) onChange(selected.filter((n) => n !== name));
    else if (selected.length < max) onChange([...selected, name]);
  };
  return (
    <fieldset className="feature-picker">
      <legend>{legend}</legend>
      {help && <p className="muted fp-help">{help}</p>}
      {columns.length === 0 ? (
        <p className="err">No hay columnas disponibles para esta opción.</p>
      ) : (
        <>
          <div className="fp-list">
            {columns.map((c) => {
              const on = selected.includes(c.name);
              return (
                <label key={c.name} className={`fp-item ${on ? 'is-on' : ''}`}>
                  <input type="checkbox" checked={on} onChange={() => toggle(c.name)} />
                  <span className="fp-name">{c.name}</span>
                  <span className="fp-kind">{KIND_LABEL[c.kind]}</span>
                </label>
              );
            })}
          </div>
          <div className="sheet-quick">
            <button type="button" className="linkbtn" onClick={() => onChange(columns.slice(0, max).map((c) => c.name))}>
              Marcar todas
            </button>
            <button type="button" className="linkbtn" onClick={() => onChange([])}>
              Quitar todas
            </button>
            <span className="muted">{selected.length} de {columns.length} marcadas</span>
          </div>
        </>
      )}
    </fieldset>
  );
}
