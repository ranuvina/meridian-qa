import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { DbService } from '../db/db.service';

@Injectable()
export class AuthService {
  constructor(private readonly db: DbService) {}

  private signAccess(userId: string) {
    return jwt.sign({ sub: userId }, process.env.JWT_SECRET, {
      expiresIn: Number(process.env.ACCESS_TOKEN_TTL || 900),
    });
  }

  async login(email: string, password: string) {
    const user = await this.db.one(
      `SELECT id, email, password_hash FROM users WHERE email = $1`,
      [email],
    );
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    const refreshToken = randomBytes(32).toString('hex');
    const ttl = Number(process.env.REFRESH_TOKEN_TTL || 604800);
    await this.db.query(
      `INSERT INTO sessions (user_id, refresh_token, expires_at)
       VALUES ($1, $2, now() + ($3 || ' seconds')::interval)`,
      [user.id, refreshToken, String(ttl)],
    );

    const memberships = await this.db.query(
      `SELECT t.id, t.name, t.slug, t.plan, m.role
         FROM memberships m JOIN tenants t ON t.id = m.tenant_id
        WHERE m.user_id = $1
        ORDER BY t.name`,
      [user.id],
    );

    return {
      accessToken: this.signAccess(user.id),
      refreshToken,
      user: { id: user.id, email: user.email },
      tenants: memberships,
    };
  }

  async refresh(refreshToken: string) {
    const session = await this.db.one(
      `SELECT id, user_id FROM sessions
        WHERE refresh_token = $1 AND expires_at > now()`,
      [refreshToken],
    );
    if (!session) throw new UnauthorizedException('Invalid refresh token');

    return { accessToken: this.signAccess(session.user_id) };
  }

  async logout(refreshToken: string) {
    await this.db.query(
      `UPDATE sessions SET revoked_at = now() WHERE refresh_token = $1`,
      [refreshToken],
    );
    return { ok: true };
  }

  async me(userId: string) {
    const user = await this.db.one(`SELECT id, email, created_at FROM users WHERE id = $1`, [userId]);
    const tenants = await this.db.query(
      `SELECT t.id, t.name, t.slug, t.plan, t.timezone, t.suspended, m.role
         FROM memberships m JOIN tenants t ON t.id = m.tenant_id
        WHERE m.user_id = $1`,
      [userId],
    );
    return { user, tenants };
  }
}
