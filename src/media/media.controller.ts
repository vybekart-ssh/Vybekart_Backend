import {
  Controller,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { SellerVerifiedGuard } from '../auth/seller-verified.guard';
import { Role } from '@prisma/client';
import { SupabaseStorageService } from '../storage/supabase-storage.service';

@Controller('media')
export class MediaController {
  constructor(private readonly supabase: SupabaseStorageService) {}

  @Post('images')
  @UseGuards(JwtAuthGuard, RolesGuard, SellerVerifiedGuard)
  @Roles(Role.SELLER)
  @UseInterceptors(
    FilesInterceptor('images', 6, {
      limits: { fileSize: 8 * 1024 * 1024 },
    }),
  )
  async uploadImages(
    @Request() req: { user: { id: string } },
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    if (!files?.length) throw new BadRequestException('No images uploaded');
    const bucket = this.supabase.publicBucket();
    const urls: string[] = [];
    for (const f of files) {
      const mime = (f.mimetype ?? '').toLowerCase();
      if (!mime.startsWith('image/')) {
        throw new BadRequestException('Only image uploads are allowed');
      }
      const ext = mime.includes('png')
        ? '.png'
        : mime.includes('webp')
          ? '.webp'
          : mime.includes('gif')
            ? '.gif'
            : '.jpg';
      const objectKey = `vybekart-images/products/${req.user.id}/img-${Date.now()}-${Math.random()
        .toString(16)
        .slice(2)}${ext}`;
      const { publicUrl } = await this.supabase.uploadPublicObject({
        bucket,
        objectKey,
        contentType: mime,
        bytes: f.buffer,
        cacheControlSeconds: 60 * 60 * 24 * 30,
        upsert: true,
      });
      urls.push(publicUrl);
    }
    return { urls };
  }
}

