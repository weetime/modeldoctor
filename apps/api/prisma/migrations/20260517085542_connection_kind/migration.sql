-- AlterTable
ALTER TABLE "connections" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'model',
ALTER COLUMN "model" SET DEFAULT '',
ALTER COLUMN "category" DROP NOT NULL;
