import bcrypt from "bcryptjs";
import { prisma } from "@/lib/server/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => undefined)) as
    | { token?: unknown; password?: unknown }
    | undefined;

  const token = typeof body?.token === "string" ? body.token : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!token || !password) {
    return Response.json({ error: "Dados inválidos" }, { status: 400 });
  }
  if (password.length < 8) {
    return Response.json({ error: "Senha precisa ter ao menos 8 caracteres" }, { status: 400 });
  }

  const registro = await prisma.verificationToken.findUnique({ where: { token } });
  // Mensagem genérica pra convite inválido/expirado/já usado — não dá pra
  // distinguir os casos sem vazar se um token específico já existiu.
  if (!registro || registro.expires < new Date()) {
    return Response.json({ error: "Link inválido ou expirado" }, { status: 400 });
  }

  const usuario = await prisma.user.findUnique({ where: { email: registro.identifier } });
  if (!usuario) {
    return Response.json({ error: "Link inválido ou expirado" }, { status: 400 });
  }

  const hash = await bcrypt.hash(password, 12);
  await prisma.user.update({ where: { id: usuario.id }, data: { password: hash } });
  await prisma.verificationToken.delete({ where: { token } });

  return Response.json({ ok: true });
}
