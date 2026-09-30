"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useSession } from "next-auth/react";
import { LEADERSHIP_ROLES } from "@/lib/roles";
import type { Role } from "../../../generated/prisma/enums";

/** Qualquer cargo do sistema pode ser pré-visualizado — ver ROLE_ORDER em @/lib/roles. */
export type PapelVisualizacao = Role;

interface VisaoContextValue {
  /** Cargo efetivo pra fins de exibição — o real, a menos que o MESTRE esteja pré-visualizando outro. */
  role: Role | undefined;
  isMestre: boolean;
  isLideranca: boolean;
  /** Só true quando a sessão real (não a pré-visualizada) é MESTRE. */
  podeAlternarVisao: boolean;
  /** null = vendo o painel normalmente, com o cargo real. */
  visualizandoComo: PapelVisualizacao | null;
  setVisualizandoComo: (papel: PapelVisualizacao | null) => void;
}

const VisaoContext = createContext<VisaoContextValue | null>(null);

export function VisaoProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const roleReal = session?.user?.role;
  const podeAlternarVisao = roleReal === "MESTRE";
  const [visualizandoComo, setVisualizandoComoState] = useState<PapelVisualizacao | null>(null);

  const role = podeAlternarVisao && visualizandoComo ? visualizandoComo : roleReal;

  const value = useMemo<VisaoContextValue>(
    () => ({
      role,
      isMestre: role === "MESTRE",
      isLideranca: !!role && LEADERSHIP_ROLES.includes(role),
      podeAlternarVisao,
      visualizandoComo,
      // Sem sessão MESTRE de verdade, ignora qualquer tentativa de alternar — só efeito visual, nunca eleva permissão.
      setVisualizandoComo: (papel) => setVisualizandoComoState(podeAlternarVisao ? papel : null),
    }),
    [role, podeAlternarVisao, visualizandoComo]
  );

  return <VisaoContext.Provider value={value}>{children}</VisaoContext.Provider>;
}

export function useVisao(): VisaoContextValue {
  const ctx = useContext(VisaoContext);
  if (!ctx) throw new Error("useVisao precisa ser usado dentro de <VisaoProvider>");
  return ctx;
}
