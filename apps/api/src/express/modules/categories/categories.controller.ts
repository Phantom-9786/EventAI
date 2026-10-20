import type { Request, Response, NextFunction } from 'express';
import { CategoriesService } from '../../../modules/categories/categories.service';

export class ExpressCategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  spotlights = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try { res.json({ spotlights: await this.categoriesService.spotlights(), windowDays: 30 }); }
    catch (error) { next(error); }
  };

  list = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const categories = await this.categoriesService.listActive();
      res.status(200).json({ categories });
    } catch (err) {
      next(err);
    }
  };

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const category = await this.categoriesService.create(req.body);
      res.status(201).json({ category });
    } catch (err) {
      next(err);
    }
  };

  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const category = await this.categoriesService.update(req.params.id, req.body);
      res.status(200).json({ category });
    } catch (err) {
      next(err);
    }
  };

  deactivate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.categoriesService.deactivate(req.params.id);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };
}
