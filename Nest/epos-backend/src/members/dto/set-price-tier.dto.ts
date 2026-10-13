import { IsIn } from 'class-validator';
import { PRICE_TIERS } from '../../common/price-tier.util';
import type { PriceTierName } from '../../common/price-tier.util';

export class SetPriceTierDto {
  @IsIn(PRICE_TIERS) priceTier!: PriceTierName;
}
