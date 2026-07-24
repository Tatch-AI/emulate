import type { RouteContext } from "@emulators/core";
import { getDeepgramStore } from "../store.js";
import { deepgramError, generateOpaqueToken, generateUuid, queryInt, requireDeepgramAuth } from "../helpers.js";

export function projectsRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const ds = () => getDeepgramStore(store);

  app.get("/v1/projects", (c) => {
    const auth = requireDeepgramAuth(c, ds());
    if (auth instanceof Response) return auth;

    return c.json({
      projects: ds().projects.all().map((p) => ({
        project_id: p.project_id,
        name: p.name,
        company: p.company ?? undefined,
      })),
    });
  });

  app.get("/v1/projects/:project_id", (c) => {
    const auth = requireDeepgramAuth(c, ds());
    if (auth instanceof Response) return auth;

    const project = ds().projects.findOneBy("project_id", c.req.param("project_id"));
    if (!project) return deepgramError(c, 404, "Not Found", "Project not found.");

    return c.json({
      project_id: project.project_id,
      name: project.name,
      company: project.company ?? undefined,
    });
  });

  app.patch("/v1/projects/:project_id", async (c) => {
    const auth = requireDeepgramAuth(c, ds());
    if (auth instanceof Response) return auth;

    const project = ds().projects.findOneBy("project_id", c.req.param("project_id"));
    if (!project) return deepgramError(c, 404, "Not Found", "Project not found.");

    let body: Record<string, unknown> = {};
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return deepgramError(c, 400, "Bad Request", "Invalid JSON body.");
    }

    if (typeof body.name === "string") {
      ds().projects.update(project.id, { name: body.name });
    }
    if (typeof body.company === "string" || body.company === null) {
      ds().projects.update(project.id, { company: (body.company as string | null) ?? null });
    }

    return c.json({ message: "Project updated" });
  });

  app.delete("/v1/projects/:project_id", (c) => {
    const auth = requireDeepgramAuth(c, ds());
    if (auth instanceof Response) return auth;

    const project = ds().projects.findOneBy("project_id", c.req.param("project_id"));
    if (!project) return deepgramError(c, 404, "Not Found", "Project not found.");

    ds().projects.delete(project.id);
    for (const key of ds().apiKeys.findBy("project_id", project.project_id)) {
      ds().apiKeys.delete(key.id);
    }
    for (const member of ds().members.findBy("project_id", project.project_id)) {
      ds().members.delete(member.id);
    }

    return c.json({ message: "Project deleted" });
  });

  app.get("/v1/projects/:project_id/keys", (c) => {
    const auth = requireDeepgramAuth(c, ds());
    if (auth instanceof Response) return auth;

    const project = ds().projects.findOneBy("project_id", c.req.param("project_id"));
    if (!project) return deepgramError(c, 404, "Not Found", "Project not found.");

    const api_keys = ds()
      .apiKeys.findBy("project_id", project.project_id)
      .map((key) => ({
        member: {
          member_id: key.member_id,
          email: key.member_email,
        },
        api_key: {
          api_key_id: key.api_key_id,
          comment: key.comment,
          scopes: key.scopes,
          created: key.created,
          expiration_date: key.expiration_date ?? undefined,
        },
      }));

    return c.json({ api_keys });
  });

  app.get("/v1/projects/:project_id/keys/:key_id", (c) => {
    const auth = requireDeepgramAuth(c, ds());
    if (auth instanceof Response) return auth;

    const key = ds().apiKeys.findOneBy("api_key_id", c.req.param("key_id"));
    if (!key || key.project_id !== c.req.param("project_id")) {
      return deepgramError(c, 404, "Not Found", "API key not found.");
    }

    return c.json({
      member: {
        member_id: key.member_id,
        email: key.member_email,
        api_key: {
          api_key_id: key.api_key_id,
          comment: key.comment,
          scopes: key.scopes,
          created: key.created,
          expiration_date: key.expiration_date ?? undefined,
        },
      },
    });
  });

  app.post("/v1/projects/:project_id/keys", async (c) => {
    const auth = requireDeepgramAuth(c, ds());
    if (auth instanceof Response) return auth;

    const project = ds().projects.findOneBy("project_id", c.req.param("project_id"));
    if (!project) return deepgramError(c, 404, "Not Found", "Project not found.");

    let body: Record<string, unknown> = {};
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return deepgramError(c, 400, "Bad Request", "Invalid JSON body.");
    }

    const comment = typeof body.comment === "string" ? body.comment : "";
    const scopes = Array.isArray(body.scopes) ? body.scopes.map(String) : ["member"];
    let expiration_date: string | null = null;
    if (typeof body.expiration_date === "string") {
      expiration_date = body.expiration_date;
    } else if (body.time_to_live_in_seconds != null) {
      const ttl = Number(body.time_to_live_in_seconds);
      if (Number.isFinite(ttl) && ttl > 0) {
        expiration_date = new Date(Date.now() + ttl * 1000).toISOString();
      }
    }

    const created = new Date().toISOString();
    const api_key_id = generateUuid();
    const key = generateOpaqueToken("dg");
    let member = ds().members.findBy("project_id", project.project_id)[0];
    if (!member) {
      member = ds().members.insert({
        member_id: generateUuid(),
        project_id: project.project_id,
        email: "owner@emulate.dev",
        first_name: "Owner",
        last_name: "User",
        scopes: ["admin"],
      });
    }

    ds().apiKeys.insert({
      api_key_id,
      key,
      project_id: project.project_id,
      comment,
      scopes,
      created,
      expiration_date,
      member_id: member.member_id,
      member_email: member.email,
    });

    return c.json({
      api_key_id,
      key,
      comment,
      scopes,
      created,
      expiration_date: expiration_date ?? undefined,
    });
  });

  app.delete("/v1/projects/:project_id/keys/:key_id", (c) => {
    const auth = requireDeepgramAuth(c, ds());
    if (auth instanceof Response) return auth;

    const key = ds().apiKeys.findOneBy("api_key_id", c.req.param("key_id"));
    if (!key || key.project_id !== c.req.param("project_id")) {
      return deepgramError(c, 404, "Not Found", "API key not found.");
    }

    ds().apiKeys.delete(key.id);
    return c.json({ message: "API key deleted" });
  });

  app.get("/v1/projects/:project_id/members", (c) => {
    const auth = requireDeepgramAuth(c, ds());
    if (auth instanceof Response) return auth;

    const project = ds().projects.findOneBy("project_id", c.req.param("project_id"));
    if (!project) return deepgramError(c, 404, "Not Found", "Project not found.");

    return c.json({
      members: ds()
        .members.findBy("project_id", project.project_id)
        .map((m) => ({
          member_id: m.member_id,
          email: m.email,
          first_name: m.first_name,
          last_name: m.last_name,
          scopes: m.scopes,
        })),
    });
  });

  app.get("/v1/projects/:project_id/requests", (c) => {
    const auth = requireDeepgramAuth(c, ds());
    if (auth instanceof Response) return auth;

    const project = ds().projects.findOneBy("project_id", c.req.param("project_id"));
    if (!project) return deepgramError(c, 404, "Not Found", "Project not found.");

    const page = queryInt(c, "page", 1) ?? 1;
    const limit = Math.min(queryInt(c, "limit", 10) ?? 10, 100);
    const all = ds()
      .usageRequests.findBy("project_id", project.project_id)
      .sort((a, b) => b.id - a.id);
    const start = (page - 1) * limit;
    const slice = all.slice(start, start + limit);

    return c.json({
      page,
      limit,
      requests: slice.map((r) => ({
        request_id: r.request_id,
        project_uuid: r.project_id,
        created: r.created,
        path: r.path,
        api_key_id: r.api_key_id ?? undefined,
        code: r.code,
      })),
    });
  });

  app.get("/v1/projects/:project_id/usage", (c) => {
    const auth = requireDeepgramAuth(c, ds());
    if (auth instanceof Response) return auth;

    const project = ds().projects.findOneBy("project_id", c.req.param("project_id"));
    if (!project) return deepgramError(c, 404, "Not Found", "Project not found.");

    const requests = ds().usageRequests.findBy("project_id", project.project_id);
    const totalHours = requests.reduce((sum, r) => sum + r.duration_hours, 0);
    const now = new Date();
    const start = requests[0]?.created ?? now.toISOString();

    return c.json({
      start,
      end: now.toISOString(),
      resolution: { units: "hour", amount: 1 },
      results: [
        {
          start,
          end: now.toISOString(),
          hours: totalHours,
          total_hours: totalHours,
          requests: requests.length,
        },
      ],
      total_requests: requests.length,
      total_hours: totalHours,
    });
  });
}
