import { Injectable, NotFoundException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';

export interface CategoryAttributeHintDto {
  key: string;
  label: string;
}

export interface CategoryMetadataResponseDto {
  slug: string;
  formKind: 'fashion' | 'electronics' | 'general';
  brands: string[];
  attributeHints: CategoryAttributeHintDto[];
  /** Where brands came from (for debugging / client UX) */
  brandsSource: 'static' | 'external' | 'mixed';
}

/**
 * Static + optional DummyJSON public API for brand suggestions.
 * Fails gracefully when external API is down.
 */
@Injectable()
export class CategoriesService {
  constructor(
    private prisma: PrismaService,
    private readonly http: HttpService,
  ) {}

  async findAll() {
    return this.prisma.category.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        iconUrl: true,
        parentId: true,
      },
    });
  }

  async findOne(id: string) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: { children: true },
    });
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  private classifySlug(slug: string): 'fashion' | 'electronics' | 'general' {
    const s = slug.toLowerCase();
    if (
      /electronic|mobile|computer|gadget|phone|laptop|audio|tv|camera/.test(
        s,
      )
    ) {
      return 'electronics';
    }
    if (
      /fashion|apparel|clothing|beauty|footwear|jewel|bag|accessories/.test(s)
    ) {
      return 'fashion';
    }
    return 'general';
  }

  private staticBrands(kind: 'fashion' | 'electronics' | 'general'): string[] {
    if (kind === 'electronics') {
      return [
        'Samsung',
        'Apple',
        'Sony',
        'LG',
        'OnePlus',
        'Xiaomi',
        'Realme',
        'HP',
        'Dell',
        'Lenovo',
        'Boat',
        'JBL',
      ];
    }
    if (kind === 'fashion') {
      return [
        'Zara',
        'H&M',
        'Mango',
        'FabIndia',
        'Biba',
        'Manyavar',
        'Puma',
        'Nike',
        'Adidas',
      ];
    }
    return [];
  }

  private attributeHints(
    kind: 'fashion' | 'electronics' | 'general',
  ): CategoryAttributeHintDto[] {
    if (kind === 'electronics') {
      return [
        { key: 'processor', label: 'Processor / SoC' },
        { key: 'ram', label: 'RAM' },
        { key: 'storage', label: 'Storage' },
        { key: 'display', label: 'Display' },
        { key: 'battery', label: 'Battery' },
        { key: 'warranty', label: 'Warranty' },
      ];
    }
    if (kind === 'fashion') {
      return [
        { key: 'fabricCare', label: 'Fabric care' },
        { key: 'fit', label: 'Fit' },
        { key: 'pattern', label: 'Pattern' },
      ];
    }
    return [{ key: 'notes', label: 'Additional notes' }];
  }

  async getMetadata(slug: string): Promise<CategoryMetadataResponseDto> {
    const normalized = (slug || 'general').toLowerCase().replace(/\s+/g, '-');
    const kind = this.classifySlug(normalized);
    const staticBrands = this.staticBrands(kind);
    let brandsSource: CategoryMetadataResponseDto['brandsSource'] = 'static';
    const merged = new Set<string>(staticBrands);

    try {
      const { data } = await firstValueFrom(
        this.http.get<{
          products?: { brand?: string }[];
        }>('https://dummyjson.com/products', {
          params: { limit: 50, select: 'brand' },
          timeout: 5000,
        }),
      );
      const fromApi = (data?.products ?? [])
        .map((p) => p.brand?.trim())
        .filter((b): b is string => !!b && b.length > 0);
      for (const b of fromApi) merged.add(b);
      if (fromApi.length > 0) {
        brandsSource = merged.size > staticBrands.length ? 'mixed' : 'external';
      }
    } catch {
      // External API optional — keep static lists only
    }

    const brands = [...merged].sort((a, b) => a.localeCompare(b));

    return {
      slug: normalized,
      formKind: kind,
      brands,
      attributeHints: this.attributeHints(kind),
      brandsSource,
    };
  }
}
