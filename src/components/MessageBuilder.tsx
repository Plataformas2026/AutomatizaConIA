'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconPlus } from './Icons';
import {
  MESSAGE_VARIABLES,
  sampleValues,
  templateToSegments,
  variableLabel,
  type VariableKey,
} from '@/lib/messages/variables';

export const MESSAGE_MAX_LENGTH = 500;

const EXAMPLE_TEMPLATE = 'Atención: {count} filas cumplen la regla «{rule}» en {file} (filas {rows}).';

interface Props {
  /** Plantilla actual, con las variables serializadas como {count}, {rows}… */
  value: string;
  onChange: (template: string) => void;
  /** Cambia para vaciar o reconstruir el editor desde fuera (p. ej. tras guardar). */
  resetKey: number;
  /** Datos reales de la regla para los ejemplos de cada valor. */
  fileName: string;
  ruleName: string;
  columnName: string;
  sheetName: string;
  /** Excel / Google Sheets: habilita el dato «Hoja». */
  hasSheets: boolean;
}

/* ── Utilidades de DOM (el editor es un contenteditable con etiquetas) ── */

function makeChip(key: VariableKey): HTMLSpanElement {
  const chip = document.createElement('span');
  chip.className = 'chip-var';
  chip.dataset.var = key;
  chip.contentEditable = 'false';
  chip.append(document.createTextNode(variableLabel(key)));

  const x = document.createElement('span');
  x.className = 'chip-x';
  x.dataset.remove = 'true';
  x.setAttribute('role', 'button');
  x.setAttribute('aria-label', `Quitar «${variableLabel(key)}»`);
  x.textContent = '×';
  chip.append(x);
  return chip;
}

function fill(el: HTMLElement, template: string) {
  el.textContent = '';
  for (const seg of templateToSegments(template)) {
    el.append(seg.type === 'text' ? document.createTextNode(seg.text) : makeChip(seg.key));
  }
  // Un texto tras la última etiqueta permite seguir escribiendo detrás de ella.
  if (el.lastElementChild && el.lastChild === el.lastElementChild) el.append(document.createTextNode(' '));
}

function serialize(el: HTMLElement): string {
  let out = '';
  el.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? '';
    } else if (node instanceof HTMLElement) {
      if (node.dataset.var) out += `{${node.dataset.var}}`;
      else if (node.tagName !== 'BR') out += node.textContent ?? '';
    }
  });
  return out.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

function closestChip(node: Node): HTMLElement | null {
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return (el?.closest('[data-var]') as HTMLElement | null) ?? null;
}

interface CaretDoc {
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
}

/** Posición del texto bajo el puntero (para soltar una etiqueta arrastrada). */
function rangeFromPoint(x: number, y: number): Range | null {
  const d = document as unknown as CaretDoc;
  if (d.caretRangeFromPoint) return d.caretRangeFromPoint(x, y);
  if (d.caretPositionFromPoint) {
    const pos = d.caretPositionFromPoint(x, y);
    if (!pos) return null;
    const r = document.createRange();
    r.setStart(pos.offsetNode, pos.offset);
    r.collapse(true);
    return r;
  }
  return null;
}

/**
 * Editor visual del texto de un aviso. El usuario escribe con normalidad y
 * añade datos pulsando o arrastrando etiquetas; nunca ve llaves ni sintaxis.
 * Por dentro se guarda como plantilla ("{count}") que entiende el servidor.
 */
