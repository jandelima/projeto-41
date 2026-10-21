import { z } from "zod";
import type { RoutePlugin } from "./index.js";

export const registerIconsRoutes: RoutePlugin = (app, { iconService }) => {
  if (!iconService) return;
  app.get("/api/icons/:kind/:key", async (request, reply) => {
    const { kind, key } = z
      .object({
        kind: z.enum(["crypto", "b3", "institution"]),
        key: z.string().min(1).max(80)
      })
      .parse(request.params);
    const icon = await iconService.read(kind, key);
    if (!icon) return reply.status(404).send({ error: "Icone indisponivel" });
    reply.header("Cache-Control", "public, max-age=604800");
    return reply.type(icon.contentType).send(icon.data);
  });
};
