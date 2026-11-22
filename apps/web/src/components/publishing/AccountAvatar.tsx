"use client";

import Image from "next/image";
import { useState } from "react";
import type { AccountView } from "../../../../../services/publishing/src/types";

function AccountPhoto({ account }: { account: AccountView }) {
  const [failed, setFailed] = useState(false), [loaded, setLoaded] = useState(false);
  return <span className="uf-publish-account-avatar" aria-hidden="true">
    {!loaded && (account.identity?.handle.slice(0, 1).toUpperCase() || "?")}
    {account.platform === "instagram" && account.status === "connected" && !failed && <Image src={`/api/publishing/connections/${encodeURIComponent(account.id)}/avatar?checked=${account.verifiedAt ?? 0}`} alt="" width={40} height={40} unoptimized className={loaded ? "is-loaded" : ""} onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />}
  </span>;
}

export function AccountAvatar({ account }: { account: AccountView }) {
  return <AccountPhoto key={`${account.id}:${account.verifiedAt}`} account={account} />;
}
