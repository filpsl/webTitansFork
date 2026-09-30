import { StatusMembro } from "../../generated/prisma/enums";

export const STATUS_MEMBRO_ORDER: StatusMembro[] = ["ATIVO", "INATIVO", "CONSELHEIRO"];

export const STATUS_MEMBRO_LABELS: Record<StatusMembro, string> = {
  ATIVO: "Ativo",
  INATIVO: "Inativo",
  CONSELHEIRO: "Conselheiro",
};

/** Classes de badge por status — legíveis em light e dark. */
export const STATUS_MEMBRO_BADGE_CLASS: Record<StatusMembro, string> = {
  ATIVO: "border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  INATIVO: "border-transparent bg-destructive/15 text-destructive dark:text-red-300",
  CONSELHEIRO: "border-transparent bg-sky-500/15 text-sky-700 dark:text-sky-300",
};
