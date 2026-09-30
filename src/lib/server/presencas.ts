import { prisma } from "./prisma";
import { PROJETOS_COMPETICAO } from "../projetos";

type ProjetoCompeticaoResultado =
  | { tipo: "nao_encontrado" }
  | { tipo: "nao_competicao" }
  | { tipo: "ok"; projeto: { id: string; nome: string } };

/**
 * O painel de presenças só existe pros projetos de competição (Seguidor de
 * Linha, VSS, SSL, Robô de Combate, Rover) — os demais (Marketing, WebSite)
 * não têm treino/sessão pra marcar presença.
 */
export async function resolverProjetoCompeticao(projetoId: string): Promise<ProjetoCompeticaoResultado> {
  const projeto = await prisma.projeto.findUnique({
    where: { id: projetoId },
    select: { id: true, nome: true },
  });
  if (!projeto) return { tipo: "nao_encontrado" };
  if (!PROJETOS_COMPETICAO.includes(projeto.nome as (typeof PROJETOS_COMPETICAO)[number])) {
    return { tipo: "nao_competicao" };
  }
  return { tipo: "ok", projeto };
}
