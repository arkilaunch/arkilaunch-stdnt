import { createZodDto } from 'nestjs-zod';
import {
  CompanyStatusUpdateRequestSchema,
  TestimonialWriteSchema,
  TenantApplicationListQuerySchema,
  TenantRegisterRequestSchema,
  TenantBrandingUpdateRequestSchema,
  TenantSeoUpdateRequestSchema,
  PaymongoAccountUpdateSchema,
} from '@arkilaunch/shared';

export class TenantBrandingUpdateDto extends createZodDto(TenantBrandingUpdateRequestSchema) {}
export class TenantSeoUpdateDto extends createZodDto(TenantSeoUpdateRequestSchema) {}
export class TestimonialWriteDto extends createZodDto(TestimonialWriteSchema) {}
export class TenantRegisterDto extends createZodDto(TenantRegisterRequestSchema) {}
export class TenantApplicationListQueryDto extends createZodDto(TenantApplicationListQuerySchema) {}
export class PaymongoAccountUpdateDto extends createZodDto(PaymongoAccountUpdateSchema) {}
export class CompanyStatusUpdateDto extends createZodDto(CompanyStatusUpdateRequestSchema) {}
