import { config } from "dotenv";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { COLUNAS_PADRAO, PROJETOS_PADRAO } from "../src/lib/projetos";

// dotenv/config só carrega .env por padrão. MASTER_EMAIL/MASTER_PASSWORD
// vivem no .env.local (como todo o resto dos secrets do app), então
// carregamos os dois explicitamente, com .env.local por cima.
config({ path: ".env" });
config({ path: ".env.local", override: true });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const email = process.env.MASTER_EMAIL;
  const password = process.env.MASTER_PASSWORD;
  const nome = process.env.MASTER_NOME;

  if (!email || !password) {
    throw new Error(
      "Defina MASTER_EMAIL e MASTER_PASSWORD no .env.local antes de rodar o seed."
    );
  }

  const hash = await bcrypt.hash(password, 12);

  const master = await prisma.user.upsert({
    where: { email },
    update: { password: hash, role: "MESTRE", nome },
    create: { email, password: hash, role: "MESTRE", nome },
  });

  console.log(`Usuário master pronto: ${master.email} (role: ${master.role})`);

  for (const nome of PROJETOS_PADRAO) {
    const projeto = await prisma.projeto.upsert({
      where: { nome },
      update: {},
      create: {
        nome,
        colunas: {
          create: COLUNAS_PADRAO.map((nomeColuna, ordem) => ({
            nome: nomeColuna,
            ordem,
          })),
        },
      },
    });
    console.log(`Projeto pronto: ${projeto.nome}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
