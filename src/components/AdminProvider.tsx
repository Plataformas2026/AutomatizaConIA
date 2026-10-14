'use client';

import { createContext, useContext } from 'react';

const AdminContext = createContext(false);

/** Dice a los formularios si quien los usa es administrador (el dato viene del servidor). */
export function AdminProvider({ isAdmin, children }: { isAdmin: boolean; children: React.ReactNode }) {
  return <AdminContext.Provider value={isAdmin}>{children}</AdminContext.Provider>;
}

export function useIsAdmin(): boolean {
  return useContext(AdminContext);
}
