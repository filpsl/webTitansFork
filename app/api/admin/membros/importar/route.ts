import { auth } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";
import { podeEditarMembros, gerarSenhaPlaceholder } from "@/lib/server/admin";
import { enviarConviteDeSenha } from "@/lib/server/convite";
import { resolverRole } from "@/lib/roles";
import { resolverNomeProjeto } from "@/lib/projetos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface LinhaResultado {
  linha: number;
  email: string | null;
  status: "criado" | "atualizado" | "erro";
  mensagem?: string;
}

// Formato: nome;email;cargo;curso;semestre;projetos
// - curso, semestre e projetos são opcionais (deixe vazio entre os ";").
// - projetos: nomes separados por vírgula (ex.: "Rover,Marketing").
// - linhas em branco ou começando com "#" são ignoradas.
// - membro novo recebe convite por e-mail pra definir a própria senha;
//   e-mail já cadastrado só atualiza cargo/curso/semestre/projetos (senha
//   existente não é tocada).
async function processarLinha(linha: string, numero: number): Promise<LinhaResultado> {
  const campos = linha.split(";").map((c) => c.trim());
  const [nome, email, cargoTexto, curso, semestreTexto, projetosTexto] = campos;

  if (!nome || !email || !cargoTexto) {
    return {
      linha: numero,
      email: email || null,
      status: "erro",
      mensagem: "Campos obrigatórios: nome;email;cargo",
    };
  }

  const role = resolverRole(cargoTexto);
  if (!role) {
    return { linha: numero, email, status: "erro", mensagem: `Cargo não reconhecido: "${cargoTexto}"` };
  }

  const nomesProjetos = (projetosTexto ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const projetoIds: string[] = [];
  for (const nomeProjeto of nomesProjetos) {
    const resolvido = resolverNomeProjeto(nomeProjeto);
    if (!resolvido) {
      return { linha: numero, email, status: "erro", mensagem: `Projeto não reconhecido: "${nomeProjeto}"` };
    }
    const projeto = await prisma.projeto.findUnique({ where: { nome: resolvido }, select: { id: true } });
    if (projeto) projetoIds.push(projeto.id);
  }

  const semestre = semestreTexto ? Number.parseInt(semestreTexto, 10) : null;
  const emailNormalizado = email.toLowerCase();

  const existente = await prisma.user.findUnique({
    where: { email: emailNormalizado },
    select: { id: true },
  });

  if (existente) {
    await prisma.user.update({
      where: { email: emailNormalizado },
      data: {
        nome,
        role,
        curso: curso || null,
        semestre: Number.isInteger(semestre) ? semestre : null,
        projetos: { set: projetoIds.map((id) => ({ id })) },
      },
    });
  } else {
    await prisma.user.create({
      data: {
        nome,
        email: emailNormalizado,
        password: await gerarSenhaPlaceholder(),
        role,
        curso: curso || null,
        semestre: Number.isInteger(semestre) ? semestre : null,
        projetos: { connect: projetoIds.map((id) => ({ id })) },
      },
    });
    await enviarConviteDeSenha(emailNormalizado, nome);
  }

  return { linha: numero, email: emailNormalizado, status: existente ? "atualizado" : "criado" };
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  // MESTRE e CAPITAO importam .txt — cadastro manual/convite avulso continua só com o MESTRE.
  if (!podeEditarMembros(session)) return Response.json({ error: "Sem permissão" }, { status: 403 });

  const body = (await req.json().catch(() => undefined)) as { texto?: unknown } | undefined;
  const texto = typeof body?.texto === "string" ? body.texto : "";
  if (!texto.trim()) return Response.json({ error: "Arquivo vazio" }, { status: 400 });

  const linhas = texto
    .split(/\r?\n/)
    .map((l, i) => ({ conteudo: l.trim(), numero: i + 1 }))
    .filter((l) => l.conteudo && !l.conteudo.startsWith("#"));

  const resultados: LinhaResultado[] = [];
  for (const { conteudo, numero } of linhas) {
    try {
      resultados.push(await processarLinha(conteudo, numero));
    } catch (e) {
      resultados.push({
        linha: numero,
        email: null,
        status: "erro",
        mensagem: e instanceof Error ? e.message : "Erro inesperado",
      });
    }
  }

  return Response.json({ resultados });
}
