-- AlterTable
ALTER TABLE "saved_compares" ADD COLUMN     "classification" TEXT NOT NULL DEFAULT 'internal',
ADD COLUMN     "client_name" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;
