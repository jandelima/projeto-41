import cron from "node-cron";
import type { AppDatabase } from "@projeto41/db";
import type { createPriceService } from "../prices/price-service.js";
import { createDailySnapshot } from "../services/portfolio-service.js";

export function startScheduler(
  db: AppDatabase,
  priceService: ReturnType<typeof createPriceService>,
  timezone = "America/Fortaleza"
) {
  const tasks = [
    cron.schedule("*/15 * * * *", () => void priceService.runCrypto(), {
      timezone
    }),
    cron.schedule("*/30 10-18 * * 1-5", () => void priceService.runB3(), {
      timezone
    }),
    cron.schedule("0 */2 * * *", () => void priceService.runCurrency(), {
      timezone
    }),
    cron.schedule(
      "59 23 * * *",
      () => {
        const date = new Intl.DateTimeFormat("en-CA", {
          timeZone: timezone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit"
        }).format(new Date());
        createDailySnapshot(db, date);
      },
      { timezone }
    )
  ];
  return () => tasks.forEach((task) => task.stop());
}
