import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { TicketCreateSchema, TicketListQuerySchema, TicketPatchSchema } from '@arkilaunch/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../common/guards/permissions.guard.js';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import type { CtxRequest } from '../common/request.js';
import { SupportService } from './support.service.js';

class CreateDto extends createZodDto(TicketCreateSchema) {}
class PatchDto extends createZodDto(TicketPatchSchema) {}
class QueryDto extends createZodDto(TicketListQuerySchema) {}
class IdDto extends createZodDto(z.object({ id: z.uuid() })) {}

@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SupportController {
  constructor(private readonly support: SupportService) {}
  @Post('me/tickets')
  @RequirePermission('booking:create')
  create(@Req() req: CtxRequest, @Body() body: CreateDto) { return this.support.create(req.ctx, body); }
  @Get('me/tickets')
  @RequirePermission('booking:read')
  mine(@Req() req: CtxRequest) { return this.support.mine(req.ctx); }
  @Get('me/tickets/:id')
  @RequirePermission('booking:read')
  own(@Req() req: CtxRequest, @Param() params: IdDto) { return this.support.detail(req.ctx, params.id, true); }
  @Get('tickets')
  @RequirePermission('user:manage')
  list(@Req() req: CtxRequest, @Query() query: QueryDto) { return this.support.list(req.ctx, query); }
  @Get('tickets/:id')
  @RequirePermission('user:manage')
  detail(@Req() req: CtxRequest, @Param() params: IdDto) { return this.support.detail(req.ctx, params.id); }
  @Patch('tickets/:id')
  @RequirePermission('user:manage')
  patch(@Req() req: CtxRequest, @Param() params: IdDto, @Body() body: PatchDto) { return this.support.patch(req.ctx, params.id, body); }
}
