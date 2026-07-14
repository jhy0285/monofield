import { OrderItemDto } from './create-order.dto';

export class OrderResponseDto {
  orderId: string;
  status: string;
  totalAmount: number;
  items: OrderItemDto[];
  // audit column — collectors must drop this
  createdAt: string;
}
