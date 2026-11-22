import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { request } from "node:https";
import { MediaError } from "./errors.ts";

const platforms = ["youtube.com", "youtu.be", "tiktok.com", "instagram.com", "vimeo.com"];
const blocked = new BlockList();
for (const [network, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]] as const) blocked.addSubnet(network, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
blocked.addSubnet("2001::", 23, "ipv6");
blocked.addSubnet("2001:db8::", 32, "ipv6");

export function isPublicAddress(address: string) {
  const family = isIP(address);
  return family === 4 ? !blocked.check(address, "ipv4") : family === 6 && globalV6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}

function platformUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new MediaError("REFERENCE_URL", "Enter a valid public video link or upload the reference file."); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || !platforms.some((p) => host === p || host.endsWith("." + p))) throw new MediaError("REFERENCE_URL", "Use an HTTPS video link from a supported public video platform, or upload the reference file.");
  url.hash = "";
  return url;
}

/** Reject arbitrary/private initial URLs. The deployment must also restrict downloader egress. */
export async function validatePublicReferenceUrl(value: string): Promise<URL> {
  const url = platformUrl(value);
  let addresses;
  try { addresses = await lookup(url.hostname, { all: true }); } catch { throw new MediaError("REFERENCE_URL", "The reference host could not be resolved. Upload the reference video instead."); }
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw new MediaError("REFERENCE_URL", "Reference links must resolve to a public video platform.");
  return url;
}

/** Inspect bounded page redirects using pinned public DNS addresses before invoking the extractor. */
export async function resolvePublicReferenceUrl(value: string, signal?: AbortSignal): Promise<string> {
  let url = platformUrl(value);
  for (let redirect = 0; redirect <= 3; redirect++) {
    const addresses = await lookup(url.hostname, { all: true }).catch(() => { throw new MediaError("REFERENCE_URL", "The reference host could not be resolved. Upload the reference video instead."); });
    if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw new MediaError("REFERENCE_URL", "Reference links must resolve to a public video platform.");
    const address = addresses.find((address) => address.family === 4) ?? addresses[0];
    const location = await new Promise<string | undefined>((resolve, reject) => {
      const req = request({ hostname: address.address, family: address.family, servername: url.hostname, port: 443, path: url.pathname + url.search, method: "HEAD", headers: { Host: url.hostname }, signal, timeout: 10_000 }, (res) => {
        res.resume();
        resolve(res.statusCode && res.statusCode >= 300 && res.statusCode < 400 ? res.headers.location : undefined);
      });
      req.on("timeout", () => req.destroy(new Error("reference timeout")));
      req.on("error", () => reject(new MediaError(signal?.aborted ? "CANCELLED" : "REFERENCE_URL", signal?.aborted ? "Reference analysis was cancelled." : "The reference link could not be opened. Upload the reference video instead.")));
      req.end();
    });
    if (!location) return url.href;
    url = platformUrl(new URL(location, url).href);
  }
  throw new MediaError("REFERENCE_URL", "This reference link redirects too many times. Upload the reference video instead.");
}
