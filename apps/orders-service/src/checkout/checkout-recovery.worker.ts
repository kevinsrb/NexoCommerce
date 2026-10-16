import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { type OrdersEnvironment } from '@nexo/config';
import { ORDERS_ENVIRONMENT } from '../common/environment';
import { CheckoutRepository } from './checkout.repository';
import { CheckoutService } from './checkout.service';

@Injectable()
export class CheckoutRecoveryWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private readonly logger = new Logger(CheckoutRecoveryWorker.name);
  constructor(
    private readonly repository: CheckoutRepository,
    private readonly checkout: CheckoutService,
    @Inject(ORDERS_ENVIRONMENT) private readonly environment: OrdersEnvironment,
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
    this.running = this.recover()
      .catch(() => {
        this.logger.error('Checkout recovery scan failed');
      })
      .finally(() => {
        this.running = undefined;
      });
    return this.running;
  }
  private async recover() {
    for (const attempt of await this.repository.recoverable()) {
      if (Date.now() - attempt.createdAt.getTime() > 30 * 60 * 1000)
        this.logger.warn({
          message: 'Checkout recovery age threshold exceeded',
          attemptId: attempt.id,
          request_id: attempt.requestId,
        });
      try {
        await this.checkout.resume(attempt.id, attempt.requestId);
      } catch {
        this.logger.warn({
          message: 'Checkout recovery requires retry or ended with a domain outcome',
          attemptId: attempt.id,
          request_id: attempt.requestId,
        });
      }
    }
  }
  async onModuleDestroy() {
    clearInterval(this.timer);
    await this.running;
  }
}
