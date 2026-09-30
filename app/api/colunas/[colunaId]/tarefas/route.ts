import { auth } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";
import { podeEditarColuna, mapTarefa } from "@/lib/server/board";
import { registrarLog } from "@/lib/server/log";
import type { TaskPriority } from "@/lib/kanban/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TaskBody {
  title?: unknown;
  description?: unknown;
  priority?: unknown;
  dueDate?: unknown;
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

export async function POST(
  req: Request,
  { params }: { params: Promise<{ colunaId: string }> }
) {
  const session = await auth();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const { colunaId } = await params;

  const canEdit = await podeEditarColuna(
    { id: session.user.id, role: session.user.role },
    colunaId
  );
  if (canEdit === null) return Response.json({ error: "Coluna não encontrada" }, { status: 404 });
  if (!canEdit) return Response.json({ error: "Sem permissão" }, { status: 403 });

  const body = (await req.json().catch(() => undefined)) as TaskBody | undefined;
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!title) return Response.json({ error: "Informe um título" }, { status: 400 });

  const description = typeof body?.description === "string" ? body.description.trim() : "";
  const priority: TaskPriority = [1, 2, 3].includes(body?.priority as number)
    ? (body?.priority as TaskPriority)
    : 1;
  const dueDate =
    typeof body?.dueDate === "string" && body.dueDate ? new Date(body.dueDate) : null;

  const tarefa = await prisma.tarefa.create({
    data: {
      titulo: title,
      descricao: description,
      prioridade: priority,
      dataEntrega: dueDate,
      colunaId,
      subtarefas: { create: parseSubtasks(body?.subtasks) },
    },
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

  await registrarLog({
    usuarioId: session.user.id,
    usuarioNome: session.user.name,
    usuarioEmail: session.user.email,
    categoria: "TAREFAS",
    acao: "tarefa_criada",
    descricao: `Criou a tarefa "${title}" na coluna "${tarefa.coluna.nome}"`,
    request: req,
  });

  return Response.json(mapTarefa(tarefa), { status: 201 });
}
