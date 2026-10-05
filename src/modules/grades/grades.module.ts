import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/index.js';
import { AdminGradeImportsController } from './admin-grade-imports.controller.js';
import { GradeImportService } from './grade-import.service.js';
import { GradeMasterBootstrap } from './grade-master.bootstrap.js';

/**
 * Source.One grade master import (CSV -> PostgreSQL Grade table).
 * Grade CRUD and read APIs live in MasterDataModule (`/master-data/grades`,
 * `/admin/grades`).
 */
@Module({
  imports: [AuthModule],
  controllers: [AdminGradeImportsController],
  providers: [GradeImportService, GradeMasterBootstrap],
  exports: [GradeImportService],
})
export class GradesModule {}
