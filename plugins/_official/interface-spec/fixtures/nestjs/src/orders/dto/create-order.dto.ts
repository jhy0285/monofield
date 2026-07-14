import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class OrderItemOptionDto {
  @IsString()
  @IsNotEmpty()
  optionName: string;

  @IsString()
  optionValue: string;
}

export class OrderItemDto {
  @IsString()
  @IsNotEmpty()
  productCode: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => OrderItemOptionDto)
  options?: OrderItemOptionDto[];
}

export class ShippingAddressDto {
  @IsString()
  zipCode: string;

  @IsString()
  @IsNotEmpty()
  address1: string;

  @IsOptional()
  @IsString()
  address2?: string;
}

export class CreateOrderDto {
  @IsString()
  @IsNotEmpty()
  customerId: string;

  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];

  @ValidateNested()
  @Type(() => ShippingAddressDto)
  shipping: ShippingAddressDto;

  @IsOptional()
  @IsString()
  memo?: string;
}
