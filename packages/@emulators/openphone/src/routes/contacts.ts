import type { Context, RouteContext } from "@emulators/core";
import { getOpenPhoneStore } from "../store.js";
import {
  defaultUserId,
  formatContact,
  listEnvelope,
  openPhoneError,
  openPhoneId,
  parseJson,
  parseMaxResults,
  parsePageToken,
  queryStringArray,
  requireOpenPhoneAuth,
} from "../helpers.js";
import type { OpenPhoneContactCustomField, OpenPhoneContactEmail, OpenPhoneContactPhone } from "../entities.js";

export function contactRoutes({ app, store }: RouteContext): void {
  const ops = () => getOpenPhoneStore(store);

  app.post("/v1/contacts", async (c) => {
    const auth = requireOpenPhoneAuth(c, ops());
    if (auth instanceof Response) return auth;
    const body = await parseJson(c);
    if (body instanceof Response) return body;

    const defaultFieldsRaw =
      body.defaultFields && typeof body.defaultFields === "object" && !Array.isArray(body.defaultFields)
        ? (body.defaultFields as Record<string, unknown>)
        : {};
    const customFieldsRaw = Array.isArray(body.customFields) ? body.customFields : [];

    const emails = normalizeEmails(defaultFieldsRaw.emails);
    const phoneNumbers = normalizePhones(defaultFieldsRaw.phoneNumbers);
    const customFields = normalizeCustomFields(customFieldsRaw);

    const contact = ops().contacts.insert({
      openphone_id: openPhoneId("CN", 16),
      external_id: typeof body.externalId === "string" ? body.externalId : null,
      source: typeof body.source === "string" ? body.source : "public-api",
      source_url: typeof body.sourceUrl === "string" ? body.sourceUrl : null,
      created_by_user_id: defaultUserId(ops()),
      default_fields: {
        firstName: stringOrNull(defaultFieldsRaw.firstName),
        lastName: stringOrNull(defaultFieldsRaw.lastName),
        company: stringOrNull(defaultFieldsRaw.company),
        role: stringOrNull(defaultFieldsRaw.role),
        emails,
        phoneNumbers,
      },
      custom_fields: customFields,
    });

    return c.json({ data: formatContact(contact) }, 201);
  });

  app.get("/v1/contacts", (c) => {
    const auth = requireOpenPhoneAuth(c, ops());
    if (auth instanceof Response) return auth;

    const externalIds = queryStringArray(c, "externalIds");
    const sources = queryStringArray(c, "sources");
    const maxResults = parseMaxResults(c, 10, 50);
    const offset = parsePageToken(c);

    let contacts = ops().contacts.all();
    if (externalIds.length > 0) {
      contacts = contacts.filter((contact) => contact.external_id != null && externalIds.includes(contact.external_id));
    }
    if (sources.length > 0) {
      contacts = contacts.filter((contact) => contact.source != null && sources.includes(contact.source));
    }
    contacts = contacts.sort((a, b) => b.id - a.id);
    return c.json(listEnvelope(contacts.map(formatContact), maxResults, offset));
  });

  app.get("/v1/contacts/:id", (c) => {
    const auth = requireOpenPhoneAuth(c, ops());
    if (auth instanceof Response) return auth;
    const contact = findContact(c);
    if (contact instanceof Response) return contact;
    return c.json({ data: formatContact(contact) });
  });

  app.patch("/v1/contacts/:id", async (c) => {
    const auth = requireOpenPhoneAuth(c, ops());
    if (auth instanceof Response) return auth;
    const contact = findContact(c);
    if (contact instanceof Response) return contact;
    const body = await parseJson(c);
    if (body instanceof Response) return body;

    const defaultFieldsRaw =
      body.defaultFields && typeof body.defaultFields === "object" && !Array.isArray(body.defaultFields)
        ? (body.defaultFields as Record<string, unknown>)
        : null;
    const customFieldsRaw = Array.isArray(body.customFields) ? body.customFields : null;

    const updated = ops().contacts.update(contact.id, {
      external_id: typeof body.externalId === "string" ? body.externalId : contact.external_id,
      source: typeof body.source === "string" ? body.source : contact.source,
      source_url: typeof body.sourceUrl === "string" ? body.sourceUrl : contact.source_url,
      default_fields: defaultFieldsRaw
        ? {
            firstName:
              defaultFieldsRaw.firstName !== undefined
                ? stringOrNull(defaultFieldsRaw.firstName)
                : contact.default_fields.firstName,
            lastName:
              defaultFieldsRaw.lastName !== undefined
                ? stringOrNull(defaultFieldsRaw.lastName)
                : contact.default_fields.lastName,
            company:
              defaultFieldsRaw.company !== undefined
                ? stringOrNull(defaultFieldsRaw.company)
                : contact.default_fields.company,
            role:
              defaultFieldsRaw.role !== undefined ? stringOrNull(defaultFieldsRaw.role) : contact.default_fields.role,
            emails:
              defaultFieldsRaw.emails !== undefined
                ? normalizeEmails(defaultFieldsRaw.emails)
                : contact.default_fields.emails,
            phoneNumbers:
              defaultFieldsRaw.phoneNumbers !== undefined
                ? normalizePhones(defaultFieldsRaw.phoneNumbers)
                : contact.default_fields.phoneNumbers,
          }
        : contact.default_fields,
      custom_fields: customFieldsRaw ? normalizeCustomFields(customFieldsRaw) : contact.custom_fields,
    })!;

    return c.json({ data: formatContact(updated) });
  });

  app.delete("/v1/contacts/:id", (c) => {
    const auth = requireOpenPhoneAuth(c, ops());
    if (auth instanceof Response) return auth;
    const contact = findContact(c);
    if (contact instanceof Response) return contact;
    ops().contacts.delete(contact.id);
    return c.body(null, 204);
  });

  app.get("/v1/contact-custom-fields", (c) => {
    const auth = requireOpenPhoneAuth(c, ops());
    if (auth instanceof Response) return auth;
    const data = ops()
      .customFields.all()
      .map((field) => ({ key: field.key, name: field.name, type: field.field_type }));
    return c.json({ data });
  });

  function findContact(c: Context) {
    const contact = ops().contacts.findOneBy("openphone_id", c.req.param("id"));
    if (!contact) return openPhoneError(c, 404, "Not Found", "Contact not found", "not_found");
    return contact;
  }
}

function stringOrNull(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value == null) return null;
  return String(value);
}

function normalizeEmails(value: unknown): OpenPhoneContactEmail[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    return {
      id: typeof row.id === "string" ? row.id : openPhoneId("EM", 8),
      name: typeof row.name === "string" ? row.name : "email",
      value: typeof row.value === "string" ? row.value : null,
    };
  });
}

function normalizePhones(value: unknown): OpenPhoneContactPhone[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    return {
      id: typeof row.id === "string" ? row.id : openPhoneId("PH", 8),
      name: typeof row.name === "string" ? row.name : "phone",
      value: typeof row.value === "string" ? row.value : null,
    };
  });
}

function normalizeCustomFields(value: unknown[]): OpenPhoneContactCustomField[] {
  return value.map((item) => {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    return {
      id: typeof row.id === "string" ? row.id : openPhoneId("CF", 8),
      key: typeof row.key === "string" ? row.key : "",
      value: row.value == null ? null : String(row.value),
      name: typeof row.name === "string" ? row.name : undefined,
      type: typeof row.type === "string" ? row.type : undefined,
    };
  });
}
