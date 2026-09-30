import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import type { Session } from "next-auth";
import {
  EDITAR_MEMBROS_ROLES,
  GERENTE_OU_SUPERIOR,
  LEADERSHIP_ROLES,
  REENVIAR_CONVITE_ROLES,
} from "../roles";

/** Só o MESTRE gerencia cadastro de membros e atribuição de cargos/projetos. */
export function isMestre(session: Session | null): boolean {
  return session?.user?.role === "MESTRE";
}

/** MESTRE/CAPITAO/VICE_CAPITAO criam/editam eventos, avisos e semestres do calendário. */
export function isLideranca(session: Session | null): boolean {
  if (!session?.user?.role) return false;
  return LEADERSHIP_ROLES.includes(session.user.role);
}

/** Gerente de projeto pra cima — só quem pode registrar/editar presença. */
export function isGerenteOuSuperior(session: Session | null): boolean {
  if (!session?.user?.role) return false;
  return GERENTE_OU_SUPERIOR.includes(session.user.role);
}

/** MESTRE/CAPITAO corrigem dados de membros já cadastrados e importam .txt — cadastro e remoção continuam só do MESTRE. */
export function podeEditarMembros(session: Session | null): boolean {
  if (!session?.user?.role) return false;
  return EDITAR_MEMBROS_ROLES.includes(session.user.role);
}

/** MESTRE/CAPITAO/GERENTE_PROJETO reenviam convite de senha — Gerente de Projeto só isso e a visualização, sem editar dados. */
export function podeReenviarConvite(session: Session | null): boolean {
  if (!session?.user?.role) return false;
  return REENVIAR_CONVITE_ROLES.includes(session.user.role);
}

/**
 * Hash de uma senha aleatória e inutilizável — usado ao criar um membro por
 * convite (sem senha definida ainda). Login por credenciais falha até o
 * membro definir a própria senha pelo link de /definir-senha.
 */
export async function gerarSenhaPlaceholder(): Promise<string> {
  return bcrypt.hash(crypto.randomBytes(32).toString("hex"), 12);
}

/** Hash de uma senha definida manualmente pelo MESTRE no cadastro manual. */
export async function hashSenha(senha: string): Promise<string> {
  return bcrypt.hash(senha, 12);
}
