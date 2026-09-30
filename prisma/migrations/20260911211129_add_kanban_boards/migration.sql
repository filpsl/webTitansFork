-- AlterEnum
ALTER TYPE "role" ADD VALUE 'MEMBRO_TEMPORARIO';

-- CreateTable
CREATE TABLE "colunas" (
    "id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "projeto_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "colunas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tarefas" (
    "id" UUID NOT NULL,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL DEFAULT '',
    "prioridade" INTEGER NOT NULL DEFAULT 1,
    "data_entrega" DATE,
    "coluna_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tarefas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subtarefas" (
    "id" UUID NOT NULL,
    "descricao" TEXT NOT NULL,
    "concluida" BOOLEAN NOT NULL DEFAULT false,
    "tarefa_id" UUID NOT NULL,

    CONSTRAINT "subtarefas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "colunas_projeto_id_ordem_key" ON "colunas"("projeto_id", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "projetos_nome_key" ON "projetos"("nome");

-- AddForeignKey
ALTER TABLE "colunas" ADD CONSTRAINT "colunas_projeto_id_fkey" FOREIGN KEY ("projeto_id") REFERENCES "projetos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tarefas" ADD CONSTRAINT "tarefas_coluna_id_fkey" FOREIGN KEY ("coluna_id") REFERENCES "colunas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subtarefas" ADD CONSTRAINT "subtarefas_tarefa_id_fkey" FOREIGN KEY ("tarefa_id") REFERENCES "tarefas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

