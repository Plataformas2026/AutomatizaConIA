'use client';

import { useId, useState } from 'react';
import type { SheetSelection } from '@/lib/parsing/parse';

type Kind = 'one' | 'many' | 'all';

interface Props {
  /** Todas las hojas del archivo. */
  sheets: string[];
  value: SheetSelection;
  onChange: (next: SheetSelection) => void;
}

function kindOf(v: SheetSelection): Kind {
  if (v.mode === 'all') return 'all';
  if (v.mode === 'selected' && v.names.length > 1) return 'many';
  return 'one';
}

const CHOICES: { kind: Kind; title: string; text: string }[] = [
  { kind: 'one', title: 'Una hoja', text: 'Vigila solo la hoja que elijas.' },
  { kind: 'many', title: 'Varias hojas', text: 'Marca las hojas que quieras vigilar.' },
  { kind: 'all', title: 'Todas las hojas', text: 'Incluye también las que añadas más adelante.' },
];

/** Selector de hojas: una, varias o todas. */
export function SheetPicker({ sheets, value, onChange }: Props) {
  const group = useId();
  const [kind, setKind] = useState<Kind>(() => kindOf(value));

  // "first" (archivos antiguos) equivale a la primera hoja.
  const selected = value.mode === 'first' ? sheets.slice(0, 1) : value.names.filter((n) => sheets.includes(n));

  function chooseKind(next: Kind) {
    setKind(next);
    if (next === 'all') return onChange({ mode: 'all', names: [] });
    const keep = selected.length ? selected : sheets.slice(0, 1);
    onChange({ mode: 'selected', names: next === 'one' ? keep.slice(0, 1) : keep });
  }

  function toggle(name: string) {
    if (kind === 'one') return onChange({ mode: 'selected', names: [name] });
    const names = selected.includes(name) ? selected.filter((n) => n !== name) : [...selected, name];
    onChange({ mode: 'selected', names });
  }

  return (
    <div className="sheetpicker">
      <div className="choices" role="radiogroup" aria-label="Qué hojas vigilar">
        {CHOICES.map((c) => (
          <label key={c.kind} className={`choice ${kind === c.kind ? 'is-on' : ''}`}>
            <input
              type="radio"
              name={`${group}-kind`}
              checked={kind === c.kind}
              onChange={() => chooseKind(c.kind)}
            />
            <span>
              <strong>{c.title}</strong>
              <span className="muted">{c.text}</span>
            </span>
          </label>
        ))}
      </div>

      {kind === 'all' ? (
        <p className="muted">Se vigilarán las {sheets.length} hojas de este archivo.</p>
      ) : (
        <fieldset className="sheet-list">
          <legend className="muted">{kind === 'one' ? 'Elige la hoja' : 'Marca las hojas'}</legend>
          {sheets.map((name) => (
            <label key={name} className={`sheet-option ${selected.includes(name) ? 'is-on' : ''}`}>
              <input
                type={kind === 'one' ? 'radio' : 'checkbox'}
                name={`${group}-sheet`}
                checked={selected.includes(name)}
                onChange={() => toggle(name)}
              />
              <span>{name}</span>
            </label>
          ))}
        </fieldset>
      )}

      {kind === 'many' && (
        <div className="sheet-quick">
          <button type="button" className="linkbtn" onClick={() => onChange({ mode: 'selected', names: sheets })}>
            Marcar todas
          </button>
          <button type="button" className="linkbtn" onClick={() => onChange({ mode: 'selected', names: [] })}>
            Quitar todas
          </button>
        </div>
      )}
    </div>
  );
}

/** True si la selección es válida para guardar. */
export function isValidSelection(v: SheetSelection): boolean {
  return v.mode !== 'selected' || v.names.length > 0;
}
