import type { LogCategoria } from "../../generated/prisma/enums";

export const LOG_CATEGORIA_ORDER: LogCategoria[] = ["AUTENTICACAO", "TAREFAS"];

export const LOG_CATEGORIA_LABELS: Record<LogCategoria, string> = {
  AUTENTICACAO: "Autenticação",
  TAREFAS: "Quadro de Tarefas",
};

/** Classes de badge por ação — sucesso em verde, falha/bloqueio em vermelho, resto neutro. */
export const LOG_ACAO_BADGE_CLASS: Record<string, string> = {
  login_sucesso: "border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  login_falha: "border-transparent bg-destructive/15 text-destructive dark:text-red-300",
  login_bloqueado: "border-transparent bg-destructive/15 text-destructive dark:text-red-300",
  logout: "border-transparent bg-muted text-muted-foreground",
};

export const LOG_ACAO_BADGE_CLASS_PADRAO = "border-transparent bg-secondary text-secondary-foreground";

export const LOG_ACAO_LABELS: Record<string, string> = {
  login_sucesso: "Login",
  login_falha: "Falha de login",
  login_bloqueado: "Login bloqueado",
  logout: "Logout",
  coluna_criada: "Coluna criada",
  coluna_renomeada: "Coluna renomeada",
  coluna_removida: "Coluna removida",
  tarefa_criada: "Tarefa criada",
  tarefa_atualizada: "Tarefa atualizada",
  tarefa_movida: "Tarefa movida",
  tarefa_removida: "Tarefa removida",
};
