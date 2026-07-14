import { Module } from '@nestjs/common';
import { OrdersModule } from './orders/orders.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [UsersModule, OrdersModule],
})
export class AppModule {}
