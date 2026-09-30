import type { Role } from "../../../generated/prisma/enums";
import { LEADERSHIP_ROLES } from "../roles";

/** MESTRE/CAPITAO/VICE_CAPITAO editam qualquer projeto; os demais só os em que são membros. */
export function podeEditarProjeto(
  usuario: { id: string; role: Role },
  projeto: { membros: { id: string }[] }
): boolean {
  if (LEADERSHIP_ROLES.includes(usuario.role)) return true;
  return projeto.membros.some((m) => m.id === usuario.id);
}
