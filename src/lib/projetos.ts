import { normalizarTexto } from "./text";

/** Projetos internos da equipe — usados no quadro de tarefas e na importação de membros. */
export const PROJETOS_PADRAO = [
  "Seguidor de Linha",
  "VSS",
  "SSL",
  "Robô de Combate",
  "Rover",
  "Marketing",
  "WebSite",
] as const;

/** Projetos de competição — os únicos que aparecem no painel de presenças. */
export const PROJETOS_COMPETICAO = [
  "Seguidor de Linha",
  "VSS",
  "SSL",
  "Robô de Combate",
  "Rover",
] as const;

/** Colunas com que todo projeto novo nasce no quadro Kanban. */
export const COLUNAS_PADRAO = ["A começar", "Em andamento", "Concluído"] as const;

export const MAX_COLUNAS_POR_PROJETO = 15;

/** Resolve um nome de projeto (com acentos/caixa livres) pro nome oficial cadastrado. */
export function resolverNomeProjeto(nome: string): string | null {
  const alvo = normalizarTexto(nome);
  return PROJETOS_PADRAO.find((p) => normalizarTexto(p) === alvo) ?? null;
}
