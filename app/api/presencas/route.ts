import { auth } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";
import { resolverProjetoCompeticao } from "@/lib/server/presencas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const url = new URL(req.url);
  const projetoId = url.searchParams.get("projetoId");
  if (!projetoId) return Response.json({ error: "Informe o projeto" }, { status: 400 });

  const resolvido = await resolverProjetoCompeticao(projetoId);
  if (resolvido.tipo === "nao_encontrado") {
    return Response.json({ error: "Projeto não encontrado" }, { status: 404 });
  }
  if (resolvido.tipo === "nao_competicao") {
    return Response.json({ error: "Esse projeto não tem painel de presenças" }, { status: 403 });
  }

  const [membros, sessoes] = await Promise.all([
    prisma.user.findMany({
      where: { projetos: { some: { id: projetoId } } },
      orderBy: { nome: "asc" },
      select: { id: true, nome: true, email: true },
    }),
    prisma.sessaoPresenca.findMany({
      where: { projetoId },
      orderBy: { data: "asc" },
      select: {
        id: true,
        data: true,
        presencas: { select: { membroId: true, status: true, observacao: true } },
      },
    }),
  ]);

  const presencas = sessoes.flatMap((s) =>
    s.presencas.map((p) => ({
      sessaoId: s.id,
      membroId: p.membroId,
      status: p.status,
      observacao: p.observacao,
    }))
  );

  return Response.json({
    projetoId: resolvido.projeto.id,
    projetoNome: resolvido.projeto.nome,
    membros,
    sessoes: sessoes.map((s) => ({ id: s.id, data: s.data.toISOString().slice(0, 10) })),
    presencas,
  });
}
