import { auth } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";
import { podeReenviarConvite } from "@/lib/server/admin";
import { enviarConviteDeSenha } from "@/lib/server/convite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await auth();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  if (!podeReenviarConvite(session)) return Response.json({ error: "Sem permissão" }, { status: 403 });

  const { userId } = await params;
  const membro = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, nome: true },
  });
  if (!membro) return Response.json({ error: "Membro não encontrado" }, { status: 404 });

  const enviado = await enviarConviteDeSenha(membro.email, membro.nome);
  if (!enviado) {
    return Response.json(
      {
        error:
          "Não foi possível enviar o e-mail. Verifique a configuração do Resend (RESEND_API_KEY e domínio verificado em resend.com/domains).",
      },
      { status: 502 }
    );
  }

  return Response.json({ ok: true });
}
