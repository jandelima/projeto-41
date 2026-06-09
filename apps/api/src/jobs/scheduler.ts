import cron from "node-cron";
import type { AppDatabase } from "@projeto41/db";
import type { createPriceService } from "../prices/price-service.js";
import { createDailySnapshot } from "../services/portfolio-service.js";

export function startScheduler(
  db: AppDatabase,
  priceService: ReturnType<typeof createPriceService>
) {
  const tasks = [
    cron.schedule("*/15 * * * *", () => void priceService.runCrypto(), {
      timezone: "America/Fortaleza"
    }),
    cron.schedule("*/30 10-18 * * 1-5", () => void priceService.runB3(), {
      timezone: "America/Sao_Paulo"
    }),
    cron.schedule("0 */2 * * *", () => void priceService.runCurrency(), {
      timezone: "America/Fortaleza"
    }),
    cron.schedule(
      "59 23 * * *",
      () => {
        const date = new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/Fortaleza",
          year: "numeric",
          month: "2-digit",
          day: "2-digit"
        }).format(new Date());
        createDailySnapshot(db, date);
      },
      { timezone: "America/Fortaleza" }
    )
  ];
  return () => tasks.forEach((task) => task.stop());
}

