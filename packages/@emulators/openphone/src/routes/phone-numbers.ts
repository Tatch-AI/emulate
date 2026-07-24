import type { RouteContext } from "@emulators/core";
import { getOpenPhoneStore } from "../store.js";
import { formatPhoneNumber, openPhoneError, requireOpenPhoneAuth } from "../helpers.js";

export function phoneNumberRoutes({ app, store }: RouteContext): void {
  const ops = () => getOpenPhoneStore(store);

  app.get("/v1/phone-numbers", (c) => {
    const auth = requireOpenPhoneAuth(c, ops());
    if (auth instanceof Response) return auth;
    const userId = c.req.query("userId");
    let numbers = ops().phoneNumbers.all();
    if (userId) {
      numbers = numbers.filter((number) => number.user_ids.includes(userId));
    }
    return c.json({ data: numbers.map((number) => formatPhoneNumber(ops(), number)) });
  });

  app.get("/v1/phone-numbers/:phoneNumberId", (c) => {
    const auth = requireOpenPhoneAuth(c, ops());
    if (auth instanceof Response) return auth;
    const number = ops().phoneNumbers.findOneBy("openphone_id", c.req.param("phoneNumberId"));
    if (!number) return openPhoneError(c, 404, "Not Found", "Phone number not found", "not_found");
    return c.json({ data: formatPhoneNumber(ops(), number) });
  });
}
