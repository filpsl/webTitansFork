export const PRESENCA_STATUS_VALUES = ["PRESENTE", "AUSENTE", "FALTA_JUSTIFICADA"] as const;
export type PresencaStatus = (typeof PRESENCA_STATUS_VALUES)[number];

export const PRESENCA_STATUS_LABELS: Record<PresencaStatus, string> = {
  PRESENTE: "Presente",
  AUSENTE: "Ausente",
  FALTA_JUSTIFICADA: "Falta justificada",
};

/** Classes de badge por status — legíveis em light e dark. */
export const PRESENCA_STATUS_BADGE_CLASS: Record<PresencaStatus, string> = {
  PRESENTE: "border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  AUSENTE: "border-transparent bg-destructive/15 text-destructive dark:text-red-300",
  FALTA_JUSTIFICADA: "border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-300",
};

export interface MembroResumo {
  id: string;
  nome: string | null;
  email: string;
}

export interface SessaoPresenca {
  id: string;
  /** Data em ISO (yyyy-MM-dd). */
  data: string;
}

export interface PresencaCelula {
  sessaoId: string;
  membroId: string;
  status: PresencaStatus;
  observacao: string | null;
}

export interface PresencasProjeto {
  projetoId: string;
  projetoNome: string;
  membros: MembroResumo[];
  sessoes: SessaoPresenca[];
  presencas: PresencaCelula[];
}
