// ============================================================
// SecureTeam — Middleware de Roles
// Controla acceso basado en ADMIN / USER
// ============================================================

import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth.js';

/**
 * Middleware que restringe acceso solo a administradores.
 * Debe usarse DESPUÉS de authMiddleware.
 */
export function adminOnly(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({
      success: false,
      error: 'No autenticado',
    });
    return;
  }

  if (req.user.role !== 'ADMIN') {
    res.status(403).json({
      success: false,
      error: 'Acceso denegado. Se requieren permisos de Administrador.',
    });
    return;
  }

  next();
}

/**
 * Middleware que permite acceso a cualquier usuario autenticado.
 * Debe usarse DESPUÉS de authMiddleware.
 */
export function anyRole(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({
      success: false,
      error: 'No autenticado',
    });
    return;
  }

  next();
}

/**
 * Factory: permite acceso solo a los roles especificados.
 */
export function requireRole(...roles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'No autenticado',
      });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        error: `Acceso denegado. Roles permitidos: ${roles.join(', ')}`,
      });
      return;
    }

    next();
  };
}
