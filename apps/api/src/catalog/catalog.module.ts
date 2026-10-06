import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller.js';
import { CatalogRatesController } from './catalog-rates.controller.js';
import { CatalogService } from './catalog.service.js';

@Module({
  controllers: [CatalogController, CatalogRatesController],
  providers: [CatalogService],
})
export class CatalogModule {}