export function MessageBuilder({
  value,
  onChange,
  resetKey,
  fileName,
  ruleName,
  columnName,
  sheetName,
  hasSheets,
}: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const [empty, setEmpty] = useState(value === '');
  const [dragOver, setDragOver] = useState(false);

  const variables = useMemo(() => MESSAGE_VARIABLES.filter((v) => hasSheets || !v.needsSheets), [hasSheets]);
  const samples = useMemo(
    () => sampleValues({ fileName, ruleName, columnName, sheetName }),
    [fileName, ruleName, columnName, sheetName],
  );

  const sync = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const template = serialize(el);
    if (!template && !el.querySelector('[data-var]')) el.textContent = ''; // restablece el marcador de posición
    setEmpty(el.textContent === '');
    onChange(template);
  }, [onChange]);

  // Construye el contenido al montar y cuando el padre lo pide. No depende de `value`
  // a propósito: reescribir el DOM mientras se escribe movería el cursor.
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    fill(el, value);
    setEmpty(el.textContent === '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // Recuerda dónde estaba el cursor para insertar al pulsar una etiqueta de la paleta.
  useEffect(() => {
    const onSelection = () => {
      const sel = window.getSelection();
      const el = editorRef.current;
      if (sel && sel.rangeCount > 0 && el && el.contains(sel.anchorNode)) {
        savedRange.current = sel.getRangeAt(0).cloneRange();
      }
    };
    document.addEventListener('selectionchange', onSelection);
    return () => document.removeEventListener('selectionchange', onSelection);
  }, []);

  const insertChip = useCallback(
    (key: VariableKey, at?: Range | null) => {
      const el = editorRef.current;
      const sel = window.getSelection();
      if (!el || !sel) return;
      el.focus();

      let range = at && el.contains(at.commonAncestorContainer) ? at : savedRange.current;
      if (!range || !el.contains(range.commonAncestorContainer)) {
        range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
      }
      // Si el cursor cae dentro de otra etiqueta, se inserta justo detrás de ella.
      const host = closestChip(range.startContainer);
      if (host) {
        range = document.createRange();
        range.setStartAfter(host);
        range.collapse(true);
      }

      range.deleteContents();
      const chip = makeChip(key);
      range.insertNode(chip);
      const tail = document.createTextNode(' ');
      chip.after(tail);
      range.setStart(tail, 1);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      savedRange.current = range.cloneRange();
      sync();
    },
    [sync],
  );

  function onPaste(e: React.ClipboardEvent<HTMLDivElement>) {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain').replace(/\s+/g, ' ');
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !text) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    sync();
  }

  function onClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    if (target.dataset?.remove) {
      target.closest('[data-var]')?.remove();
      sync();
    }
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    const key = e.dataTransfer.getData('application/x-message-var') as VariableKey;
    setDragOver(false);
    if (!key) return;
    e.preventDefault();
    insertChip(key, rangeFromPoint(e.clientX, e.clientY));
  }

  function insertExample() {
    const el = editorRef.current;
    if (!el) return;
    fill(el, EXAMPLE_TEMPLATE);
    setEmpty(false);
    sync();
  }

  const segments = templateToSegments(value);
  const tooLong = value.length > MESSAGE_MAX_LENGTH;

  return (
    <div className="msgbuilder">
      <label htmlFor="msg-editor" className="msg-label">
        Texto del aviso
      </label>
      <p className="muted msg-help">
        Escribe el mensaje y añade datos que cambian solos. Pulsa un dato o arrástralo hasta el punto del texto donde
        quieras que aparezca.
      </p>

      <div className="var-palette" role="group" aria-label="Datos que puedes añadir al aviso">
        {variables.map((v) => (
          <button
            key={v.key}
            type="button"
            className="var-chip"
            data-var={v.key}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/x-message-var', v.key);
              e.dataTransfer.setData('text/plain', v.label);
              e.dataTransfer.effectAllowed = 'copy';
            }}
            onClick={() => insertChip(v.key)}
            title={`${v.description} Ejemplo: ${samples[v.key]}`}
          >
            <IconPlus size={14} />
            {v.label}
          </button>
        ))}
      </div>

      <div
        id="msg-editor"
        ref={editorRef}
        className={`msg-editor ${dragOver ? 'is-dragover' : ''}`}
        data-empty={empty}
        data-placeholder="Ej.: Hay filas con el stock por debajo del mínimo"
        contentEditable
        role="textbox"
        aria-multiline="false"
        aria-label="Texto del aviso"
        spellCheck
        onInput={sync}
        onPaste={onPaste}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.preventDefault();
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('application/x-message-var')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            setDragOver(true);
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      />

      <div className="msg-meta">
        <button type="button" className="linkbtn" onClick={insertExample}>
          Usar un texto de ejemplo
        </button>
        <span className={tooLong ? 'err' : 'muted'}>
          {value.length}/{MESSAGE_MAX_LENGTH}
        </span>
      </div>

      <div className="msg-preview" aria-live="polite">
        <span className="msg-preview-title">Así se verá el aviso</span>
        {segments.length === 0 ? (
          <p className="muted">Escribe el texto para ver cómo quedará.</p>
        ) : (
          <p>
            {segments.map((s, i) =>
              s.type === 'text' ? (
                <span key={i}>{s.text}</span>
              ) : (
                <b key={i} className="pv" data-var={s.key}>
                  {samples[s.key]}
                </b>
              ),
            )}
          </p>
        )}
      </div>

      <details className="var-legend" open>
        <summary>¿Qué valor toma cada dato?</summary>
        <dl>
          {variables.map((v) => (
            <div key={v.key}>
              <dt>
                <span className="var-chip static" data-var={v.key}>
                  {v.label}
                </span>
              </dt>
              <dd>
                {v.description} <span className="muted">En tu caso aparecería:</span> <b>{samples[v.key]}</b>
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}
