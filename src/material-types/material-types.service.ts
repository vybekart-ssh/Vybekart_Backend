import { Injectable } from '@nestjs/common';

export interface MaterialTypeItem {
  id: string;
  name: string;
}

@Injectable()
export class MaterialTypesService {
  private readonly defaultList: MaterialTypeItem[] = [
    { id: 'cotton', name: 'Cotton' },
    { id: 'polyester', name: 'Polyester' },
    { id: 'silk', name: 'Silk' },
    { id: 'linen', name: 'Linen' },
    { id: 'wool', name: 'Wool' },
    { id: 'leather', name: 'Leather' },
    { id: 'denim', name: 'Denim' },
    { id: 'velvet', name: 'Velvet' },
    { id: 'nylon', name: 'Nylon' },
    { id: 'rayon', name: 'Rayon' },
    { id: 'blend', name: 'Blend' },
    { id: 'other', name: 'Other' },
  ];

  findAll(): MaterialTypeItem[] {
    return this.defaultList;
  }
}
