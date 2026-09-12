import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/index.js';
import { ApplicationsController } from './applications/applications.controller.js';
import { ApplicationsService } from './applications/applications.service.js';
import { AttributesController } from './attributes/attributes.controller.js';
import { AttributesService } from './attributes/attributes.service.js';
import { CategoriesController } from './categories/categories.controller.js';
import { CategoriesService } from './categories/categories.service.js';
import { GradesController } from './grades/grades.controller.js';
import { GradesService } from './grades/grades.service.js';
import { LocationsController } from './locations/locations.controller.js';
import { LocationsService } from './locations/locations.service.js';
import { PaymentTermsController } from './payment-terms/payment-terms.controller.js';
import { PaymentTermsService } from './payment-terms/payment-terms.service.js';
import { SubcategoriesController } from './subcategories/subcategories.controller.js';
import { SubcategoriesService } from './subcategories/subcategories.service.js';
import { UnitsController } from './units/units.controller.js';
import { UnitsService } from './units/units.service.js';
import { WarehousesController } from './warehouses/warehouses.controller.js';
import { WarehousesService } from './warehouses/warehouses.service.js';

@Module({
  imports: [AuthModule],
  controllers: [
    GradesController,
    CategoriesController,
    SubcategoriesController,
    ApplicationsController,
    UnitsController,
    AttributesController,
    LocationsController,
    WarehousesController,
    PaymentTermsController,
  ],
  providers: [
    GradesService,
    CategoriesService,
    SubcategoriesService,
    ApplicationsService,
    UnitsService,
    AttributesService,
    LocationsService,
    WarehousesService,
    PaymentTermsService,
  ],
  exports: [
    GradesService,
    CategoriesService,
    SubcategoriesService,
    ApplicationsService,
    UnitsService,
    AttributesService,
    LocationsService,
    WarehousesService,
    PaymentTermsService,
  ],
})
export class MasterDataModule {}
