import { auth } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";
import { isGerenteOuSuperior } from "@/lib/server/admin";
import { resolverProjetoCompeticao } from "@/lib/server/presencas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CreateBody {
  projetoId?: unknown;
  data?: unknown;
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  if (!isGerenteOuSuperior(session)) return Response.json({ error: "Sem permissão" }, { status: 403 });

  const body = (await req.json().catch(() => undefined)) as CreateBody | undefined;
  const projetoId = typeof body?.projetoId === "string" ? body.projetoId : "";
  const dataTexto = typeof body?.data === "string" ? body.data : "";
  if (!projetoId || !dataTexto) {
    return Response.json({ error: "Informe o projeto e a data" }, { status: 400 });
  }

  const resolvido = await resolverProjetoCompeticao(projetoId);
  if (resolvido.tipo === "nao_encontrado") {
    return Response.json({ error: "Projeto não encontrado" }, { status: 404 });
  }
  if (resolvido.tipo === "nao_competicao") {
    return Response.json({ error: "Esse projeto não tem painel de presenças" }, { status: 403 });
  }

  const data = new Date(dataTexto);
  if (Number.isNaN(data.getTime())) {
    return Response.json({ error: "Data inválida" }, { status: 400 });
  }

  // Idempotente: se já existe sessão nessa data, devolve ela — evita erro de corrida entre abas.
  const sessao = await prisma.sessaoPresenca.upsert({
    where: { projetoId_data: { projetoId, data } },
    create: { projetoId, data, criadoPorId: session.user.id },
    update: {},
    select: { id: true, data: true },
  });

  return Response.json(
    { sessao: { id: sessao.id, data: sessao.data.toISOString().slice(0, 10) } },
    { status: 201 }
  );
}
