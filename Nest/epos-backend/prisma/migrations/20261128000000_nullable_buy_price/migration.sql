-- Modal boleh kosong: gudang menerima barang tanpa nota, admin mengisi belakangan.
ALTER TABLE "item_costs" ALTER COLUMN "buy_price" DROP NOT NULL;
