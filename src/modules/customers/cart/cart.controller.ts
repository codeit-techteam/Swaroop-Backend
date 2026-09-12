import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RoleCode } from '../../../common/enums/domain.enums.js';
import { successResponse } from '../../../common/utils/response.util.js';
import { CurrentUser, Roles } from '../../auth/decorators/auth.decorators.js';
import { JwtAuthGuard, RolesGuard } from '../../auth/index.js';
import type { AuthenticatedUser } from '../../auth/types/auth.types.js';
import {
  AddCartItemDto,
  UpdateCartItemDto,
  ValidateCartDto,
} from './cart.dto.js';
import { CartService } from './cart.service.js';

@ApiTags('Customer Cart')
@Controller({ path: 'customer/cart', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(RoleCode.CUSTOMER)
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  @ApiOperation({ summary: 'Get current cart' })
  async getCart(@CurrentUser() user: AuthenticatedUser) {
    return successResponse(
      await this.cartService.getCart(user.id),
      'Cart retrieved',
    );
  }

  @Get('summary')
  @ApiOperation({ summary: 'Cart summary' })
  async summary(@CurrentUser() user: AuthenticatedUser) {
    return successResponse(
      await this.cartService.summary(user.id),
      'Cart summary',
    );
  }

  @Post('items')
  @ApiOperation({ summary: 'Add offer to cart' })
  async addItem(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AddCartItemDto,
  ) {
    return successResponse(
      await this.cartService.addItem(user.id, dto),
      'Cart item added',
    );
  }

  @Patch('items/:id')
  @ApiOperation({ summary: 'Update cart item' })
  async updateItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    return successResponse(
      await this.cartService.updateItem(user.id, id, dto),
      'Cart item updated',
    );
  }

  @Delete('items/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove cart item' })
  async removeItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.cartService.removeItem(user.id, id),
      'Cart item removed',
    );
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Clear cart' })
  async clear(@CurrentUser() user: AuthenticatedUser) {
    return successResponse(
      await this.cartService.clear(user.id),
      'Cart cleared',
    );
  }

  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validate cart for checkout' })
  async validate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ValidateCartDto,
  ) {
    return successResponse(
      await this.cartService.validate(user.id, dto),
      'Cart validated',
    );
  }
}
