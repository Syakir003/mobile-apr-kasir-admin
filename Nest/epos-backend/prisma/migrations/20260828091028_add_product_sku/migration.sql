/*
  Warnings:

  - A unique constraint covering the columns `[sku]` on the table `products` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "products" ADD COLUMN     "sku" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");
