-- CreateEnum
CREATE TYPE "log_categoria" AS ENUM ('AUTENTICACAO', 'TAREFAS');

-- CreateTable
CREATE TABLE "logs_atividade" (
    "id" UUID NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuario_id" UUID,
    "usuario_nome" TEXT,
    "usuario_email" TEXT,
    "categoria" "log_categoria" NOT NULL,
    "acao" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "logs_atividade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "logs_atividade_criado_em_idx" ON "logs_atividade"("criado_em");

-- CreateIndex
CREATE INDEX "logs_atividade_categoria_idx" ON "logs_atividade"("categoria");

-- AddForeignKey
ALTER TABLE "logs_atividade" ADD CONSTRAINT "logs_atividade_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
