import { Role } from "../../generated/prisma/enums";
import { normalizarTexto } from "./text";

export const ROLE_ORDER: Role[] = [
  "MESTRE",
  "CAPITAO",
  "VICE_CAPITAO",
  "GERENTE_PROJETO",
  "INSTRUTOR",
  "MEMBRO_PROJETO",
  "MEMBRO_TEMPORARIO",
];

export const ROLE_LABELS: Record<Role, string> = {
  MESTRE: "Mestre",
  CAPITAO: "Capitão",
  VICE_CAPITAO: "Vice-Capitão",
  GERENTE_PROJETO: "Gerente de Projeto",
  INSTRUTOR: "Instrutor",
  MEMBRO_PROJETO: "Membro de Projeto",
  MEMBRO_TEMPORARIO: "Membro Temporário",
};

/** Cargos com edição liberada em qualquer projeto, membro ou não. */
export const LEADERSHIP_ROLES: Role[] = ["MESTRE", "CAPITAO", "VICE_CAPITAO"];

/** Gerente de projeto pra cima — quem pode editar o painel de presenças. */
export const GERENTE_OU_SUPERIOR: Role[] = ["MESTRE", "CAPITAO", "VICE_CAPITAO", "GERENTE_PROJETO"];

/** Corrigem dados de membros já cadastrados e importam .txt — cadastro e remoção continuam só do MESTRE. */
export const EDITAR_MEMBROS_ROLES: Role[] = ["MESTRE", "CAPITAO"];

/** Reenviam convite de senha e veem o sinal de abertura do link — Gerente de Projeto só isso, sem editar dados. */
export const REENVIAR_CONVITE_ROLES: Role[] = ["MESTRE", "CAPITAO", "GERENTE_PROJETO"];

const ROLE_ALIASES: Record<string, Role> = {};
for (const role of ROLE_ORDER) {
  ROLE_ALIASES[normalizarTexto(role)] = role;
  ROLE_ALIASES[normalizarTexto(role.replace(/_/g, " "))] = role;
  ROLE_ALIASES[normalizarTexto(ROLE_LABELS[role])] = role;
  ROLE_ALIASES[normalizarTexto(ROLE_LABELS[role].replace(/-/g, " "))] = role;
}

/** Resolve um cargo digitado livremente (com acento/caixa/hífen variando) pro enum oficial. */
export function resolverRole(texto: string): Role | null {
  return ROLE_ALIASES[normalizarTexto(texto)] ?? null;
}
