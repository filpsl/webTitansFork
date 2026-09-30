-- CreateEnum
CREATE TYPE "status_membro" AS ENUM ('ATIVO', 'INATIVO', 'CONSELHEIRO');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "status" "status_membro" NOT NULL DEFAULT 'ATIVO';
