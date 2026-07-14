import { AddressDto } from './create-user.dto';

export class UserSummaryDto {
  userId: string;
  name: string;
  email: string;
}

export class UserListResponseDto {
  total: number;
  page: number;
  items: UserSummaryDto[];
}

export class UserResponseDto {
  userId: string;
  email: string;
  name: string;
  age?: number;
  address: AddressDto;
  // audit columns — collectors must drop these
  createdAt: string;
  updatedAt: string;
}
