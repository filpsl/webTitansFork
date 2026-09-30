-- CreateEnum
CREATE TYPE "presenca_status" AS ENUM ('PRESENTE', 'AUSENTE', 'FALTA_JUSTIFICADA');

-- AlterEnum
ALTER TYPE "role" ADD VALUE 'INSTRUTOR';

-- CreateTable
CREATE TABLE "sessoes_presenca" (
    "id" UUID NOT NULL,
    "projeto_id" UUID NOT NULL,
    "data" DATE NOT NULL,
    "criado_por_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessoes_presenca_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "presencas" (
    "id" UUID NOT NULL,
    "sessao_id" UUID NOT NULL,
    "membro_id" UUID NOT NULL,
    "status" "presenca_status" NOT NULL,
    "observacao" TEXT,
    "registrado_por_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "presencas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sessoes_presenca_projeto_id_data_key" ON "sessoes_presenca"("projeto_id", "data");

-- CreateIndex
CREATE UNIQUE INDEX "presencas_sessao_id_membro_id_key" ON "presencas"("sessao_id", "membro_id");

-- AddForeignKey
ALTER TABLE "sessoes_presenca" ADD CONSTRAINT "sessoes_presenca_projeto_id_fkey" FOREIGN KEY ("projeto_id") REFERENCES "projetos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessoes_presenca" ADD CONSTRAINT "sessoes_presenca_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presencas" ADD CONSTRAINT "presencas_sessao_id_fkey" FOREIGN KEY ("sessao_id") REFERENCES "sessoes_presenca"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presencas" ADD CONSTRAINT "presencas_membro_id_fkey" FOREIGN KEY ("membro_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presencas" ADD CONSTRAINT "presencas_registrado_por_id_fkey" FOREIGN KEY ("registrado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
