import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { CATALOG_ENVIRONMENT, type CatalogEnvironment } from '../common/environment';
import { ReservationService } from './reservation.service';

@Injectable()
export class ReservationExpiryWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private readonly logger = new Logger(ReservationExpiryWorker.name);

  constructor(
    private readonly reservations: ReservationService,
    @Inject(CATALOG_ENVIRONMENT) private readonly environment: CatalogEnvironment,
  ) {}

  onModuleInit() {
    if (this.environment.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      void this.tick();
    }, 1000);
    this.timer.unref();
    void this.tick();
  }

  async tick() {
    if (this.running) return this.running;
    this.running = this.reservations
      .expireDue()
      .catch(() => {
        this.logger.error('Reservation expiry scan failed; retrying on next tick');
      })
      .finally(() => {
        this.running = undefined;
      });
    return this.running;
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    await this.running;
  }
}
