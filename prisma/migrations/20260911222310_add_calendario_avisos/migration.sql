-- CreateEnum
CREATE TYPE "evento_status" AS ENUM ('CONFIRMADO', 'PENDENTE', 'ALTERADO', 'CANCELADO', 'CONCLUIDO');

-- CreateEnum
CREATE TYPE "aviso_severidade" AS ENUM ('INFO', 'ALERTA', 'CRITICO');

-- CreateTable
CREATE TABLE "semestres" (
    "id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "inicio" DATE NOT NULL,
    "fim" DATE NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT false,
    "arquivado_em" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "semestres_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tipos_evento" (
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "cor_token" TEXT NOT NULL,
    "icone_key" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "tipos_evento_pkey" PRIMARY KEY ("slug")
);

-- CreateTable
CREATE TABLE "eventos_serie" (
    "id" UUID NOT NULL,
    "semestre_id" UUID NOT NULL,
    "frequencia" TEXT NOT NULL,
    "repetir_ate" DATE NOT NULL,
    "titulo_snapshot" TEXT NOT NULL,
    "criado_por_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eventos_serie_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eventos" (
    "id" UUID NOT NULL,
    "semestre_id" UUID NOT NULL,
    "serie_id" UUID,
    "ocorrencia_index" INTEGER,
    "titulo" TEXT NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fim" TIMESTAMP(3),
    "dia_todo" BOOLEAN NOT NULL DEFAULT false,
    "tipo_slug" TEXT NOT NULL,
    "status" "evento_status" NOT NULL DEFAULT 'CONFIRMADO',
    "local" TEXT,
    "link_reuniao" TEXT,
    "responsavel" TEXT,
    "descricao" TEXT,
    "nota_alteracao" TEXT,
    "alteracao_visivel_ate" TIMESTAMP(3),
    "importante" BOOLEAN NOT NULL DEFAULT false,
    "criado_por_id" UUID NOT NULL,
    "atualizado_por_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "eventos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "avisos" (
    "id" UUID NOT NULL,
    "semestre_id" UUID NOT NULL,
    "titulo" TEXT NOT NULL,
    "corpo" TEXT NOT NULL,
    "severidade" "aviso_severidade" NOT NULL DEFAULT 'INFO',
    "inicio" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fim" TIMESTAMP(3),
    "evento_id" UUID,
    "publicado" BOOLEAN NOT NULL DEFAULT false,
    "criado_por_id" UUID NOT NULL,
    "atualizado_por_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "avisos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_EventoProjetos" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL,

    CONSTRAINT "_EventoProjetos_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "semestres_nome_key" ON "semestres"("nome");

-- CreateIndex
CREATE INDEX "_EventoProjetos_B_index" ON "_EventoProjetos"("B");

-- AddForeignKey
ALTER TABLE "eventos_serie" ADD CONSTRAINT "eventos_serie_semestre_id_fkey" FOREIGN KEY ("semestre_id") REFERENCES "semestres"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos_serie" ADD CONSTRAINT "eventos_serie_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos" ADD CONSTRAINT "eventos_semestre_id_fkey" FOREIGN KEY ("semestre_id") REFERENCES "semestres"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos" ADD CONSTRAINT "eventos_serie_id_fkey" FOREIGN KEY ("serie_id") REFERENCES "eventos_serie"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos" ADD CONSTRAINT "eventos_tipo_slug_fkey" FOREIGN KEY ("tipo_slug") REFERENCES "tipos_evento"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos" ADD CONSTRAINT "eventos_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos" ADD CONSTRAINT "eventos_atualizado_por_id_fkey" FOREIGN KEY ("atualizado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avisos" ADD CONSTRAINT "avisos_semestre_id_fkey" FOREIGN KEY ("semestre_id") REFERENCES "semestres"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avisos" ADD CONSTRAINT "avisos_evento_id_fkey" FOREIGN KEY ("evento_id") REFERENCES "eventos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avisos" ADD CONSTRAINT "avisos_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avisos" ADD CONSTRAINT "avisos_atualizado_por_id_fkey" FOREIGN KEY ("atualizado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_EventoProjetos" ADD CONSTRAINT "_EventoProjetos_A_fkey" FOREIGN KEY ("A") REFERENCES "eventos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_EventoProjetos" ADD CONSTRAINT "_EventoProjetos_B_fkey" FOREIGN KEY ("B") REFERENCES "projetos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed: tipos de evento fixos usados pelo calendário do painel de membro.
INSERT INTO "tipos_evento" ("slug", "label", "cor_token", "icone_key", "ordem", "ativo") VALUES
    ('reuniao-geral', 'Reunião geral', 'titans-red', 'Users', 0, true),
    ('reuniao-lideres', 'Reunião de líderes', 'titans-orange', 'UsersRound', 1, true),
    ('prazo', 'Prazo', 'amber', 'Clock3', 2, true),
    ('competicao', 'Competição', 'titans-red', 'Trophy', 3, true),
    ('evento-externo', 'Evento externo', 'muted', 'CalendarPlus', 4, true),
    ('processo-seletivo', 'Processo seletivo', 'titans-orange', 'UserPlus', 5, true),
    ('arrecadacao', 'Arrecadação', 'amber', 'HandCoins', 6, true),
    ('marco', 'Marco importante', 'foreground', 'Flag', 7, true);
