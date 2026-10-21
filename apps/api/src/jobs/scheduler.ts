import cron from "node-cron";
import type { AppDatabase } from "@projeto41/db";
import type { CdiService } from "../cdi/cdi-service.js";
import type { createPriceService } from "../prices/price-service.js";
import { createDailySnapshots } from "../services/portfolio-service.js";
import { syncAllYields } from "../services/yield-sync.js";

function localDate(timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

export function startScheduler(
  db: AppDatabase,
  priceService: ReturnType<typeof createPriceService>,
  timezone = "America/Fortaleza",
  cdiService?: CdiService
) {
  const tasks = [
    // Tres vezes por dia util cobre a publicacao D+1 do BCB e fica muito abaixo
    // do teto de 4 requisicoes por hora. Fim de semana nao tem o que publicar.
    ...(cdiService
      ? [
          // Logo depois da série, o rendimento entra nas caixinhas e posições.
          cron.schedule(
            "20 9,13,19 * * 1-5",
            () =>
              void cdiService
                .refresh()
                .catch(() => undefined)
                .then(() => syncAllYields(db, localDate(timezone))),
            { timezone }
          )
        ]
      : []),
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
        // O retrato do dia sai com o rendimento em dia.
        syncAllYields(db, localDate(timezone));
        createDailySnapshots(db, localDate(timezone));
      },
      { timezone }
    )
  ];
  return () => tasks.forEach((task) => task.stop());
}
