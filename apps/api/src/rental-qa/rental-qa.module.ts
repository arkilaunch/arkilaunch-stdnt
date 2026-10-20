import { Module } from '@nestjs/common';
import { RentalQaController, StorefrontPromotionsController } from './rental-qa.controller.js';
import { RentalQaService } from './rental-qa.service.js';
@Module({
  controllers: [RentalQaController, StorefrontPromotionsController],
  providers: [RentalQaService],
})
export class RentalQaModule {}
