import { auth } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";
import { podeEditarSubtarefa } from "@/lib/server/board";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ subtarefaId: string }> }
) {
  const session = await auth();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const { subtarefaId } = await params;

  const canEdit = await podeEditarSubtarefa(
    { id: session.user.id, role: session.user.role },
    subtarefaId
  );
  if (canEdit === null) return Response.json({ error: "Subtarefa não encontrada" }, { status: 404 });
  if (!canEdit) return Response.json({ error: "Sem permissão" }, { status: 403 });

  const body = (await req.json().catch(() => undefined)) as { done?: unknown } | undefined;
  if (typeof body?.done !== "boolean") {
    return Response.json({ error: "Informe done: boolean" }, { status: 400 });
  }

  const subtarefa = await prisma.subtarefa.update({
    where: { id: subtarefaId },
    data: { concluida: body.done },
  });

  return Response.json({ id: subtarefa.id, description: subtarefa.descricao, done: subtarefa.concluida });
}
