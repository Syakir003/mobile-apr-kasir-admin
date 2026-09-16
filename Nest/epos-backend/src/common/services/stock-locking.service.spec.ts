import { BadRequestException } from '@nestjs/common';
import { StockLockingService } from './stock-locking.service';

function fakeTx(queryResult: unknown[]) {
  return {
    $queryRawUnsafe: jest.fn().mockResolvedValue(queryResult),
    $executeRawUnsafe: jest.fn().mockResolvedValue(1),
  } as any;
}

describe('StockLockingService.lockAndDeductProductBatch', () => {
  it('kurangi stok batch & balikin harga modal+jual batch itu', async () => {
    const service = new StockLockingService();
    const tx = fakeTx([
      { product_name: 'AC Split 1PK', active: true, stock: 5, sell_price: '3200000', buy_price: '3100000' },
    ]);

    const result = await service.lockAndDeductProductBatch(tx, 'batch-1', 2);

    expect(result).toEqual({ name: 'AC Split 1PK', unit: 'unit', unitPrice: 3200000, buyPrice: 3100000 });
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE item_costs SET stock = stock - $1'),
      2,
      'batch-1',
    );
  });

  it('lempar BadRequestException kalau batch gak ketemu', async () => {
    const service = new StockLockingService();
    const tx = fakeTx([]);
    await expect(service.lockAndDeductProductBatch(tx, 'batch-x', 1)).rejects.toThrow(BadRequestException);
  });

  it('lempar BadRequestException kalau stok batch gak cukup', async () => {
    const service = new StockLockingService();
    const tx = fakeTx([
      { product_name: 'AC Split 1PK', active: true, stock: 1, sell_price: '3200000', buy_price: '3100000' },
    ]);
    await expect(service.lockAndDeductProductBatch(tx, 'batch-1', 5)).rejects.toThrow(BadRequestException);
  });

  it('lempar BadRequestException kalau produk induk nonaktif', async () => {
    const service = new StockLockingService();
    const tx = fakeTx([
      { product_name: 'AC Split 1PK', active: false, stock: 5, sell_price: '3200000', buy_price: '3100000' },
    ]);
    await expect(service.lockAndDeductProductBatch(tx, 'batch-1', 1)).rejects.toThrow(BadRequestException);
  });
});
