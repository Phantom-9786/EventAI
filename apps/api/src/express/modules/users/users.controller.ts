import type { Request, Response, NextFunction } from 'express';
import { UsersService } from '../../../modules/users/users.service';
import { UnauthorizedError } from '../../types';

export class ExpressUsersController {
  constructor(private readonly usersService: UsersService) {}

  getMe = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');

      const user = await this.usersService.getOwnProfile(userId);
      res.status(200).json({ user });
    } catch (err) {
      next(err);
    }
  };

  updateMe = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');

      const user = await this.usersService.updateProfile(userId, req.body);
      res.status(200).json({ user });
    } catch (err) {
      next(err);
    }
  };

  updatePreferences = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');

      const result = await this.usersService.updatePreferences(userId, req.body.preferences);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  uploadAvatar = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');

      const file = req.file
        ? {
            buffer: req.file.buffer,
            mimetype: req.file.mimetype,
            size: req.file.size,
          }
        : undefined;

      const result = await this.usersService.saveAvatar(userId, file);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  deactivateAccount = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');

      const result = await this.usersService.deactivateAccount(userId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  getDeletionBlockers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');

      const result = await this.usersService.getDeletionBlockers(userId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  deleteAccount = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');

      const result = await this.usersService.deleteAccount(userId, req.body.confirmation);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  getPublicProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = await this.usersService.getPublicProfile(req.params.id);
      res.status(200).json({ user });
    } catch (err) {
      next(err);
    }
  };
}
