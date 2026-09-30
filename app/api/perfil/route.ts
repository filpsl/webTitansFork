import { auth } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Dados do próprio usuário logado — qualquer membro autenticado pode ler o
// que é seu (diferente de /api/admin/membros, que lista todo mundo e exige
// liderança). Hoje só serve pra saber os projetos do próprio membro no header.
export async function GET() {
  const session = await auth();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const usuario = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      projetos: { select: { id: true, nome: true }, orderBy: { nome: "asc" } },
    },
  });

  return Response.json({ projetos: usuario?.projetos ?? [] });
}
