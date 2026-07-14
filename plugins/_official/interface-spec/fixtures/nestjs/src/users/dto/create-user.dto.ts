import { Type } from 'class-transformer';
import {
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class AddressDto {
  @IsString()
  @IsNotEmpty()
  city: string;

  @IsString()
  street: string;

  @IsOptional()
  @IsString()
  zipCode?: string;
}

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  age?: number;

  @ValidateNested()
  @Type(() => AddressDto)
  address: AddressDto;

  // no decorators, no optional marker -> required by TS default
  roles: string[];
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsInt()
  age?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  address?: AddressDto;
}
