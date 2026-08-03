import { APP_VERSION } from "../../AppVersion";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { appVersion: APP_VERSION },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
