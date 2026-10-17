-- Token acak untuk tautan struk publik (dikirim lewat WhatsApp), 2026-10-17. Aditif, aman.
ALTER TABLE "invoices" ADD COLUMN "public_token" TEXT;
CREATE UNIQUE INDEX "invoices_public_token_key" ON "invoices"("public_token");
