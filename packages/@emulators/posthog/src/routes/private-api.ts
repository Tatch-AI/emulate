import type { Context, RouteContext } from "@emulators/core";
import { parseJsonBody } from "@emulators/core";
import type { PostHogFlagFilters, PostHogProject } from "../entities.js";
import {
  formatEvent,
  formatFeatureFlag,
  formatPerson,
  formatProject,
  nextAnnotationId,
  nextFlagId,
  paginateResults,
  parseLimitOffset,
  posthogError,
  requirePersonalApiKey,
} from "../helpers.js";
import { getPostHogStore, type PostHogStore } from "../store.js";

export function privateApiRoutes({ app, store }: RouteContext): void {
  const ps = () => getPostHogStore(store);

  const withAuth = (handler: (c: Context, store: PostHogStore) => Response | Promise<Response>) => {
    return async (c: Context) => {
      const auth = requirePersonalApiKey(c, ps());
      if (auth !== true) return auth;
      return handler(c, ps());
    };
  };

  const resolveProject = (c: Context, storeRef: PostHogStore): PostHogProject | Response => {
    const idParam = c.req.param("project_id") || c.req.param("id");
    if (!idParam || idParam === "@current") {
      const project = storeRef.projects.all()[0];
      if (!project) return posthogError(c, 404, "invalid_request", "not_found", "Project not found.");
      return project;
    }
    const projectId = Number(idParam);
    const project =
      storeRef.projects.findOneBy("project_id", projectId) ??
      storeRef.projects.all().find((item) => String(item.project_id) === idParam);
    if (!project) return posthogError(c, 404, "invalid_request", "not_found", "Project not found.");
    return project;
  };

  app.get(
    "/api/projects/@current/",
    withAuth(async (c, storeRef) => {
      const project = storeRef.projects.all()[0];
      if (!project) return posthogError(c, 404, "invalid_request", "not_found", "Project not found.");
      return c.json(formatProject(project));
    }),
  );
  app.get(
    "/api/projects/@current",
    withAuth(async (c, storeRef) => {
      const project = storeRef.projects.all()[0];
      if (!project) return posthogError(c, 404, "invalid_request", "not_found", "Project not found.");
      return c.json(formatProject(project));
    }),
  );

  app.get(
    "/api/projects/:id/",
    withAuth(async (c, storeRef) => {
      const project = resolveProject(c, storeRef);
      if (project instanceof Response) return project;
      return c.json(formatProject(project));
    }),
  );
  app.get(
    "/api/projects/:id",
    withAuth(async (c, storeRef) => {
      const project = resolveProject(c, storeRef);
      if (project instanceof Response) return project;
      return c.json(formatProject(project));
    }),
  );

  // Feature flags CRUD
  for (const base of ["/api/projects/:project_id/feature_flags/", "/api/projects/:project_id/feature_flags"]) {
    app.get(
      base,
      withAuth(async (c, storeRef) => {
        const project = resolveProject(c, storeRef);
        if (project instanceof Response) return project;
        const { limit, offset } = parseLimitOffset(c);
        const items = storeRef.featureFlags
          .all()
          .filter((flag) => flag.project_id === project.project_id && !flag.deleted)
          .sort((a, b) => b.flag_id - a.flag_id)
          .map(formatFeatureFlag);
        return c.json(
          paginateResults(items, limit, offset, `/api/projects/${project.project_id}/feature_flags/`, {
            limit: String(limit),
          }),
        );
      }),
    );

    app.post(
      base,
      withAuth(async (c, storeRef) => {
        const project = resolveProject(c, storeRef);
        if (project instanceof Response) return project;
        const body = await parseJsonBody(c);
        const key = String(body.key ?? "");
        if (!key) return posthogError(c, 400, "validation_error", "invalid_input", "key is required");

        const existing = storeRef.featureFlags
          .all()
          .find((flag) => flag.project_id === project.project_id && flag.key === key && !flag.deleted);
        if (existing) {
          return posthogError(c, 400, "validation_error", "already_exists", "Feature flag already exists");
        }

        const flag = storeRef.featureFlags.insert({
          flag_id: nextFlagId(storeRef),
          project_id: project.project_id,
          key,
          name: String(body.name ?? key),
          active: body.active !== false,
          deleted: false,
          filters: (body.filters as PostHogFlagFilters) ?? { groups: [{ properties: [], rollout_percentage: 100 }] },
          ensure_experience_continuity: Boolean(body.ensure_experience_continuity),
          rollout_percentage: typeof body.rollout_percentage === "number" ? body.rollout_percentage : null,
          version: 1,
        });
        return c.json(formatFeatureFlag(flag), 201);
      }),
    );
  }

  for (const path of [
    "/api/projects/:project_id/feature_flags/:id/",
    "/api/projects/:project_id/feature_flags/:id",
  ]) {
    app.get(
      path,
      withAuth(async (c, storeRef) => {
        const project = resolveProject(c, storeRef);
        if (project instanceof Response) return project;
        const flag = findFlag(storeRef, project.project_id, c.req.param("id"));
        if (!flag) return posthogError(c, 404, "invalid_request", "not_found", "Feature flag not found.");
        return c.json(formatFeatureFlag(flag));
      }),
    );

    app.patch(
      path,
      withAuth(async (c, storeRef) => {
        const project = resolveProject(c, storeRef);
        if (project instanceof Response) return project;
        const flag = findFlag(storeRef, project.project_id, c.req.param("id"));
        if (!flag) return posthogError(c, 404, "invalid_request", "not_found", "Feature flag not found.");
        const body = await parseJsonBody(c);
        const updated = storeRef.featureFlags.update(flag.id, {
          name: typeof body.name === "string" ? body.name : flag.name,
          key: typeof body.key === "string" ? body.key : flag.key,
          active: typeof body.active === "boolean" ? body.active : flag.active,
          filters: body.filters ? (body.filters as PostHogFlagFilters) : flag.filters,
          ensure_experience_continuity:
            typeof body.ensure_experience_continuity === "boolean"
              ? body.ensure_experience_continuity
              : flag.ensure_experience_continuity,
          rollout_percentage:
            typeof body.rollout_percentage === "number" ? body.rollout_percentage : flag.rollout_percentage,
          version: flag.version + 1,
        })!;
        return c.json(formatFeatureFlag(updated));
      }),
    );

    app.delete(
      path,
      withAuth(async (c, storeRef) => {
        const project = resolveProject(c, storeRef);
        if (project instanceof Response) return project;
        const flag = findFlag(storeRef, project.project_id, c.req.param("id"));
        if (!flag) return posthogError(c, 404, "invalid_request", "not_found", "Feature flag not found.");
        storeRef.featureFlags.update(flag.id, { deleted: true, active: false, version: flag.version + 1 });
        return c.json({ success: true });
      }),
    );
  }

  // Persons
  for (const base of ["/api/projects/:project_id/persons/", "/api/projects/:project_id/persons"]) {
    app.get(
      base,
      withAuth(async (c, storeRef) => {
        const project = resolveProject(c, storeRef);
        if (project instanceof Response) return project;
        const distinctId = c.req.query("distinct_id");
        const search = c.req.query("search");
        const { limit, offset } = parseLimitOffset(c);
        let items = storeRef.persons.all().filter((person) => person.project_id === project.project_id);
        if (distinctId) {
          items = items.filter((person) => person.distinct_ids.includes(distinctId));
        }
        if (search) {
          const needle = search.toLowerCase();
          items = items.filter(
            (person) =>
              person.distinct_ids.some((id) => id.toLowerCase().includes(needle)) ||
              JSON.stringify(person.properties).toLowerCase().includes(needle),
          );
        }
        const formatted = items.sort((a, b) => b.id - a.id).map(formatPerson);
        return c.json(
          paginateResults(formatted, limit, offset, `/api/projects/${project.project_id}/persons/`, {
            distinct_id: distinctId,
            search,
          }),
        );
      }),
    );
  }

  for (const path of ["/api/projects/:project_id/persons/:id/", "/api/projects/:project_id/persons/:id"]) {
    app.get(
      path,
      withAuth(async (c, storeRef) => {
        const project = resolveProject(c, storeRef);
        if (project instanceof Response) return project;
        const id = c.req.param("id");
        const person = storeRef.persons
          .all()
          .find(
            (item) =>
              item.project_id === project.project_id &&
              (String(item.id) === id || item.uuid === id || item.distinct_ids.includes(id)),
          );
        if (!person) return posthogError(c, 404, "invalid_request", "not_found", "Person not found.");
        return c.json(formatPerson(person));
      }),
    );
  }

  // Events
  for (const base of ["/api/projects/:project_id/events/", "/api/projects/:project_id/events"]) {
    app.get(
      base,
      withAuth(async (c, storeRef) => {
        const project = resolveProject(c, storeRef);
        if (project instanceof Response) return project;
        const eventName = c.req.query("event");
        const distinctId = c.req.query("distinct_id");
        const after = c.req.query("after");
        const before = c.req.query("before");
        const { limit, offset } = parseLimitOffset(c);

        let items = storeRef.events.all().filter((event) => event.project_id === project.project_id);
        if (eventName) items = items.filter((event) => event.event === eventName);
        if (distinctId) items = items.filter((event) => event.distinct_id === distinctId);
        if (after) items = items.filter((event) => event.timestamp >= after);
        if (before) items = items.filter((event) => event.timestamp < before);

        const formatted = items.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)).map(formatEvent);
        return c.json(
          paginateResults(formatted, limit, offset, `/api/projects/${project.project_id}/events/`, {
            event: eventName,
            distinct_id: distinctId,
            after,
            before,
          }),
        );
      }),
    );
  }

  // Annotations
  for (const base of ["/api/projects/:project_id/annotations/", "/api/projects/:project_id/annotations"]) {
    app.get(
      base,
      withAuth(async (c, storeRef) => {
        const project = resolveProject(c, storeRef);
        if (project instanceof Response) return project;
        const { limit, offset } = parseLimitOffset(c);
        const items = storeRef.annotations
          .all()
          .filter((item) => item.project_id === project.project_id)
          .sort((a, b) => b.annotation_id - a.annotation_id)
          .map((item) => ({
            id: item.annotation_id,
            content: item.content,
            date_marker: item.date_marker,
            scope: item.scope,
            created_at: item.created_at,
            updated_at: item.updated_at,
          }));
        return c.json(
          paginateResults(items, limit, offset, `/api/projects/${project.project_id}/annotations/`, {}),
        );
      }),
    );

    app.post(
      base,
      withAuth(async (c, storeRef) => {
        const project = resolveProject(c, storeRef);
        if (project instanceof Response) return project;
        const body = await parseJsonBody(c);
        const content = String(body.content ?? "");
        if (!content) return posthogError(c, 400, "validation_error", "invalid_input", "content is required");
        const annotation = storeRef.annotations.insert({
          annotation_id: nextAnnotationId(storeRef),
          project_id: project.project_id,
          content,
          date_marker: typeof body.date_marker === "string" ? body.date_marker : null,
          scope: typeof body.scope === "string" ? body.scope : "project",
        });
        return c.json(
          {
            id: annotation.annotation_id,
            content: annotation.content,
            date_marker: annotation.date_marker,
            scope: annotation.scope,
            created_at: annotation.created_at,
            updated_at: annotation.updated_at,
          },
          201,
        );
      }),
    );
  }

}

function findFlag(storeRef: PostHogStore, projectId: number, idOrKey: string) {
  return storeRef.featureFlags
    .all()
    .find(
      (flag) =>
        flag.project_id === projectId &&
        !flag.deleted &&
        (String(flag.flag_id) === idOrKey || flag.key === idOrKey),
    );
}
