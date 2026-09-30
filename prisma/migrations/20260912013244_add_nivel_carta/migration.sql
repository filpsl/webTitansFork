-- CreateEnum
CREATE TYPE "nivel_carta" AS ENUM ('ICONE', 'LENDA', 'MESTRE', 'ESMERALDA', 'PLATINA', 'PRATA');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "nivel_carta" "nivel_carta";
