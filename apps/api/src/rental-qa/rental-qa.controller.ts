import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { DamageAssessmentCreateSchema, DamageAssessmentResolveSchema, StorefrontPromotionsSchema } from '@arkilaunch/shared';
import { RentalQaService } from './rental-qa.service.js';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { StorefrontSlug } from '../common/decorators/tenant-slug.decorator.js';
import type { CtxRequest } from '../common/request.js';
class CreateDto extends createZodDto(DamageAssessmentCreateSchema) {}
class ResolveDto extends createZodDto(DamageAssessmentResolveSchema) {}
class PromotionsDto extends createZodDto(StorefrontPromotionsSchema) {}
@Controller('bookings/:rentalId/damage-assessments')
export class RentalQaController {
 constructor(private readonly service: RentalQaService) {}
 @Get() @RequirePermission('fleet:manage')
 list(@Param('rentalId', ParseUUIDPipe) id: string, @Req() req: CtxRequest) { return this.service.list(req.ctx, id); }
 @Post() @RequirePermission('fleet:manage')
 create(@Param('rentalId', ParseUUIDPipe) id: string, @Body() body: CreateDto, @Req() req: CtxRequest) { return this.service.create(req.ctx, id, body); }
 @Patch(':id') @RequirePermission('fleet:manage')
 resolve(@Param('rentalId', ParseUUIDPipe) rentalId: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: ResolveDto, @Req() req: CtxRequest) { return this.service.resolve(req.ctx, rentalId, id, body); }
}
@Controller()
export class StorefrontPromotionsController {
 constructor(private readonly service: RentalQaService) {}
 @Get('tenants/me/promotions') @RequirePermission('tenant:manage')
 get(@Req() req: CtxRequest) { return this.service.promotions(req.ctx); }
 @Patch('tenants/me/promotions') @RequirePermission('tenant:manage')
 save(@Req() req: CtxRequest, @Body() body: PromotionsDto) { return this.service.savePromotions(req.ctx, body); }
 @Public() @Get('catalog/promotions')
 catalog(@StorefrontSlug() slug: string) { return this.service.publicPromotions(slug); }
}
