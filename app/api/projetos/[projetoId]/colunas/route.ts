import { auth } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";
import { getProjetoComMembros } from "@/lib/server/board";
import { podeEditarProjeto } from "@/lib/server/permissions";
import { mapColuna } from "@/lib/server/board";
import { MAX_COLUNAS_POR_PROJETO } from "@/lib/projetos";
import { registrarLog } from "@/lib/server/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ projetoId: string }> }
) {
  const session = await auth();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const { projetoId } = await params;

  const body = (await req.json().catch(() => undefined)) as { nome?: unknown } | undefined;
  const nome = typeof body?.nome === "string" ? body.nome.trim() : "";
  if (!nome) return Response.json({ error: "Informe um nome para a coluna" }, { status: 400 });

  const projeto = await getProjetoComMembros(projetoId);
  if (!projeto) return Response.json({ error: "Projeto não encontrado" }, { status: 404 });

  const canEdit = podeEditarProjeto({ id: session.user.id, role: session.user.role }, projeto);
  if (!canEdit) return Response.json({ error: "Sem permissão" }, { status: 403 });

  const total = await prisma.coluna.count({ where: { projetoId } });
  if (total >= MAX_COLUNAS_POR_PROJETO) {
    return Response.json(
      { error: `Limite de ${MAX_COLUNAS_POR_PROJETO} colunas por projeto atingido` },
      { status: 422 }
    );
  }

  const ultima = await prisma.coluna.findFirst({
    where: { projetoId },
    orderBy: { ordem: "desc" },
    select: { ordem: true },
  });

  const coluna = await prisma.coluna.create({
    data: { nome, ordem: (ultima?.ordem ?? -1) + 1, projetoId },
  });

  await registrarLog({
    usuarioId: session.user.id,
    usuarioNome: session.user.name,
    usuarioEmail: session.user.email,
    categoria: "TAREFAS",
    acao: "coluna_criada",
    descricao: `Criou a coluna "${nome}" no projeto ${projeto.nome}`,
    request: req,
  });

  return Response.json(mapColuna(coluna), { status: 201 });
}
