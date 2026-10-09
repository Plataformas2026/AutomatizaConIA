import type { SVGProps } from 'react';

type IconProps = Omit<SVGProps<SVGSVGElement>, 'width' | 'height'> & { size?: number };

function Svg({ size = 20, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** Logotipo: una cuadrícula de hoja de cálculo con una celda resaltada. */
export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">
      <rect x="2" y="2" width="28" height="28" rx="8" fill="#fff" fillOpacity=".1" stroke="#fff" strokeOpacity=".85" strokeWidth="1.8" />
      <path d="M11.5 2.5v27M20.5 2.5v27M2.5 11.5h27M2.5 20.5h27" stroke="#fff" strokeOpacity=".35" strokeWidth="1.2" />
      <rect x="21.5" y="12.5" width="7" height="7" rx="2" fill="#ff4d6d" />
    </svg>
  );
}

export function IconGrid(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
    </Svg>
  );
}

export function IconBell(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </Svg>
  );
}

export function IconClose(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Svg>
  );
}

export function IconTable(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="4" width="17" height="16" rx="3" />
      <path d="M3.5 9.5h17M3.5 14.8h17M9.5 9.5V20" />
    </Svg>
  );
}

/** Icono con color según el tipo de archivo (Excel, CSV, Hoja de Google). */
export function FileTypeIcon({ mime }: { mime: string }) {
  const kind = mime === 'text/csv' ? 'csv' : mime === 'application/vnd.google-apps.spreadsheet' ? 'gsheet' : 'xlsx';
  return (
    <span className={`ftype ftype-${kind}`} title={kind === 'csv' ? 'CSV' : kind === 'gsheet' ? 'Hoja de Google' : 'Excel'}>
      <IconTable size={20} />
    </span>
  );
}
