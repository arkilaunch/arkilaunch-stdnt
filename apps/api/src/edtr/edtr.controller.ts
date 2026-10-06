import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { MAX_UPLOAD_BYTES, type EdtrCaptureRequest } from '@arkilaunch/shared';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { validateUpload } from '../storage/upload-validation.js';
import { StorageService, edtrBucket } from '../storage/storage.service.js';
import { EdtrService } from './edtr.service.js';
import { EdtrApproveDto, EdtrBillPreviewQueryDto, EdtrCaptureDto, EdtrRotationDto, EdtrTranscribeDto, EdtrListQueryDto, EdtrRejectDto, EdtrReviewDto } from './dto.js';
import type { CtxRequest, MulterFile } from '../common/request.js';

@Controller('edtr')
export class EdtrController {
  constructor(
    private readonly edtr: EdtrService,
    private readonly storage: StorageService,
  ) {}

  // Tighter cap: each capture queues an Azure DI extraction. FileInterceptor only engages on multipart,
  // so digital_entry JSON passes through untouched.
  @Post()
  @RequirePermission('edtr:create')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async capture(@Body() body: EdtrCaptureDto, @UploadedFile() file: MulterFile | undefined, @Req() req: CtxRequest) {
    let rawFileUri: string | undefined;
    if (body.source === 'paper_ocr') {
      const validated = validateUpload(file);
      const key = this.storage.buildObjectKey(req.ctx.tenantId, validated.extension);
      await this.storage.uploadObject(edtrBucket(), key, file!.buffer, validated.contentType);
      rawFileUri = key;
    }

    const captureRequest: EdtrCaptureRequest = { ...body, rawFileUri };
    return this.edtr.capture(req.ctx, captureRequest);
  }

  // Staff only; the service's timekeeper site-scoping stays as defence in depth.
  @Get()
  @RequirePermission('edtr:read')
  list(@Query() query: EdtrListQueryDto, @Req() req: CtxRequest) {
    return this.edtr.list(req.ctx, query);
  }

  // edtr:create too: the timekeeper polls their own capture and previews its scan (site-scoped in the service).
  @Get(':id')
  @RequirePermission('edtr:create', 'edtr:read')
  get(@Param('id') id: string, @Req() req: CtxRequest) {
    return this.edtr.get(req.ctx, id);
  }

  @Patch(':id/rotation')
  @RequirePermission('edtr:approve')
  rotate(@Param('id') id: string, @Body() body: EdtrRotationDto, @Req() req: CtxRequest) {
    return this.edtr.setRotation(req.ctx, id, body.degrees);
  }

  // Approvers only: hours typed from the photo of a sheet the worker could not read.
  @Post(':id/transcribe')
  @RequirePermission('edtr:approve')
  transcribe(@Param('id') id: string, @Body() body: EdtrTranscribeDto, @Req() req: CtxRequest) {
    return this.edtr.transcribe(req.ctx, id, body);
  }

  // Approvers only: it prices hours exactly as approve() would, without writing anything.
  @Get(':id/bill-preview')
  @RequirePermission('edtr:approve')
  billPreview(@Param('id') id: string, @Query() query: EdtrBillPreviewQueryDto, @Req() req: CtxRequest) {
    return this.edtr.billPreview(req.ctx, id, query);
  }

  // Never a public URL; the key is re-derived from the owning row under RLS.
  @Get(':id/image')
  @RequirePermission('edtr:create', 'edtr:read')
  async image(@Param('id') id: string, @Req() req: CtxRequest) {
    const key = await this.edtr.rawFileKey(req.ctx, id);
    const url = await this.storage.createSignedDownloadUrl(edtrBucket(), key);
    return { url, expiresInSeconds: 300 };
  }

  // Three segments, so it never collides with ':id/approve'.
  @Post('reconciliations/:reconciliationId/approve')
  @RequirePermission('edtr:approve')
  approveByReconciliation(
    @Param('reconciliationId') reconciliationId: string,
    @Body() body: EdtrApproveDto,
    @Req() req: CtxRequest,
  ) {
    return this.edtr.approveByReconciliation(req.ctx, reconciliationId, body);
  }

  @Post(':id/approve')
  @RequirePermission('edtr:approve')
  approve(@Param('id') id: string, @Body() body: EdtrApproveDto, @Req() req: CtxRequest) {
    return this.edtr.approve(req.ctx, id, body);
  }

  @Post(':id/review')
  @RequirePermission('edtr:approve')
  review(@Param('id') id: string, @Body() body: EdtrReviewDto, @Req() req: CtxRequest) {
    return this.edtr.review(req.ctx, id, body);
  }

  @Post(':id/reject')
  @RequirePermission('edtr:approve')
  reject(@Param('id') id: string, @Body() body: EdtrRejectDto, @Req() req: CtxRequest) {
    return this.edtr.reject(req.ctx, id, body);
  }
}
