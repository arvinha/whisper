import { connection } from "next/server";
import { authorizedCaller } from "@/lib/server/auth";
import { getServerConfig, toPublicConfig } from "@/lib/server/config";
import { json } from "@/lib/server/errors";

export async function GET(req: Request) {
  // Read the environment per request, not once at build time.
  await connection();
  const config = getServerConfig();
  return json(toPublicConfig(config, await authorizedCaller(req, config)));
}
