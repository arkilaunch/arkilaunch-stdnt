import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { QuoteRequestSchema } from '@arkilaunch/shared';

export class QuoteRequestDto extends createZodDto(QuoteRequestSchema) {}

export class CapDecisionDto extends createZodDto(z.object({ approved: z.boolean() })) {}
