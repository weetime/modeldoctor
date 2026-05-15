-- AlterTable
ALTER TABLE "benchmark_templates" ADD COLUMN     "categories" TEXT[] DEFAULT ARRAY['chat']::TEXT[];
