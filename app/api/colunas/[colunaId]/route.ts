import { auth } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";
import { podeEditarColuna, mapColuna } from "@/lib/server/board";
import { registrarLog } from "@/lib/server/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ colunaId: string }> }
) {
  const session = await auth();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const { colunaId } = await params;

  const body = (await req.json().catch(() => undefined)) as { nome?: unknown } | undefined;
  const nome = typeof body?.nome === "string" ? body.nome.trim() : "";
  if (!nome) return Response.json({ error: "Informe um nome para a coluna" }, { status: 400 });

  const canEdit = await podeEditarColuna(
    { id: session.user.id, role: session.user.role },
    colunaId
  );
  if (canEdit === null) return Response.json({ error: "Coluna não encontrada" }, { status: 404 });
  if (!canEdit) return Response.json({ error: "Sem permissão" }, { status: 403 });

  const anterior = await prisma.coluna.findUnique({
    where: { id: colunaId },
    select: { nome: true, projeto: { select: { nome: true } } },
  });

  const coluna = await prisma.coluna.update({ where: { id: colunaId }, data: { nome } });

  await registrarLog({
    usuarioId: session.user.id,
    usuarioNome: session.user.name,
    usuarioEmail: session.user.email,
    categoria: "TAREFAS",
    acao: "coluna_renomeada",
    descricao: `Renomeou a coluna "${anterior?.nome ?? "?"}" para "${nome}" no projeto ${anterior?.projeto.nome ?? "?"}`,
    request: req,
  });

  return Response.json(mapColuna(coluna));
}

export async function DELETE(
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

  const { projetoId, nome, projeto } = await prisma.coluna.findUniqueOrThrow({
    where: { id: colunaId },
    select: { projetoId: true, nome: true, projeto: { select: { nome: true } } },
  });
  const total = await prisma.coluna.count({ where: { projetoId } });
  if (total <= 1) {
    return Response.json(
      { error: "Não é possível excluir a última coluna do projeto" },
      { status: 400 }
    );
  }

  await prisma.coluna.delete({ where: { id: colunaId } });

  await registrarLog({
    usuarioId: session.user.id,
    usuarioNome: session.user.name,
    usuarioEmail: session.user.email,
    categoria: "TAREFAS",
    acao: "coluna_removida",
    descricao: `Removeu a coluna "${nome}" do projeto ${projeto.nome}`,
    request: req,
  });

  return Response.json({ ok: true });
}
