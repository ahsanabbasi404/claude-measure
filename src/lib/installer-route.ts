import { publicOrigin, readClientFile, type ClientFile } from "./client-files";

/** Serves an installer script with this deployment's URL filled in. Contains no secrets. */
export async function serveInstaller(req: Request, file: ClientFile) {
  const source = (await readClientFile(file)).replace(/\r\n/g, "\n");
  return new Response(source.replaceAll("__CCM_URL__", publicOrigin(req)), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
