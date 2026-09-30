-- CreateEnum
CREATE TYPE "tipo_pedido_3d" AS ENUM ('ARQUIVOS', 'MODELAGEM');

-- CreateEnum
CREATE TYPE "status_pedido_3d" AS ENUM ('RECEBIDO', 'CONTATADO', 'CONCLUIDO', 'CANCELADO');

-- CreateTable
CREATE TABLE "pedidos_3d" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tipo" "tipo_pedido_3d" NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "qualidade" TEXT,
    "descricao" TEXT,
    "observacoes" TEXT,
    "modelos_paths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fotos_paths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "status_pedido_3d" NOT NULL DEFAULT 'RECEBIDO',
    "contatado_em" TIMESTAMP(3),

    CONSTRAINT "pedidos_3d_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pedidos_3d_status_idx" ON "pedidos_3d"("status");

-- CreateIndex
CREATE INDEX "pedidos_3d_tipo_idx" ON "pedidos_3d"("tipo");
