import { auth } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";
import { podeEditarProjeto } from "@/lib/server/permissions";
import { mapColuna, mapTarefa } from "@/lib/server/board";
import type { BoardData } from "@/lib/kanban/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ projetoId: string }> }
) {
  const session = await auth();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const { projetoId } = await params;

  const projeto = await prisma.projeto.findUnique({
    where: { id: projetoId },
    select: {
      id: true,
      nome: true,
      membros: { select: { id: true } },
      colunas: {
        orderBy: { ordem: "asc" },
        select: {
          id: true,
          nome: true,
          ordem: true,
          tarefas: {
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              titulo: true,
              descricao: true,
              prioridade: true,
              dataEntrega: true,
              colunaId: true,
              createdAt: true,
              subtarefas: { select: { id: true, descricao: true, concluida: true } },
            },
          },
        },
      },
    },
  });

  if (!projeto) return Response.json({ error: "Projeto não encontrado" }, { status: 404 });

  const canEdit = podeEditarProjeto(
    { id: session.user.id, role: session.user.role },
    projeto
  );

  const board: BoardData = {
    projetoId: projeto.id,
    projetoNome: projeto.nome,
    canEdit,
    colunas: projeto.colunas.map(mapColuna),
    tasks: projeto.colunas.flatMap((c) => c.tarefas.map(mapTarefa)),
  };

  return Response.json(board);
}
