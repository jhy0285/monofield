import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderResponseDto } from './dto/order-response.dto';

@Controller('orders')
export class OrdersController {
  // POST /api/v1/orders — deeply nested body: order -> items[] -> options[]
  @Post()
  async createOrder(@Body() dto: CreateOrderDto): Promise<OrderResponseDto> {
    return new OrderResponseDto();
  }

  // GET /api/v1/orders/:orderId
  @Get(':orderId')
  getOrder(@Param('orderId') orderId: string): Promise<OrderResponseDto> {
    return Promise.resolve(new OrderResponseDto());
  }

  // DELETE /api/v1/orders/:orderId — no response body
  @Delete(':orderId')
  async cancelOrder(@Param('orderId') orderId: string): Promise<void> {
    return;
  }
}
