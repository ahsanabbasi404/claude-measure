import { serveInstaller } from "@/lib/installer-route";

export async function GET(req: Request) {
  return serveInstaller(req, "installPosix");
}
