-- BUY requests no longer take a customer-entered validity; the server sets it on publish.
ALTER TABLE "import_settings"
  ADD COLUMN "buy_request_validity_days" INTEGER NOT NULL DEFAULT 30;
