import { auth } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";
import { podeEditarColuna, podeEditarTarefa, mapTarefa } from "@/lib/server/board";
import { registrarLog } from "@/lib/server/log";
import type { TaskPriority } from "@/lib/kanban/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TaskBody {
  title?: unknown;
  description?: unknown;
  priority?: unknown;
  dueDate?: unknown;
  colunaId?: unknown;
  subtasks?: unknown;
}

function parseSubtasks(input: unknown): { descricao: string; concluida: boolean }[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((s) => {
      if (typeof s !== "object" || s === null) return null;
      const description = (s as Record<string, unknown>).description;
      const done = (s as Record<string, unknown>).done;
      if (typeof description !== "string" || description.trim() === "") return null;
      return { descricao: description.trim(), concluida: done === true };
    })
    .filter((s): s is { descricao: string; concluida: boolean } => s !== null);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ tarefaId: string }> }
) {
  const session = await auth();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const { tarefaId } = await params;
  const usuario = { id: session.user.id, role: session.user.role };

  const canEdit = await podeEditarTarefa(usuario, tarefaId);
  if (canEdit === null) return Response.json({ error: "Tarefa não encontrada" }, { status: 404 });
  if (!canEdit) return Response.json({ error: "Sem permissão" }, { status: 403 });

  const body = (await req.json().catch(() => undefined)) as TaskBody | undefined;
  if (!body) return Response.json({ error: "Corpo inválido" }, { status: 400 });

  // Mover de coluna: precisa checar permissão na coluna de destino também
  // (relevante se um dia colunas de projetos diferentes puderem ser alvo).
  let novaColunaId: string | undefined;
  if (typeof body.colunaId === "string" && body.colunaId) {
    const podeNaColuna = await podeEditarColuna(usuario, body.colunaId);
    if (podeNaColuna === null) {
      return Response.json({ error: "Coluna de destino não encontrada" }, { status: 404 });
    }
    if (!podeNaColuna) return Response.json({ error: "Sem permissão" }, { status: 403 });
    novaColunaId = body.colunaId;
  }

  const data: Record<string, unknown> = {};
  if (typeof body.title === "string" && body.title.trim()) data.titulo = body.title.trim();
  if (typeof body.description === "string") data.descricao = body.description.trim();
  if ([1, 2, 3].includes(body.priority as number)) data.prioridade = body.priority as TaskPriority;
  if ("dueDate" in body) {
    data.dataEntrega =
      typeof body.dueDate === "string" && body.dueDate ? new Date(body.dueDate) : null;
  }
  if (novaColunaId) data.colunaId = novaColunaId;

  if (body.subtasks !== undefined) {
    await prisma.subtarefa.deleteMany({ where: { tarefaId } });
    data.subtarefas = { create: parseSubtasks(body.subtasks) };
  }

  const anterior = await prisma.tarefa.findUnique({
    where: { id: tarefaId },
    select: { titulo: true, colunaId: true },
  });

  const tarefa = await prisma.tarefa.update({
    where: { id: tarefaId },
    data,
    select: {
      id: true,
      titulo: true,
      descricao: true,
      prioridade: true,
      dataEntrega: true,
      colunaId: true,
      createdAt: true,
      subtarefas: { select: { id: true, descricao: true, concluida: true } },
      coluna: { select: { nome: true } },
    },
  });

  const usuarioLog = {
    usuarioId: session.user.id,
    usuarioNome: session.user.name,
    usuarioEmail: session.user.email,
    categoria: "TAREFAS" as const,
    request: req,
  };
  if (novaColunaId && novaColunaId !== anterior?.colunaId) {
    await registrarLog({
      ...usuarioLog,
      acao: "tarefa_movida",
      descricao: `Moveu a tarefa "${tarefa.titulo}" para a coluna "${tarefa.coluna.nome}"`,
    });
  } else {
    await registrarLog({
      ...usuarioLog,
      acao: "tarefa_atualizada",
      descricao: `Atualizou a tarefa "${anterior?.titulo ?? tarefa.titulo}"`,
    });
  }

  return Response.json(mapTarefa(tarefa));
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ tarefaId: string }> }
) {
  const session = await auth();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const { tarefaId } = await params;
  const canEdit = await podeEditarTarefa(
    { id: session.user.id, role: session.user.role },
    tarefaId
  );
  if (canEdit === null) return Response.json({ error: "Tarefa não encontrada" }, { status: 404 });
  if (!canEdit) return Response.json({ error: "Sem permissão" }, { status: 403 });

  const { titulo } = await prisma.tarefa.findUniqueOrThrow({
    where: { id: tarefaId },
    select: { titulo: true },
  });

  await prisma.tarefa.delete({ where: { id: tarefaId } });

  await registrarLog({
    usuarioId: session.user.id,
    usuarioNome: session.user.name,
    usuarioEmail: session.user.email,
    categoria: "TAREFAS",
    acao: "tarefa_removida",
    descricao: `Removeu a tarefa "${titulo}"`,
    request: req,
  });

  return Response.json({ ok: true });
}
