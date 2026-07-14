import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CreateUserDto, UpdateUserDto } from './dto/create-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UserListResponseDto, UserResponseDto } from './dto/user-response.dto';

@Controller('users')
export class UsersController {
  // GET /api/v1/users — paged listing driven by a query DTO
  @Get()
  async findAll(@Query() query: ListUsersQueryDto): Promise<UserListResponseDto> {
    return new UserListResponseDto();
  }

  // GET /api/v1/users/:id — path param + a single optional query param
  @Get(':id')
  findOne(
    @Param('id') id: string,
    @Query('expand') expand?: string,
  ): Promise<UserResponseDto> {
    return Promise.resolve(new UserResponseDto());
  }

  // POST /api/v1/users — body DTO with nested AddressDto
  @Post()
  @HttpCode(201)
  async create(@Body() dto: CreateUserDto): Promise<UserResponseDto> {
    return new UserResponseDto();
  }

  // PATCH /api/v1/users/:id — path param + partial body DTO
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<UserResponseDto> {
    return new UserResponseDto();
  }
}
