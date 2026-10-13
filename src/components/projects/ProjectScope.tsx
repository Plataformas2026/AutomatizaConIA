'use client';

import { useRouter } from 'next/navigation';

export interface ScopeOption {
  value: string;
  label: string;
}

/** Desplegable «Proyecto»: recarga la página con ?project=… */
export function ProjectScope({
  basePath,
  value,
  options,
  label = 'Proyecto',
}: {
  basePath: string;
  value: string;
  options: ScopeOption[];
  label?: string;
}) {
  const router = useRouter();
  return (
    <label className="scope-select">
      <span className="field-title">{label}</span>
      <select value={value} onChange={(e) => router.push(`${basePath}?project=${encodeURIComponent(e.target.value)}`)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
