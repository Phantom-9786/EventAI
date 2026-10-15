import type { Request, Response, NextFunction } from 'express';
import { VenuesService } from '../../../modules/venues/venues.service';

export class ExpressVenuesController {
  constructor(private readonly venuesService: VenuesService) {}

  search = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const page = req.query.page ? Math.max(1, parseInt(String(req.query.page), 10) || 1) : 1;
      const limit = req.query.limit
        ? Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10) || 20))
        : 20;

      const result = await this.venuesService.search({
        city: typeof req.query.city === 'string' ? req.query.city : undefined,
        query: typeof req.query.query === 'string' ? req.query.query : undefined,
        page,
        limit,
      });

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  getVenue = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const venue = await this.venuesService.getVenue(req.params.id);
      res.status(200).json({ venue });
    } catch (err) {
      next(err);
    }
  };
}
